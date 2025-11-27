import Fastify from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { config } from './config.js'
import { createLogger } from '@sardeenz/utils'
import { OrphanDetector } from './services/orphan-detector.js'
import { detectGpuInfo } from './utils/gpu-info.js'

// Create logger
const logger = createLogger({
  level: config.logLevel,
  name: 'sardeenz-backend',
})

// Create Fastify instance with TypeBox type provider
const fastify = Fastify({
  loggerInstance: logger,
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
  trustProxy: true,
}).withTypeProvider<TypeBoxTypeProvider>()

// Register plugins
await fastify.register(import('@fastify/cors'), {
  origin: true, // Allow all origins in development
  credentials: true,
})

// Register Swagger/OpenAPI documentation
await fastify.register(import('@fastify/swagger'), {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Sardeenz API',
      description: 'Multi-model management platform for vLLM with dynamic loading and unified proxy',
      version: '0.1.0',
    },
    servers: [
      {
        url: config.apiBaseUrl,
        description: 'API Server',
      },
    ],
    tags: [
      { name: 'models', description: 'Model lifecycle management endpoints' },
      { name: 'events', description: 'Real-time event streaming (SSE) endpoints' },
      { name: 'memory', description: 'GPU memory management endpoints' },
      { name: 'gpu', description: 'GPU information and monitoring endpoints' },
      { name: 'proxy', description: 'Inference proxy endpoints' },
      { name: 'health', description: 'Health check endpoints' },
      { name: 'orphans', description: 'Orphan process detection and cleanup (FR-027)' },
      { name: 'settings', description: 'Application settings endpoints' },
    ],
  },
})

await fastify.register(import('@fastify/swagger-ui'), {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
  },
})

// Register metrics plugin
await fastify.register(import('./plugins/metrics.js'))

// Register auth plugin (if OIDC is configured)
if (config.oidcIssuerUrl) {
  await fastify.register(import('./plugins/auth.js'))
}

// Register routes
await fastify.register(import('./routes/health.js'))
await fastify.register(import('./routes/models.js'))
await fastify.register(import('./routes/events.js'))
await fastify.register(import('./routes/memory.js'))
await fastify.register(import('./routes/gpu.js'))
await fastify.register(import('./routes/proxy.js'))
await fastify.register(import('./routes/orphans.js'))
await fastify.register(import('./routes/settings.js'))

// Root endpoint
fastify.get('/', async () => {
  return {
    name: 'Sardeenz',
    version: '0.1.0',
    status: 'running',
    documentation: '/docs',
  }
})

// Start server
async function start() {
  try {
    // Detect GPU info at startup (cache result for later use)
    const gpuInfo = await detectGpuInfo()
    if (gpuInfo.length > 0) {
      logger.info(
        { gpus: gpuInfo.map((g) => ({ name: g.name, totalMemoryGB: g.totalMemoryGB })) },
        `Detected ${gpuInfo.length} GPU(s)`
      )
    } else {
      logger.warn('No GPU detected via nvidia-smi, using default GPU memory values')
    }

    await fastify.listen({
      port: config.port,
      host: config.host,
    })
    logger.info(
      `Server listening on http://${config.host}:${config.port}`
    )
    logger.info(`Documentation available at http://${config.host}:${config.port}/docs`)

    // FR-027: Perform startup orphan detection
    const orphanDetector = new OrphanDetector(logger)
    await orphanDetector.performStartupScan()
  } catch (err) {
    logger.error(err)
    process.exit(1)
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down server...')
  await fastify.close()
  logger.info('Server shut down')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Start if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  start()
}

export { fastify }
