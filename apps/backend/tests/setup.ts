import { beforeAll, afterAll, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { modelStore } from '../src/stores/model-store.js'
import { requestStore } from '../src/stores/request-store.js'
import { metricsStore } from '../src/stores/metrics-store.js'
import { operationStore } from '../src/stores/operation-store.js'

// Mock pino logger to reduce test output noise
vi.mock('@sardeenz/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    }),
  }),
}))

// Clear all stores between tests
export function clearAllStores(): void {
  modelStore.clear()
  requestStore.clearAll()
  metricsStore.clear()
  operationStore.clear()
}

// Create a test Fastify instance with all routes registered
export async function createTestApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>()

  // Register CORS
  await fastify.register(import('@fastify/cors'), {
    origin: true,
    credentials: true,
  })

  // Register mock metrics plugin
  fastify.decorate('metrics', {
    modelLoadDuration: {
      startTimer: () => vi.fn(),
    },
    modelUnloadDuration: {
      startTimer: () => vi.fn(),
    },
    routingLatency: {
      startTimer: () => vi.fn(),
    },
    activeModels: {
      set: vi.fn(),
    },
    activeConnections: {
      set: vi.fn(),
    },
    inferenceRequests: {
      inc: vi.fn(),
    },
  })

  // Register routes
  await fastify.register(import('../src/routes/health.js'))
  await fastify.register(import('../src/routes/models.js'))
  await fastify.register(import('../src/routes/memory.js'))
  await fastify.register(import('../src/routes/proxy.js'))

  return fastify
}

// Global setup
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL = 'silent'
})

// Clean up between tests
afterEach(() => {
  clearAllStores()
  vi.clearAllMocks()
})

// Global teardown
afterAll(() => {
  vi.restoreAllMocks()
})
