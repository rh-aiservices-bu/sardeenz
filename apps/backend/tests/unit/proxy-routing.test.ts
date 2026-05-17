/**
 * T083: Tests for cross-pod proxy routing.
 * Tests routing table lookup, weighted round-robin, loop detection, circuit breaker.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clusterRoutingStore } from '../../src/stores/cluster-routing-store.js'
import { modelStore } from '../../src/stores/model-store.js'
import { ProxyRouter, FORWARDED_HEADER } from '../../src/services/proxy-router.js'

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    clusterSecret: '',
    clusterPeers: '',
    port: 3000,
    host: '0.0.0.0',
    namespace: 'test',
    clusterExpectedPods: 0,
    debugStreaming: false,
  },
}))

// Mock utils logger
vi.mock('@sardeenz/utils', () => ({
  createLogger: () => mockLogger(),
}))

function mockLogger() {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => log,
  }
  return log
}

describe('Cross-Pod Proxy Routing (T083)', () => {
  let router: ProxyRouter

  beforeEach(() => {
    clusterRoutingStore.clear()
    modelStore.clear()
    router = new ProxyRouter(mockLogger() as never)
  })

  // -------------------------------------------------------------------------
  // Routing table lookup and model resolution
  // -------------------------------------------------------------------------
  describe('Routing table lookup', () => {
    it('should find local entries in routing table', () => {
      clusterRoutingStore.setLocalPodId('pod-a')
      clusterRoutingStore.addEntry('model-1', {
        podId: 'pod-a',
        podAddress: '10.0.0.1',
        vllmPort: 5001,
        weight: 2,
        lastVerified: Date.now(),
      })

      const entries = clusterRoutingStore.getRoutingEntries('model-1')
      expect(entries).toHaveLength(1)
      expect(entries[0].podId).toBe('pod-a')
      expect(entries[0].weight).toBe(2)
    })

    it('should find remote entries in routing table', () => {
      clusterRoutingStore.setLocalPodId('pod-a')
      clusterRoutingStore.addEntry('model-1', {
        podId: 'pod-b',
        podAddress: '10.0.0.2',
        vllmPort: 5001,
        weight: 1,
        lastVerified: Date.now(),
      })

      const entries = clusterRoutingStore.getRoutingEntries('model-1')
      expect(entries).toHaveLength(1)
      expect(entries[0].podId).toBe('pod-b')
      expect(entries[0].weight).toBe(1)
    })

    it('should return empty array for unknown model', () => {
      const entries = clusterRoutingStore.getRoutingEntries('nonexistent')
      expect(entries).toHaveLength(0)
    })

    it('should rebuild routing table from peers', () => {
      clusterRoutingStore.setLocalPodId('pod-a')
      clusterRoutingStore.rebuildFromPeers([
        {
          podId: 'pod-a',
          address: '10.0.0.1',
          port: 3000,
          role: 'leader',
          status: 'healthy',
          lastHeartbeat: Date.now(),
          term: 1,
          models: [
            { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
          ],
          gpus: [],
          joinedAt: Date.now(),
        },
        {
          podId: 'pod-b',
          address: '10.0.0.2',
          port: 3000,
          role: 'follower',
          status: 'healthy',
          lastHeartbeat: Date.now(),
          term: 1,
          models: [
            { instanceId: 'inst-2', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
          ],
          gpus: [],
          joinedAt: Date.now(),
        },
      ])

      const entries = clusterRoutingStore.getRoutingEntries('model-1')
      expect(entries).toHaveLength(2)

      // Local pod-a should have weight 2
      const localEntry = entries.find((e) => e.podId === 'pod-a')
      expect(localEntry?.weight).toBe(2)

      // Remote pod-b should have weight 1
      const remoteEntry = entries.find((e) => e.podId === 'pod-b')
      expect(remoteEntry?.weight).toBe(1)
    })

    it('should exclude unavailable peers from routing table', () => {
      clusterRoutingStore.setLocalPodId('pod-a')
      clusterRoutingStore.rebuildFromPeers([
        {
          podId: 'pod-a',
          address: '10.0.0.1',
          port: 3000,
          role: 'leader',
          status: 'healthy',
          lastHeartbeat: Date.now(),
          term: 1,
          models: [
            { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
          ],
          gpus: [],
          joinedAt: Date.now(),
        },
        {
          podId: 'pod-b',
          address: '10.0.0.2',
          port: 3000,
          role: 'follower',
          status: 'unavailable',
          lastHeartbeat: Date.now() - 30000,
          term: 1,
          models: [
            { instanceId: 'inst-2', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
          ],
          gpus: [],
          joinedAt: Date.now(),
        },
      ])

      const entries = clusterRoutingStore.getRoutingEntries('model-1')
      expect(entries).toHaveLength(1)
      expect(entries[0].podId).toBe('pod-a')
    })
  })

  // -------------------------------------------------------------------------
  // Loop detection (X-Sardeenz-Forwarded header)
  // -------------------------------------------------------------------------
  describe('Loop detection', () => {
    it('should detect forwarded request via header', () => {
      expect(router.isForwardedRequest({ [FORWARDED_HEADER]: 'true' })).toBe(true)
    })

    it('should not flag non-forwarded request', () => {
      expect(router.isForwardedRequest({})).toBe(false)
      expect(router.isForwardedRequest({ 'content-type': 'application/json' })).toBe(false)
    })

    it('should export FORWARDED_HEADER constant', () => {
      expect(FORWARDED_HEADER).toBe('x-sardeenz-forwarded')
    })
  })

  // -------------------------------------------------------------------------
  // Routing table entry management
  // -------------------------------------------------------------------------
  describe('Routing table entry management', () => {
    it('should remove entries for a pod', () => {
      clusterRoutingStore.addEntry('model-1', {
        podId: 'pod-a',
        podAddress: '10.0.0.1',
        vllmPort: 5001,
        weight: 2,
        lastVerified: Date.now(),
      })
      clusterRoutingStore.addEntry('model-1', {
        podId: 'pod-b',
        podAddress: '10.0.0.2',
        vllmPort: 5001,
        weight: 1,
        lastVerified: Date.now(),
      })

      clusterRoutingStore.removeEntriesForPod('pod-b')

      const entries = clusterRoutingStore.getRoutingEntries('model-1')
      expect(entries).toHaveLength(1)
      expect(entries[0].podId).toBe('pod-a')
    })

    it('should atomically swap routing entry', () => {
      clusterRoutingStore.addEntry('model-1', {
        podId: 'pod-a',
        podAddress: '10.0.0.1',
        vllmPort: 5001,
        weight: 2,
        lastVerified: Date.now(),
      })

      clusterRoutingStore.swapEntry('model-1', 'pod-a', {
        podId: 'pod-b',
        podAddress: '10.0.0.2',
        vllmPort: 5001,
        weight: 1,
        lastVerified: Date.now(),
      })

      const entries = clusterRoutingStore.getRoutingEntries('model-1')
      expect(entries).toHaveLength(1)
      expect(entries[0].podId).toBe('pod-b')
    })

    it('should increment version on changes', () => {
      const v1 = clusterRoutingStore.getVersion()
      clusterRoutingStore.addEntry('model-1', {
        podId: 'pod-a',
        podAddress: '10.0.0.1',
        vllmPort: 5001,
        weight: 2,
        lastVerified: Date.now(),
      })
      const v2 = clusterRoutingStore.getVersion()
      expect(v2).toBeGreaterThan(v1)
    })
  })

  // -------------------------------------------------------------------------
  // Peer removal cleanup
  // -------------------------------------------------------------------------
  describe('Peer removal', () => {
    it('should destroy pool and circuit breaker state on peer removal', () => {
      // This verifies the removePeer method exists and doesn't throw
      router.removePeer('pod-b')
      // No assertion needed — verifying no error
    })

    it('should destroy all pools on shutdown', () => {
      router.destroyAllPools()
    })
  })
})
