import { hostname } from 'node:os'
import type { Logger } from '@sardeenz/utils'
import type { ClusterState, PeerModelEntry, PeerGpuInfo } from '@sardeenz/types'
import { createPeerDiscovery } from './peer-discovery.js'
import type { PeerDiscovery, DiscoveredPeer } from './peer-discovery.js'
import { createLeaderElection } from './leader-election.js'
import type { LeaderElection } from './leader-election.js'
import { HeartbeatService } from './heartbeat.js'
import type { HeartbeatDataProvider } from './heartbeat.js'
import { peerStore } from '../stores/peer-store.js'
import { clusterRoutingStore } from '../stores/cluster-routing-store.js'
import { config } from '../config.js'
import { modelStore } from '../stores/model-store.js'
import { getNvidiaSmiInfo } from '../utils/gpu-info.js'

export class ClusterManager implements HeartbeatDataProvider {
  private podId: string
  private discovery: PeerDiscovery
  private election: LeaderElection
  private heartbeat: HeartbeatService
  private logger: Logger
  private _isClusterMode: boolean
  private _clusterServicesStarted = false

  constructor(logger: Logger) {
    this.logger = logger
    // In K8s, hostname() returns the pod name (e.g. "sardeenz-0") which is unique.
    // With static peers (local dev), derive podId from CLUSTER_PEERS to match discovery IDs.
    if (config.clusterPeers) {
      const selfEntry = config.clusterPeers
        .split(',')
        .map((p) => p.trim())
        .find((entry) => {
          const port = parseInt(entry.split(':')[1], 10) || config.port
          return port === config.port
        })
      this.podId = selfEntry ?? `${hostname()}:${config.port}`
    } else {
      this.podId = hostname()
    }
    this._isClusterMode = !!(process.env.KUBERNETES_SERVICE_HOST || config.clusterPeers)

    // Set local pod ID on routing store
    clusterRoutingStore.setLocalPodId(this.podId)

    // Create sub-services, passing resolved podId for consistency
    this.discovery = createPeerDiscovery(logger)
    this.election = createLeaderElection(logger, this.podId)
    this.heartbeat = new HeartbeatService(logger, this, this.podId)

    // Wire up discovery callbacks
    this.discovery.onPeerAdded = (peer: DiscoveredPeer) => this.handlePeerAdded(peer)
    this.discovery.onPeerRemoved = (podId: string) => this.handlePeerRemoved(podId)

    // Wire up leader election callback
    this.election.onLeaderChange = (leaderId: string, term: number) => {
      this.logger.info({ leaderId, term }, 'Leader changed')
      const role = leaderId === this.podId ? 'leader' : 'follower'
      peerStore.updatePeer(this.podId, { role, term })
    }
  }

  async start(): Promise<void> {
    // Register self as a peer
    peerStore.addPeer({
      podId: this.podId,
      address: config.host === '0.0.0.0' ? '127.0.0.1' : config.host,
      port: config.port,
      role: 'follower',
      status: 'healthy',
      lastHeartbeat: Date.now(),
      term: 0,
      models: [],
      gpus: [],
      joinedAt: Date.now(),
    })

    if (!this._isClusterMode) {
      // Single-pod mode: zero overhead — no timers, no network calls
      // Discovery is a no-op, election returns always-leader, heartbeat not started
      this.logger.info('Running in single-instance mode, cluster services skipped')
      await this.election.start()
      return
    }

    // Cluster mode: start all sub-services
    await this.startClusterServices()

    // Start GPU info refresh for heartbeat data
    await this.refreshGpuInfo()
    this.gpuRefreshTimer = setInterval(() => {
      this.refreshGpuInfo().catch(() => {})
    }, ClusterManager.GPU_REFRESH_INTERVAL_MS)

    this.logger.info({ podId: this.podId, clusterMode: true }, 'ClusterManager started')
  }

  private async startClusterServices(): Promise<void> {
    if (this._clusterServicesStarted) return
    this._clusterServicesStarted = true

    await this.discovery.start()
    await this.election.start()
    await this.heartbeat.start()
  }

