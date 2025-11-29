import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'
import { QUIET_ROUTES } from '../config/quiet-routes.js'

/**
 * Custom request/response logging plugin with support for quiet routes.
 *
 * Routes can opt-out of verbose logging by:
 * 1. Setting `logRequests: false` in route config, OR
 * 2. Being listed in QUIET_ROUTES configuration
 *
 * Quiet routes log success (2xx/3xx) at 'debug' level, errors (4xx/5xx) at 'warn'/'error' levels.
 * Can be overridden with LOG_ALL_REQUESTS=true env var to force all routes to log at info level.
 */
async function requestLoggingPlugin(fastify: FastifyInstance) {
  // Request hook - capture start time
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    ;(request as any).requestStartTime = Date.now()
  })

  // Response hook - logs after response is sent
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const { statusCode } = reply
    const { method, url, routeOptions } = request
    const startTime = (request as any).requestStartTime || Date.now()
    const responseTime = Date.now() - startTime

    // Check if route has quiet logging enabled
    const isQuietRoute =
      routeOptions?.config?.logRequests === false ||
      QUIET_ROUTES.some((route) => url.startsWith(route))

    const forceVerbose = config.logAllRequests

    // Prepare log context
    const logContext = {
      req: request,
      res: reply,
      responseTime: `${responseTime.toFixed(2)}ms`,
    }

    // Determine log level based on status code and route config
    let logLevel: 'debug' | 'info' | 'warn' | 'error'
    let logMessage = `${method} ${url} ${statusCode}`

    if (statusCode >= 500) {
      logLevel = 'error'
      logMessage = `${method} ${url} ${statusCode} - Server Error`
    } else if (statusCode >= 400) {
      logLevel = 'warn'
      logMessage = `${method} ${url} ${statusCode} - Client Error`
    } else {
      // 2xx/3xx success - use debug for quiet routes (unless forced), info for verbose
      logLevel = isQuietRoute && !forceVerbose ? 'debug' : 'info'
    }

    // Log with appropriate level
    fastify.log[logLevel](logContext, logMessage)
  })
}

export default fp(requestLoggingPlugin, {
  name: 'request-logging-plugin',
})
