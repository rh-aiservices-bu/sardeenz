import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { clearAllStores } from '../setup.js'
import { modelStore } from '../../src/stores/model-store.js'
import type { ModelInstance, ModelStatus } from '@sardeenz/types'
import Fastify from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'

/**
 * Memory Monitoring Routes Tests
 *
 * These tests focus on API contracts. We mock the MemoryMonitor service
 * to avoid requiring actual kvctl subprocess calls.
 */

// Mock the MemoryMonitor service
const mockGetMemoryUsage = vi.fn()
const mockSetMemoryLimits = vi.fn()

vi.mock('../../src/services/memory-monitor.js', () => ({
  MemoryMonitor: vi.fn().mockImplementation(() => ({
    getMemoryUsage: mockGetMemoryUsage,
    setMemoryLimits: mockSetMemoryLimits,
    collectMetrics: vi.fn(),
    getCachedMetrics: vi.fn(),
  })),
}))

describe('Memory Monitoring Routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    clearAllStores()
    vi.clearAllMocks()

    // Create a minimal test app with memory routes
    app = Fastify({
      logger: false,
    }).withTypeProvider<TypeBoxTypeProvider>()

    // Register mock metrics plugin
    app.decorate('metrics', {
      modelLoadDuration: { startTimer: () => vi.fn() },
      modelUnloadDuration: { startTimer: () => vi.fn() },
      routingLatency: { startTimer: () => vi.fn() },
      activeModels: { set: vi.fn() },
      activeConnections: { set: vi.fn() },
      inferenceRequests: { inc: vi.fn() },
    })

    // Register memory routes
    await app.register(import('../../src/routes/memory.js'))
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /api/memory/usage', () => {
    it('should return GPU memory usage', async () => {
      // Mock the response from MemoryMonitor (current format)
      mockGetMemoryUsage.mockResolvedValueOnce({
        kvcache: {
          total_gb: 6.0,
          prealloc_gb: 4.0,
          used_gb: 1.0,
          free_gb: 1.0,
        },
        gpu: {
          total_gb: 24.0,
          used_gb: 7.5,
          free_gb: 16.5,
          utilization_percent: 45,
        },
        models: [
          {
            model_path: 'meta-llama/Llama-3.2-1B',
            display_name: 'Llama-3.2-1B',
            gpu_memory_gb: 2.5,
            color: '#0066CC',
          },
          {
            model_path: 'mistralai/Mistral-7B',
            display_name: 'Mistral-7B',
            gpu_memory_gb: 5.0,
            color: '#5752D1',
          },
        ],
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/memory/usage',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.gpu.total_gb).toBe(24.0)
      expect(body.gpu.used_gb).toBe(7.5)
      expect(body.gpu.free_gb).toBe(16.5)
      expect(body.kvcache.total_gb).toBe(6.0)
      expect(body.kvcache.prealloc_gb).toBe(4.0)
      expect(body.models).toBeInstanceOf(Array)
      expect(body.models).toHaveLength(2)

      // Check first model
      expect(body.models[0].gpu_memory_gb).toBe(2.5)
      expect(body.models[0].display_name).toBe('Llama-3.2-1B')
      expect(body.models[0].color).toBe('#0066CC')
    })

    it('should return empty models array when no segments exist', async () => {
      mockGetMemoryUsage.mockResolvedValueOnce({
        kvcache: {
          total_gb: 0,
          prealloc_gb: 0,
          used_gb: 0,
          free_gb: 0,
        },
        gpu: {
          total_gb: 24.0,
          used_gb: 0,
          free_gb: 24.0,
          utilization_percent: 0,
        },
        models: [],
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/memory/usage',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.models).toEqual([])
      expect(body.gpu.used_gb).toBe(0)
    })

    it('should handle kvctl errors gracefully', async () => {
      // Mock error from MemoryMonitor
      mockGetMemoryUsage.mockRejectedValueOnce(new Error('kvctl list failed'))

      const response = await app.inject({
        method: 'GET',
        url: '/api/memory/usage',
      })

      expect(response.statusCode).toBe(500)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('internal_error')
    })
  })

  describe('POST /api/memory/limits', () => {
    it('should set memory limits for a model', async () => {
      // Pre-populate the store with an existing model
      const instance: ModelInstance = {
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
      modelStore.set('meta-llama/Llama-3.2-1B', instance)

      // Mock successful memory limit set
      mockSetMemoryLimits.mockResolvedValueOnce(undefined)

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/limits',
        payload: {
          model_path: 'meta-llama/Llama-3.2-1B',
          limit_gb: 6.0,
        },
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('success')
      expect(body.model).toBe('meta-llama/Llama-3.2-1B')
      expect(body.new_limit_gb).toBe(6.0)

      // Verify MemoryMonitor was called with correct arguments
      expect(mockSetMemoryLimits).toHaveBeenCalledWith('meta-llama/Llama-3.2-1B', 6.0)
    })

    it('should return 500 when model is not found', async () => {
      // Mock error from MemoryMonitor
      mockSetMemoryLimits.mockRejectedValueOnce(new Error('Model non-existent-model not found'))

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/limits',
        payload: {
          model_path: 'non-existent-model',
          limit_gb: 6.0,
        },
      })

      expect(response.statusCode).toBe(500)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('internal_error')
    })

    it('should handle kvctl limit errors', async () => {
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
        ipcSegmentName: 'VLLM_META_LLAMA_LLAMA_3_2_1B',
      }
      modelStore.set('meta-llama/Llama-3.2-1B', instance)

      // Mock failed kvctl limit command
      mockSetMemoryLimits.mockRejectedValueOnce(new Error('kvctl limit failed: segment not found'))

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/limits',
        payload: {
          model_path: 'meta-llama/Llama-3.2-1B',
          limit_gb: 6.0,
        },
      })

      expect(response.statusCode).toBe(500)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('internal_error')
    })
  })
})
