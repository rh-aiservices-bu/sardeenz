import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, clearAllStores } from '../setup.js'
import {
  createMockCompletionResponse,
  createMockChatCompletionResponse,
  createMockStreamingResponse,
} from '../mocks/vllm-mock.js'
import { modelStore } from '../../src/stores/model-store.js'
import type { ModelInstance, ModelStatus } from '@sardeenz/types'

describe('Proxy Routing', () => {
  let app: FastifyInstance
  let fetchMock: Mock

  const runningModel: ModelInstance = {
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

  beforeEach(async () => {
    clearAllStores()

    // Set up fetch mock
    fetchMock = vi.fn()
    global.fetch = fetchMock

    app = await createTestApp()
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.clearAllMocks()
  })

  describe('POST /v1/completions', () => {
    it('should forward request to loaded model', async () => {
      modelStore.set('meta-llama/Llama-3.2-1B', runningModel)
      fetchMock.mockResolvedValueOnce(createMockCompletionResponse('meta-llama/Llama-3.2-1B'))

      const response = await app.inject({
        method: 'POST',
        url: '/v1/completions',
        payload: {
          model: 'meta-llama/Llama-3.2-1B',
          prompt: 'What is the meaning of life?',
          max_tokens: 100,
        },
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.object).toBe('text_completion')
      expect(body.model).toBe('meta-llama/Llama-3.2-1B')
      expect(body.choices).toBeDefined()
      expect(body.choices[0].text).toBeDefined()

      // Verify fetch was called with correct URL
      expect(fetchMock).toHaveBeenCalledWith(
        `http://localhost:${runningModel.port}/v1/completions`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('should return 404 when model is not loaded', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/completions',
        payload: {
          model: 'non-existent-model',
          prompt: 'Hello',
        },
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('not_found')
      expect(body.error.message).toContain('not loaded')
    })

    it('should return 404 when model is not active', async () => {
      const startingModel: ModelInstance = {
        ...runningModel,
        status: 'starting' as ModelStatus,
      }
      modelStore.set('meta-llama/Llama-3.2-1B', startingModel)

      const response = await app.inject({
        method: 'POST',
        url: '/v1/completions',
        payload: {
          model: 'meta-llama/Llama-3.2-1B',
          prompt: 'Hello',
        },
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload)
      expect(body.error.message).toContain('not active')
    })

    it('should handle streaming requests', async () => {
      modelStore.set('meta-llama/Llama-3.2-1B', runningModel)
      fetchMock.mockResolvedValueOnce(createMockStreamingResponse('meta-llama/Llama-3.2-1B'))

      const response = await app.inject({
        method: 'POST',
        url: '/v1/completions',
        payload: {
          model: 'meta-llama/Llama-3.2-1B',
          prompt: 'Hello',
          stream: true,
        },
      })

      // For streaming, we get the raw response
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('text/event-stream')
    })

    it('should return 502 when vLLM returns error', async () => {
      modelStore.set('meta-llama/Llama-3.2-1B', runningModel)
      fetchMock.mockRejectedValueOnce(new Error('Connection refused'))

      const response = await app.inject({
        method: 'POST',
        url: '/v1/completions',
        payload: {
          model: 'meta-llama/Llama-3.2-1B',
          prompt: 'Hello',
        },
      })

      expect(response.statusCode).toBe(502)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('bad_gateway')
    })
  })

  describe('POST /v1/chat/completions', () => {
    it('should forward chat request to loaded model', async () => {
      modelStore.set('meta-llama/Llama-3.2-1B', runningModel)
      fetchMock.mockResolvedValueOnce(createMockChatCompletionResponse('meta-llama/Llama-3.2-1B'))

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'meta-llama/Llama-3.2-1B',
          messages: [{ role: 'user', content: 'Hello!' }],
        },
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.object).toBe('chat.completion')
      expect(body.model).toBe('meta-llama/Llama-3.2-1B')
      expect(body.choices).toBeDefined()
      expect(body.choices[0].message).toBeDefined()
      expect(body.choices[0].message.role).toBe('assistant')
      expect(body.choices[0].message.content).toBeDefined()

      // Verify fetch was called with correct URL
      expect(fetchMock).toHaveBeenCalledWith(
        `http://localhost:${runningModel.port}/v1/chat/completions`,
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should return 404 when model is not loaded', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'non-existent-model',
          messages: [{ role: 'user', content: 'Hello!' }],
        },
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload)
      expect(body.error.type).toBe('not_found')
    })

    it('should handle streaming chat requests', async () => {
      modelStore.set('meta-llama/Llama-3.2-1B', runningModel)
      fetchMock.mockResolvedValueOnce(createMockStreamingResponse('meta-llama/Llama-3.2-1B'))

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'meta-llama/Llama-3.2-1B',
          messages: [{ role: 'user', content: 'Hello!' }],
          stream: true,
        },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('text/event-stream')
    })

    it('should include available models in error message', async () => {
      // Add some models to the store
      modelStore.set('model-a', { ...runningModel, modelPath: 'model-a' })
      modelStore.set('model-b', { ...runningModel, modelPath: 'model-b' })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'non-existent-model',
          messages: [{ role: 'user', content: 'Hello!' }],
        },
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload)
      expect(body.error.message).toContain('Available models')
    })
  })
})
