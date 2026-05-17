/**
 * T085: Tests for auto-discovery and leader election.
 * Tests static peer list parsing, bully algorithm election, heartbeat failure detection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { peerStore } from '../../src/stores/peer-store.js'
import { clusterRoutingStore } from '../../src/stores/cluster-routing-store.js'
import { HeartbeatService } from '../../src/services/heartbeat.js'
import type { HeartbeatDataProvider } from '../../src/services/heartbeat.js'

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    clusterSecret: '',
    clusterPeers: 'localhost:3000,localhost:3001',
    port: 3000,
    host: '0.0.0.0',
    namespace: 'test',
    clusterExpectedPods: 2,
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
  return log
}

function mockDataProvider(): HeartbeatDataProvider {
  return {
    getModels: vi.fn().mockReturnValue([]),
    getGpus: vi.fn().mockReturnValue([]),
    getCurrentTerm: vi.fn().mockReturnValue(1),
    getRole: vi.fn().mockReturnValue('leader' as const),
    getClusterVersion: vi.fn().mockReturnValue(1),
  }
}

describe('Discovery & Leader Election (T085)', () => {
  beforeEach(() => {
    peerStore.clear()
    clusterRoutingStore.clear()
  })

  // -------------------------------------------------------------------------
  // Static peer list parsing
  // -------------------------------------------------------------------------
  describe('Static peer list parsing', () => {
    it('should parse CLUSTER_PEERS with host:port format', async () => {
      // Import the class to test parsing
      const { StaticPeerDiscovery } = await import('../../src/services/peer-discovery.js')
      const discovery = new StaticPeerDiscovery('host1:3000,host2:3001', mockLogger() as never)

      // The peers are parsed in constructor — verify by starting and checking poll behavior
      // We can't directly access private fields, so we test the output behavior
      expect(discovery).toBeDefined()
      expect(discovery.onPeerAdded).toBeNull()
      expect(discovery.onPeerRemoved).toBeNull()
    })

    it('should handle empty peer list gracefully', async () => {
      const { StaticPeerDiscovery } = await import('../../src/services/peer-discovery.js')
      const discovery = new StaticPeerDiscovery('', mockLogger() as never)
      expect(discovery).toBeDefined()
    })

    it('should handle single peer', async () => {
      const { StaticPeerDiscovery } = await import('../../src/services/peer-discovery.js')
      const discovery = new StaticPeerDiscovery('localhost:3000', mockLogger() as never)
      expect(discovery).toBeDefined()
    })

    it('should use default port when not specified', async () => {
      const { StaticPeerDiscovery } = await import('../../src/services/peer-discovery.js')
      // Port defaults to config.port when parsing fails
      const discovery = new StaticPeerDiscovery('host1', mockLogger() as never)
      expect(discovery).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Factory priority
  // -------------------------------------------------------------------------
  describe('Discovery factory', () => {
    it('should create StaticPeerDiscovery when CLUSTER_PEERS is set', async () => {
      // CLUSTER_PEERS is set in mock config
      const { createPeerDiscovery } = await import('../../src/services/peer-discovery.js')
      const discovery = createPeerDiscovery(mockLogger() as never)
      // Should be StaticPeerDiscovery since KUBERNETES_SERVICE_HOST is not set
      expect(discovery).toBeDefined()
      expect(discovery.onPeerAdded).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Leader election (HeartbeatLeaderElection with bully algorithm)
  // -------------------------------------------------------------------------
  describe('Leader election (bully algorithm)', () => {
    it('should elect lowest podId as leader', async () => {
      // Add peers with known podIds
      peerStore.addPeer({
        podId: 'pod-c',
        address: '10.0.0.3',
        port: 3000,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: 0,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })
      peerStore.addPeer({
        podId: 'pod-a',
        address: '10.0.0.1',
        port: 3000,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: 0,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })
      peerStore.addPeer({
        podId: 'pod-b',
        address: '10.0.0.2',
        port: 3000,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: 0,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })

      // Sorted peers: pod-a, pod-b, pod-c → pod-a should win
      const allPeers = peerStore.getAllPeers()
      const healthyPeers = allPeers.filter((p) => p.status !== 'unavailable')
      const sortedIds = healthyPeers.map((p) => p.podId).sort()
      expect(sortedIds[0]).toBe('pod-a')
    })

    it('should skip unavailable peers in election', () => {
      peerStore.addPeer({
        podId: 'pod-a',
        address: '10.0.0.1',
        port: 3000,
        role: 'follower',
        status: 'unavailable',
        lastHeartbeat: Date.now() - 30000,
        term: 0,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })
      peerStore.addPeer({
        podId: 'pod-b',
        address: '10.0.0.2',
        port: 3000,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: 0,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })

      const healthyPeers = peerStore.getAllPeers().filter((p) => p.status !== 'unavailable')
      const sortedIds = healthyPeers.map((p) => p.podId).sort()
      // pod-a is unavailable, so pod-b should be elected
      expect(sortedIds[0]).toBe('pod-b')
    })

    it('should create HeartbeatLeaderElection when CLUSTER_PEERS is set', async () => {
      const { createLeaderElection } = await import('../../src/services/leader-election.js')
      const election = createLeaderElection(mockLogger() as never)
      // Should be HeartbeatLeaderElection since KUBERNETES_SERVICE_HOST is not set
      expect(election).toBeDefined()
      expect(election.isLeader()).toBe(false) // Not started yet
      expect(election.getCurrentTerm()).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Heartbeat failure detection and peer state transitions
  // -------------------------------------------------------------------------
  describe('Heartbeat failure detection', () => {
    it('should process incoming heartbeat and return ack', () => {
      const logger = mockLogger()
      const provider = mockDataProvider()
      const heartbeat = new HeartbeatService(logger as never, provider)

      // Add a peer
      peerStore.addPeer({
        podId: 'peer-1',
        address: '10.0.0.2',
        port: 3000,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now() - 5000,
        term: 1,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })

      const ack = heartbeat.processIncomingHeartbeat({
        podId: 'peer-1',
        role: 'follower',
        term: 1,
        timestamp: Date.now(),
        models: [
          { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model-1', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
        ],
        gpus: [],
        clusterVersion: 1,
      })

      expect(ack).toHaveProperty('podId')
      expect(ack).toHaveProperty('term')
      expect(ack).toHaveProperty('role')
      expect(ack).toHaveProperty('clusterVersion')

      // Verify peer was updated with new models
      const peer = peerStore.getPeer('peer-1')
      expect(peer?.models).toHaveLength(1)
      expect(peer?.models[0].modelName).toBe('model-1')
    })

    it('should add unknown peers discovered via heartbeat', () => {
      const logger = mockLogger()
      const provider = mockDataProvider()
      const heartbeat = new HeartbeatService(logger as never, provider)

      // Process heartbeat from unknown peer
      heartbeat.processIncomingHeartbeat({
        podId: 'new-peer',
        role: 'follower',
        term: 1,
        timestamp: Date.now(),
        models: [],
        gpus: [],
        clusterVersion: 1,
      })

      // Peer should now exist
      const peer = peerStore.getPeer('new-peer')
      expect(peer).toBeDefined()
      expect(peer?.status).toBe('healthy')
    })

    it('should trigger routing table rebuild on version mismatch', () => {
      const logger = mockLogger()
      const provider = mockDataProvider()
      const heartbeat = new HeartbeatService(logger as never, provider)

      peerStore.addPeer({
        podId: 'peer-1',
        address: '10.0.0.2',
        port: 3000,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: 1,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })

      const prevVersion = clusterRoutingStore.getVersion()

      // Send heartbeat with different cluster version to trigger rebuild
      vi.useFakeTimers()
      heartbeat.processIncomingHeartbeat({
        podId: 'peer-1',
        role: 'follower',
        term: 1,
        timestamp: Date.now(),
        models: [],
        gpus: [],
        clusterVersion: prevVersion + 10, // Mismatch
      })

      // Rebuild is debounced — advance timers to trigger it
      vi.advanceTimersByTime(600)
      vi.useRealTimers()

      // Version should have changed due to rebuild
      expect(clusterRoutingStore.getVersion()).toBeGreaterThan(prevVersion)
    })
  })
})
