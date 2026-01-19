import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  LoadModelRequestSchema,
  LoadModelResponseSchema,
  UnloadModelResponseSchema,
  ListModelsResponseSchema,
  GetModelResponseSchema,
  ModelHealthResponseSchema,
  ErrorResponseSchema,
  ListInstancesResponseSchema,
  UnloadInstanceResponseSchema,
  SleepModelRequestSchema,
  SleepModelResponseSchema,
  WakeModelRequestSchema,
  WakeModelResponseSchema,
  SleepStatusResponseSchema,
  type ModelInstanceDTO,
  type LoadModelRequestType,
  type SleepModelRequestType,
  type WakeModelRequestType,
} from '@sardeenz/types'
import { getModelManager } from '../services/model-manager.js'
import { getModelMover } from '../services/model-mover.js'
import { modelStore } from '../stores/model-store.js'
import { operationStore } from '../stores/operation-store.js'
import { NotFoundError, AppError } from '../utils/errors.js'
import { randomUUID } from 'crypto'
import type { ModelInstance, ControllerOperation } from '@sardeenz/types'
import { OperationStatus, OperationType } from '@sardeenz/types'

export default async function modelsRoutes(fastify: FastifyInstance) {
  const modelManager = getModelManager(fastify.log)

  // Helper to convert ModelInstance to DTO
  function toDTO(instance: ModelInstance): ModelInstanceDTO {
    return {
      id: instance.id,
      model_path: instance.modelPath,
      model_name: instance.modelName,
      status: instance.status,
      port: instance.port,
      process_id: instance.processId,
      max_tokens: instance.maxTokens,
      gpu_memory_utilization: instance.gpuMemoryUtilization,
      loaded_at: instance.loadedAt.toISOString(),
      ready_at: instance.readyAt?.toISOString(),
      error_message: instance.errorMessage,
      memory_metrics: instance.memoryMetrics
        ? {
            total_gpu_memory_gib: instance.memoryMetrics.totalGpuMemoryGiB,
            weights_memory_gib: instance.memoryMetrics.weightsMemoryGiB,
            cuda_graph_memory_gib: instance.memoryMetrics.cudaGraphMemoryGiB,
            overhead_memory_gib: instance.memoryMetrics.overheadMemoryGiB,
            kv_cache_available_gib: instance.memoryMetrics.kvCacheAvailableGiB,
            kv_cache_per_request_mib: instance.memoryMetrics.kvCachePerRequestMiB,
            max_model_len: instance.memoryMetrics.maxModelLen,
          }
        : undefined,
      has_chat_template: instance.hasChatTemplate,
      launch_command: instance.launchCommand,
      gpu_ids: instance.gpuIds,
      tensor_parallel_size: instance.tensorParallelSize,
      kvcached_enabled: instance.kvcachedEnabled,
      memory_baseline_by_gpu: instance.memoryBaselineByGpu,
      sleep_mode_enabled: instance.sleepModeEnabled,
      sleep_level: instance.sleepLevel,
      slept_at: instance.sleptAt?.toISOString(),
      routable: instance.routable,
    }
  }

  /**
   * POST /api/models/load - Load a new model
   */
  fastify.post<{ Body: LoadModelRequestType }>(
    '/api/models/load',
    {
      schema: {
        tags: ['models'],
        description: 'Load a new model instance',
        body: LoadModelRequestSchema,
        response: {
          200: LoadModelResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const {
        model_path,
        max_tokens,
        extra_args,
        gpu_ids,
        tensor_parallel_size,
        source_type,
        served_model_name,
        enable_sleep_mode,
      } = request.body

      const operationId = randomUUID()
      const operation: ControllerOperation = {
        id: operationId,
        operationType: OperationType.Load,
        modelPath: model_path,
        initiatedBy: 'system', // TODO: Get from auth context
        initiatedAt: new Date(),
        status: OperationStatus.InProgress,
        parameters: {
          max_tokens,
          extra_args,
          gpu_ids,
          tensor_parallel_size,
          source_type,
          served_model_name,
        },
      }

      operationStore.add(operation)

      const timer = fastify.sardeenzMetrics.modelLoadDuration.startTimer()

      try {
        // launchModel now returns immediately with status='starting'
        // Model loading continues in background, frontend subscribes via SSE
        const instance = await modelManager.launchModel({
          modelPath: model_path,
          maxTokens: max_tokens,
          extraArgs: extra_args,
          gpuIds: gpu_ids,
          tensorParallelSize: tensor_parallel_size,
          sourceType: source_type,
          servedModelName: served_model_name,
          enableSleepMode: enable_sleep_mode,
        })

        // Operation stays InProgress - will be updated when model finishes loading
        // Frontend can track progress via SSE events on /api/models/instances/:id/events
        fastify.sardeenzMetrics.activeModels.set(modelStore.count())

        return {
          status: 'success' as const,
          model: instance.modelPath,
          port: instance.port,
          loaded_at: instance.loadedAt.toISOString(),
          instance_id: instance.id,
        }
      } catch (err) {
        // This only catches spawn failures, not loading failures
        // Loading failures are emitted via SSE events
        operation.status = OperationStatus.Failed
        operation.completedAt = new Date()
        operation.errorMessage = err instanceof Error ? err.message : 'Unknown error'
        operation.durationSeconds =
          (operation.completedAt.getTime() - operation.initiatedAt.getTime()) / 1000
        operationStore.add(operation)

        timer({ model_path, status: 'failure' })

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

  /**
   * DELETE /api/models/:model_path - Unload a model
   */
  fastify.delete<{ Params: { model_path: string } }>(
    '/api/models/:model_path',
    {
      schema: {
        tags: ['models'],
        description: 'Unload a model instance',
        params: Type.Object({
          model_path: Type.String(),
        }),
        response: {
          200: UnloadModelResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { model_path } = request.params
      const decodedPath = decodeURIComponent(model_path)

      const operationId = randomUUID()
      const operation: ControllerOperation = {
        id: operationId,
        operationType: OperationType.Unload,
        modelPath: decodedPath,
        initiatedBy: 'system', // TODO: Get from auth context
        initiatedAt: new Date(),
        status: OperationStatus.InProgress,
      }

      operationStore.add(operation)

      const timer = fastify.sardeenzMetrics.modelUnloadDuration.startTimer()

      try {
        await modelManager.unloadModel(decodedPath)

        operation.status = OperationStatus.Completed
        operation.completedAt = new Date()
        operation.durationSeconds =
          (operation.completedAt.getTime() - operation.initiatedAt.getTime()) / 1000
        operationStore.add(operation)

        timer({ model_path: decodedPath })
        fastify.sardeenzMetrics.activeModels.set(modelStore.count())

        return {
          status: 'success' as const,
          model: decodedPath,
          unloaded_at: new Date().toISOString(),
        }
      } catch (err) {
        operation.status = OperationStatus.Failed
        operation.completedAt = new Date()
        operation.errorMessage = err instanceof Error ? err.message : 'Unknown error'
        operation.durationSeconds =
          (operation.completedAt.getTime() - operation.initiatedAt.getTime()) / 1000
        operationStore.add(operation)

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

  /**
   * GET /api/models - List all models
   */
  fastify.get(
    '/api/models',
    {
      schema: {
        tags: ['models'],
        description: 'List all loaded models',
        response: {
          200: ListModelsResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
      config: { logRequests: false },
    },
    async () => {
      const instances = modelManager.listModels()
      return {
        models: instances.map(toDTO),
        total: instances.length,
      }
    }
  )

  /**
   * GET /api/models/:model_path - Get model details
   */
  fastify.get<{ Params: { model_path: string } }>(
    '/api/models/:model_path',
    {
      schema: {
        tags: ['models'],
        description: 'Get details of a specific model',
        params: Type.Object({
          model_path: Type.String(),
        }),
        response: {
          200: GetModelResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request) => {
      const { model_path } = request.params
      const decodedPath = decodeURIComponent(model_path)

      const instance = modelManager.getModelStatus(decodedPath)
      if (!instance) {
        throw new NotFoundError(`Model ${decodedPath} not found`)
      }

      return {
        model: toDTO(instance),
      }
    }
  )

  /**
   * GET /api/models/:model_path/health - Check model health
   */
  fastify.get<{ Params: { model_path: string } }>(
    '/api/models/:model_path/health',
    {
      schema: {
        tags: ['models'],
        description: 'Check health of a specific model',
        params: Type.Object({
          model_path: Type.String(),
        }),
        response: {
          200: ModelHealthResponseSchema,
          404: ErrorResponseSchema,
          503: ModelHealthResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { model_path } = request.params
      const decodedPath = decodeURIComponent(model_path)

      const instance = modelManager.getModelStatus(decodedPath)
      if (!instance) {
        throw new NotFoundError(`Model ${decodedPath} not found`)
      }

      if (instance.status !== 'running') {
        return reply.code(503).send({
          status: 'unhealthy',
          model: decodedPath,
          port: instance.port,
          uptime_seconds: 0,
        })
      }

      try {
        // Check if vLLM health endpoint responds
        const response = await fetch(`http://localhost:${instance.port}/health`, {
          signal: AbortSignal.timeout(2000),
        })

        if (!response.ok) {
          return reply.code(503).send({
            status: 'unhealthy',
            model: decodedPath,
            port: instance.port,
            uptime_seconds: instance.readyAt ? (Date.now() - instance.readyAt.getTime()) / 1000 : 0,
          })
        }

        return {
          status: 'healthy' as const,
          model: decodedPath,
          port: instance.port,
          uptime_seconds: instance.readyAt ? (Date.now() - instance.readyAt.getTime()) / 1000 : 0,
        }
      } catch {
        return reply.code(503).send({
          status: 'unhealthy',
          model: decodedPath,
          port: instance.port,
          uptime_seconds: 0,
        })
      }
    }
  )

  /**
   * GET /api/models/:model_path/instances - List all instances for a model path (FR-004)
   */
  fastify.get<{ Params: { model_path: string } }>(
    '/api/models/:model_path/instances',
    {
      schema: {
        tags: ['models'],
        description: 'List all instances of a specific model (FR-004 multi-instance support)',
        params: Type.Object({
          model_path: Type.String(),
        }),
        response: {
          200: ListInstancesResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request) => {
      const { model_path } = request.params
      const decodedPath = decodeURIComponent(model_path)

      const instances = modelManager.getInstancesByPath(decodedPath)
      if (instances.length === 0) {
        throw new NotFoundError(`No instances found for model ${decodedPath}`)
      }

      return {
        instances: instances.map(toDTO),
        total: instances.length,
      }
    }
  )

  /**
   * DELETE /api/models/instances/:instance_id - Unload by instance ID (FR-004)
   */
  fastify.delete<{ Params: { instance_id: string } }>(
    '/api/models/instances/:instance_id',
    {
      schema: {
        tags: ['models'],
        description: 'Unload a specific model instance by ID (FR-004 multi-instance support)',
        params: Type.Object({
          instance_id: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: UnloadInstanceResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { instance_id } = request.params

      // Get instance info before unloading
      const instance = modelManager.getModelStatus(instance_id)
      if (!instance) {
        throw new NotFoundError(`Model instance ${instance_id} not found`)
      }

      const modelPath = instance.modelPath

      const operationId = randomUUID()
      const operation: ControllerOperation = {
        id: operationId,
        operationType: OperationType.Unload,
        modelPath,
        initiatedBy: 'system', // TODO: Get from auth context
        initiatedAt: new Date(),
        status: OperationStatus.InProgress,
      }

      operationStore.add(operation)

      try {
        await modelManager.unloadModel(instance_id)

        operation.status = OperationStatus.Completed
        operation.completedAt = new Date()
        operation.durationSeconds =
          (operation.completedAt.getTime() - operation.initiatedAt.getTime()) / 1000
        operationStore.add(operation)

        return {
          status: 'success' as const,
          instance_id,
          model_path: modelPath,
          unloaded_at: new Date().toISOString(),
        }
      } catch (err) {
        operation.status = OperationStatus.Failed
        operation.completedAt = new Date()
        operation.errorMessage = err instanceof Error ? err.message : 'Unknown error'
        operation.durationSeconds =
          (operation.completedAt.getTime() - operation.initiatedAt.getTime()) / 1000
        operationStore.add(operation)

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

  /**
   * GET /api/models/instances/:instance_id/logs - Get process logs for an instance
   * Useful for debugging model loading failures
   */
  fastify.get<{ Params: { instance_id: string }; Querystring: { lines?: number } }>(
    '/api/models/instances/:instance_id/logs',
    {
      schema: {
        tags: ['models'],
        description: 'Get buffered process logs for a model instance (useful for debugging)',
        params: Type.Object({
          instance_id: Type.String({ format: 'uuid' }),
        }),
        querystring: Type.Object({
          lines: Type.Optional(Type.Number({ minimum: 1, maximum: 500, default: 100 })),
        }),
        response: {
          200: Type.Object({
            instance_id: Type.String(),
            logs: Type.String(),
            line_count: Type.Number(),
          }),
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request) => {
      const { instance_id } = request.params

      // Check if instance exists (or has logs from a failed instance)
      const instance = modelManager.getModelStatus(instance_id)
      const { logs, lineCount } = modelManager.getLogs(instance_id)

      if (!instance && lineCount === 0) {
        throw new NotFoundError(`No logs found for instance ${instance_id}`)
      }

      return {
        instance_id,
        logs,
        line_count: lineCount,
      }
    }
  )

  /**
   * POST /api/models/instances/:instance_id/sleep - Put model to sleep
   */
  fastify.post<{
    Params: { instance_id: string }
    Body: SleepModelRequestType
  }>(
    '/api/models/instances/:instance_id/sleep',
    {
      schema: {
        tags: ['models'],
        summary: 'Put model instance to sleep',
        params: Type.Object({ instance_id: Type.String({ format: 'uuid' }) }),
        body: SleepModelRequestSchema,
        response: {
          200: SleepModelResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { instance_id } = request.params
      const { level = 1 } = request.body ?? {}

      try {
        await modelManager.sleepModel(instance_id, level)

        const instance = modelStore.get(instance_id)
        if (!instance) {
          return reply.status(404).send({
            error: 'Not Found',
            message: `Model instance ${instance_id} not found`,
          })
        }

        return reply.send({
          status: 'success' as const,
          instance_id,
          model_path: instance.modelPath,
          sleep_level: level,
          slept_at: instance.sleptAt?.toISOString() ?? new Date().toISOString(),
        })
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.status(404).send({
            error: 'Not Found',
            message: err.message,
          })
        }
        if (err instanceof AppError) {
          const statusCode = err.message.includes('not loaded with sleep mode') ? 400 : 409
          return reply.status(statusCode).send({
            error: statusCode === 400 ? 'Bad Request' : 'Conflict',
            message: err.message,
          })
        }
        throw err
      }
    }
  )

  /**
   * POST /api/models/instances/:instance_id/wake - Wake sleeping model
   */
  fastify.post<{
    Params: { instance_id: string }
    Body: WakeModelRequestType
  }>(
    '/api/models/instances/:instance_id/wake',
    {
      schema: {
        tags: ['models'],
        summary: 'Wake a sleeping model instance',
        params: Type.Object({ instance_id: Type.String({ format: 'uuid' }) }),
        body: WakeModelRequestSchema,
        response: {
          200: WakeModelResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { instance_id } = request.params
      const { tags } = request.body ?? {}

      try {
        await modelManager.wakeModel(instance_id, tags)

        const instance = modelStore.get(instance_id)
        if (!instance) {
          return reply.status(404).send({
            error: 'Not Found',
            message: `Model instance ${instance_id} not found`,
          })
        }

        return reply.send({
          status: 'success' as const,
          instance_id,
          model_path: instance.modelPath,
          woke_at: new Date().toISOString(),
        })
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.status(404).send({
            error: 'Not Found',
            message: err.message,
          })
        }
        if (err instanceof AppError) {
          return reply.status(409).send({
            error: 'Conflict',
            message: err.message,
          })
        }
        throw err
      }
    }
  )

  /**
   * GET /api/models/instances/:instance_id/sleep-status - Check sleep status
   */
  fastify.get<{ Params: { instance_id: string } }>(
    '/api/models/instances/:instance_id/sleep-status',
    {
      schema: {
        tags: ['models'],
        summary: 'Check if model instance is sleeping',
        params: Type.Object({ instance_id: Type.String({ format: 'uuid' }) }),
        response: {
          200: SleepStatusResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { instance_id } = request.params

      try {
        const sleepStatus = await modelManager.isSleeping(instance_id)

        return reply.send({
          instance_id,
          is_sleeping: sleepStatus.isSleeping,
          sleep_level: sleepStatus.level,
        })
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.status(404).send({
            error: 'Not Found',
            message: err.message,
          })
        }
        throw err
      }
    }
  )

  /**
   * POST /api/models/instances/:instance_id/move - Move model to different GPU(s)
   */
  fastify.post<{
    Params: { instance_id: string }
    Body: { target_gpu_ids: number[]; drain_timeout_ms?: number }
  }>(
    '/api/models/instances/:instance_id/move',
    {
      schema: {
        tags: ['models'],
        summary: 'Move model instance to different GPU(s)',
        description:
          'Initiates a blue-green move operation to relocate a model to different GPU(s). Returns immediately with a move ID for SSE tracking.',
        params: Type.Object({ instance_id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          target_gpu_ids: Type.Array(Type.Number(), { minItems: 1 }),
          drain_timeout_ms: Type.Optional(Type.Number({ minimum: 1000, default: 60000 })),
        }),
        response: {
          202: Type.Object({
            move_id: Type.String(),
            source_instance_id: Type.String(),
            target_gpu_ids: Type.Array(Type.Number()),
          }),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { instance_id } = request.params
      const { target_gpu_ids, drain_timeout_ms } = request.body
      const modelMover = getModelMover(fastify.log)

      const result = await modelMover.moveModel({
        instanceId: instance_id,
        targetGpuIds: target_gpu_ids,
        drainTimeoutMs: drain_timeout_ms,
      })

      return reply.code(202).send({
        move_id: result.moveId,
        source_instance_id: result.sourceInstanceId,
        target_gpu_ids: result.targetGpuIds,
      })
    }
  )

  /**
   * GET /api/models/moves/:move_id/events - SSE stream for move progress
   */
  fastify.get<{ Params: { move_id: string } }>(
    '/api/models/moves/:move_id/events',
    {
      schema: {
        tags: ['models', 'events'],
        summary: 'Subscribe to move operation progress events (SSE)',
        params: Type.Object({ move_id: Type.String({ format: 'uuid' }) }),
        response: {
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { move_id } = request.params
      const modelMover = getModelMover(fastify.log)

      const op = modelMover.getMove(move_id)
      if (!op) {
        throw new NotFoundError(`Move operation ${move_id} not found`)
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      })

      const connectionId = randomUUID()

      // Helper to send SSE event
      const sendEvent = (event: {
        id: string
        phase: string
        message: string
        progress?: number
        error?: string
      }): void => {
        try {
          const data = JSON.stringify(event)
          reply.raw.write(`id: ${event.id}\n`)
          reply.raw.write(`event: move_progress\n`)
          reply.raw.write(`data: ${data}\n\n`)
        } catch {
          // Connection closed
        }
      }

      const connection = { id: connectionId, send: sendEvent }
      modelMover.subscribeMoveEvents(move_id, connection)

      // Send current status immediately
      sendEvent({
        id: randomUUID(),
        phase: op.phase,
        message: `Move operation in phase: ${op.phase}`,
        error: op.error,
      })

      // Heartbeat
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n')
        } catch {
          // Connection closed
        }
      }, 15000)

      // Cleanup on close
      request.raw.on('close', () => {
        clearInterval(heartbeat)
        modelMover.unsubscribeMoveEvents(move_id, connection)
      })
    }
  )

  /**
   * DELETE /api/models/moves/:move_id - Cancel a move operation
   */
  fastify.delete<{
    Params: { move_id: string }
    Querystring: { force?: string }
  }>(
    '/api/models/moves/:move_id',
    {
      schema: {
        tags: ['models'],
        summary: 'Cancel a move operation',
        description:
          'Cancels an in-progress move. Without force, reverts to source. With force=true, completes the move immediately (may drop connections).',
        params: Type.Object({ move_id: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({
          force: Type.Optional(Type.String()),
        }),
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { move_id } = request.params
      const force = request.query.force === 'true'
      const modelMover = getModelMover(fastify.log)

      await modelMover.cancelMove(move_id, force)
      return reply.code(204).send()
    }
  )

  // Cleanup on shutdown
  fastify.addHook('onClose', async () => {
    await modelManager.cleanup()
  })
}
