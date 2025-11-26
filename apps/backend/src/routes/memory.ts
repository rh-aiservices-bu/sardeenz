import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  SetMemoryLimitsRequestSchema,
  SetMemoryLimitsResponseSchema,
  ErrorResponseSchema,
  type SetMemoryLimitsRequestType,
} from '@sardeenz/types'
import { MemoryMonitor } from '../services/memory-monitor.js'
import { AppError } from '../utils/errors.js'

export default async function memoryRoutes(fastify: FastifyInstance) {
  const memoryMonitor = new MemoryMonitor(fastify.log)

  /**
   * GET /api/memory/usage - Get GPU memory usage for all models
   */
  fastify.get(
    '/api/memory/usage',
    {
      schema: {
        tags: ['memory'],
        description: 'Get GPU memory usage for all models',
        response: {
          200: Type.Object({
            gpu_total_gb: Type.Number(),
            gpu_used_gb: Type.Number(),
            gpu_free_gb: Type.Number(),
            models: Type.Array(
              Type.Object({
                model_path: Type.String(),
                gpu_memory_used_gb: Type.Number(),
                gpu_memory_limit_gb: Type.Number(),
                gpu_memory_usage_percent: Type.Number(),
              })
            ),
          }),
          500: ErrorResponseSchema,
        },
      },
      // TODO: Uncomment when auth is configured
      // onRequest: fastify.requireRole('admin-readonly'),
    },
    async (_request, reply) => {
      try {
        const usage = await memoryMonitor.getMemoryUsage()
        return usage
      } catch (err) {
        if (err instanceof AppError) {
          reply.status(err.statusCode as 500)
          return reply.send(err.toJSON())
        }

        reply.status(500)
        return reply.send({
          error: {
            message: err instanceof Error ? err.message : 'Unknown error',
            type: 'internal_error',
          },
        })
      }
    }
  )

  /**
   * POST /api/memory/limits - Set memory limits for a model
   */
  fastify.post<{ Body: SetMemoryLimitsRequestType }>(
    '/api/memory/limits',
    {
      schema: {
        tags: ['memory'],
        description: 'Set memory limit for a specific model',
        body: SetMemoryLimitsRequestSchema,
        response: {
          200: SetMemoryLimitsResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      // TODO: Uncomment when auth is configured
      // onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { model_path, limit_gb } = request.body

      try {
        await memoryMonitor.setMemoryLimits(model_path, limit_gb)

        return {
          status: 'success' as const,
          model: model_path,
          new_limit_gb: limit_gb,
        }
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send(err.toJSON())
        }

        return reply.code(500).send({
          error: {
            message: err instanceof Error ? err.message : 'Unknown error',
            type: 'internal_error',
          },
        })
      }
    }
  )
}
