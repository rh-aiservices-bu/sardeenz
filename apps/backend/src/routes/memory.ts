import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  SetMemoryLimitsRequestSchema,
  SetMemoryLimitsResponseSchema,
  ErrorResponseSchema,
  MultiGpuMemoryUsageResponseSchema,
  type SetMemoryLimitsRequestType,
} from '@sardeenz/types'
import { MemoryMonitor } from '../services/memory-monitor.js'
import { AppError } from '../utils/errors.js'

// Response schemas for memory usage
const KVCacheMetricsSchema = Type.Object({
  total_gb: Type.Number(),
  prealloc_gb: Type.Number(),
  used_gb: Type.Number(),
  free_gb: Type.Number(),
})

const GpuMetricsSchema = Type.Object({
  total_gb: Type.Number(),
  used_gb: Type.Number(),
  free_gb: Type.Number(),
  utilization_percent: Type.Number(),
})

const ModelGpuMemorySchema = Type.Object({
  model_path: Type.String(),
  instance_id: Type.String(),
  display_name: Type.String(),
  gpu_memory_gb: Type.Number(),
  color: Type.String(),
})

const MemoryUsageResponseSchema = Type.Object({
  kvcache: KVCacheMetricsSchema,
  gpu: GpuMetricsSchema,
  models: Type.Array(ModelGpuMemorySchema),
})

export default async function memoryRoutes(fastify: FastifyInstance) {
  const memoryMonitor = new MemoryMonitor(fastify.log)

  /**
   * GET /api/memory/usage - Get GPU and KVCache memory usage with per-model breakdown
   */
  fastify.get(
    '/api/memory/usage',
    {
      schema: {
        tags: ['memory'],
        description: 'Get GPU and KVCache memory usage with per-model breakdown for visualization',
        response: {
          200: MemoryUsageResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
      config: { logRequests: false },
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
   * GET /api/memory/usage/multi-gpu - Get per-GPU memory breakdown for multi-GPU systems
   */
  fastify.get(
    '/api/memory/usage/multi-gpu',
    {
      schema: {
        tags: ['memory'],
        description:
          'Get per-GPU memory usage with per-model breakdown for multi-GPU visualization',
        response: {
          200: MultiGpuMemoryUsageResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
      config: { logRequests: false },
    },
    async (_request, reply) => {
      try {
        const usage = await memoryMonitor.getMultiGpuMemoryUsage()
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
      onRequest: fastify.requireRole('admin'),
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
