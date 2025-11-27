import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/health',
    {
      schema: {
        tags: ['health'],
        description: 'Health check endpoint',
        response: {
          200: Type.Object({
            status: Type.Literal('healthy'),
            timestamp: Type.String({ format: 'date-time' }),
            uptime: Type.Number(),
            version: Type.String(),
          }),
        },
      },
      config: { logRequests: false },
    },
    async () => {
      return {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '0.1.0',
      }
    }
  )

  fastify.get(
    '/api/health/ready',
    {
      schema: {
        tags: ['health'],
        description: 'Readiness check endpoint',
        response: {
          200: Type.Object({
            status: Type.Literal('ready'),
            timestamp: Type.String({ format: 'date-time' }),
          }),
        },
      },
      config: { logRequests: false },
    },
    async () => {
      return {
        status: 'ready' as const,
        timestamp: new Date().toISOString(),
      }
    }
  )

  fastify.get(
    '/api/health/live',
    {
      schema: {
        tags: ['health'],
        description: 'Liveness check endpoint',
        response: {
          200: Type.Object({
            status: Type.Literal('alive'),
            timestamp: Type.String({ format: 'date-time' }),
          }),
        },
      },
      config: { logRequests: false },
    },
    async () => {
      return {
        status: 'alive' as const,
        timestamp: new Date().toISOString(),
      }
    }
  )
}
