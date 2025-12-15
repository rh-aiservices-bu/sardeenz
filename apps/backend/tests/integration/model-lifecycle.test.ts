import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, clearAllStores } from '../setup.js'
import { createMockHealthResponse } from '../mocks/vllm-mock.js'
import { modelStore } from '../../src/stores/model-store.js'
import type { ModelInstance, ModelStatus } from '@sardeenz/types'

/**
 * These tests focus on API contracts, not model lifecycle.
 * Model load/unload operations are complex and require extensive mocking
 * of child_process, so we test those aspects separately by directly
 * manipulating the store.
 */
describe('Model Lifecycle Routes', () => {
  let app: FastifyInstance
  let fetchMock: Mock

  beforeEach(async () => {
    clearAllStores()

    // Set up fetch mock for health checks
    fetchMock = vi.fn().mockResolvedValue(createMockHealthResponse(true))
    global.fetch = fetchMock

    app = await createTestApp()
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.clearAllMocks()
  })

  describe('GET /api/models', () => {
    it('should return empty list when no models loaded', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/models',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.models).toEqual([])
      expect(body.total).toBe(0)
    })

    it('should return list of loaded models', async () => {
      // Pre-populate the store with models
      const instance1: ModelInstance = {
        id: 'instance-1',
        modelPath: 'meta-llama/Llama-3.2-1B',
        status: 'running' as ModelStatus,
        port: 12346,
        processId: 12345,
        maxTokens: 4096,
        gpuMemoryUtilization: 0.9,
        loadedAt: new Date(),
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      const instance2: ModelInstance = {
        id: 'instance-2',
        modelPath: 'mistralai/Mistral-7B',
        status: 'starting' as ModelStatus,
        port: 12347,
        processId: 12346,
        maxTokens: 8192,
        gpuMemoryUtilization: 0.8,
        loadedAt: new Date(),
        ipcSegmentName: 'VLLM_MISTRALAI_MISTRAL_7B',
      }

      modelStore.set('meta-llama/Llama-3.2-1B', instance1)
      modelStore.set('mistralai/Mistral-7B', instance2)

      const response = await app.inject({
        method: 'GET',
        url: '/api/models',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.models).toHaveLength(2)
      expect(body.total).toBe(2)
      expect(body.models[0].model_path).toBeDefined()
      expect(body.models[0].status).toBeDefined()
    })
  })

  describe('GET /api/models/:model_path', () => {
    it('should return model details', async () => {
      // Pre-populate the store
      const instance: ModelInstance = {
        id: 'instance-1',
        modelPath: 'meta-llama/Llama-3.2-1B',
        status: 'running' as ModelStatus,
        port: 12346,
        processId: 12345,
        maxTokens: 4096,
        gpuMemoryUtilization: 0.9,
        loadedAt: new Date(),
        readyAt: new Date(),
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      modelStore.set('meta-llama/Llama-3.2-1B', instance)

      const response = await app.inject({
        method: 'GET',
        url: '/api/models/meta-llama%2FLlama-3.2-1B',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.model.id).toBe('instance-1')
      expect(body.model.model_path).toBe('meta-llama/Llama-3.2-1B')
      expect(body.model.status).toBe('running')
      expect(body.model.port).toBe(12346)
      expect(body.model.max_tokens).toBe(4096)
      expect(body.model.gpu_memory_utilization).toBe(0.9)
    })

    it('should return 404 when model is not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/models/non-existent-model',
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('not_found')
    })
  })

  describe('DELETE /api/models/:model_path', () => {
    it('should return 404 when model is not found', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/models/non-existent-model',
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('not_found')
    })
  })

  describe('POST /api/models/load', () => {
    it('should return 409 when model is already loaded', async () => {
      // Pre-populate the store with an existing model
      const existingInstance: ModelInstance = {
        id: 'existing-id',
        modelPath: 'meta-llama/Llama-3.2-1B',
        status: 'running' as ModelStatus,
        port: 12346,
        processId: 12345,
        maxTokens: 4096,
        gpuMemoryUtilization: 0.9,
        loadedAt: new Date(),
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      modelStore.set('meta-llama/Llama-3.2-1B', existingInstance)

      const response = await app.inject({
        method: 'POST',
        url: '/api/models/load',
        payload: {
          model_path: 'meta-llama/Llama-3.2-1B',
        },
      })

      expect(response.statusCode).toBe(409)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('conflict')
    })

    it('should validate required model_path field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/models/load',
        payload: {},
      })

      // Should return 400 for missing required field
      expect(response.statusCode).toBe(400)
    })
  })

  describe('GET /api/models/:model_path/health', () => {
    it('should return healthy status for active model with healthy vLLM', async () => {
      // Pre-populate the store with an active model
      const instance: ModelInstance = {
        id: 'instance-1',
        modelPath: 'meta-llama/Llama-3.2-1B',
        status: 'running' as ModelStatus,
        port: 12346,
        processId: 12345,
        maxTokens: 4096,
        gpuMemoryUtilization: 0.9,
        loadedAt: new Date(),
        readyAt: new Date(),
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      modelStore.set('meta-llama/Llama-3.2-1B', instance)

      // Mock vLLM health check returning healthy
      fetchMock.mockResolvedValueOnce(createMockHealthResponse(true))

      const response = await app.inject({
        method: 'GET',
        url: '/api/models/meta-llama%2FLlama-3.2-1B/health',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('healthy')
      expect(body.model).toBe('meta-llama/Llama-3.2-1B')
      expect(body.port).toBe(12346)
    })

    it('should return 503 for non-active model', async () => {
      // Pre-populate the store with a starting model
      const instance: ModelInstance = {
        id: 'instance-1',
        modelPath: 'meta-llama/Llama-3.2-1B',
        status: 'starting' as ModelStatus,
        port: 12346,
        processId: 12345,
        maxTokens: 4096,
        gpuMemoryUtilization: 0.9,
        loadedAt: new Date(),
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      modelStore.set('meta-llama/Llama-3.2-1B', instance)

      const response = await app.inject({
        method: 'GET',
        url: '/api/models/meta-llama%2FLlama-3.2-1B/health',
      })

      expect(response.statusCode).toBe(503)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('unhealthy')
    })

    it('should return 503 when vLLM health check fails', async () => {
      // Pre-populate the store with an active model
      const instance: ModelInstance = {
        id: 'instance-1',
        modelPath: 'meta-llama/Llama-3.2-1B',
        status: 'running' as ModelStatus,
        port: 12346,
        processId: 12345,
        maxTokens: 4096,
        gpuMemoryUtilization: 0.9,
        loadedAt: new Date(),
        readyAt: new Date(),
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      modelStore.set('meta-llama/Llama-3.2-1B', instance)

      // Mock vLLM health check returning unhealthy
      fetchMock.mockResolvedValueOnce(createMockHealthResponse(false))

      const response = await app.inject({
        method: 'GET',
        url: '/api/models/meta-llama%2FLlama-3.2-1B/health',
      })

      expect(response.statusCode).toBe(503)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('unhealthy')
    })

    it('should return 503 when vLLM health check times out', async () => {
      // Pre-populate the store with an active model
      const instance: ModelInstance = {
        id: 'instance-1',
        modelPath: 'meta-llama/Llama-3.2-1B',
        status: 'running' as ModelStatus,
        port: 12346,
        processId: 12345,
        maxTokens: 4096,
        gpuMemoryUtilization: 0.9,
        loadedAt: new Date(),
        readyAt: new Date(),
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      modelStore.set('meta-llama/Llama-3.2-1B', instance)

      // Mock vLLM health check throwing an error
      fetchMock.mockRejectedValueOnce(new Error('Connection refused'))

      const response = await app.inject({
        method: 'GET',
        url: '/api/models/meta-llama%2FLlama-3.2-1B/health',
      })

      expect(response.statusCode).toBe(503)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('unhealthy')
    })

    it('should return 404 when model is not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/models/non-existent-model/health',
      })

      expect(response.statusCode).toBe(404)
    })
  })
})
