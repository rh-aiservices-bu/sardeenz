/**
 * Tests for KubernetesLeaderElection:
 * - V1MicroTime format validation (must have 6 fractional digits)
 * - ApiException error detection (code vs statusCode)
 * - Lease creation and acquisition flows
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as k8s from '@kubernetes/client-node'

// Mock kubernetes config so it doesn't try to load in-cluster config
vi.mock('@kubernetes/client-node', async () => {
  const actual = await vi.importActual<typeof k8s>('@kubernetes/client-node')
  return {
    ...actual,
    KubeConfig: class MockKubeConfig {
      loadFromCluster() {}
      makeApiClient() {
        return mockCoordApi
      }
    },
  }
})

vi.mock('../../src/config.js', () => ({
  config: {
    namespace: 'test-ns',
    clusterPeers: '',
    clusterSecret: '',
    port: 3000,
    host: '0.0.0.0',
    clusterExpectedPods: 0,
  },
}))

vi.mock('../../src/stores/peer-store.js', () => ({
  peerStore: {
    getAllPeers: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  },
}))

function mockLogger() {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => log,
  }
  return log as never
}

// Shared mock for CoordinationV1Api
const mockCoordApi = {
  readNamespacedLease: vi.fn(),
  createNamespacedLease: vi.fn(),
  replaceNamespacedLease: vi.fn(),
}

describe('KubernetesLeaderElection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // V1MicroTime format validation
  // ---------------------------------------------------------------------------
  describe('V1MicroTime format', () => {
    it('should produce exactly 6 fractional digits (microsecond precision)', () => {
      const microTime = new k8s.V1MicroTime()
      const iso = microTime.toISOString()

      // K8s MicroTime format: 2026-05-20T15:51:13.510000Z
      // Must have exactly 6 digits after the decimal point
      const match = iso.match(/\.(\d+)Z$/)
      expect(match).not.toBeNull()
      expect(match![1]).toHaveLength(6)
    })

    it('should produce a valid ISO 8601 timestamp', () => {
      const microTime = new k8s.V1MicroTime()
      const iso = microTime.toISOString()

      // Must match: YYYY-MM-DDTHH:MM:SS.xxxxxxZ
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    })

    it('plain Date should NOT produce 6 fractional digits (the bug we fixed)', () => {
      const plainDate = new Date()
      const iso = plainDate.toISOString()

      // Plain Date produces only 3 fractional digits
      const match = iso.match(/\.(\d+)Z$/)
      expect(match).not.toBeNull()
      expect(match![1]).toHaveLength(3)
    })
  })

  // ---------------------------------------------------------------------------
  // ApiException error detection
  // ---------------------------------------------------------------------------
  describe('Error detection', () => {
    it('should detect 404 from ApiException (code property)', async () => {
      const { KubernetesLeaderElection } = await import(
        '../../src/services/leader-election.js'
      )
      const election = new KubernetesLeaderElection(mockLogger())

      // ApiException uses .code, not .statusCode
      const apiException = new Error('Not Found') as Error & { code: number }
      apiException.code = 404

      mockCoordApi.readNamespacedLease.mockRejectedValueOnce(apiException)

      const createdLease = new k8s.V1Lease()
      createdLease.metadata = new k8s.V1ObjectMeta()
      createdLease.metadata.name = 'sardeenz-leader'
      createdLease.spec = new k8s.V1LeaseSpec()
      createdLease.spec.holderIdentity = 'test-host'
      createdLease.spec.leaseTransitions = 0
      createdLease.spec.renewTime = new k8s.V1MicroTime()
      mockCoordApi.createNamespacedLease.mockResolvedValueOnce(createdLease)

      await election.start()

      // Should have called createNamespacedLease after getting 404
      expect(mockCoordApi.createNamespacedLease).toHaveBeenCalledTimes(1)
      expect(election.isLeader()).toBe(true)
    })

    it('should detect 409 conflict from ApiException (code property)', async () => {
      const { KubernetesLeaderElection } = await import(
        '../../src/services/leader-election.js'
      )
      const election = new KubernetesLeaderElection(mockLogger())

      // Return an expired lease held by another pod
      const existingLease = new k8s.V1Lease()
      existingLease.metadata = new k8s.V1ObjectMeta()
      existingLease.metadata.name = 'sardeenz-leader'
      existingLease.spec = new k8s.V1LeaseSpec()
      existingLease.spec.holderIdentity = 'other-pod'
      existingLease.spec.leaseDurationSeconds = 15
      existingLease.spec.renewTime = new Date(
        Date.now() - 60_000
      ) as k8s.V1MicroTime // expired
      existingLease.spec.leaseTransitions = 1

      mockCoordApi.readNamespacedLease.mockResolvedValueOnce(existingLease)

      // Simulate 409 conflict on replace (another pod won the race)
      const conflictErr = new Error('Conflict') as Error & { code: number }
      conflictErr.code = 409
      mockCoordApi.replaceNamespacedLease.mockRejectedValueOnce(conflictErr)

      // Re-read after conflict returns the other pod as holder
      const refreshedLease = new k8s.V1Lease()
      refreshedLease.spec = new k8s.V1LeaseSpec()
      refreshedLease.spec.holderIdentity = 'winning-pod'
      mockCoordApi.readNamespacedLease.mockResolvedValueOnce(refreshedLease)

      await election.start()

      // Should NOT be leader (conflict means another pod won)
      expect(election.isLeader()).toBe(false)
    })

    it('should propagate non-404/409 errors', async () => {
      const { KubernetesLeaderElection } = await import(
        '../../src/services/leader-election.js'
      )
      const logger = mockLogger()
      const election = new KubernetesLeaderElection(logger)

      const serverErr = new Error('Internal') as Error & { code: number }
      serverErr.code = 500
      mockCoordApi.readNamespacedLease.mockRejectedValueOnce(serverErr)

      await election.start()

      // Should have logged the error
      expect((logger as unknown as Record<string, ReturnType<typeof vi.fn>>).error).toHaveBeenCalled()
      expect(election.isLeader()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Lease body format validation
  // ---------------------------------------------------------------------------
  describe('Lease body format', () => {
    it('should create lease with correct spec fields and MicroTime renewTime', async () => {
      const { KubernetesLeaderElection } = await import(
        '../../src/services/leader-election.js'
      )
      const election = new KubernetesLeaderElection(mockLogger())

      const apiException = new Error('Not Found') as Error & { code: number }
      apiException.code = 404
      mockCoordApi.readNamespacedLease.mockRejectedValueOnce(apiException)

      mockCoordApi.createNamespacedLease.mockImplementation(
        ({ body }: { body: k8s.V1Lease }) => {
          // Validate the lease body sent to K8s
          expect(body.metadata?.name).toBe('sardeenz-leader')
          expect(body.spec?.leaseDurationSeconds).toBe(15)
          expect(body.spec?.leaseTransitions).toBe(0)
          expect(body.spec?.holderIdentity).toBeDefined()

          // The critical check: renewTime must be a V1MicroTime instance
          expect(body.spec?.renewTime).toBeInstanceOf(k8s.V1MicroTime)
          const iso = body.spec!.renewTime!.toISOString()
          expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)

          return Promise.resolve(body)
        }
      )

      await election.start()

      expect(mockCoordApi.createNamespacedLease).toHaveBeenCalledTimes(1)
    })

    it('should renew lease with MicroTime when we hold it', async () => {
      const { KubernetesLeaderElection } = await import(
        '../../src/services/leader-election.js'
      )
      const election = new KubernetesLeaderElection(mockLogger())

      // First call: 404 → create lease → become leader
      const notFound = new Error('Not Found') as Error & { code: number }
      notFound.code = 404
      mockCoordApi.readNamespacedLease.mockRejectedValueOnce(notFound)

      const createdLease = new k8s.V1Lease()
      createdLease.metadata = new k8s.V1ObjectMeta()
      createdLease.metadata.name = 'sardeenz-leader'
      createdLease.spec = new k8s.V1LeaseSpec()
      createdLease.spec.holderIdentity = require('os').hostname()
      createdLease.spec.leaseTransitions = 0
      createdLease.spec.renewTime = new k8s.V1MicroTime()
      createdLease.spec.leaseDurationSeconds = 15
      mockCoordApi.createNamespacedLease.mockResolvedValueOnce(createdLease)

      await election.start()
      election.stop() // stop the interval so we can manually trigger renewal

      // Second call: read returns our lease → renew
      mockCoordApi.readNamespacedLease.mockResolvedValueOnce(createdLease)
      mockCoordApi.replaceNamespacedLease.mockImplementation(
        ({ body }: { body: k8s.V1Lease }) => {
          expect(body.spec?.renewTime).toBeInstanceOf(k8s.V1MicroTime)
          const iso = body.spec!.renewTime!.toISOString()
          expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
          return Promise.resolve(body)
        }
      )

      // Manually invoke tryAcquireOrRenew via start-like flow
      // Access private method through any cast for testing
      await (election as any).tryAcquireOrRenew()

      expect(mockCoordApi.replaceNamespacedLease).toHaveBeenCalledTimes(1)
    })
  })
})
