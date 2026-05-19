import { hostname } from 'node:os'
import type { Logger } from '@sardeenz/utils'
import type { HeartbeatMessage, HeartbeatAck, PeerModelEntry, PeerGpuInfo } from '@sardeenz/types'
import { buildSignedHeaders } from './cluster-auth.js'
import { peerStore } from '../stores/peer-store.js'
import { clusterRoutingStore } from '../stores/cluster-routing-store.js'
import { config } from '../config.js'

const HEARTBEAT_INTERVAL_MS = 5_000
const HEARTBEAT_TIMEOUT_MS = 2_000
const STARTUP_JITTER_MS = 2_000
const SUSPECT_THRESHOLD_MS = 10_000
const UNAVAILABLE_THRESHOLD_MS = 15_000
const REAPER_INTERVAL_MS = 5_000

export interface HeartbeatDataProvider {
  getModels(): PeerModelEntry[]
  getGpus(): PeerGpuInfo[]
  getCurrentTerm(): number
  getRole(): 'leader' | 'follower'
  getClusterVersion(): number
}

export class HeartbeatService {
  private podId: string
  private sendTimer: ReturnType<typeof setInterval> | null = null
  private reaperTimer: ReturnType<typeof setInterval> | null = null
  private logger: Logger
  private dataProvider: HeartbeatDataProvider
  private rebuildTimeout: ReturnType<typeof setTimeout> | null = null
  private static readonly REBUILD_DEBOUNCE_MS = 500

  constructor(logger: Logger, dataProvider: HeartbeatDataProvider, podId?: string) {
    this.logger = logger
    this.podId = podId ?? hostname()
    this.dataProvider = dataProvider
  }

  async start(): Promise<void> {
    // Startup jitter to avoid thundering herd
    const jitter = Math.random() * STARTUP_JITTER_MS

    this.logger.info(
      { podId: this.podId, jitterMs: Math.round(jitter) },
      'Starting heartbeat service'
    )

    setTimeout(() => {
      // Send first heartbeat immediately after jitter
      this.sendHeartbeats()

      // Start periodic heartbeat sending
      this.sendTimer = setInterval(() => {
        this.sendHeartbeats()
      }, HEARTBEAT_INTERVAL_MS)
    }, jitter)

    // Start failure detection reaper immediately
    this.reaperTimer = setInterval(() => {
      this.reapPeers()
    }, REAPER_INTERVAL_MS)
  }

