import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { HeartbeatMessage, ClusterEvent, SSEEvent, SSEEventType, SavedModelConfiguration, MemoryProfile } from '@sardeenz/types'
import { getClusterManager } from '../services/cluster-manager.js'
import { getModelManager } from '../services/model-manager.js'
import { MemoryMonitor } from '../services/memory-monitor.js'
import { GpuSelector } from '../services/gpu-selector.js'
import { getNvidiaSmiInfo } from '../utils/gpu-info.js'
import { eventBus, type SSEConnection } from '../services/event-bus.js'
import { processLogBuffer } from '../services/process-log-buffer.js'
import { peerStore } from '../stores/peer-store.js'
import { modelStore } from '../stores/model-store.js'
import { clusterRoutingStore } from '../stores/cluster-routing-store.js'
import { getModelConfigurationStore } from '../stores/model-configuration-store.js'
import { getMemoryProfileStore, type CreateProfileData } from '../stores/memory-profile-store.js'
import { toModelDTO } from '../utils/model-dto.js'
import { getModelMover } from '../services/model-mover.js'

export default async function internalRoutes(fastify: FastifyInstance) {
  // Apply cluster HMAC auth to all routes in this plugin
  await fastify.register(import('../plugins/cluster-auth.js'))

  // Rate limit internal endpoints: 100 req/s per source IP
  fastify.addHook('onRoute', (routeOptions) => {
    routeOptions.config = {
      ...routeOptions.config,
      rateLimit: routeOptions.config?.rateLimit ?? {
        max: 100,
        timeWindow: '1 second',
      },
    }
  })

  const clusterManager = getClusterManager(fastify.log)

  // GET /internal/ping — basic liveness
  fastify.get(
    '/internal/ping',
    {
      schema: {
        description: 'Internal cluster ping endpoint',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', const: 'ok' },
              timestamp: { type: 'number' },
            },
          },
        },
      },
      config: { logRequests: false },
    },
    async () => {
      return {
        status: 'ok' as const,
        timestamp: Date.now(),
      }
    }
  )

  // POST /internal/heartbeat — receive heartbeat from a peer
  fastify.post<{ Body: HeartbeatMessage }>(
    '/internal/heartbeat',
    {
      schema: {
        description: 'Receive heartbeat from a peer pod',
        body: {
          type: 'object',
          required: ['podId', 'role', 'term', 'timestamp', 'models', 'gpus'],
          properties: {
            podId: { type: 'string' },
            role: { type: 'string', enum: ['leader', 'follower'] },
            term: { type: 'integer' },
            timestamp: { type: 'integer' },
            models: { type: 'array' },
            gpus: { type: 'array' },
            clusterVersion: { type: 'integer' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              podId: { type: 'string' },
              term: { type: 'integer' },
              role: { type: 'string', enum: ['leader', 'follower'] },
              clusterVersion: { type: 'integer' },
            },
          },
        },
      },
      config: { logRequests: false },
    },
    async (request) => {
      const heartbeatService = clusterManager.getHeartbeatService()
      return heartbeatService.processIncomingHeartbeat(request.body, request.ip)
    }
  )

  // GET /internal/state — full pod state for sync
  fastify.get(
    '/internal/state',
    {
      schema: {
        description: 'Get full pod state for sync after reconnection',
        response: {
          200: {
            type: 'object',
            properties: {
              podId: { type: 'string' },
              role: { type: 'string', enum: ['leader', 'follower'] },
              term: { type: 'integer' },
              models: { type: 'array' },
              gpus: { type: 'array' },
              routingTableVersion: { type: 'integer' },
            },
          },
        },
      },
    },
    async () => {
      return {
        podId: clusterManager.getPodId(),
        role: clusterManager.getRole(),
        term: clusterManager.getCurrentTerm(),
        models: clusterManager.getModels(),
        gpus: clusterManager.getGpus(),
        routingTableVersion: clusterManager.getClusterVersion(),
      }
    }
  )

  // POST /internal/cluster/event — receive immediate cluster event
  fastify.post<{ Body: ClusterEvent }>(
    '/internal/cluster/event',
    {
      schema: {
        description: 'Receive immediate cluster event from a peer',
        body: {
          type: 'object',
          required: ['type', 'podId', 'term', 'timestamp', 'payload'],
          properties: {
            type: {
              type: 'string',
              enum: ['model-loaded', 'model-unloaded', 'model-moved', 'leader-elected', 'pod-joined', 'pod-left'],
            },
            podId: { type: 'string' },
            term: { type: 'integer' },
            timestamp: { type: 'integer' },
            payload: { type: 'object' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              received: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request) => {
      const event = request.body

      switch (event.type) {
        case 'model-loaded':
        case 'model-unloaded':
        case 'model-moved':
          // Trigger routing table rebuild from current peer state
          clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())
          break

        case 'leader-elected': {
          const { leaderId, term } = event.payload as { leaderId: string; term: number }
          if (leaderId && term) {
            const peer = peerStore.getPeer(leaderId)
            if (peer) {
              peerStore.updatePeer(leaderId, { role: 'leader', term })
            }
          }
          break
        }

        case 'pod-joined': {
          const { podId, address, port } = event.payload as { podId: string; address: string; port: number }
          if (podId && !peerStore.getPeer(podId)) {
            // Validate address is a plausible internal address (RFC1918/K8s hostname)
            if (address && !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|[\w-]+\.)/.test(address)) {
              fastify.log.warn({ podId, address }, 'Rejected pod-joined with suspicious address')
              break
            }
            peerStore.addPeer({
              podId,
              address: address ?? '',
              port: port ?? 3000,
              role: 'follower',
              status: 'healthy',
              lastHeartbeat: Date.now(),
              term: event.term,
              models: [],
              gpus: [],
              joinedAt: Date.now(),
            })
          }
          break
        }

        case 'pod-left': {
          const { podId } = event.payload as { podId: string }
          if (podId) {
            peerStore.removePeer(podId)
            clusterRoutingStore.removeEntriesForPod(podId)
          }
          break
        }
      }

      return { received: true }
    }
  )

  // ---------------------------------------------------------------------------
  // T031: POST /internal/models/load — receive remote load command
  // ---------------------------------------------------------------------------
  fastify.post<{
    Body: {
      modelPath: string
      maxTokens?: number
      extraArgs?: string[]
      gpuIds?: number[]
      tensorParallelSize?: number
      servedModelName?: string
      enableSleepMode?: boolean
    }
  }>(
    '/internal/models/load',
    {
      schema: {
        description: 'Receive remote model load command from leader',
        body: {
          type: 'object',
          required: ['modelPath'],
          properties: {
            modelPath: { type: 'string' },
            maxTokens: { type: 'integer' },
            extraArgs: { type: 'array', items: { type: 'string' } },
            gpuIds: { type: 'array', items: { type: 'integer' } },
            tensorParallelSize: { type: 'integer' },
            servedModelName: { type: 'string' },
            enableSleepMode: { type: 'boolean' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              instanceId: { type: 'string' },
              status: { type: 'string' },
              warnings: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const modelManager = getModelManager(fastify.log)
      const { modelPath, maxTokens, extraArgs, gpuIds, tensorParallelSize, servedModelName, enableSleepMode } = request.body

      try {
        const instance = await modelManager.launchModel({
          modelPath,
          maxTokens,
          extraArgs,
          gpuIds,
          tensorParallelSize,
          servedModelName,
          enableSleepMode,
        })

        return {
          instanceId: instance.id,
          status: instance.status,
          ...(instance.warnings?.length ? { warnings: instance.warnings } : {}),
        }
      } catch (err) {
        fastify.log.error({ err, modelPath }, 'Remote load command failed')
        return reply.code(500).send({ error: (err as Error).message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T032: POST /internal/models/:id/unload — receive remote unload command
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    '/internal/models/:id/unload',
    {
      schema: {
        description: 'Receive remote model unload command from leader',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const modelManager = getModelManager(fastify.log)
      const { id } = request.params

      try {
        await modelManager.unloadModel(id)
        return { success: true }
      } catch (err) {
        if ((err as Error).message?.includes('not found')) {
          return reply.code(404).send({ error: (err as Error).message })
        }
        fastify.log.error({ err, instanceId: id }, 'Remote unload command failed')
        return reply.code(500).send({ error: (err as Error).message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T033: GET /internal/models/:id/events — SSE relay for model load progress
  // ---------------------------------------------------------------------------
  const VALID_EVENT_TYPES: SSEEventType[] = ['log', 'status', 'memory', 'progress', 'error']

  fastify.get<{ Params: { id: string } }>(
    '/internal/models/:id/events',
    {
      schema: {
        description: 'SSE relay for model load progress on this pod',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params

      const instance = modelStore.get(id)
      const hasLogs = processLogBuffer.has(id)

      if (!instance && !hasLogs) {
        return reply.code(404).send({ error: `Model instance ${id} not found` })
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const connectionId = randomUUID()

      const sendEvent = (event: SSEEvent): void => {
        try {
          const data = JSON.stringify(event)
          reply.raw.write(`id: ${event.id}\n`)
          reply.raw.write(`event: ${event.eventType}\n`)
          reply.raw.write(`data: ${data}\n\n`)
        } catch (err) {
          fastify.log.debug({ connectionId, err }, 'Failed to write SSE event')
        }
      }

      const connection: SSEConnection = {
        id: connectionId,
        send: sendEvent,
        filters: VALID_EVENT_TYPES,
      }

      // Replay existing logs
      const existingLogs = processLogBuffer.getBuffer(id)
      let lineNumber = 0
      for (const entry of existingLogs) {
        sendEvent(eventBus.createLogEvent(id, entry, lineNumber))
        lineNumber++
      }

      // Send current status
      if (instance) {
        sendEvent(
          eventBus.createStatusEvent(
            id,
            null,
            instance.status,
            instance.status === 'running'
              ? 'Model is ready'
              : instance.status === 'starting'
                ? 'Model is loading'
                : undefined,
            instance.errorMessage
          )
        )
      }

      // Subscribe to future events
      eventBus.subscribe(id, connection)

      const unsubscribeLogs = processLogBuffer.onLog(id, (entry) => {
        sendEvent(eventBus.createLogEvent(id, entry))
      })

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n')
        } catch {
          // Connection closed
        }
      }, 30000)

      // Clean up on close
      request.raw.on('close', () => {
        clearInterval(heartbeat)
        unsubscribeLogs()
        eventBus.unsubscribe(id, connection)
      })
    }
  )

  // ---------------------------------------------------------------------------
  // T065: POST /internal/presets/sync — receive presets from leader
  // ---------------------------------------------------------------------------
  fastify.post<{
    Body: { presets: SavedModelConfiguration[] }
  }>(
    '/internal/presets/sync',
    {
      schema: {
        description: 'Sync presets from leader using version-based conflict resolution',
        body: {
          type: 'object',
          required: ['presets'],
          properties: {
            presets: { type: 'array' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              synced: { type: 'integer' },
              conflicts: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request) => {
      const configStore = getModelConfigurationStore()
      const { presets } = request.body
      let synced = 0
      let conflicts = 0

      for (const preset of presets) {
        const accepted = await configStore.syncPreset(preset)
        if (accepted) {
          synced++
        } else {
          conflicts++
        }
      }

      fastify.log.info({ synced, conflicts, total: presets.length }, 'Preset sync completed')
      return { synced, conflicts }
    }
  )

  // ---------------------------------------------------------------------------
  // T067: GET /internal/memory-profiles — return all local profiles
  // ---------------------------------------------------------------------------
  fastify.get(
    '/internal/memory-profiles',
    {
      schema: {
        description: 'Get all memory profiles stored on this pod for reconciliation',
        response: {
          200: {
            type: 'object',
            properties: {
              profiles: { type: 'array' },
            },
          },
        },
      },
    },
    async () => {
      const profileStore = getMemoryProfileStore()
      const { profiles } = await profileStore.listProfiles()
      return { profiles }
    }
  )

  // ---------------------------------------------------------------------------
  // T068: POST /internal/memory-profiles — receive profiles from peers
  // ---------------------------------------------------------------------------
  fastify.post<{
    Body: { profiles: MemoryProfile[] }
  }>(
    '/internal/memory-profiles',
    {
      schema: {
        description: 'Push memory profiles from another pod for cross-pod reconciliation',
        body: {
          type: 'object',
          required: ['profiles'],
          properties: {
            profiles: { type: 'array' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              imported: { type: 'integer' },
              updated: { type: 'integer' },
              skipped: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request) => {
      const profileStore = getMemoryProfileStore()
      const { profiles } = request.body
      let imported = 0
      let updated = 0
      let skipped = 0

      for (const profile of profiles) {
        // Check if we already have this profile by model+GPU lookup
        const existing = profile.gpuName
          ? await profileStore.lookupProfile(profile.modelPath, profile.maxTokens, profile.gpuName)
          : null

        if (existing) {
          // Update if remote is newer
          if (profile.updatedAt && existing.updatedAt && profile.updatedAt > existing.updatedAt) {
            const data: CreateProfileData = {
              profileName: profile.profileName,
              modelPath: profile.modelPath,
              maxTokens: profile.maxTokens,
              totalGpuMemoryGib: profile.totalGpuMemoryGib,
              weightsMemoryGib: profile.weightsMemoryGib,
              cudaGraphsGib: profile.cudaGraphsGib,
              overheadMemoryGib: profile.overheadMemoryGib,
              kvCacheAvailableGib: profile.kvCacheAvailableGib,
              kvCachePerRequestMib: profile.kvCachePerRequestMib,
              gpuName: profile.gpuName,
              gpuTotalMemoryGib: profile.gpuTotalMemoryGib,
              comments: profile.comments,
              createdBy: profile.createdBy,
            }
            await profileStore.upsertProfile(data)
            updated++
          } else {
            skipped++
          }
        } else {
          // New profile — create it
          const data: CreateProfileData = {
            profileName: profile.profileName,
            modelPath: profile.modelPath,
            maxTokens: profile.maxTokens,
            totalGpuMemoryGib: profile.totalGpuMemoryGib,
            weightsMemoryGib: profile.weightsMemoryGib,
            cudaGraphsGib: profile.cudaGraphsGib,
            overheadMemoryGib: profile.overheadMemoryGib,
            kvCacheAvailableGib: profile.kvCacheAvailableGib,
            kvCachePerRequestMib: profile.kvCachePerRequestMib,
            gpuName: profile.gpuName,
            gpuTotalMemoryGib: profile.gpuTotalMemoryGib,
            comments: profile.comments,
            createdBy: profile.createdBy,
          }
          await profileStore.createProfile(data)
          imported++
        }
      }

      fastify.log.info({ imported, updated, skipped, total: profiles.length }, 'Memory profile sync completed')
      return { imported, updated, skipped }
    }
  )

  // ---------------------------------------------------------------------------
  // GET /internal/gpu/available — GPU availability for cluster proxying
  // ---------------------------------------------------------------------------
  fastify.get(
    '/internal/gpu/available',
    {
      schema: {
        description: 'Get GPU availability for cluster proxying',
      },
      config: { logRequests: false },
    },
    async (_request, reply) => {
      const gpuSelector = new GpuSelector(fastify.log)
      try {
        return await gpuSelector.getGpuAvailability()
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get GPU availability for cluster proxy')
        return reply.code(500).send({ error: (err as Error).message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // GET /internal/memory/multi-gpu — GPU memory usage for cluster proxying
  // ---------------------------------------------------------------------------
  fastify.get(
    '/internal/memory/multi-gpu',
    {
      schema: {
        description: 'Get multi-GPU memory usage for cluster proxying',
      },
      config: { logRequests: false },
    },
    async (_request, reply) => {
      const memoryMonitor = new MemoryMonitor(fastify.log)
      try {
        const usage = await memoryMonitor.getMultiGpuMemoryUsage()
        return usage
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get memory usage for cluster proxy')
        return reply.code(500).send({ error: (err as Error).message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // GET /internal/gpu/info — full GPU info (NvidiaSmiInfo) for cluster proxying
  // ---------------------------------------------------------------------------
  fastify.get(
    '/internal/gpu/info',
    {
      schema: {
        description: 'Get full GPU info for cluster proxying',
      },
      config: { logRequests: false },
    },
    async (_request, reply) => {
      try {
        return await getNvidiaSmiInfo()
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get GPU info for cluster proxy')
        return reply.code(500).send({ error: (err as Error).message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // GET /internal/models — full model list (ModelInstanceDTO[]) for cluster proxying
  // ---------------------------------------------------------------------------
  fastify.get(
    '/internal/models',
    {
      schema: {
        description: 'List all models with full DTO for cluster proxying',
      },
      config: { logRequests: false },
    },
    async () => {
      const modelManager = getModelManager(fastify.log)
      const instances = modelManager.listModels()
      return {
        models: instances.map(toModelDTO),
        total: instances.length,
      }
    }
  )

  // ---------------------------------------------------------------------------
  // POST /internal/models/:id/sleep — receive remote sleep command
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { id: string }; Body: { level?: number } }>(
    '/internal/models/:id/sleep',
    {
      schema: {
        description: 'Receive remote model sleep command',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          properties: { level: { type: 'integer' } },
        },
      },
    },
    async (request, reply) => {
      const modelManager = getModelManager(fastify.log)
      const { id } = request.params
      const { level = 1 } = request.body ?? {}

      try {
        await modelManager.sleepModel(id, level as 1 | 2)
        const instance = modelStore.get(id)
        return {
          status: 'success',
          instance_id: id,
          sleep_level: level,
          slept_at: instance?.sleptAt?.toISOString() ?? new Date().toISOString(),
        }
      } catch (err) {
        const message = (err as Error).message
        if (message?.includes('not found')) {
          return reply.code(404).send({ error: message })
        }
        fastify.log.error({ err, instanceId: id }, 'Remote sleep command failed')
        return reply.code(500).send({ error: message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // POST /internal/models/:id/wake — receive remote wake command
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { id: string }; Body: { tags?: string } }>(
    '/internal/models/:id/wake',
    {
      schema: {
        description: 'Receive remote model wake command',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          properties: { tags: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const modelManager = getModelManager(fastify.log)
      const { id } = request.params
      const { tags } = request.body ?? {}

      try {
        await modelManager.wakeModel(id, tags as 'weights' | 'kv_cache' | undefined)
        const instance = modelStore.get(id)
        return {
          status: 'success',
          instance_id: id,
          model_path: instance?.modelPath,
          woke_at: new Date().toISOString(),
        }
      } catch (err) {
        const message = (err as Error).message
        if (message?.includes('not found')) {
          return reply.code(404).send({ error: message })
        }
        fastify.log.error({ err, instanceId: id }, 'Remote wake command failed')
        return reply.code(500).send({ error: message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // GET /internal/models/:id/logs — return process logs for remote instance
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/internal/models/:id/logs',
    {
      schema: {
        description: 'Get process logs for a model instance (cluster proxying)',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const modelManager = getModelManager(fastify.log)
      const { id } = request.params
      const instance = modelManager.getModelStatus(id)
      const { logs, lineCount } = modelManager.getLogs(id)
      if (!instance && lineCount === 0) {
        return reply.code(404).send({ error: `No logs found for instance ${id}` })
      }
      return { instance_id: id, logs, line_count: lineCount }
    }
  )

  // GET /internal/moves/:moveId/events — SSE stream for move progress (cluster proxying)
  fastify.get<{ Params: { moveId: string } }>(
    '/internal/moves/:moveId/events',
    {
      schema: {
        description: 'SSE stream for move operation progress (cluster proxying)',
        params: {
          type: 'object',
          required: ['moveId'],
          properties: { moveId: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const modelMover = getModelMover(fastify.log)
      const { moveId } = request.params
      const op = modelMover.getMove(moveId)
      if (!op) {
        return reply.code(404).send({ error: `Move operation ${moveId} not found` })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const connectionId = randomUUID()
      const sendEvent = (event: { id: string; phase: string; message: string; progress?: number; error?: string }): void => {
        try {
          reply.raw.write(`id: ${event.id}\nevent: move_progress\ndata: ${JSON.stringify(event)}\n\n`)
        } catch { /* connection closed */ }
      }

      const connection = { id: connectionId, send: sendEvent }
      modelMover.subscribeMoveEvents(moveId, connection)

      sendEvent({ id: randomUUID(), phase: op.phase, message: `Move in phase: ${op.phase}`, error: op.error })

      const heartbeat = setInterval(() => {
        try { reply.raw.write(': heartbeat\n\n') } catch { /* closed */ }
      }, 15000)

      request.raw.on('close', () => {
        clearInterval(heartbeat)
        modelMover.unsubscribeMoveEvents(moveId, connection)
      })
    }
  )
}
