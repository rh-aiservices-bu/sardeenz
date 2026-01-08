import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual } from 'crypto'
import { config } from '../config.js'

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Lengths differ - still do a comparison to avoid leaking length info via timing
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

// Route prefixes that are considered inference endpoints
// These are excluded from admin JWT auth and use optional API key auth instead
const INFERENCE_ROUTE_PREFIXES = [
  '/v1/', // OpenAI-compatible endpoints
  '/tokenize',
  '/detokenize',
  '/pooling',
  '/classification',
  '/score',
  '/re-rank',
  '/api/direct/', // Direct port-based proxy
]

declare module 'fastify' {
  interface FastifyInstance {
    isInferenceRoute: (url: string) => boolean
    authenticateInference: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

async function inferenceAuthPlugin(fastify: FastifyInstance) {
  // Helper to check if a route is an inference route
  fastify.decorate('isInferenceRoute', (url: string): boolean => {
    // Remove query string for comparison
    const path = url.split('?')[0]
    return INFERENCE_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))
  })

  // Inference authentication decorator
  // If INFERENCE_API_KEY is set, validates Bearer token against it
  // If not set, allows all requests (inference endpoints are open)
  fastify.decorate(
    'authenticateInference',
    async function (request: FastifyRequest, reply: FastifyReply) {
      // If no inference API key is configured, allow all requests
      if (!config.inferenceApiKey) {
        return
      }

      // Extract Bearer token from Authorization header
      const authHeader = request.headers.authorization
      if (!authHeader) {
        reply.code(401).send({
          error: {
            message: 'API key required. Provide Authorization: Bearer <api-key> header.',
            type: 'authentication_error',
            code: 'missing_api_key',
          },
        })
        return
      }

      // Validate Bearer token format
      const parts = authHeader.split(' ')
      if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        reply.code(401).send({
          error: {
            message: 'Invalid Authorization header format. Use: Bearer <api-key>',
            type: 'authentication_error',
            code: 'invalid_auth_format',
          },
        })
        return
      }

      const token = parts[1]

      // Validate token against configured API key using timing-safe comparison
      if (!secureCompare(token, config.inferenceApiKey)) {
        reply.code(401).send({
          error: {
            message: 'Invalid API key',
            type: 'authentication_error',
            code: 'invalid_api_key',
          },
        })
        return
      }

      // Token is valid, continue
    }
  )
}

export default fp(inferenceAuthPlugin, {
  name: 'inference-auth-plugin',
})