  stop(): void {
    if (this.gpuRefreshTimer) {
      clearInterval(this.gpuRefreshTimer)
      this.gpuRefreshTimer = null
    }
    if (this._clusterServicesStarted) {
      this.heartbeat.stop()
      this.election.stop()
      this.discovery.stop()
    } else {
      this.election.stop()
    }
    peerStore.clear()
    this.logger.info('ClusterManager stopped')
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  isClusterMode(): boolean {
    return this._isClusterMode
  }

  isLeader(): boolean {
    return this.election.isLeader()
  }

  getClusterState(): ClusterState {
    return {
      clusterId: `${config.namespace}-sardeenz`,
      term: this.election.getCurrentTerm(),
      leaderId: this.election.getLeaderId() ?? this.podId,
      peers: new Map(peerStore.getAllPeers().map((p) => [p.podId, p])),
      routingTable: clusterRoutingStore.getRoutingTable(),
      expectedSize: config.clusterExpectedPods > 0
        ? config.clusterExpectedPods
        : peerStore.count(),
    }
  }

  getLeaderAddress(): string | null {
    const leaderId = this.election.getLeaderId()
    if (!leaderId) return null

    const leader = peerStore.getPeer(leaderId)
    if (!leader) return null

    return `${leader.address}:${leader.port}`
  }

  getPodId(): string {
    return this.podId
  }

  getHeartbeatService(): HeartbeatService {
    return this.heartbeat
  }

  // ---------------------------------------------------------------------------
  // HeartbeatDataProvider implementation
  // ---------------------------------------------------------------------------

  getModels(): PeerModelEntry[] {
    return modelStore.getAll().map((instance) => ({
      instanceId: instance.id,
      modelPath: instance.modelPath,
      modelName: instance.modelName,
      port: instance.port,
      status: instance.status,
      gpuIds: instance.gpuIds,
      tensorParallelSize: instance.tensorParallelSize,
      maxTokens: instance.maxTokens,
    }))
  }

  getGpus(): PeerGpuInfo[] {
    return this.cachedGpus
  }

  private cachedGpus: PeerGpuInfo[] = []
  private gpuRefreshTimer: ReturnType<typeof setInterval> | null = null
  private static readonly GPU_REFRESH_INTERVAL_MS = 5_000

  async refreshGpuInfo(): Promise<void> {
    try {
      const info = await getNvidiaSmiInfo()
      this.cachedGpus = info.gpus.map((gpu) => ({
        gpuId: gpu.index,
        name: gpu.name,
        totalVramMB: gpu.memoryTotalMB,
        usedVramMB: gpu.memoryUsedMB,
        temperature: parseInt(gpu.temperature) || 0,
        utilization: parseInt(gpu.gpuUtilization) || 0,
      }))
      peerStore.updatePeer(this.podId, { gpus: this.cachedGpus, models: this.getModels() })
    } catch {
      // Keep previous cached data on failure
    }
  }

  getCurrentTerm(): number {
    return this.election.getCurrentTerm()
  }

  getRole(): 'leader' | 'follower' {
    return this.election.isLeader() ? 'leader' : 'follower'
  }

  getClusterVersion(): number {
    return clusterRoutingStore.getVersion()
  }

  // ---------------------------------------------------------------------------
  // Discovery callbacks
  // ---------------------------------------------------------------------------

  private static readonly MAX_CLUSTER_SIZE = 8

  private handlePeerAdded(peer: DiscoveredPeer): void {
    // Enforce cluster size cap (SC-006)
    if (peerStore.count() >= ClusterManager.MAX_CLUSTER_SIZE) {
      this.logger.warn(
        { podId: peer.podId, currentSize: peerStore.count(), max: ClusterManager.MAX_CLUSTER_SIZE },
        'Rejecting peer: cluster at maximum capacity'
      )
      return
    }

    // Add to peer store if not already known
    if (!peerStore.getPeer(peer.podId)) {
      peerStore.addPeer({
        podId: peer.podId,
        address: peer.address,
        port: peer.port,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: 0,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })

      this.logger.info({ podId: peer.podId, address: peer.address }, 'Peer added to cluster')
    }

    // Auto-activate cluster services on first peer discovery (lazy activation)
    if (!this._clusterServicesStarted && !this._isClusterMode) {
      this.logger.info('First peer discovered, activating cluster services')
      this.startClusterServices()
        .then(() => {
          this._isClusterMode = true
          this.logger.info('Cluster services activated successfully')
        })
        .catch((err) => {
          this._clusterServicesStarted = false
          this.logger.error({ err }, 'Failed to start cluster services on peer discovery')
        })
    }
  }

  private handlePeerRemoved(podId: string): void {
    peerStore.removePeer(podId)
    clusterRoutingStore.removeEntriesForPod(podId)
    this.logger.info({ podId }, 'Peer removed from cluster')
  }
}

// Lazy singleton
let _clusterManagerInstance: ClusterManager | null = null

export function getClusterManager(logger: Logger): ClusterManager {
  if (!_clusterManagerInstance) {
    _clusterManagerInstance = new ClusterManager(logger)
  }
  return _clusterManagerInstance
}
