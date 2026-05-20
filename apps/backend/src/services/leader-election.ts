import * as k8s from '@kubernetes/client-node'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import type { Logger } from '@sardeenz/utils'
import { peerStore } from '../stores/peer-store.js'
import { config } from '../config.js'

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LeaderElection {
  start(): Promise<void>
  stop(): void
  isLeader(): boolean
  getCurrentTerm(): number
  getLeaderId(): string | null

  onLeaderChange: ((leaderId: string, term: number) => void) | null
}

// ---------------------------------------------------------------------------
// Quorum calculation (per research.md Section 4)
// ---------------------------------------------------------------------------

function calculateQuorum(clusterSize: number): number {
  return Math.floor(clusterSize / 2) + 1
}

// ---------------------------------------------------------------------------
// K8s Lease-based leader election
// ---------------------------------------------------------------------------

const LEASE_NAME = 'sardeenz-leader'
const LEASE_DURATION_SECONDS = 15
const RENEW_INTERVAL_MS = 10_000

export class KubernetesLeaderElection implements LeaderElection {
  onLeaderChange: ((leaderId: string, term: number) => void) | null = null

  private coordApi: k8s.CoordinationV1Api
  private namespace: string = 'default'
  private podId: string
  private term = 0
  private leaderId: string | null = null
  private _isLeader = false
  private renewTimer: ReturnType<typeof setInterval> | null = null
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
    this.podId = hostname()

    const kc = new k8s.KubeConfig()
    kc.loadFromCluster()
    this.coordApi = kc.makeApiClient(k8s.CoordinationV1Api)
  }

  async start(): Promise<void> {
    try {
      this.namespace = readFileSync(
        '/var/run/secrets/kubernetes.io/serviceaccount/namespace',
        'utf-8'
      ).trim()
    } catch {
      this.namespace = config.namespace
    }

    this.logger.info({ podId: this.podId, namespace: this.namespace }, 'Starting K8s Lease leader election')

    // Try to acquire leadership immediately
    await this.tryAcquireOrRenew()

    // Start periodic renewal
    this.renewTimer = setInterval(() => {
      this.tryAcquireOrRenew().catch((err) => {
        this.logger.error({ err }, 'Leader election renewal error')
      })
    }, RENEW_INTERVAL_MS)
  }

  private async tryAcquireOrRenew(): Promise<void> {
    try {
      let lease: k8s.V1Lease

      try {
        lease = await this.coordApi.readNamespacedLease({
          name: LEASE_NAME,
          namespace: this.namespace,
        })
      } catch (err: unknown) {
        // Lease doesn't exist yet — create it
        if (this.isNotFoundError(err)) {
          lease = await this.createLease()
          this.becomeLeader(lease)
          return
        }
        throw err
      }

      const holder = lease.spec?.holderIdentity
      const renewTime = lease.spec?.renewTime
      const durationSec = lease.spec?.leaseDurationSeconds ?? LEASE_DURATION_SECONDS

      // Check if lease is expired
      const isExpired = renewTime
        ? Date.now() - new Date(String(renewTime)).getTime() > durationSec * 1000
        : true

      if (holder === this.podId) {
        // We hold the lease — renew it
        lease.spec!.renewTime = new k8s.V1MicroTime()
        const updated = await this.coordApi.replaceNamespacedLease({
          name: LEASE_NAME,
          namespace: this.namespace,
          body: lease,
        })
        this.becomeLeader(updated)
      } else if (isExpired || !holder) {
        // Lease is expired or unowned — try to acquire
        lease.spec!.holderIdentity = this.podId
        lease.spec!.renewTime = new k8s.V1MicroTime()
        lease.spec!.leaseTransitions = (lease.spec!.leaseTransitions ?? 0) + 1
        lease.spec!.leaseDurationSeconds = LEASE_DURATION_SECONDS

        try {
          const updated = await this.coordApi.replaceNamespacedLease({
            name: LEASE_NAME,
            namespace: this.namespace,
            body: lease,
          })
          this.becomeLeader(updated)
        } catch (err: unknown) {
          // Conflict — another pod acquired it first
          if (this.isConflictError(err)) {
            this.logger.debug('Lease acquisition conflict, another pod won')
            await this.refreshLeaderInfo()
          } else {
            throw err
          }
        }
      } else {
        // Another pod holds a valid lease
        this.setFollower(holder)
      }
    } catch (err: unknown) {
      this.logger.error({ err }, 'Leader election error')
      // On error, assume we lost leadership
      if (this._isLeader) {
        this._isLeader = false
        this.logger.warn('Lost leadership due to error')
      }
    }
  }

  private async createLease(): Promise<k8s.V1Lease> {
    const lease = new k8s.V1Lease()
    lease.metadata = new k8s.V1ObjectMeta()
    lease.metadata.name = LEASE_NAME
    lease.metadata.namespace = this.namespace
    lease.spec = new k8s.V1LeaseSpec()
    lease.spec.holderIdentity = this.podId
    lease.spec.leaseDurationSeconds = LEASE_DURATION_SECONDS
    lease.spec.renewTime = new k8s.V1MicroTime()
    lease.spec.leaseTransitions = 0

    return this.coordApi.createNamespacedLease({
      namespace: this.namespace,
      body: lease,
    })
  }

  private becomeLeader(lease: k8s.V1Lease): void {
    const transitions = lease.spec?.leaseTransitions ?? 0
    const newTerm = transitions + 1

    if (!this._isLeader || this.term !== newTerm) {
      this._isLeader = true
      this.term = newTerm
      this.leaderId = this.podId
      this.logger.info({ term: this.term }, 'Became cluster leader')
      this.onLeaderChange?.(this.podId, this.term)
    }
  }

  private setFollower(leaderId: string): void {
    const wasLeader = this._isLeader
    this._isLeader = false
    this.leaderId = leaderId

    if (wasLeader) {
      this.logger.info({ leaderId }, 'Stepped down, new leader')
      this.onLeaderChange?.(leaderId, this.term)
    }
  }

  private async refreshLeaderInfo(): Promise<void> {
    try {
      const lease = await this.coordApi.readNamespacedLease({
        name: LEASE_NAME,
        namespace: this.namespace,
      })
      const holder = lease.spec?.holderIdentity
      if (holder && holder !== this.podId) {
        this.setFollower(holder)
      }
    } catch {
      // Ignore — will retry next cycle
    }
  }

  private isNotFoundError(err: unknown): boolean {
    const e = err as { code?: number; statusCode?: number }
    return e?.code === 404 || e?.statusCode === 404
  }

  private isConflictError(err: unknown): boolean {
    const e = err as { code?: number; statusCode?: number }
    return e?.code === 409 || e?.statusCode === 409
  }

  stop(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer)
      this.renewTimer = null
    }
    this._isLeader = false
    this.logger.info('K8s Lease leader election stopped')
  }

  isLeader(): boolean {
    return this._isLeader
  }

  getCurrentTerm(): number {
    return this.term
  }

  getLeaderId(): string | null {
    return this.leaderId
  }
}

