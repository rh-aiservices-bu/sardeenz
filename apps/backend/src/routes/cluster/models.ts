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

      // Check if the source instance lives on this pod
      const isSourceLocal = !!modelStore.get(instanceId)

      try {
        if (!isSourceLocal) {
          // Source is on a remote pod — proxy the move request there so that pod
          // handles it (it will then do a cross-pod move back to the target).
          const sourcePodInfo = findPodForInstance(instanceId)
          if (!sourcePodInfo) {
            return reply.code(404).send({ error: `Instance ${instanceId} not found in cluster` })
          }
          const proxyPath = `/api/cluster/models/${instanceId}/move`
          const body = JSON.stringify({ targetPodId, targetGpuIds, drainTimeoutMs })
          const headers = buildSignedHeaders('POST', proxyPath, body)
          const proxyUrl = `http://${sourcePodInfo.address}:${sourcePodInfo.port}${proxyPath}`
          const proxyRes = await fetch(proxyUrl, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body })
          const proxyJson = (await proxyRes.json()) as { moveId?: string; error?: string }
          if (!proxyRes.ok) {
            return reply.code(proxyRes.status).send({ error: proxyJson.error ?? 'Proxy move failed' })
          }
          return { moveId: proxyJson.moveId! }
        }

        // Source is local — determine if target is a different pod (cross-pod) or same pod (intra-pod)
        const isCrossPod = targetPodId && targetPodId !== localPodId

        if (isCrossPod) {
          const result = await modelMover.crossPodMoveModel({
            instanceId,
            targetPodId,
            targetGpuIds,
            drainTimeoutMs,
          })
          return { moveId: result.moveId }
        } else {
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

  fastify.get<{ Params: { instanceId: string }; Querystring: { podId?: string } }>(
    '/api/cluster/models/:instanceId/events',
    {
      schema: {
        tags: ['cluster'],
        description: 'Subscribe to model events (SSE), works for models on any pod',
        params: InstanceIdParamsSchema,
        querystring: Type.Object({
          podId: Type.Optional(Type.String()),
        }),
      },
    },
    async (
      request: FastifyRequest<{ Params: { instanceId: string }; Querystring: { podId?: string } }>,
      reply: FastifyReply
    ) => {
      const { instanceId } = request.params
      const { podId: hintPodId } = request.query

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
      let podInfo = findPodForInstance(instanceId)
      if (!podInfo && hintPodId) {
        const hintPeer = peerStore.getPeer(hintPodId)
        if (hintPeer) {
          podInfo = { podId: hintPeer.podId, address: hintPeer.address, port: hintPeer.port }
        }
      }
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

  // ---------------------------------------------------------------------------
  // POST /api/cluster/models/:instanceId/sleep — sleep on any pod
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { instanceId: string }; Body: { level?: number } }>(
    '/api/cluster/models/:instanceId/sleep',
    {
      schema: {
        tags: ['cluster'],
        description: 'Put a model to sleep on any pod in the cluster',
        params: InstanceIdParamsSchema,
        body: Type.Object({
          level: Type.Optional(Type.Integer({ minimum: 1, maximum: 2 })),
        }),
        response: {
          200: Type.Object({
            status: Type.String(),
            instance_id: Type.String(),
            sleep_level: Type.Integer(),
            slept_at: Type.String(),
          }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { instanceId } = request.params
      const { level = 1 } = request.body ?? {}

      // Check if model is local
      const localInstance = modelStore.get(instanceId)
      if (localInstance) {
        const modelManager = getModelManager(fastify.log)
        try {
          await modelManager.sleepModel(instanceId, level as 1 | 2)
          const updated = modelStore.get(instanceId)
          return {
            status: 'success',
            instance_id: instanceId,
            sleep_level: level,
            slept_at: updated?.sleptAt?.toISOString() ?? new Date().toISOString(),
          }
        } catch (err) {
          fastify.log.error({ err, instanceId }, 'Local cluster sleep failed')
          return reply.code(500).send({ error: (err as Error).message })
        }
      }

      // Remote: forward to target pod
      const podInfo = findPodForInstance(instanceId)
      if (!podInfo) {
        return reply.code(404).send({ error: `Instance ${instanceId} not found in cluster` })
      }

      const internalPath = `/internal/models/${instanceId}/sleep`
      const body = JSON.stringify({ level })
      const headers = buildSignedHeaders('POST', internalPath, body)

      try {
        const response = await fetch(`http://${podInfo.address}:${podInfo.port}${internalPath}`, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        })
        const result = await response.json() as Record<string, unknown>
        if (!response.ok) {
          return reply.code(response.status).send({ error: result.error ?? 'Remote sleep failed' })
        }
        return result
      } catch (err) {
        fastify.log.error({ err, instanceId, podId: podInfo.podId }, 'Failed to forward sleep to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podInfo.podId}` })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // POST /api/cluster/models/:instanceId/wake — wake on any pod
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { instanceId: string }; Body: { tags?: string } }>(
    '/api/cluster/models/:instanceId/wake',
    {
      schema: {
        tags: ['cluster'],
        description: 'Wake a sleeping model on any pod in the cluster',
        params: InstanceIdParamsSchema,
        body: Type.Object({
          tags: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            status: Type.String(),
            instance_id: Type.String(),
            woke_at: Type.String(),
          }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { instanceId } = request.params
      const { tags } = request.body ?? {}

      const localInstance = modelStore.get(instanceId)
      if (localInstance) {
        const modelManager = getModelManager(fastify.log)
        try {
          await modelManager.wakeModel(instanceId, tags as 'weights' | 'kv_cache' | undefined)
          return {
            status: 'success',
            instance_id: instanceId,
            model_path: localInstance.modelPath,
            woke_at: new Date().toISOString(),
          }
        } catch (err) {
          fastify.log.error({ err, instanceId }, 'Local cluster wake failed')
          return reply.code(500).send({ error: (err as Error).message })
        }
      }

      const podInfo = findPodForInstance(instanceId)
      if (!podInfo) {
        return reply.code(404).send({ error: `Instance ${instanceId} not found in cluster` })
      }

      const internalPath = `/internal/models/${instanceId}/wake`
      const body = JSON.stringify({ tags })
      const headers = buildSignedHeaders('POST', internalPath, body)

      try {
        const response = await fetch(`http://${podInfo.address}:${podInfo.port}${internalPath}`, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        })
        const result = await response.json() as Record<string, unknown>
        if (!response.ok) {
          return reply.code(response.status).send({ error: result.error ?? 'Remote wake failed' })
        }
        return result
      } catch (err) {
        fastify.log.error({ err, instanceId, podId: podInfo.podId }, 'Failed to forward wake to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podInfo.podId}` })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // GET /api/cluster/models/:instanceId/logs — logs from any pod
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { instanceId: string } }>(
    '/api/cluster/models/:instanceId/logs',
    {
      schema: {
        tags: ['cluster'],
        description: 'Get process logs for a model on any pod',
        params: InstanceIdParamsSchema,
        response: {
          200: Type.Object({
            instance_id: Type.String(),
            logs: Type.String(),
            line_count: Type.Integer(),
          }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { instanceId } = request.params

      // Check local first
      const localInstance = modelStore.get(instanceId)
      const hasLocalLogs = processLogBuffer.has(instanceId)
      if (localInstance || hasLocalLogs) {
        const modelManager = getModelManager(fastify.log)
        const { logs, lineCount } = modelManager.getLogs(instanceId)
        return { instance_id: instanceId, logs, line_count: lineCount }
      }

      // Remote
      const podInfo = findPodForInstance(instanceId)
      if (!podInfo) {
        return reply.code(404).send({ error: `Instance ${instanceId} not found in cluster` })
      }

      const internalPath = `/internal/models/${instanceId}/logs`
      const headers = buildSignedHeaders('GET', internalPath, '')

      try {
        const response = await fetch(`http://${podInfo.address}:${podInfo.port}${internalPath}`, {
          headers,
          signal: AbortSignal.timeout(10_000),
        })
        const result = await response.json() as Record<string, unknown>
        if (!response.ok) {
          return reply.code(response.status).send({ error: result.error ?? 'Remote logs fetch failed' })
        }
        return result
      } catch (err) {
        fastify.log.error({ err, instanceId, podId: podInfo.podId }, 'Failed to forward logs request to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podInfo.podId}` })
      }
    }
  )

  // ---------------------------------------------------------------------------
  // GET /api/cluster/moves/:moveId/events — SSE relay for move progress from any pod
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { moveId: string } }>(
    '/api/cluster/moves/:moveId/events',
    {
      schema: {
        tags: ['cluster'],
        description: 'Subscribe to move operation progress from any pod (SSE)',
        params: Type.Object({ moveId: Type.String() }),
      },
    },
    async (request, reply) => {
      const { moveId } = request.params
      const modelMover = getModelMover(fastify.log)

      // Check if this move is local
      const localOp = modelMover.getMove(moveId)
      if (localOp) {
        // Stream from local event bus — same as /api/models/moves/:moveId/events
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        })

        const connectionId = randomUUID()
        const sendEvent = (event: { id: string; phase: string; message: string; progress?: number; error?: string }): void => {
          try {
            reply.raw.write(`id: ${event.id}\nevent: move_progress\ndata: ${JSON.stringify(event)}\n\n`)
          } catch { /* connection closed */ }
        }

        const connection = { id: connectionId, send: sendEvent }
        modelMover.subscribeMoveEvents(moveId, connection)
        sendEvent({ id: randomUUID(), phase: localOp.phase, message: `Move in phase: ${localOp.phase}`, error: localOp.error })

        const heartbeat = setInterval(() => {
          try { reply.raw.write(': heartbeat\n\n') } catch { /* closed */ }
        }, 15000)

        request.raw.on('close', () => {
          clearInterval(heartbeat)
          modelMover.unsubscribeMoveEvents(moveId, connection)
        })
        return
      }

      // Not local — query all peers for this move and relay SSE from the one that has it
      let sourcePodInfo: { address: string; port: number; podId: string } | null = null
      for (const peer of peerStore.getAllPeers()) {
        if (peer.status !== 'healthy') continue
        try {
          const checkPath = `/internal/moves/${moveId}/events`
          const checkHeaders = buildSignedHeaders('GET', checkPath, '')
          const probe = await fetch(`http://${peer.address}:${peer.port}${checkPath}`, {
            headers: { ...checkHeaders, Accept: 'text/event-stream' },
            signal: AbortSignal.timeout(3_000),
          })
          if (probe.ok) {
            sourcePodInfo = { address: peer.address, port: peer.port, podId: peer.podId }
            // We have the SSE stream — relay it
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
              'Access-Control-Allow-Origin': '*',
            })

            const abortController = new AbortController()
            request.raw.on('close', () => abortController.abort())

            const reader = probe.body?.getReader()
            if (!reader) break

            const pump = async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  try { reply.raw.write(value) } catch { break }
                }
              } catch {
                // connection closed or aborted
              } finally {
                try { reply.raw.end() } catch { /* ignore */ }
              }
            }
            pump().catch(() => { /* ignore */ })
            return
          }
        } catch {
          // Peer unreachable — try next
        }
      }

      if (!sourcePodInfo) {
        return reply.code(404).send({ error: `Move operation ${moveId} not found in cluster` })
      }
    }
  )
}
