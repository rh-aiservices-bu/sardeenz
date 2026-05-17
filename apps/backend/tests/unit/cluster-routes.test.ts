/**
 * T082: Contract tests for /api/cluster/* endpoints.
 * Validates request/response shapes against cluster-admin-api.yaml schemas.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { peerStore } from '../../src/stores/peer-store.js'
import { clusterRoutingStore } from '../../src/stores/cluster-routing-store.js'
import { modelStore } from '../../src/stores/model-store.js'

// Mock cluster manager
const mockClusterManager = {
  getPodId: vi.fn().mockReturnValue('test-pod'),
  getRole: vi.fn().mockReturnValue('leader'),
  getCurrentTerm: vi.fn().mockReturnValue(1),
  getModels: vi.fn().mockReturnValue([]),
  getGpus: vi.fn().mockReturnValue([]),
  getClusterVersion: vi.fn().mockReturnValue(1),
  isClusterMode: vi.fn().mockReturnValue(true),
  isLeader: vi.fn().mockReturnValue(true),
  getClusterState: vi.fn().mockReturnValue({
    clusterId: 'test-cluster',
    term: 1,
    leaderId: 'test-pod',
    peers: new Map(),
    routingTable: { entries: new Map(), version: 1 },
    expectedSize: 2,
  }),
  getLeaderAddress: vi.fn().mockReturnValue('127.0.0.1:3000'),
  getHeartbeatService: vi.fn().mockReturnValue({
    processIncomingHeartbeat: vi.fn(),
  }),
}

vi.mock('../../src/services/cluster-manager.js', () => ({
  getClusterManager: vi.fn().mockReturnValue(mockClusterManager),
  ClusterManager: vi.fn().mockImplementation(() => mockClusterManager),
}))

// Mock model manager
vi.mock('../../src/services/model-manager.js', () => ({
  getModelManager: vi.fn().mockReturnValue({
    launchModel: vi.fn().mockResolvedValue({ id: 'inst-1', status: 'starting' }),
    unloadModel: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Mock model mover
vi.mock('../../src/services/model-mover.js', () => ({
  getModelMover: vi.fn().mockReturnValue({
    moveModel: vi.fn().mockResolvedValue({ moveId: 'move-1' }),
    crossPodMoveModel: vi.fn().mockResolvedValue({ moveId: 'move-2' }),
  }),
}))

// Mock pod scheduler
vi.mock('../../src/services/pod-scheduler.js', () => ({
  getPodScheduler: vi.fn().mockReturnValue({
    placeModels: vi.fn().mockReturnValue({ decisions: [], failures: [] }),
    reconcile: vi.fn().mockReturnValue({
      toLoad: [],
      toUnload: [],
      failures: [],
      unchanged: [],
    }),
  }),
}))

// Mock event bus
vi.mock('../../src/services/event-bus.js', () => ({
  eventBus: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    createLogEvent: vi.fn().mockReturnValue({ id: '1', eventType: 'log', data: {} }),
    createStatusEvent: vi.fn().mockReturnValue({ id: '2', eventType: 'status', data: {} }),
  },
}))

// Mock process log buffer
vi.mock('../../src/services/process-log-buffer.js', () => ({
  processLogBuffer: {
    has: vi.fn().mockReturnValue(false),
    getBuffer: vi.fn().mockReturnValue([]),
    onLog: vi.fn().mockReturnValue(() => {}),
  },
}))

// Mock cluster auth
vi.mock('../../src/services/cluster-auth.js', () => ({
  signRequest: vi.fn().mockReturnValue({ signature: 'test-sig', timestamp: Date.now() }),
  verifyRequest: vi.fn().mockReturnValue(true),
  verifyRequestDualSecret: vi.fn().mockReturnValue(true),
}))

// Mock model configuration store
vi.mock('../../src/stores/model-configuration-store.js', () => ({
  getModelConfigurationStore: vi.fn().mockReturnValue({
    getConfiguration: vi.fn().mockReturnValue(null),
    syncPreset: vi.fn().mockReturnValue(true),
  }),
}))

// Mock memory profile store
vi.mock('../../src/stores/memory-profile-store.js', () => ({
  getMemoryProfileStore: vi.fn().mockReturnValue({
    listProfiles: vi.fn().mockReturnValue({ profiles: [] }),
    createProfile: vi.fn(),
    upsertProfile: vi.fn(),
    lookupProfile: vi.fn().mockReturnValue(null),
  }),
}))

// Mock benchmark store
vi.mock('../../src/stores/benchmark-store.js', () => ({
  getBenchmarkStore: vi.fn().mockReturnValue({
    listRuns: vi.fn().mockReturnValue({ runs: [], total: 0 }),
    getRunWithDetails: vi.fn().mockReturnValue(null),
    getRun: vi.fn().mockReturnValue(null),
    createRun: vi.fn().mockReturnValue({ id: 'run-1', status: 'pending', mode: 'sequential', kvcachedEnabled: false, createdAt: new Date().toISOString(), configJson: '{}' }),
    createScenario: vi.fn(),
  }),
}))

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

function addTestPeer(podId: string, models: Array<{ instanceId: string; modelPath: string; modelName: string; port: number; status: string; gpuIds: number[]; tensorParallelSize: number }> = []) {
  peerStore.addPeer({
    podId,
    address: '10.0.0.1',
    port: 3000,
    role: podId === 'test-pod' ? 'leader' : 'follower',
    status: 'healthy',
    lastHeartbeat: Date.now(),
    term: 1,
    models,
    gpus: [
      { gpuId: 0, name: 'NVIDIA A100', totalVramMB: 81920, usedVramMB: 10000, temperature: 50, utilization: 20 },
    ],
    joinedAt: Date.now(),
  })
}

describe('Cluster Routes Contract Tests', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    peerStore.clear()
    clusterRoutingStore.clear()
    modelStore.clear()

    // Add self as peer
    addTestPeer('test-pod')

    app = Fastify({ logger: false })
    await app.register(import('../../src/routes/cluster/index.js'))
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  // -------------------------------------------------------------------------
  // GET /api/cluster — ClusterStatus
  // -------------------------------------------------------------------------
  describe('GET /api/cluster', () => {
    it('should return ClusterStatus schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('clusterId')
      expect(body).toHaveProperty('isClusterMode')
      expect(body).toHaveProperty('podCount')
      expect(body).toHaveProperty('healthyPodCount')
      expect(body).toHaveProperty('leaderId')
      expect(body).toHaveProperty('term')
      expect(body).toHaveProperty('expectedSize')
      expect(body).toHaveProperty('totalModelsLoaded')
      expect(body).toHaveProperty('totalGpus')
      expect(body).toHaveProperty('routingTableVersion')
      expect(body).toHaveProperty('health')
      expect(typeof body.clusterId).toBe('string')
      expect(typeof body.isClusterMode).toBe('boolean')
      expect(typeof body.podCount).toBe('number')
      expect(typeof body.healthyPodCount).toBe('number')
      expect(['healthy', 'degraded', 'critical']).toContain(body.health)
    })
  })

  // -------------------------------------------------------------------------
  // GET /api/cluster/pods
  // -------------------------------------------------------------------------
  describe('GET /api/cluster/pods', () => {
    it('should return pods array matching ClusterPod schema', async () => {
      addTestPeer('peer-pod-1', [
        { instanceId: 'inst-1', modelPath: 'org/model', modelName: 'model', port: 5001, status: 'running', gpuIds: [0], tensorParallelSize: 1 },
      ])

      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/pods',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('pods')
      expect(Array.isArray(body.pods)).toBe(true)
      expect(body.pods.length).toBeGreaterThanOrEqual(1)

      const pod = body.pods.find((p: { podId: string }) => p.podId === 'peer-pod-1')
      expect(pod).toBeDefined()
      expect(pod).toHaveProperty('podId')
      expect(pod).toHaveProperty('address')
      expect(pod).toHaveProperty('role')
      expect(pod).toHaveProperty('status')
      expect(pod).toHaveProperty('lastHeartbeat')
      expect(pod).toHaveProperty('joinedAt')
      expect(pod).toHaveProperty('modelCount')
      expect(pod).toHaveProperty('gpus')
      expect(pod).toHaveProperty('models')
      expect(Array.isArray(pod.gpus)).toBe(true)
      expect(Array.isArray(pod.models)).toBe(true)

      // Verify GPU shape
      const gpu = pod.gpus[0]
      expect(gpu).toHaveProperty('gpuId')
      expect(gpu).toHaveProperty('name')
      expect(gpu).toHaveProperty('totalVramMB')
      expect(gpu).toHaveProperty('usedVramMB')

      // Verify model shape
      const model = pod.models[0]
      expect(model).toHaveProperty('instanceId')
      expect(model).toHaveProperty('podId')
      expect(model).toHaveProperty('modelPath')
      expect(model).toHaveProperty('modelName')
      expect(model).toHaveProperty('status')
      expect(model).toHaveProperty('port')
      expect(model).toHaveProperty('gpuIds')
    })
  })

  // -------------------------------------------------------------------------
  // GET /api/cluster/pods/:podId/models
  // -------------------------------------------------------------------------
  describe('GET /api/cluster/pods/:podId/models', () => {
    it('should return models for existing pod', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/pods/test-pod/models',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('models')
      expect(Array.isArray(body.models)).toBe(true)
    })

    it('should return 404 for unknown pod', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/pods/nonexistent-pod/models',
      })

      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('error')
    })
  })

  // -------------------------------------------------------------------------
  // GET /api/cluster/routing-table
  // -------------------------------------------------------------------------
  describe('GET /api/cluster/routing-table', () => {
    it('should return RoutingTable schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/routing-table',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('version')
      expect(body).toHaveProperty('entries')
      expect(typeof body.version).toBe('number')
      expect(typeof body.entries).toBe('object')
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/cluster/models/load
  // -------------------------------------------------------------------------
  describe('POST /api/cluster/models/load', () => {
    it('should accept valid load request and return ClusterLoadModelResponse', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/load',
        payload: {
          modelPath: 'Qwen/Qwen3-0.6B',
          targetPodId: 'test-pod',
          maxTokens: 4096,
          gpuIds: [0],
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('instanceId')
      expect(body).toHaveProperty('podId')
      expect(body).toHaveProperty('status')
      expect(typeof body.instanceId).toBe('string')
      expect(typeof body.podId).toBe('string')
      expect(typeof body.status).toBe('string')
    })

    it('should reject load request missing modelPath', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/load',
        payload: {
          targetPodId: 'test-pod',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('should return 404 for unknown target pod', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/load',
        payload: {
          modelPath: 'org/model',
          targetPodId: 'nonexistent-pod',
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return 400 for unhealthy target pod', async () => {
      peerStore.addPeer({
        podId: 'sick-pod',
        address: '10.0.0.2',
        port: 3000,
        role: 'follower',
        status: 'unavailable',
        lastHeartbeat: Date.now() - 30000,
        term: 1,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })

      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/load',
        payload: {
          modelPath: 'org/model',
          targetPodId: 'sick-pod',
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.payload)
      expect(body.error).toContain('unavailable')
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/cluster/models/:instanceId/unload
  // -------------------------------------------------------------------------
  describe('POST /api/cluster/models/:instanceId/unload', () => {
    it('should return 404 for unknown instance', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/nonexistent/unload',
      })

      expect(response.statusCode).toBe(404)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/cluster/models/:instanceId/move
  // -------------------------------------------------------------------------
  describe('POST /api/cluster/models/:instanceId/move', () => {
    it('should accept ClusterMoveModelRequest and return moveId', async () => {
      // Add a local model instance to modelStore so move finds it
      modelStore.set({
        id: 'inst-move-1',
        modelPath: 'org/model',
        servedModelName: 'model',
        status: 'running',
        port: 5001,
        gpuIds: [0],
        tensorParallelSize: 1,
        pid: 1234,
        vllmProcess: null as never,
        startedAt: new Date(),
        maxTokens: 4096,
      })

      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/inst-move-1/move',
        payload: {
          targetGpuIds: [1],
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('moveId')
      expect(typeof body.moveId).toBe('string')
    })

    it('should reject missing targetGpuIds', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/models/inst-1/move',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/cluster/presets/:presetId/apply
  // -------------------------------------------------------------------------
  describe('POST /api/cluster/presets/:presetId/apply', () => {
    it('should return 404 for unknown preset', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/presets/nonexistent/apply',
        payload: { dryRun: true },
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return PresetApplicationResult on dry run', async () => {
      // Mock config store to return a preset
      const { getModelConfigurationStore } = await import('../../src/stores/model-configuration-store.js')
      const store = getModelConfigurationStore()
      vi.mocked(store.getConfiguration).mockReturnValueOnce({
        id: 'preset-1',
        name: 'Test Preset',
        modelCount: 1,
        entries: [{ modelPath: 'org/model', loadOrder: 1, maxTokens: 4096 }],
        createdAt: new Date().toISOString(),
      })

      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/presets/preset-1/apply',
        payload: { dryRun: true },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('presetId')
      expect(body).toHaveProperty('presetName')
      expect(body).toHaveProperty('dryRun', true)
      expect(body).toHaveProperty('placed')
      expect(body).toHaveProperty('unplaceable')
      expect(body).toHaveProperty('unloaded')
      expect(Array.isArray(body.placed)).toBe(true)
      expect(Array.isArray(body.unplaceable)).toBe(true)
      expect(Array.isArray(body.unloaded)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/cluster/memory-profiles/reconcile
  // -------------------------------------------------------------------------
  describe('POST /api/cluster/memory-profiles/reconcile', () => {
    it('should return reconciliation result', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/memory-profiles/reconcile',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('totalProfiles')
      expect(body).toHaveProperty('newDistributed')
      expect(body).toHaveProperty('duplicatesResolved')
      expect(typeof body.totalProfiles).toBe('number')
      expect(typeof body.newDistributed).toBe('number')
      expect(typeof body.duplicatesResolved).toBe('number')
    })
  })

  // -------------------------------------------------------------------------
  // GET /api/cluster/memory-profiles/export
  // -------------------------------------------------------------------------
  describe('GET /api/cluster/memory-profiles/export', () => {
    it('should return profiles array and exportedAt', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/memory-profiles/export',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('profiles')
      expect(body).toHaveProperty('exportedAt')
      expect(Array.isArray(body.profiles)).toBe(true)
      expect(typeof body.exportedAt).toBe('string')
      // Validate ISO date format
      expect(new Date(body.exportedAt).toISOString()).toBe(body.exportedAt)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/cluster/memory-profiles/import
  // -------------------------------------------------------------------------
  describe('POST /api/cluster/memory-profiles/import', () => {
    it('should accept profiles and return import counts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/memory-profiles/import',
        payload: {
          profiles: [
            {
              profileName: 'test',
              modelPath: 'org/model',
              maxTokens: 4096,
              totalGpuMemoryGib: 10,
              weightsMemoryGib: 5,
              cudaGraphsGib: 1,
              overheadMemoryGib: 0.5,
              kvCacheAvailableGib: 3.5,
            },
          ],
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('imported')
      expect(body).toHaveProperty('skipped')
      expect(typeof body.imported).toBe('number')
      expect(typeof body.skipped).toBe('number')
    })

    it('should reject missing profiles field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/memory-profiles/import',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // GET /api/cluster/benchmarks/export
  // -------------------------------------------------------------------------
  describe('GET /api/cluster/benchmarks/export', () => {
    it('should return runs array and exportedAt', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/cluster/benchmarks/export',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('runs')
      expect(body).toHaveProperty('exportedAt')
      expect(Array.isArray(body.runs)).toBe(true)
      expect(typeof body.exportedAt).toBe('string')
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/cluster/benchmarks/import
  // -------------------------------------------------------------------------
  describe('POST /api/cluster/benchmarks/import', () => {
    it('should accept runs and return import counts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/benchmarks/import',
        payload: {
          runs: [],
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('imported')
      expect(body).toHaveProperty('skipped')
      expect(typeof body.imported).toBe('number')
      expect(typeof body.skipped).toBe('number')
    })

    it('should reject missing runs field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cluster/benchmarks/import',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