// ---------------------------------------------------------------------------
// Heartbeat-based fallback (Bully algorithm with quorum)
// ---------------------------------------------------------------------------

const ELECTION_INTERVAL_MS = 10_000

export class HeartbeatLeaderElection implements LeaderElection {
  onLeaderChange: ((leaderId: string, term: number) => void) | null = null

  private podId: string
  private term = 0
  private leaderId: string | null = null
  private _isLeader = false
  private electionTimer: ReturnType<typeof setInterval> | null = null
  private logger: Logger

  constructor(logger: Logger, podId?: string) {
    this.logger = logger
    this.podId = podId ?? hostname()
  }

  async start(): Promise<void> {
    this.logger.info({ podId: this.podId }, 'Starting heartbeat-based leader election')

    // Run initial election
    this.runElection()

    // Periodically re-evaluate leadership
    this.electionTimer = setInterval(() => {
      this.runElection()
    }, ELECTION_INTERVAL_MS)
  }

  private runElection(): void {
    const allPeers = peerStore.getAllPeers()
    const healthyPeers = allPeers.filter((p) => p.status !== 'unavailable')

    // Determine expected cluster size
    const expectedSize = config.clusterExpectedPods > 0
      ? config.clusterExpectedPods
      : allPeers.length

    const quorum = calculateQuorum(expectedSize)

    // Need quorum to elect
    if (healthyPeers.length < quorum) {
      if (this._isLeader) {
        this.logger.warn(
          { healthy: healthyPeers.length, quorum },
          'Lost quorum, stepping down as leader'
        )
        this._isLeader = false
      }
      return
    }

    // Bully algorithm: lowest podId wins
    const sortedPeers = healthyPeers
      .map((p) => p.podId)
      .sort()

    const electedId = sortedPeers[0]

    if (electedId !== this.leaderId) {
      this.term++
      this.leaderId = electedId
      this._isLeader = electedId === this.podId

      this.logger.info(
        { leaderId: electedId, term: this.term, isLeader: this._isLeader },
        'Leader election result'
      )
      this.onLeaderChange?.(electedId, this.term)
    } else if (electedId === this.podId && !this._isLeader) {
      // Re-affirm leadership
      this._isLeader = true
      this.logger.info({ term: this.term }, 'Re-affirmed as leader')
    } else if (electedId !== this.podId && this._isLeader) {
      // Lost leadership
      this._isLeader = false
      this.logger.info({ leaderId: electedId }, 'Stepped down, new leader elected')
    }
  }

  stop(): void {
    if (this.electionTimer) {
      clearInterval(this.electionTimer)
      this.electionTimer = null
    }
    this._isLeader = false
    this.logger.info('Heartbeat leader election stopped')
  }

  isLeader(): boolean {
    return this._isLeader
  }

  getCurrentTerm(): number {
    return this.term
  }

  getLeaderId(): string | null {
    return this.leaderId
  }
}

// ---------------------------------------------------------------------------
// No-op election for single-instance mode
// ---------------------------------------------------------------------------

class SingleInstanceElection implements LeaderElection {
  onLeaderChange: ((leaderId: string, term: number) => void) | null = null
  private podId: string

  constructor() {
    this.podId = hostname()
  }

  async start(): Promise<void> {
    // Single instance is always leader
    this.onLeaderChange?.(this.podId, 1)
  }

  stop(): void {
    // No-op
  }

  isLeader(): boolean {
    return true
  }

  getCurrentTerm(): number {
    return 1
  }

  getLeaderId(): string | null {
    return this.podId
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLeaderElection(logger: Logger, podId?: string): LeaderElection {
  // Priority 1: Kubernetes environment
  if (process.env.KUBERNETES_SERVICE_HOST) {
    logger.info('Using Kubernetes Lease leader election')
    return new KubernetesLeaderElection(logger)
  }

  // Priority 2: Static peer list (non-K8s cluster)
  if (config.clusterPeers) {
    logger.info('Using heartbeat-based leader election')
    return new HeartbeatLeaderElection(logger, podId)
  }

  // Priority 3: Single instance — always leader
  logger.info('Single-instance mode, always leader')
  return new SingleInstanceElection()
}
