import { EventEmitter } from 'events'
import { vi } from 'vitest'
import type { ChildProcess } from 'child_process'

export interface MockProcessOptions {
  pid?: number
  shouldSucceed?: boolean
  startupDelayMs?: number
  exitCode?: number
  exitSignal?: NodeJS.Signals | null
}

/**
 * Create a fake ChildProcess for testing vLLM subprocess spawning
 */
export function createMockProcess(options: MockProcessOptions = {}): ChildProcess {
  const {
    pid = Math.floor(Math.random() * 100000) + 1000,
    shouldSucceed = true,
    startupDelayMs = 0,
    exitCode = 0,
    exitSignal = null,
  } = options

  const emitter = new EventEmitter() as ChildProcess

  // Create mock stdout/stderr streams
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()

  // Set up the mock process properties
  Object.assign(emitter, {
    pid,
    stdin: null,
    stdout,
    stderr,
    stdio: [null, stdout, stderr],
    killed: false,
    connected: true,
    exitCode: null,
    signalCode: null,
    spawnfile: 'vllm',
    spawnargs: ['vllm', 'serve'],

    kill: vi.fn((signal?: NodeJS.Signals) => {
      if (!(emitter as any).killed) {
        ;(emitter as any).killed = true
        ;(emitter as any).signalCode = signal || 'SIGTERM'
        ;(emitter as any).exitCode = exitCode

        // Emit exit event
        setImmediate(() => {
          emitter.emit('exit', exitCode, signal || 'SIGTERM')
        })
        return true
      }
      return false
    }),

    ref: vi.fn(),
    unref: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),

    [Symbol.dispose]: vi.fn(),
  })

  // Simulate startup behavior
  if (startupDelayMs > 0) {
    setTimeout(() => {
      if (!shouldSucceed) {
        stderr.emit('data', Buffer.from('Error: Failed to load model\n'))
        emitter.emit('exit', 1, null)
      } else {
        stdout.emit('data', Buffer.from('Model loaded successfully\n'))
      }
    }, startupDelayMs)
  }

  return emitter
}

/**
 * Create a mock fetch response for vLLM health checks
 */
export function createMockHealthResponse(healthy: boolean): Response {
  if (healthy) {
    return new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({ status: 'unhealthy' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a mock fetch response for vLLM completions
 */
export function createMockCompletionResponse(modelId: string): Response {
  const responseBody = {
    id: 'cmpl-' + Math.random().toString(36).substring(7),
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        text: ' The answer to life, the universe, and everything is 42.',
        index: 0,
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 12,
      total_tokens: 17,
    },
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a mock fetch response for vLLM chat completions
 */
export function createMockChatCompletionResponse(modelId: string): Response {
  const responseBody = {
    id: 'chatcmpl-' + Math.random().toString(36).substring(7),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
    },
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a mock streaming response for vLLM completions
 */
export function createMockStreamingResponse(modelId: string): Response {
  const chunks = [
    `data: {"id":"cmpl-1","object":"text_completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"${modelId}","choices":[{"text":"Hello","index":0}]}\n\n`,
    `data: {"id":"cmpl-1","object":"text_completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"${modelId}","choices":[{"text":" world","index":0}]}\n\n`,
    `data: {"id":"cmpl-1","object":"text_completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"${modelId}","choices":[{"text":"!","index":0,"finish_reason":"stop"}]}\n\n`,
    'data: [DONE]\n\n',
  ]

  const encoder = new TextEncoder()
  let chunkIndex = 0

  const stream = new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex]))
        chunkIndex++
      } else {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Create a mock kvctl list response
 */
export function createMockKvctlListResponse(
  segments: Array<{
    name: string
    size_gb: number
    limit_gb: number
    usage_percent: number
  }>
): string {
  return JSON.stringify(segments)
}

/**
 * Setup spawn mock for child_process
 */
export function setupSpawnMock(mockProcess: ChildProcess) {
  return vi.fn().mockReturnValue(mockProcess)
}

/**
 * Setup fetch mock for vLLM health and inference endpoints
 */
export function setupFetchMock(
  options: {
    healthyModels?: Set<string>
    loadedModels?: Map<string, number> // modelPath -> port
  } = {}
) {
  const { healthyModels = new Set(), loadedModels = new Map() } = options

  return vi.fn(async (url: string, init?: RequestInit) => {
    const urlObj = new URL(url)

    // Health check
    if (urlObj.pathname === '/health') {
      const port = parseInt(urlObj.port, 10)
      // Find model by port
      for (const [modelPath, modelPort] of loadedModels.entries()) {
        if (modelPort === port) {
          return createMockHealthResponse(healthyModels.has(modelPath))
        }
      }
      return createMockHealthResponse(false)
    }

    // Completions
    if (urlObj.pathname === '/v1/completions') {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      const stream = body.stream === true

      if (stream) {
        return createMockStreamingResponse(body.model)
      }
      return createMockCompletionResponse(body.model)
    }

    // Chat completions
    if (urlObj.pathname === '/v1/chat/completions') {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      const stream = body.stream === true

      if (stream) {
        return createMockStreamingResponse(body.model)
      }
      return createMockChatCompletionResponse(body.model)
    }

    // Default: not found
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}
