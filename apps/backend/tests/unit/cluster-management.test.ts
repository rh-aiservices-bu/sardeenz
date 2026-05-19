/**
 * T084: Tests for cluster model management.
 * Tests leader-follower topology, routing table updates on model state changes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { peerStore } from '../../src/stores/peer-store.js'
import { clusterRoutingStore } from '../../src/stores/cluster-routing-store.js'

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    clusterSecret: '',
    clusterPeers: '',
    port: 3000,
    host: '0.0.0.0',
    namespace: 'test',
    clusterExpectedPods: 0,
  },
}))

function addPeer(
  podId: string,
  role: 'leader' | 'follower' = 'follower',
  models: Array<{ instanceId: string; modelPath: string; modelName: string; port: number; status: string; gpuIds: number[]; tensorParallelSize: number }> = []
) {
  peerStore.addPeer({
    podId,
    address: `10.0.0.${podId.charCodeAt(podId.length - 1) - 96}`,
    port: 3000,
    role,
    status: 'healthy',
    lastHeartbeat: Date.now(),
    term: 1,
    models,
    gpus: [{ gpuId: 0, name: 'NVIDIA A100', totalVramMB: 81920, usedVramMB: 10000, temperature: 50, utilization: 20 }],
    joinedAt: Date.now(),
  })
}

describe('Cluster Model Management (T084)', () => {
  beforeEach(() => {
    peerStore.clear()
    clusterRoutingStore.clear()
    clusterRoutingStore.setLocalPodId('pod-a')
  })

  // -------------------------------------------------------------------------
  // Leader-follower topology
  // -------------------------------------------------------------------------
  describe('Leader-follower topology', () => {
    it('should track leader and follower roles', () => {
      addPeer('pod-a', 'leader')
      addPeer('pod-b', 'follower')

      const leader = peerStore.getPeer('pod-a')
      const follower = peerStore.getPeer('pod-b')
      expect(leader?.role).toBe('leader')
      expect(follower?.role).toBe('follower')
    })

    it('should update peer role', () => {
      addPeer('pod-a', 'follower')
      peerStore.updatePeer('pod-a', { role: 'leader' })

      expect(peerStore.getPeer('pod-a')?.role).toBe('leader')
    })

    it('should list all peers', () => {
      addPeer('pod-a', 'leader')
      addPeer('pod-b', 'follower')
      addPeer('pod-c', 'follower')

      expect(peerStore.getAllPeers()).toHaveLength(3)
    })

    it('should list only healthy peers', () => {
      addPeer('pod-a', 'leader')
      addPeer('pod-b', 'follower')
      peerStore.markUnavailable('pod-b')

      const healthy = peerStore.getHealthyPeers()
      expect(healthy).toHaveLength(1)
      expect(healthy[0].podId).toBe('pod-a')
    })
  })

  // -------------------------------------------------------------------------
  // Routing table updates on model state changes
  // -------------------------------------------------------------------------
  describe('Routing table updates on model state changes', () => {
    it('should include running models in routing table', () => {
      addPeer('pod-a', 'leader', [
        { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])
      addPeer('pod-b', 'follower', [
        { instanceId: 'inst-2', modelPath: 'org/model2', modelName: 'model-2', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])

      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())

      expect(clusterRoutingStore.getRoutingEntries('model-1')).toHaveLength(1)
      expect(clusterRoutingStore.getRoutingEntries('model-2')).toHaveLength(1)
    })

    it('should exclude non-running models from routing table', () => {
      addPeer('pod-a', 'leader', [
        { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'starting', gpuIds: [0], tensorParallelSize: 1 },
      ])

      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())

      expect(clusterRoutingStore.getRoutingEntries('model-1')).toHaveLength(0)
    })

    it('should update routing when model loads', () => {
      addPeer('pod-a', 'leader', [])
      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())
      expect(clusterRoutingStore.getRoutingEntries('model-1')).toHaveLength(0)

      // Simulate model loaded
      peerStore.updatePeer('pod-a', {
        models: [
          { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
        ],
      })
      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())

      expect(clusterRoutingStore.getRoutingEntries('model-1')).toHaveLength(1)
    })

    it('should update routing when model unloads', () => {
      addPeer('pod-a', 'leader', [
        { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])
      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())
      expect(clusterRoutingStore.getRoutingEntries('model-1')).toHaveLength(1)

      // Simulate model unloaded
      peerStore.updatePeer('pod-a', { models: [] })
      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())

      expect(clusterRoutingStore.getRoutingEntries('model-1')).toHaveLength(0)
    })

    it('should handle same model on multiple pods', () => {
      addPeer('pod-a', 'leader', [
        { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])
      addPeer('pod-b', 'follower', [
        { instanceId: 'inst-2', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])

      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())

      const entries = clusterRoutingStore.getRoutingEntries('model-1')
      expect(entries).toHaveLength(2)
    })

    it('should remove routing entries when pod becomes unavailable', () => {
      addPeer('pod-a', 'leader', [
        { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])
      addPeer('pod-b', 'follower', [
        { instanceId: 'inst-2', modelPath: 'org/model2', modelName: 'model-2', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])

      clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())
      expect(clusterRoutingStore.getRoutingEntries('model-2')).toHaveLength(1)

      // pod-b goes unavailable
      clusterRoutingStore.removeEntriesForPod('pod-b')
      expect(clusterRoutingStore.getRoutingEntries('model-2')).toHaveLength(0)
      // pod-a model should still be there
      expect(clusterRoutingStore.getRoutingEntries('model-1')).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // Peer state management
  // -------------------------------------------------------------------------
  describe('Peer state management', () => {
    it('should transition healthy → suspect → unavailable', () => {
      addPeer('pod-b', 'follower')

      expect(peerStore.getPeer('pod-b')?.status).toBe('healthy')

      peerStore.markSuspect('pod-b')
      expect(peerStore.getPeer('pod-b')?.status).toBe('suspect')

      peerStore.markUnavailable('pod-b')
      expect(peerStore.getPeer('pod-b')?.status).toBe('unavailable')
    })

    it('should reset to healthy on heartbeat', () => {
      addPeer('pod-b', 'follower')
      peerStore.markSuspect('pod-b')

      peerStore.updateLastHeartbeat('pod-b', Date.now())
      expect(peerStore.getPeer('pod-b')?.status).toBe('healthy')
    })

    it('should remove peer completely', () => {
      addPeer('pod-b', 'follower')
      expect(peerStore.getPeer('pod-b')).toBeDefined()

      peerStore.removePeer('pod-b')
      expect(peerStore.getPeer('pod-b')).toBeUndefined()
    })
  })
})
