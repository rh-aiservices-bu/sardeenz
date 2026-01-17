import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { config } from '../config.js'
import type { JWTPayload } from '@sardeenz/types'

// JWT sign payload (without iat/exp which are added by the library)
export interface JWTSignPayload {
  sub: string
  username: string
  email?: string
  roles: string[]
  authMode: 'simple' | 'oauth'
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTSignPayload
    user: JWTPayload
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    optionalAuthenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRole: (
      role: 'admin' | 'admin-readonly'
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    isPublicRoute: (url: string) => boolean
  }
}

// Public route prefixes that don't require authentication
const PUBLIC_ROUTE_PREFIXES = ['/api/health', '/api/auth', '/docs', '/metrics']

async function authPlugin(fastify: FastifyInstance) {
  // Register JWT plugin (always, for all auth modes that need it)
  if (config.authMode !== 'none') {
    await fastify.register(fastifyJwt, {
      secret: config.jwtSecret,
      sign: {
        expiresIn: `${config.jwtExpirationHours}h`,
      },
    })
  }

  // Helper to check if a route is public
  fastify.decorate('isPublicRoute', (url: string): boolean => {
    // Remove query string for comparison
    const path = url.split('?')[0]
    return PUBLIC_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))
  })

  // Authentication decorator - enforces authentication
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    // Skip authentication if auth mode is 'none'
    if (config.authMode === 'none') {
      return
    }

    // Check for token in query params (fallback for EventSource/SSE which can't send headers)
    const queryToken = (request.query as { token?: string })?.token
    if (queryToken) {
      try {
        request.user = fastify.jwt.verify<JWTPayload>(queryToken)
        return
      } catch {
        // Fall through to standard error handling
      }
    }

    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({
        error: {
          message: 'Unauthorized',
          type: 'authentication_error',
        },
      })
    }
  })

  // Optional authentication - doesn't fail if no token, but sets user if present
  fastify.decorate(
    'optionalAuthenticate',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      if (config.authMode === 'none') {
        return
      }

      try {
        await request.jwtVerify()
      } catch {
        // Token invalid or missing - continue without user
      }
    }
  )

  // Authorization decorator - checks roles after authentication
  fastify.decorate('requireRole', function (role: 'admin' | 'admin-readonly') {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // First authenticate
      await fastify.authenticate(request, reply)

      // Skip role check if auth is disabled
      if (config.authMode === 'none') {
        return
      }

      const userRoles = request.user?.roles || []

      // Check if user has no recognized roles at all
      const hasNoRoles = !userRoles.includes('admin') && !userRoles.includes('admin-readonly')

      if (hasNoRoles) {
        reply.code(403).send({
          error: {
            message:
              'Access denied: You are not bound to any sardeenz roles. Contact your administrator to create a RoleBinding.',
            type: 'authorization_error',
            code: 'no_roles',
          },
        })
        return
      }

      // 'admin' role has access to everything
      // 'admin-readonly' can only access if specifically required
      const hasAccess =
        userRoles.includes('admin') ||
        (role === 'admin-readonly' && userRoles.includes('admin-readonly'))

      if (!hasAccess) {
        reply.code(403).send({
          error: {
            message: 'Forbidden: insufficient permissions',
            type: 'authorization_error',
            code: 'insufficient_permissions',
          },
        })
      }
    }
  })
}

export default fp(authPlugin, {
  name: 'auth-plugin',
})
