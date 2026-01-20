import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { getNvidiaSmiInfo } from '../utils/gpu-info.js'
import { ErrorResponseSchema, GpuAvailabilityResponseSchema } from '@sardeenz/types'
import { GpuSelector } from '../services/gpu-selector.js'

// Response schemas
const DriverInfoSchema = Type.Object({
  nvidiaSmiVersion: Type.String(),
  driverVersion: Type.String(),
  cudaVersion: Type.String(),
})

const GpuStatusSchema = Type.Object({
  index: Type.Number(),
  name: Type.String(),
  persistenceMode: Type.String(),
  busId: Type.String(),
  displayActive: Type.String(),
  eccErrors: Type.Union([Type.String(), Type.Null()]),
  fan: Type.String(),
  temperature: Type.String(),
  performanceState: Type.String(),
  powerUsage: Type.String(),
  powerCap: Type.String(),
  memoryUsed: Type.String(),
  memoryTotal: Type.String(),
  memoryUsedMB: Type.Number(),
  memoryTotalMB: Type.Number(),
  gpuUtilization: Type.String(),
  computeMode: Type.String(),
  migMode: Type.Union([Type.String(), Type.Null()]),
})

const GpuProcessSchema = Type.Object({
  gpu: Type.Number(),
  gi: Type.String(),
  ci: Type.String(),
  pid: Type.Number(),
  type: Type.String(),
  processName: Type.String(),
  gpuMemory: Type.String(),
  gpuMemoryMB: Type.Number(),
})

const NvidiaSmiInfoSchema = Type.Object({
  timestamp: Type.String(),
  driver: DriverInfoSchema,
  gpus: Type.Array(GpuStatusSchema),
  processes: Type.Array(GpuProcessSchema),
})

export default async function gpuRoutes(fastify: FastifyInstance) {
  const gpuSelector = new GpuSelector(fastify.log)

  /**
   * GET /api/gpu/info - Get complete GPU information
   */
  fastify.get(
    '/api/gpu/info',
    {
      schema: {
        tags: ['gpu'],
        description: 'Get complete GPU information from NVML',
        response: {
          200: NvidiaSmiInfoSchema,
          500: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (_request, reply) => {
      try {
        const info = await getNvidiaSmiInfo()
        return info
      } catch (err) {
        reply.status(500)
        return reply.send({
          error: {
            message: err instanceof Error ? err.message : 'Failed to get GPU info',
            type: 'internal_error',
          },
        })
      }
    }
  )

  /**
   * GET /api/gpu/available - Get available GPUs with selection recommendations
   */
  fastify.get(
    '/api/gpu/available',
    {
      schema: {
        tags: ['gpu'],
        description: 'Get available GPUs with selection recommendations for model loading',
        response: {
          200: GpuAvailabilityResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (_request, reply) => {
      try {
        const availability = await gpuSelector.getGpuAvailability()
        return availability
      } catch (err) {
        reply.status(500)
        return reply.send({
          error: {
            message: err instanceof Error ? err.message : 'Failed to get GPU availability',
            type: 'internal_error',
          },
        })
      }
    }
  )
}
