import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyOAuth2 from '@fastify/oauth2'
import { config } from '../config.js'

interface JWTPayload {
  sub: string
  preferred_username?: string
  email?: string
  realm_access?: {
    roles: string[]
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTPayload
    user: JWTPayload
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRole: (role: 'admin' | 'admin-readonly') => (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>
  }
}

async function authPlugin(fastify: FastifyInstance) {
  // Register JWT plugin
  await fastify.register(fastifyJwt, {
    secret: config.jwtSecret,
    decode: { complete: true },
  })

  // Register OAuth2 plugin (if OIDC is configured)
  if (config.oidcIssuerUrl) {
    await fastify.register(fastifyOAuth2, {
      name: 'oidcAuth',
      scope: ['openid', 'profile', 'email'],
      credentials: {
        client: {
          id: config.oauthClientId,
          secret: config.oauthClientSecret,
        },
      },
      startRedirectPath: '/auth/login',
      callbackUri: `${config.apiBaseUrl}/auth/callback`,
      discovery: {
        issuer: config.oidcIssuerUrl,
      },
    })
  }

  // Authentication decorator
  fastify.decorate('authenticate', async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
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

  // Authorization decorator
  fastify.decorate('requireRole', function (role: 'admin' | 'admin-readonly') {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await fastify.authenticate(request, reply)

      const userRoles = request.user?.realm_access?.roles || []

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
