/**
 * T081: Contract tests for /internal/* endpoints.
 * Validates request/response shapes against internal-api.yaml schemas.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { peerStore } from '../../src/stores/peer-store.js'
import { clusterRoutingStore } from '../../src/stores/cluster-routing-store.js'

// Mock cluster manager
vi.mock('../../src/services/cluster-manager.js', () => {
  const mockHeartbeatService = {
    processIncomingHeartbeat: vi.fn().mockReturnValue({
      podId: 'test-pod',
      term: 1,
      role: 'leader',
      clusterVersion: 1,
    }),
  }
  const mockClusterManager = {
    getPodId: vi.fn().mockReturnValue('test-pod'),
    getRole: vi.fn().mockReturnValue('leader'),
    getCurrentTerm: vi.fn().mockReturnValue(1),
    getModels: vi.fn().mockReturnValue([]),
    getGpus: vi.fn().mockReturnValue([]),
    getClusterVersion: vi.fn().mockReturnValue(1),
    getHeartbeatService: vi.fn().mockReturnValue(mockHeartbeatService),
    isClusterMode: vi.fn().mockReturnValue(false),
    isLeader: vi.fn().mockReturnValue(true),
    getClusterState: vi.fn().mockReturnValue({
      clusterId: 'test-cluster',
      term: 1,
      leaderId: 'test-pod',
      peers: new Map(),
      routingTable: { entries: new Map(), version: 1 },
      expectedSize: 1,
    }),
    getLeaderAddress: vi.fn().mockReturnValue(null),
  }
  return {
    getClusterManager: vi.fn().mockReturnValue(mockClusterManager),
    ClusterManager: vi.fn().mockImplementation(() => mockClusterManager),
  }
})

// Mock model manager
vi.mock('../../src/services/model-manager.js', () => ({
  getModelManager: vi.fn().mockReturnValue({
    launchModel: vi.fn().mockResolvedValue({ id: 'inst-1', status: 'starting' }),
    unloadModel: vi.fn().mockResolvedValue(undefined),
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

// Mock model configuration store
vi.mock('../../src/stores/model-configuration-store.js', () => ({
  getModelConfigurationStore: vi.fn().mockReturnValue({
    syncPreset: vi.fn().mockReturnValue(true),
    getConfiguration: vi.fn().mockReturnValue(null),
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

// Mock config (no cluster secret = no HMAC auth required)
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

describe('Internal Routes Contract Tests', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    peerStore.clear()
    clusterRoutingStore.clear()

    app = Fastify({ logger: false })
    await app.register(import('../../src/routes/internal.js'))
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  // -------------------------------------------------------------------------
  // POST /internal/heartbeat
  // -------------------------------------------------------------------------
  describe('POST /internal/heartbeat', () => {
    it('should accept a valid heartbeat and return HeartbeatAck', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/heartbeat',
        payload: {
          podId: 'peer-pod-1',
          role: 'follower',
          term: 1,
          timestamp: Date.now(),
          models: [],
          gpus: [],
          clusterVersion: 1,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('podId')
      expect(body).toHaveProperty('term')
      expect(body).toHaveProperty('role')
      expect(body).toHaveProperty('clusterVersion')
      expect(typeof body.podId).toBe('string')
      expect(typeof body.term).toBe('number')
      expect(['leader', 'follower']).toContain(body.role)
      expect(typeof body.clusterVersion).toBe('number')
    })

    it('should accept heartbeat with models and gpus', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/heartbeat',
        payload: {
          podId: 'peer-pod-2',
          role: 'leader',
          term: 2,
          timestamp: Date.now(),
          models: [
            {
              instanceId: 'inst-1',
              modelPath: 'org/model',
              modelName: 'model',
              port: 5001,
              status: 'running',
              gpuIds: [0],
              tensorParallelSize: 1,
            },
          ],
          gpus: [
            {
              gpuId: 0,
              name: 'NVIDIA A100',
              totalVramMB: 81920,
              usedVramMB: 40960,
              temperature: 55,
              utilization: 30,
            },
          ],
          clusterVersion: 5,
        },
      })

      expect(response.statusCode).toBe(200)
    })

    it('should reject heartbeat missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/heartbeat',
        payload: {
          podId: 'peer-pod-1',
          // missing role, term, timestamp, models, gpus
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // GET /internal/state
  // -------------------------------------------------------------------------
  describe('GET /internal/state', () => {
    it('should return PodFullState schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/state',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('podId')
      expect(body).toHaveProperty('role')
      expect(body).toHaveProperty('term')
      expect(body).toHaveProperty('models')
      expect(body).toHaveProperty('gpus')
      expect(body).toHaveProperty('routingTableVersion')
      expect(typeof body.podId).toBe('string')
      expect(['leader', 'follower']).toContain(body.role)
      expect(typeof body.term).toBe('number')
      expect(Array.isArray(body.models)).toBe(true)
      expect(Array.isArray(body.gpus)).toBe(true)
      expect(typeof body.routingTableVersion).toBe('number')
    })
  })

  // -------------------------------------------------------------------------
  // POST /internal/cluster/event
  // -------------------------------------------------------------------------
  describe('POST /internal/cluster/event', () => {
    it('should accept model-loaded event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cluster/event',
        payload: {
          type: 'model-loaded',
          podId: 'peer-pod-1',
          term: 1,
          timestamp: Date.now(),
          payload: { instanceId: 'inst-1', modelPath: 'org/model' },
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('received', true)
    })

    it('should accept leader-elected event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cluster/event',
        payload: {
          type: 'leader-elected',
          podId: 'peer-pod-1',
          term: 2,
          timestamp: Date.now(),
          payload: { leaderId: 'peer-pod-1', term: 2 },
        },
      })

      expect(response.statusCode).toBe(200)
    })

    it('should accept pod-joined event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cluster/event',
        payload: {
          type: 'pod-joined',
          podId: 'new-pod',
          term: 1,
          timestamp: Date.now(),
          payload: { podId: 'new-pod', address: '10.0.0.5', port: 3000 },
        },
      })

      expect(response.statusCode).toBe(200)
    })

    it('should accept pod-left event', async () => {
      peerStore.addPeer({
        podId: 'leaving-pod',
        address: '10.0.0.6',
        port: 3000,
        role: 'follower',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        term: 1,
        models: [],
        gpus: [],
        joinedAt: Date.now(),
      })

      const response = await app.inject({
        method: 'POST',
        url: '/internal/cluster/event',
        payload: {
          type: 'pod-left',
          podId: 'leaving-pod',
          term: 1,
          timestamp: Date.now(),
          payload: { podId: 'leaving-pod' },
        },
      })

      expect(response.statusCode).toBe(200)
      expect(peerStore.getPeer('leaving-pod')).toBeUndefined()
    })

    it('should reject event missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cluster/event',
        payload: {
          type: 'model-loaded',
          // missing podId, term, timestamp, payload
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // POST /internal/models/load
  // -------------------------------------------------------------------------
  describe('POST /internal/models/load', () => {
    it('should accept valid load request and return instanceId + status', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/models/load',
        payload: {
          modelPath: 'Qwen/Qwen3-0.6B',
          maxTokens: 4096,
          gpuIds: [0],
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('instanceId')
      expect(body).toHaveProperty('status')
      expect(typeof body.instanceId).toBe('string')
      expect(typeof body.status).toBe('string')
    })

    it('should reject load request missing modelPath', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/models/load',
        payload: {
          maxTokens: 4096,
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // POST /internal/models/:id/unload
  // -------------------------------------------------------------------------
  describe('POST /internal/models/:id/unload', () => {
    it('should accept valid unload request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/models/inst-1/unload',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('success', true)
    })
  })

  // -------------------------------------------------------------------------
  // POST /internal/presets/sync
  // -------------------------------------------------------------------------
  describe('POST /internal/presets/sync', () => {
    it('should accept presets and return sync counts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/presets/sync',
        payload: {
          presets: [
            {
              id: 'preset-1',
              name: 'Test Preset',
              description: 'A test preset',
              modelCount: 2,
              entries: [],
              placementStrategy: 'balanced',
              version: 1,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('synced')
      expect(body).toHaveProperty('conflicts')
      expect(typeof body.synced).toBe('number')
      expect(typeof body.conflicts).toBe('number')
    })

    it('should reject missing presets field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/presets/sync',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // GET /internal/memory-profiles
  // -------------------------------------------------------------------------
  describe('GET /internal/memory-profiles', () => {
    it('should return profiles array', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/memory-profiles',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('profiles')
      expect(Array.isArray(body.profiles)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // POST /internal/memory-profiles
  // -------------------------------------------------------------------------
  describe('POST /internal/memory-profiles', () => {
    it('should accept profiles and return import counts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/memory-profiles',
        payload: {
          profiles: [
            {
              profileName: 'test-profile',
              modelPath: 'org/model',
              maxTokens: 4096,
              totalGpuMemoryGib: 10,
              weightsMemoryGib: 5,
              cudaGraphsGib: 1,
              overheadMemoryGib: 0.5,
              kvCacheAvailableGib: 3.5,
              gpuName: 'NVIDIA A100',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('imported')
      expect(body).toHaveProperty('updated')
      expect(body).toHaveProperty('skipped')
      expect(typeof body.imported).toBe('number')
      expect(typeof body.updated).toBe('number')
      expect(typeof body.skipped).toBe('number')
    })

    it('should reject missing profiles field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/memory-profiles',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // GET /internal/ping
  // -------------------------------------------------------------------------
  describe('GET /internal/ping', () => {
    it('should return ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/ping',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body).toHaveProperty('status', 'ok')
      expect(body).toHaveProperty('timestamp')
      expect(typeof body.timestamp).toBe('number')
    })
  })
})
