/**
 * T086: Tests for single-pod backward compatibility.
 * Verifies zero cluster overhead, local-only routing, graceful responses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { peerStore } from '../../src/stores/peer-store.js'
import { clusterRoutingStore } from '../../src/stores/cluster-routing-store.js'
import { FORWARDED_HEADER } from '../../src/services/proxy-router.js'

// Mock cluster manager for single-pod mode
const mockClusterManager = {
  getPodId: vi.fn().mockReturnValue('single-pod'),
  getRole: vi.fn().mockReturnValue('leader'),
  getCurrentTerm: vi.fn().mockReturnValue(1),
  getModels: vi.fn().mockReturnValue([]),
  getGpus: vi.fn().mockReturnValue([]),
  getClusterVersion: vi.fn().mockReturnValue(1),
  isClusterMode: vi.fn().mockReturnValue(false), // Single-pod mode
  isLeader: vi.fn().mockReturnValue(true),
  getClusterState: vi.fn().mockReturnValue({
    clusterId: 'test-cluster',
    term: 1,
    leaderId: 'single-pod',
    peers: new Map(),
    routingTable: { entries: new Map(), version: 1 },
    expectedSize: 1,
  }),
  getLeaderAddress: vi.fn().mockReturnValue(null),
  getHeartbeatService: vi.fn().mockReturnValue({
    processIncomingHeartbeat: vi.fn(),
  }),
}

vi.mock('../../src/services/cluster-manager.js', () => ({
  getClusterManager: vi.fn().mockReturnValue(mockClusterManager),
  ClusterManager: vi.fn().mockImplementation(() => mockClusterManager),
}))

vi.mock('../../src/services/model-manager.js', () => ({
  getModelManager: vi.fn().mockReturnValue({
    launchModel: vi.fn().mockResolvedValue({ id: 'inst-1', status: 'starting' }),
    unloadModel: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../src/services/model-mover.js', () => ({
  getModelMover: vi.fn().mockReturnValue({
    moveModel: vi.fn().mockResolvedValue({ moveId: 'move-1' }),
    crossPodMoveModel: vi.fn().mockResolvedValue({ moveId: 'move-2' }),
  }),
}))

vi.mock('../../src/services/pod-scheduler.js', () => ({
  getPodScheduler: vi.fn().mockReturnValue({
    placeModels: vi.fn().mockReturnValue({ decisions: [], failures: [] }),
    reconcile: vi.fn().mockReturnValue({ toLoad: [], toUnload: [], failures: [], unchanged: [] }),
  }),
}))

vi.mock('../../src/services/event-bus.js', () => ({
  eventBus: { subscribe: vi.fn(), unsubscribe: vi.fn(), createLogEvent: vi.fn(), createStatusEvent: vi.fn() },
}))

vi.mock('../../src/services/process-log-buffer.js', () => ({
  processLogBuffer: { has: vi.fn().mockReturnValue(false), getBuffer: vi.fn().mockReturnValue([]), onLog: vi.fn().mockReturnValue(() => {}) },
}))

vi.mock('../../src/services/cluster-auth.js', () => ({
  signRequest: vi.fn().mockReturnValue({ signature: 'test', timestamp: Date.now() }),
}))

vi.mock('../../src/stores/model-configuration-store.js', () => ({
  getModelConfigurationStore: vi.fn().mockReturnValue({ getConfiguration: vi.fn().mockReturnValue(null) }),
}))

vi.mock('../../src/stores/memory-profile-store.js', () => ({
  getMemoryProfileStore: vi.fn().mockReturnValue({ listProfiles: vi.fn().mockReturnValue({ profiles: [] }), upsertProfile: vi.fn(), createProfile: vi.fn(), lookupProfile: vi.fn().mockReturnValue(null) }),
}))

vi.mock('../../src/stores/benchmark-store.js', () => ({
  getBenchmarkStore: vi.fn().mockReturnValue({ listRuns: vi.fn().mockReturnValue({ runs: [], total: 0 }), getRunWithDetails: vi.fn(), getRun: vi.fn() }),
}))

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

describe('Single-Pod Backward Compatibility (T086)', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    peerStore.clear()
    clusterRoutingStore.clear()

    // Add self as only peer
    peerStore.addPeer({
      podId: 'single-pod',
      address: '127.0.0.1',
      port: 3000,
      role: 'leader',
      status: 'healthy',
      lastHeartbeat: Date.now(),
      term: 1,
      models: [],
      gpus: [],
      joinedAt: Date.now(),
    })

    app = Fastify({ logger: false })
    await app.register(import('../../src/routes/cluster/index.js'))
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  // -------------------------------------------------------------------------
  // Zero cluster overhead
  // -------------------------------------------------------------------------
  describe('Zero cluster overhead in single-pod mode', () => {
    it('should report isClusterMode=false', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body.isClusterMode).toBe(false)
    })

    it('should report single pod count', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster',
      })

      const body = JSON.parse(response.payload)
      expect(body.podCount).toBe(1)
      expect(body.healthyPodCount).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Local-only routing when not in cluster mode
  // -------------------------------------------------------------------------
  describe('Local-only routing', () => {
    it('should have empty routing table in single-pod mode', () => {
      const entries = clusterRoutingStore.getRoutingEntries('any-model')
      expect(entries).toHaveLength(0)
    })

    it('should return empty routing table via API', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/routing-table',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body.entries).toEqual({})
    })
  })

  // -------------------------------------------------------------------------
  // Graceful /api/cluster responses when no peers
  // -------------------------------------------------------------------------
  describe('Graceful responses with no peers', () => {
    it('should return healthy cluster status with single pod', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster',
      })

      const body = JSON.parse(response.payload)
      expect(body.health).toBe('healthy')
      expect(body.podCount).toBe(1)
    })

    it('should list single pod in pods list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/pods',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body.pods).toHaveLength(1)
      expect(body.pods[0].podId).toBe('single-pod')
    })

    it('should return models for own pod', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/pods/single-pod/models',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body.models).toBeDefined()
      expect(Array.isArray(body.models)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // No X-Sardeenz-Forwarded header injection in single-pod mode
  // -------------------------------------------------------------------------
  describe('No forwarding header in single-pod mode', () => {
    it('should define FORWARDED_HEADER constant', () => {
      expect(FORWARDED_HEADER).toBe('x-sardeenz-forwarded')
    })

    it('should not have forwarding headers in local responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster',
      })

      expect(response.headers[FORWARDED_HEADER]).toBeUndefined()
    })

    it('should handle model load locally without forwarding', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/load',
        payload: {
          modelPath: 'org/model',
          targetPodId: 'single-pod',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body.podId).toBe('single-pod')
      expect(body.instanceId).toBeDefined()
    })
  })
})
