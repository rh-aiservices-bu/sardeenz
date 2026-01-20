import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { config } from './config.js'
import { createLogger } from '@sardeenz/utils'
import { OrphanDetector } from './services/orphan-detector.js'
import { detectGpuInfo, initializeNvml, shutdownNvml } from './utils/gpu-info.js'
import { initializeDatabase, closeDb } from './db/index.js'

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
  disableRequestLogging: true,
  trustProxy: true,
}).withTypeProvider<TypeBoxTypeProvider>()

// Register plugins
await fastify.register(import('@fastify/cors'), {
  origin: true, // Allow all origins in development
  credentials: true,
})

// Register security headers (Helmet)
await fastify.register(import('@fastify/helmet'), {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // React dev tools may need these
      styleSrc: ["'self'", "'unsafe-inline'"], // PatternFly uses inline styles
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://api.github.com'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for some PatternFly assets
})

// Register rate limiting (global registration, applied per-route)
await fastify.register(import('@fastify/rate-limit'), {
  global: false, // Don't apply globally, configure per-route
})

// Register custom request logging plugin
await fastify.register(import('./plugins/request-logging.js'))

// Register Swagger/OpenAPI documentation
await fastify.register(import('@fastify/swagger'), {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Sardeenz API',
      description:
        'Multi-model management platform for vLLM with dynamic loading and unified proxy',
      version: '0.1.0',
    },
    servers: [
      {
        url: config.apiBaseUrl,
        description: 'API Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authentication token',
        },
      },
    },
    security: config.authMode !== 'none' ? [{ bearerAuth: [] }] : [],
    tags: [
      { name: 'auth', description: 'Authentication endpoints' },
      { name: 'models', description: 'Model lifecycle management endpoints' },
      { name: 'events', description: 'Real-time event streaming (SSE) endpoints' },
      { name: 'memory', description: 'GPU memory management and profiling endpoints' },
      { name: 'gpu', description: 'GPU information and monitoring endpoints' },
      { name: 'proxy', description: 'Inference proxy endpoints' },
      { name: 'health', description: 'Health check endpoints' },
      { name: 'orphans', description: 'Orphan process detection and cleanup (FR-027)' },
      { name: 'settings', description: 'Application settings endpoints' },
      { name: 'benchmarks', description: 'LLM performance benchmarking endpoints' },
      { name: 'local-models', description: 'Local model discovery and browsing' },
      { name: 'configurations', description: 'Model configuration save/load endpoints' },
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

// Register auth plugin (always - handles all auth modes)
await fastify.register(import('./plugins/auth.js'))

// Register inference auth plugin (handles separate API key auth for inference endpoints)
await fastify.register(import('./plugins/inference-auth.js'))

// Add global authentication hook for admin routes
// Note: Inference routes (/v1/*, /api/direct/*, etc.) are excluded and use separate API key auth
fastify.addHook('onRequest', async (request, reply) => {
  // Skip if auth mode is 'none'
  if (config.authMode === 'none') {
    return
  }

  // Skip public routes
  if (fastify.isPublicRoute(request.url)) {
    return
  }

  // Skip inference routes - they use separate API key auth (handled by inference-auth plugin)
  if (fastify.isInferenceRoute(request.url)) {
    return
  }

  // Skip authentication for authorization error redirects
  // This allows authenticated-but-unauthorized users to see the AccessDenied page
  if (request.url.includes('auth_error=')) {
    return
  }

  // Skip static files in production (non-API routes)
  if (config.nodeEnv === 'production' && !request.url.startsWith('/api/')) {
    return
  }

  // Authenticate admin routes with JWT
  await fastify.authenticate(request, reply)
})

// Register global error handler (must be before routes)
await fastify.register(import('./plugins/error-handler.js'))

// Register multipart support for audio endpoints
await fastify.register(import('@fastify/multipart'), {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size for audio
    files: 1, // Max 1 file per request
  },
})

// Register routes
await fastify.register(import('./routes/auth.js'))
await fastify.register(import('./routes/health.js'))
await fastify.register(import('./routes/models.js'))
await fastify.register(import('./routes/events.js'))
await fastify.register(import('./routes/memory.js'))
await fastify.register(import('./routes/gpu.js'))
await fastify.register(import('./routes/proxy.js'))
await fastify.register(import('./routes/direct-proxy.js'))
await fastify.register(import('./routes/orphans.js'))
await fastify.register(import('./routes/settings.js'))
await fastify.register(import('./routes/benchmarks.js'))
await fastify.register(import('./routes/memory-profiles.js'))
await fastify.register(import('./routes/local-models.js'))
await fastify.register(import('./routes/model-configurations.js'))

// Static file serving for frontend (production only)
if (config.nodeEnv === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const frontendPath = path.resolve(__dirname, '../../frontend/dist')

  await fastify.register(import('@fastify/static'), {
    root: frontendPath,
    prefix: '/',
  })

  // SPA fallback: serve index.html for non-API routes
  fastify.setNotFoundHandler(async (request, reply) => {
    if (
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/v1/') &&
      !request.url.startsWith('/docs') &&
      !request.url.startsWith('/metrics')
    ) {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ error: 'Not Found' })
  })
} else {
  // Development: show API info at root, redirect auth errors to frontend
  fastify.get('/', async (request, reply) => {
    // Handle authorization error redirects - redirect to frontend
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (url.searchParams.has('auth_error')) {
      const authError = url.searchParams.get('auth_error')
      const frontendHost = new URL(config.frontendUrl).host
      const currentHost = request.headers.host

      // Only redirect if frontend is on a different host/port (prevent infinite loop)
      if (frontendHost !== currentHost) {
        return reply.redirect(
          `${config.frontendUrl}/?auth_error=${encodeURIComponent(authError || '')}`
        )
      }

      // If same host, return a user-friendly error (shouldn't happen with proper config)
      return {
        error: 'Access Denied',
        message: decodeURIComponent(authError || 'You do not have access to sardeenz'),
        resolution:
          'Please contact your administrator to create a RoleBinding for sardeenz-admin or sardeenz-admin-readonly',
      }
    }

    return {
      name: 'Sardeenz',
      version: '0.1.0',
      status: 'running',
      documentation: '/docs',
    }
  })
}

// Start server
async function start() {
  try {
    // Initialize database and run migrations
    logger.info('Initializing database...')
    initializeDatabase()
    logger.info('Database initialized')

    // Initialize NVML library for GPU operations
    initializeNvml()

    // Detect GPU info at startup (cache result for later use)
    const gpuInfo = await detectGpuInfo()
    if (gpuInfo.length > 0) {
      logger.info(
        { gpus: gpuInfo.map((g) => ({ name: g.name, totalMemoryGB: g.totalMemoryGB })) },
        `Detected ${gpuInfo.length} GPU(s)`
      )
    } else {
      logger.warn('No GPU detected via NVML, using default GPU memory values')
    }

    await fastify.listen({
      port: config.port,
      host: config.host,
    })
    logger.info(`Server listening on http://${config.host}:${config.port}`)
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
  closeDb()
  shutdownNvml()
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
