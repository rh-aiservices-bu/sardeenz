/**
 * Global Error Handler Plugin
 *
 * Catches all uncaught errors, logs them with context, and returns consistent error responses.
 */

import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { AppError } from '../utils/errors.js'

/**
 * Sanitize request body for logging - remove sensitive fields
 */
function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body

  const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization']
  const sanitized = { ...(body as Record<string, unknown>) }

  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = '[REDACTED]'
    }
  }

  return sanitized
}

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler(
    (error: FastifyError | AppError | Error, request: FastifyRequest, reply: FastifyReply) => {
      // Build log context
      const logContext = {
        err: error,
        reqId: request.id,
        method: request.method,
        url: request.url,
        body: sanitizeBody(request.body),
      }

      // Handle AppError (our custom errors) - expected errors
      if (error instanceof AppError) {
        // Log at warn level for client errors (4xx), error for server errors (5xx)
        if (error.statusCode >= 500) {
          fastify.log.error(logContext, `${request.method} ${request.url} - ${error.message}`)
        } else {
          fastify.log.warn(logContext, `${request.method} ${request.url} - ${error.message}`)
        }

        return reply.status(error.statusCode).send(error.toJSON())
      }

      // Handle Fastify validation errors (schema validation failures)
      if ('validation' in error && error.validation) {
        fastify.log.warn(logContext, `Validation error: ${error.message}`)
        return reply.status(400).send({
          error: {
            message: error.message,
            type: 'validation_error',
            code: 'VALIDATION_FAILED',
          },
        })
      }

      // Handle unknown errors - these are unexpected and should be logged at error level
      fastify.log.error(logContext, `Unexpected error: ${error.message}`)

      // In production, don't leak error details
      const isProduction = process.env.NODE_ENV === 'production'
      return reply.status(500).send({
        error: {
          message: isProduction ? 'Internal server error' : error.message,
          type: 'internal_error',
          code: 'INTERNAL_ERROR',
        },
      })
    }
  )

  fastify.log.info('Global error handler registered')
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
  fastify: '5.x',
})
