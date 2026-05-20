import * as k8s from '@kubernetes/client-node'
import { readFileSync } from 'node:fs'
import type { Logger } from '@sardeenz/utils'
import { config } from '../config.js'
import { buildSignedHeaders } from './cluster-auth.js'

export interface DiscoveredPeer {
  podId: string
  address: string
  port: number
}

export interface PeerDiscovery {
  onPeerAdded: ((peer: DiscoveredPeer) => void) | null
  onPeerRemoved: ((podId: string) => void) | null
  start(): Promise<void>
  stop(): void
}

// ---------------------------------------------------------------------------
// Kubernetes-based discovery using Watch API
// ---------------------------------------------------------------------------

export class KubernetesPeerDiscovery implements PeerDiscovery {
  onPeerAdded: ((peer: DiscoveredPeer) => void) | null = null
  onPeerRemoved: ((podId: string) => void) | null = null

  private kc: k8s.KubeConfig
  private watcher: k8s.Watch
  private abortController: AbortController | null = null
  private namespace: string = 'default'
  private knownPods: Map<string, DiscoveredPeer> = new Map()
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
    this.kc = new k8s.KubeConfig()
    this.kc.loadFromCluster()
    this.watcher = new k8s.Watch(this.kc)
  }

  async start(): Promise<void> {
    // Read namespace from mounted ServiceAccount
    try {
      this.namespace = readFileSync(
        '/var/run/secrets/kubernetes.io/serviceaccount/namespace',
        'utf-8'
      ).trim()
    } catch {
      this.namespace = config.namespace
    }

    this.logger.info({ namespace: this.namespace }, 'Starting Kubernetes peer discovery')

    // Initial pod list
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    const { items } = await coreApi.listNamespacedPod({
      namespace: this.namespace,
      labelSelector: 'app=sardeenz',
    })

    for (const pod of items) {
      this.handlePodEvent('ADDED', pod)
    }

    // Watch for changes
    this.startWatch()
  }

  private startWatch(): void {
    const path = `/api/v1/namespaces/${this.namespace}/pods`

    this.watcher
      .watch(
        path,
        { labelSelector: 'app=sardeenz' },
        (phase: string, pod: k8s.V1Pod) => {
          this.handlePodEvent(phase, pod)
        },
        (err: unknown) => {
          if (err) {
            this.logger.error({ err }, 'Kubernetes watch error, restarting watch')
          }
          // Restart watch on error or closure (unless stopped)
          if (this.abortController) {
            setTimeout(() => this.startWatch(), 5000)
          }
        }
      )
      .then((ac) => {
        this.abortController = ac
      })
      .catch((err: unknown) => {
        this.logger.error({ err }, 'Failed to start Kubernetes watch')
      })
  }

  private handlePodEvent(phase: string, pod: k8s.V1Pod): void {
    const podName = pod.metadata?.name
    const podIp = pod.status?.podIP
    const podPhase = pod.status?.phase

    if (!podName) return

    if (phase === 'ADDED' || phase === 'MODIFIED') {
      // Only add pods that are Running and have an IP
      if (podPhase === 'Running' && podIp) {
        if (!this.knownPods.has(podName)) {
          const peer: DiscoveredPeer = {
            podId: podName,
            address: podIp,
            port: config.port,
          }
          this.knownPods.set(podName, peer)
          this.logger.info({ podId: podName, address: podIp }, 'Peer added via K8s discovery')
          this.onPeerAdded?.(peer)
        }
      } else if (podPhase !== 'Running' && this.knownPods.has(podName)) {
        // Pod no longer running
        this.knownPods.delete(podName)
        this.logger.info({ podId: podName }, 'Peer removed (not running) via K8s discovery')
        this.onPeerRemoved?.(podName)
      }
    } else if (phase === 'DELETED') {
      if (this.knownPods.has(podName)) {
        this.knownPods.delete(podName)
        this.logger.info({ podId: podName }, 'Peer removed via K8s discovery')
        this.onPeerRemoved?.(podName)
      }
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.knownPods.clear()
    this.logger.info('Kubernetes peer discovery stopped')
  }
}

// ---------------------------------------------------------------------------
// Static peer list discovery with health polling
// ---------------------------------------------------------------------------

const HEALTH_POLL_INTERVAL_MS = 10_000
const HEALTH_CHECK_TIMEOUT_MS = 5_000

export class StaticPeerDiscovery implements PeerDiscovery {
  onPeerAdded: ((peer: DiscoveredPeer) => void) | null = null
  onPeerRemoved: ((podId: string) => void) | null = null

  private peers: Array<{ host: string; port: number }>
  private knownPods: Map<string, DiscoveredPeer> = new Map()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private logger: Logger

  constructor(clusterPeers: string, logger: Logger) {
    this.logger = logger
    this.peers = clusterPeers
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((entry) => {
        const [host, portStr] = entry.split(':')
        return { host, port: parseInt(portStr, 10) || config.port }
      })
  }

  async start(): Promise<void> {
    this.logger.info(
      { peerCount: this.peers.length },
      'Starting static peer discovery'
    )

    // Initial health check
    await this.pollPeers()

    // Start periodic polling
    this.pollTimer = setInterval(() => {
      this.pollPeers().catch((err) => {
        this.logger.error({ err }, 'Static peer poll error')
      })
    }, HEALTH_POLL_INTERVAL_MS)
  }

  private async pollPeers(): Promise<void> {
    const activePodIds = new Set<string>()

    await Promise.allSettled(
      this.peers.map(async ({ host, port }) => {
        const podId = `${host}:${port}`
        try {
          const headers = buildSignedHeaders('GET', '/internal/ping', '')
          const response = await fetch(`http://${host}:${port}/internal/ping`, {
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
            headers,
          })

          if (response.ok) {
            activePodIds.add(podId)
            if (!this.knownPods.has(podId)) {
              const peer: DiscoveredPeer = {
                podId,
                address: host,
                port,
              }
              this.knownPods.set(podId, peer)
              this.logger.info({ podId, address: host }, 'Peer added via static discovery')
              this.onPeerAdded?.(peer)
            }
          }
        } catch {
          // Peer unreachable
        }
      })
    )

    // Remove peers that didn't respond
    for (const [podId] of this.knownPods) {
      if (!activePodIds.has(podId)) {
        this.knownPods.delete(podId)
        this.logger.info({ podId }, 'Peer removed via static discovery')
        this.onPeerRemoved?.(podId)
      }
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.knownPods.clear()
    this.logger.info('Static peer discovery stopped')
  }
}

// ---------------------------------------------------------------------------
// No-op discovery for single-instance mode
// ---------------------------------------------------------------------------

class NoOpPeerDiscovery implements PeerDiscovery {
  onPeerAdded: ((peer: DiscoveredPeer) => void) | null = null
  onPeerRemoved: ((podId: string) => void) | null = null

  async start(): Promise<void> {
    // No-op: single instance mode
  }

  stop(): void {
    // No-op
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createPeerDiscovery(logger: Logger): PeerDiscovery {
  // Priority 1: Kubernetes environment detected
  if (process.env.KUBERNETES_SERVICE_HOST) {
    logger.info('Kubernetes environment detected, using K8s peer discovery')
    return new KubernetesPeerDiscovery(logger)
  }

  // Priority 2: Static peer list configured
  if (config.clusterPeers) {
    logger.info('CLUSTER_PEERS configured, using static peer discovery')
    return new StaticPeerDiscovery(config.clusterPeers, logger)
  }

  // Priority 3: Single-instance mode
  logger.info('No cluster configuration, running in single-instance mode')
  return new NoOpPeerDiscovery()
}
