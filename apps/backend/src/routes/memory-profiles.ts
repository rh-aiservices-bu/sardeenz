/**
 * Memory Profile API Routes
 *
 * CRUD operations for memory profiles used in capacity planning.
 */

import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  CreateMemoryProfileRequestSchema,
  UpdateMemoryProfileRequestSchema,
  ListMemoryProfilesResponseSchema,
  GetMemoryProfileResponseSchema,
  DeleteMemoryProfileResponseSchema,
  MemoryCheckRequestSchema,
  MemoryCheckResponseSchema,
  LookupMemoryProfileQuerySchema,
  ErrorResponseSchema,
  type CreateMemoryProfileRequestType,
  type UpdateMemoryProfileRequestType,
  type MemoryCheckRequestType,
  type LookupMemoryProfileQueryType,
  MemoryWarningLevel,
} from '@sardeenz/types'
import { getMemoryProfileStore } from '../stores/memory-profile-store.js'
import { modelStore } from '../stores/model-store.js'
import { getCachedPrimaryGpuInfo } from '../utils/gpu-info.js'
import { MemoryMonitor } from '../services/memory-monitor.js'

const ProfileIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

// Helper to convert domain object to API response format (snake_case)
function profileToResponse(profile: {
  id: string
  profileName: string
  modelPath: string
  maxTokens: number
  totalGpuMemoryGib: number
  weightsMemoryGib: number
  cudaGraphsGib: number
  overheadMemoryGib: number
  kvCacheAvailableGib: number
  kvCachePerRequestMib?: number
  gpuName?: string
  gpuTotalMemoryGib?: number
  comments?: string
  createdBy?: string
  createdAt: string
  updatedAt?: string
}) {
  return {
    id: profile.id,
    profile_name: profile.profileName,
    model_path: profile.modelPath,
    max_tokens: profile.maxTokens,
    total_gpu_memory_gib: profile.totalGpuMemoryGib,
    weights_memory_gib: profile.weightsMemoryGib,
    cuda_graphs_gib: profile.cudaGraphsGib,
    overhead_memory_gib: profile.overheadMemoryGib,
    kv_cache_available_gib: profile.kvCacheAvailableGib,
    kv_cache_per_request_mib: profile.kvCachePerRequestMib,
    gpu_name: profile.gpuName,
    gpu_total_memory_gib: profile.gpuTotalMemoryGib,
    comments: profile.comments,
    created_by: profile.createdBy,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  }
}

