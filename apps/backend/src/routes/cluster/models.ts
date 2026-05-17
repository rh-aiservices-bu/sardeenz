import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { SSEEvent, SSEEventType } from '@sardeenz/types'
import { getClusterManager } from '../../services/cluster-manager.js'
import { getModelManager } from '../../services/model-manager.js'
import { getModelMover } from '../../services/model-mover.js'
import { buildSignedHeaders } from '../../services/cluster-auth.js'
import { eventBus, type SSEConnection } from '../../services/event-bus.js'
import { processLogBuffer } from '../../services/process-log-buffer.js'
import { peerStore } from '../../stores/peer-store.js'
import { modelStore } from '../../stores/model-store.js'
import { AppError } from '../../utils/errors.js'

/** Find which pod owns a model instance by instanceId */
function findPodForInstance(instanceId: string): { podId: string; address: string; port: number } | null {
  for (const peer of peerStore.getAllPeers()) {
    for (const model of peer.models) {
      if (model.instanceId === instanceId) {
        return { podId: peer.podId, address: peer.address, port: peer.port }
      }
    }
  }
  return null
}

const InstanceIdParamsSchema = Type.Object({
  instanceId: Type.String(),
})

const ErrorSchema = Type.Object({
  error: Type.String(),
})

export default async function clusterModelRoutes(fastify: FastifyInstance) {
  const clusterManager = getClusterManager(fastify.log)

  // ---------------------------------------------------------------------------
  // T034: POST /api/cluster/models/load — leader-orchestrated model load
  // ---------------------------------------------------------------------------
  fastify.post<{
    Body: {
      modelPath: string
      targetPodId?: string
      servedModelName?: string
      maxTokens?: number
      gpuIds?: number[]
      tensorParallelSize?: number
      enableSleepMode?: boolean
    }
  }>(
    '/api/cluster/models/load',
    {
      schema: {
        tags: ['cluster'],
        description: 'Load a model on a specific pod in the cluster',
        body: Type.Object({
          modelPath: Type.String(),
          targetPodId: Type.Optional(Type.String()),
          servedModelName: Type.Optional(Type.String()),
          maxTokens: Type.Optional(Type.Integer()),
          gpuIds: Type.Optional(Type.Array(Type.Integer())),
          tensorParallelSize: Type.Optional(Type.Integer()),
          enableSleepMode: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            instanceId: Type.String(),
            podId: Type.String(),
            status: Type.String(),
          }),
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { modelPath, targetPodId, servedModelName, maxTokens, gpuIds, tensorParallelSize, enableSleepMode } = request.body

      // Default to local pod if no target specified
      const podId = targetPodId ?? clusterManager.getPodId()
      const isLocal = podId === clusterManager.getPodId()

      // Validate target pod exists and is healthy
      const targetPeer = peerStore.getPeer(podId)
      if (!targetPeer) {
        return reply.code(404).send({ error: `Pod ${podId} not found` })
      }
      if (targetPeer.status !== 'healthy') {
        return reply.code(400).send({ error: `Pod ${podId} is ${targetPeer.status}, cannot load model` })
      }

      if (isLocal) {
        // Load locally
        const modelManager = getModelManager(fastify.log)
        try {
          const instance = await modelManager.launchModel({
            modelPath,
            maxTokens,
            gpuIds,
            tensorParallelSize,
            servedModelName,
            enableSleepMode,
          })
          return { instanceId: instance.id, podId, status: instance.status }
        } catch (err) {
          fastify.log.error({ err, modelPath }, 'Local cluster load failed')
          return reply.code(500).send({ error: (err as Error).message })
        }
      }

      // Remote: forward to target pod's /internal/models/load
      const internalPath = '/internal/models/load'
      const body = JSON.stringify({
        modelPath,
        maxTokens,
        gpuIds,
        tensorParallelSize,
        servedModelName,
        enableSleepMode,
      })
      const headers = buildSignedHeaders('POST', internalPath, body)

      try {
        const response = await fetch(`http://${targetPeer.address}:${targetPeer.port}${internalPath}`, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        })

        const result = await response.json() as { instanceId?: string; status?: string; error?: string }

        if (!response.ok) {
          return reply.code(response.status).send({ error: result.error ?? 'Remote load failed' })
        }

        return { instanceId: result.instanceId, podId, status: result.status }
      } catch (err) {
        fastify.log.error({ err, podId, modelPath }, 'Failed to forward load to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podId}` })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T035: POST /api/cluster/models/:instanceId/unload — unload from any pod
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { instanceId: string } }>(
    '/api/cluster/models/:instanceId/unload',
    {
      schema: {
        tags: ['cluster'],
        description: 'Unload a model from any pod in the cluster',
        params: InstanceIdParamsSchema,
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { instanceId } = request.params

      // Check if model is local first
      const localInstance = modelStore.get(instanceId)
      if (localInstance) {
        const modelManager = getModelManager(fastify.log)
        try {
          await modelManager.unloadModel(instanceId)
          return { success: true }
        } catch (err) {
          fastify.log.error({ err, instanceId }, 'Local cluster unload failed')
          return reply.code(500).send({ error: (err as Error).message })
        }
      }

      // Find which remote pod owns the instance
      const podInfo = findPodForInstance(instanceId)
      if (!podInfo) {
        return reply.code(404).send({ error: `Instance ${instanceId} not found in cluster` })
      }

      // Forward to remote pod
      const internalPath = `/internal/models/${instanceId}/unload`
      const body = '{}'
      const headers = buildSignedHeaders('POST', internalPath, body)

      try {
        const response = await fetch(`http://${podInfo.address}:${podInfo.port}${internalPath}`, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        })

        const result = await response.json() as { success?: boolean; error?: string }

        if (!response.ok) {
          return reply.code(response.status).send({ error: result.error ?? 'Remote unload failed' })
        }

        return { success: true }
      } catch (err) {
        fastify.log.error({ err, instanceId, podId: podInfo.podId }, 'Failed to forward unload to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podInfo.podId}` })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T056: POST /api/cluster/models/:instanceId/move — cross-pod or intra-pod move
  // ---------------------------------------------------------------------------
  fastify.post<{
    Params: { instanceId: string }
    Body: {
      targetPodId?: string
      targetGpuIds: number[]
      drainTimeoutMs?: number
    }
  }>(
    '/api/cluster/models/:instanceId/move',
    {
      schema: {
        tags: ['cluster'],
        description: 'Move a model between pods or GPUs (cross-pod or intra-pod)',
        params: InstanceIdParamsSchema,
        body: Type.Object({
          targetPodId: Type.Optional(Type.String()),
          targetGpuIds: Type.Array(Type.Integer()),
          drainTimeoutMs: Type.Optional(Type.Integer()),
        }),
        response: {
          200: Type.Object({ moveId: Type.String() }),
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { instanceId } = request.params
      const { targetPodId, targetGpuIds, drainTimeoutMs } = request.body

      const modelMover = getModelMover(fastify.log)
      const localPodId = clusterManager.getPodId()

      // Determine if this is a cross-pod or intra-pod move
      const isCrossPod = targetPodId && targetPodId !== localPodId

      try {
        if (isCrossPod) {
          // Cross-pod move
          const result = await modelMover.crossPodMoveModel({
            instanceId,
            targetPodId,
            targetGpuIds,
            drainTimeoutMs,
          })
          return { moveId: result.moveId }
        } else {
          // Intra-pod move (existing behavior)
          const result = await modelMover.moveModel({
            instanceId,
            targetGpuIds,
            drainTimeoutMs,
          })
          return { moveId: result.moveId }
        }
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send(err.toJSON())
        }
        const message = (err as Error).message
        fastify.log.error({ err, instanceId }, 'Cluster move failed')
        return reply.code(500).send({ error: message })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T036: GET /api/cluster/models/:instanceId/events — SSE from any pod
  // ---------------------------------------------------------------------------
  const VALID_EVENT_TYPES: SSEEventType[] = ['log', 'status', 'memory', 'progress', 'error']

  fastify.get<{ Params: { instanceId: string } }>(
    '/api/cluster/models/:instanceId/events',
    {
      schema: {
        tags: ['cluster'],
        description: 'Subscribe to model events (SSE), works for models on any pod',
        params: InstanceIdParamsSchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: { instanceId: string } }>,
      reply: FastifyReply
    ) => {
      const { instanceId } = request.params

      // Check if model is local
      const localInstance = modelStore.get(instanceId)
      const hasLocalLogs = processLogBuffer.has(instanceId)

      if (localInstance || hasLocalLogs) {
        // Serve events directly (same pattern as routes/events.ts)
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
        const existingLogs = processLogBuffer.getBuffer(instanceId)
        let lineNumber = 0
        for (const entry of existingLogs) {
          sendEvent(eventBus.createLogEvent(instanceId, entry, lineNumber))
          lineNumber++
        }

        // Send current status
        if (localInstance) {
          sendEvent(
            eventBus.createStatusEvent(
              instanceId,
              null,
              localInstance.status,
              localInstance.status === 'running'
                ? 'Model is ready'
                : localInstance.status === 'starting'
                  ? 'Model is loading'
                  : undefined,
              localInstance.errorMessage
            )
          )
        }

        eventBus.subscribe(instanceId, connection)
        const unsubscribeLogs = processLogBuffer.onLog(instanceId, (entry) => {
          sendEvent(eventBus.createLogEvent(instanceId, entry))
        })

        const heartbeat = setInterval(() => {
          try {
            reply.raw.write(': heartbeat\n\n')
          } catch {
            // Connection closed
          }
        }, 30000)

        request.raw.on('close', () => {
          clearInterval(heartbeat)
          unsubscribeLogs()
          eventBus.unsubscribe(instanceId, connection)
        })

        return
      }

      // Remote: find which pod owns it and relay SSE
      const podInfo = findPodForInstance(instanceId)
      if (!podInfo) {
        return reply.code(404).send({ error: `Instance ${instanceId} not found in cluster` })
      }

      // Set up SSE headers for relay
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      // Connect to remote pod's internal events SSE
      const internalPath = `/internal/models/${instanceId}/events`
      const headers = buildSignedHeaders('GET', internalPath, '')

      const abortController = new AbortController()

      try {
        const response = await fetch(`http://${podInfo.address}:${podInfo.port}${internalPath}`, {
          headers,
          signal: abortController.signal,
        })

        if (!response.ok || !response.body) {
          reply.raw.write(`data: ${JSON.stringify({ error: 'Failed to connect to remote pod' })}\n\n`)
          reply.raw.end()
          return
        }

        // Relay the SSE stream from the remote pod
        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              reply.raw.write(decoder.decode(value, { stream: true }))
            }
          } catch {
            // Stream ended or aborted
          } finally {
            reply.raw.end()
          }
        }

        // Start pumping in background
        pump()

        // Heartbeat for the relay connection
        const heartbeat = setInterval(() => {
          try {
            reply.raw.write(': relay-heartbeat\n\n')
          } catch {
            // Connection closed
          }
        }, 30000)

        // Clean up when client disconnects
        request.raw.on('close', () => {
          clearInterval(heartbeat)
          abortController.abort()
        })
      } catch (err) {
        fastify.log.error({ err, instanceId, podId: podInfo.podId }, 'Failed to relay events from remote pod')
        reply.raw.write(`data: ${JSON.stringify({ error: 'Failed to connect to remote pod' })}\n\n`)
        reply.raw.end()
      }
    }
  )
}