  stop(): void {
    if (this.sendTimer) {
      clearInterval(this.sendTimer)
      this.sendTimer = null
    }
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer)
      this.reaperTimer = null
    }
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout)
      this.rebuildTimeout = null
    }
    this.logger.info('Heartbeat service stopped')
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimeout) return
    this.rebuildTimeout = setTimeout(() => {
      this.rebuildTimeout = null
      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())
    }, HeartbeatService.REBUILD_DEBOUNCE_MS)
  }

  // ---------------------------------------------------------------------------
  // Heartbeat sending
  // ---------------------------------------------------------------------------

  private sendHeartbeats(): void {
    const peers = peerStore.getAllPeers().filter((p) => p.podId !== this.podId)

    for (const peer of peers) {
      this.sendHeartbeatToPeer(peer.address, peer.port).catch((err) => {
        const errorMsg = (err as Error).message ?? String(err)
        const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('abort')
        const isConnectionRefused = errorMsg.includes('ECONNREFUSED') || errorMsg.includes('connect')

        this.logger.warn(
          {
            podId: peer.podId,
            address: peer.address,
            errorType: isTimeout ? 'timeout' : isConnectionRefused ? 'connection_refused' : 'unknown',
            error: errorMsg,
          },
          'Failed to send heartbeat to peer'
        )
      })
    }
  }

  private async sendHeartbeatToPeer(address: string, port: number): Promise<void> {
    const message: HeartbeatMessage = {
      podId: this.podId,
      role: this.dataProvider.getRole(),
      term: this.dataProvider.getCurrentTerm(),
      timestamp: Date.now(),
      models: this.dataProvider.getModels(),
      gpus: this.dataProvider.getGpus(),
      clusterVersion: this.dataProvider.getClusterVersion(),
    }

    const body = JSON.stringify(message)
    const path = '/internal/heartbeat'
    const method = 'POST'

    const headers = buildSignedHeaders(method, path, body)

    const response = await fetch(`http://${address}:${port}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    })

    if (response.ok) {
      const ack: HeartbeatAck = await response.json() as HeartbeatAck
      this.handleAck(ack)
    }
  }

  private handleAck(ack: HeartbeatAck): void {
    // Update peer's last heartbeat timestamp (resets to healthy)
    peerStore.updateLastHeartbeat(ack.podId, Date.now())
  }

  // ---------------------------------------------------------------------------
  // Process incoming heartbeat (called by /internal/heartbeat route handler)
  // ---------------------------------------------------------------------------

  processIncomingHeartbeat(message: HeartbeatMessage, sourceIp?: string): HeartbeatAck {
    const peer = peerStore.getPeer(message.podId)

    if (peer) {
      // Update existing peer; fill in address if it was empty
      const updates: Record<string, unknown> = {
        role: message.role,
        term: message.term,
        models: message.models,
        gpus: message.gpus,
      }
      if (!peer.address && sourceIp) {
        updates.address = sourceIp
      }
      peerStore.updatePeer(message.podId, updates)
      peerStore.updateLastHeartbeat(message.podId, Date.now())
    } else {
      // New peer discovered via heartbeat — use source IP as address
      // Extract port from podId (format: "host:port") to avoid using local config.port
      const peerPort = parseInt(message.podId.split(':').pop() ?? '', 10) || config.port
      peerStore.addPeer({
        podId: message.podId,
        address: sourceIp || '',
        port: peerPort,
        role: message.role,
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: message.term,
        models: message.models,
        gpus: message.gpus,
        joinedAt: Date.now(),
      })
    }

    // Always rebuild routing table from latest peer state.
    // Version-number comparison is unreliable: each pod increments its own counter
    // independently, so two pods can reach the same version number with different
    // routing contents (e.g. both at v1 after independently loading different models).
    // The rebuild is debounced (500ms) so burst heartbeats only cause one rebuild.
    this.scheduleRebuild()

    return {
      podId: this.podId,
      term: this.dataProvider.getCurrentTerm(),
      role: this.dataProvider.getRole(),
      clusterVersion: clusterRoutingStore.getVersion(),
    }
  }

  // ---------------------------------------------------------------------------
  // Failure detection reaper
  // ---------------------------------------------------------------------------

  private reapPeers(): void {
    const now = Date.now()
    const peers = peerStore.getAllPeers().filter((p) => p.podId !== this.podId)

    for (const peer of peers) {
      const timeSinceLastHeartbeat = now - peer.lastHeartbeat

      if (peer.status === 'healthy' && timeSinceLastHeartbeat > SUSPECT_THRESHOLD_MS) {
        // healthy → suspect
        peerStore.markSuspect(peer.podId)
        this.logger.warn(
          {
            podId: peer.podId,
            transition: 'healthy→suspect',
            lastHeartbeatAge: timeSinceLastHeartbeat,
            thresholdMs: SUSPECT_THRESHOLD_MS,
          },
          'Peer state transition: healthy → suspect'
        )
      } else if (peer.status === 'suspect' && timeSinceLastHeartbeat > UNAVAILABLE_THRESHOLD_MS) {
        // suspect → unavailable
        peerStore.markUnavailable(peer.podId)
        this.logger.error(
          {
            podId: peer.podId,
            transition: 'suspect→unavailable',
            lastHeartbeatAge: timeSinceLastHeartbeat,
            thresholdMs: UNAVAILABLE_THRESHOLD_MS,
            modelsAffected: peer.models.length,
          },
          'Peer state transition: suspect → unavailable, removing from routing table'
        )

        // Remove from routing table
        clusterRoutingStore.removeEntriesForPod(peer.podId)
      }
    }
  }
}