export default async function memoryProfileRoutes(fastify: FastifyInstance) {
  const store = getMemoryProfileStore()
  const memoryMonitor = new MemoryMonitor(fastify.log)

  /**
   * GET /api/memory/profiles - List all memory profiles
   */
  fastify.get(
    '/api/memory/profiles',
    {
      schema: {
        tags: ['memory'],
        description: 'List all saved memory profiles',
        response: {
          200: ListMemoryProfilesResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async () => {
      const { profiles, total } = await store.listProfiles()

      return {
        profiles: profiles.map(profileToResponse),
        total,
      }
    }
  )

  /**
   * GET /api/memory/profiles/lookup - Find profile by model_path + max_tokens + gpu_name
   */
  fastify.get<{ Querystring: LookupMemoryProfileQueryType }>(
    '/api/memory/profiles/lookup',
    {
      schema: {
        tags: ['memory'],
        description: 'Find a memory profile by model_path, max_tokens, and gpu_name',
        querystring: LookupMemoryProfileQuerySchema,
        response: {
          200: GetMemoryProfileResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { model_path, max_tokens, gpu_name } = request.query
      const profile = await store.lookupProfile(model_path, max_tokens, gpu_name)

      if (!profile) {
        return reply.status(404).send({
          error: {
            message: `No profile found for model_path=${model_path}, max_tokens=${max_tokens}, gpu_name=${gpu_name}`,
            type: 'not_found',
          },
        })
      }

      return { profile: profileToResponse(profile) }
    }
  )

  /**
   * GET /api/memory/profiles/:id - Get a specific memory profile
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/memory/profiles/:id',
    {
      schema: {
        tags: ['memory'],
        description: 'Get a memory profile by ID',
        params: ProfileIdParamsSchema,
        response: {
          200: GetMemoryProfileResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { id } = request.params
      const profile = await store.getProfile(id)

      if (!profile) {
        return reply.status(404).send({
          error: {
            message: `Memory profile not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return { profile: profileToResponse(profile) }
    }
  )

  /**
   * POST /api/memory/profiles - Create a memory profile
   * Can capture from a running instance or accept manual entry
   */
  fastify.post<{ Body: CreateMemoryProfileRequestType }>(
    '/api/memory/profiles',
    {
      schema: {
        tags: ['memory'],
        description: 'Create a memory profile from a running instance or manual entry',
        body: CreateMemoryProfileRequestSchema,
        response: {
          201: GetMemoryProfileResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const body = request.body

      // If instance_id provided, capture from running model
      if (body.instance_id) {
        const instance = modelStore.get(body.instance_id)
        if (!instance) {
          return reply.status(404).send({
            error: {
              message: `Model instance not found: ${body.instance_id}`,
              type: 'not_found',
            },
          })
        }

        if (instance.status !== 'running') {
          return reply.status(400).send({
            error: {
              message: `Model instance is not running: ${body.instance_id} (status: ${instance.status})`,
              type: 'validation_error',
            },
          })
        }

        if (!instance.memoryMetrics) {
          return reply.status(400).send({
            error: {
              message: `Model instance does not have memory metrics yet. Wait for model to fully load.`,
              type: 'validation_error',
            },
          })
        }

        // Get GPU info from cached detection
        const gpuInfo = getCachedPrimaryGpuInfo()
        const gpuName = gpuInfo.name
        const gpuTotalMemoryGib = gpuInfo.totalMemoryGB

        // Get live GPU memory from NVML (same source as bar chart and details modal)
        let liveGpuMemoryGib: number | undefined
        try {
          const memoryUsage = await memoryMonitor.getMemoryUsage()
          const modelMemory = memoryUsage.models.find((m) => m.instance_id === body.instance_id)
          if (modelMemory) {
            liveGpuMemoryGib = modelMemory.gpu_memory_gb
          }
        } catch (err) {
          fastify.log.warn(
            { err, instanceId: body.instance_id },
            'Failed to get live GPU memory for profile'
          )
        }

        // Use live GPU memory if available, otherwise fall back to memoryMetrics
        const totalGpuMemoryGib = liveGpuMemoryGib ?? instance.memoryMetrics.totalGpuMemoryGiB

        // Recalculate overhead based on live total
        const overheadMemoryGib = liveGpuMemoryGib
          ? Math.max(
              0,
              liveGpuMemoryGib -
                instance.memoryMetrics.weightsMemoryGiB -
                instance.memoryMetrics.cudaGraphMemoryGiB
            )
          : instance.memoryMetrics.overheadMemoryGiB

        const profileName =
          body.profile_name || `${instance.modelPath} @ ${instance.maxTokens} tokens`

        const profile = await store.upsertProfile({
          profileName,
          modelPath: instance.modelPath,
          maxTokens: instance.maxTokens,
          totalGpuMemoryGib,
          weightsMemoryGib: instance.memoryMetrics.weightsMemoryGiB,
          cudaGraphsGib: instance.memoryMetrics.cudaGraphMemoryGiB,
          overheadMemoryGib,
          kvCacheAvailableGib: instance.memoryMetrics.kvCacheAvailableGiB,
          kvCachePerRequestMib: instance.memoryMetrics.kvCachePerRequestMiB,
          gpuName,
          gpuTotalMemoryGib,
          comments: body.comments,
        })

        reply.status(201)
        return { profile: profileToResponse(profile) }
      }

      // Manual entry - validate required fields
      if (
        !body.model_path ||
        !body.max_tokens ||
        body.total_gpu_memory_gib === undefined ||
        body.weights_memory_gib === undefined ||
        body.cuda_graphs_gib === undefined
      ) {
        return reply.status(400).send({
          error: {
            message:
              'Manual profile entry requires: model_path, max_tokens, total_gpu_memory_gib, weights_memory_gib, cuda_graphs_gib',
            type: 'validation_error',
          },
        })
      }

      // Calculate overhead if not provided
      const overheadMemoryGib =
        body.overhead_memory_gib ??
        Math.max(0, body.total_gpu_memory_gib - body.weights_memory_gib - body.cuda_graphs_gib)

      const profileName = body.profile_name || `${body.model_path} @ ${body.max_tokens} tokens`

      const profile = await store.upsertProfile({
        profileName,
        modelPath: body.model_path,
        maxTokens: body.max_tokens,
        totalGpuMemoryGib: body.total_gpu_memory_gib,
        weightsMemoryGib: body.weights_memory_gib,
        cudaGraphsGib: body.cuda_graphs_gib,
        overheadMemoryGib,
        kvCacheAvailableGib: body.kv_cache_available_gib ?? 0,
        kvCachePerRequestMib: body.kv_cache_per_request_mib,
        gpuName: body.gpu_name,
        gpuTotalMemoryGib: body.gpu_total_memory_gib,
        comments: body.comments,
      })

      reply.status(201)
      return { profile: profileToResponse(profile) }
    }
  )

  /**
   * PUT /api/memory/profiles/:id - Update a memory profile (name/comments only)
   */
  fastify.put<{ Params: { id: string }; Body: UpdateMemoryProfileRequestType }>(
    '/api/memory/profiles/:id',
    {
      schema: {
        tags: ['memory'],
        description: 'Update a memory profile name or comments',
        params: ProfileIdParamsSchema,
        body: UpdateMemoryProfileRequestSchema,
        response: {
          200: GetMemoryProfileResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { id } = request.params
      const body = request.body

      const profile = await store.updateProfile(id, {
        profileName: body.profile_name,
        comments: body.comments,
      })

      if (!profile) {
        return reply.status(404).send({
          error: {
            message: `Memory profile not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return { profile: profileToResponse(profile) }
    }
  )

  /**
   * DELETE /api/memory/profiles/:id - Delete a memory profile
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/memory/profiles/:id',
    {
      schema: {
        tags: ['memory'],
        description: 'Delete a memory profile',
        params: ProfileIdParamsSchema,
        response: {
          200: DeleteMemoryProfileResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { id } = request.params

      const deleted = await store.deleteProfile(id)

      if (!deleted) {
        return reply.status(404).send({
          error: {
            message: `Memory profile not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return {
        status: 'success' as const,
        id,
        deleted_at: new Date().toISOString(),
      }
    }
  )

  /**
   * POST /api/memory/check-before-load - Pre-load memory check with warnings
   */
  fastify.post<{ Body: MemoryCheckRequestType }>(
    '/api/memory/check-before-load',
    {
      schema: {
        tags: ['memory'],
        description: 'Check if a model will fit in GPU memory before loading',
        body: MemoryCheckRequestSchema,
        response: {
          200: MemoryCheckResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request) => {
      const { model_path, max_tokens, gpu_name } = request.body

      // Look up the profile
      const profile = await store.lookupProfile(model_path, max_tokens, gpu_name)

      if (!profile) {
        // No profile found - return info level warning
        return {
          has_profile: false,
          can_fit: true, // We don't know, so assume it's possible
          warning_level: MemoryWarningLevel.Info,
          message: `No memory profile found for this model configuration. Consider creating one after loading.`,
        }
      }

      // Get real available memory from memory monitor
      let availableMemoryGib: number
      try {
        const usage = await memoryMonitor.getMemoryUsage()
        availableMemoryGib = usage.gpu.free_gb
      } catch (err) {
        // Fallback to profile's GPU total if memory monitor fails
        fastify.log.warn({ err }, 'Failed to get real GPU memory, using profile fallback')
        availableMemoryGib = profile.gpuTotalMemoryGib || 24
      }

      // Required memory from profile with a small buffer
      const estimatedRequiredGib = profile.totalGpuMemoryGib * 1.05 // 5% buffer

      const canFit = estimatedRequiredGib <= availableMemoryGib
      const isClose = estimatedRequiredGib > availableMemoryGib * 0.8

      let warningLevel: MemoryWarningLevel
      let message: string

      if (!canFit) {
        warningLevel = MemoryWarningLevel.Danger
        message = `Model requires ~${estimatedRequiredGib.toFixed(1)} GiB but only ~${availableMemoryGib.toFixed(1)} GiB available.`
      } else if (isClose) {
        warningLevel = MemoryWarningLevel.Caution
        message = `Memory is tight. Model uses ~${profile.totalGpuMemoryGib.toFixed(1)} GiB, leaving ~${(availableMemoryGib - profile.totalGpuMemoryGib).toFixed(1)} GiB free.`
      } else {
        warningLevel = MemoryWarningLevel.Ok
        message = `Model should fit. Uses ~${profile.totalGpuMemoryGib.toFixed(1)} GiB, leaving ~${(availableMemoryGib - profile.totalGpuMemoryGib).toFixed(1)} GiB free.`
      }

      return {
        has_profile: true,
        can_fit: canFit,
        warning_level: warningLevel,
        message,
        profile: profileToResponse(profile),
        available_memory_gib: availableMemoryGib,
        estimated_required_gib: estimatedRequiredGib,
      }
    }
  )
}
