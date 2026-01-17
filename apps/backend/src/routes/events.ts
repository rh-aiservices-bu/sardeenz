import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Type } from '@sinclair/typebox'
import { randomUUID } from 'crypto'
import { eventBus, type SSEConnection } from '../services/event-bus.js'
import { processLogBuffer } from '../services/process-log-buffer.js'
import { modelStore } from '../stores/model-store.js'
import { NotFoundError } from '../utils/errors.js'
import type { SSEEvent, SSEEventType } from '@sardeenz/types'

/** Valid event types for filtering */
const VALID_EVENT_TYPES: SSEEventType[] = ['log', 'status', 'memory', 'progress', 'error']

/**
 * SSE Events Routes
 * Provides real-time event streaming for model instances
 */
export default async function eventsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/models/instances/:instance_id/events
   *
   * SSE endpoint for real-time events related to a model instance.
   * Supports optional filtering by event type via query param.
   */
  fastify.get<{
    Params: { instance_id: string }
    Querystring: { types?: string; replay_logs?: string }
  }>(
    '/api/models/instances/:instance_id/events',
    {
      schema: {
        tags: ['models', 'events'],
        description: 'Subscribe to real-time events for a model instance (SSE)',
        params: Type.Object({
          instance_id: Type.String({ format: 'uuid' }),
        }),
        querystring: Type.Object({
          types: Type.Optional(
            Type.String({
              description:
                'Comma-separated event types to filter (log,status,memory,progress,error)',
            })
          ),
          replay_logs: Type.Optional(
            Type.String({
              description: 'Replay existing buffered logs on connection (true/false)',
            })
          ),
        }),
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (
      request: FastifyRequest<{
        Params: { instance_id: string }
        Querystring: { types?: string; replay_logs?: string }
      }>,
      reply: FastifyReply
    ) => {
      const { instance_id } = request.params
      const { types, replay_logs } = request.query
      const shouldReplayLogs = replay_logs !== 'false' // Default true

      // Validate instance exists (or has logs from failed instance)
      const instance = modelStore.get(instance_id)
      const hasLogs = processLogBuffer.has(instance_id)

      if (!instance && !hasLogs) {
        throw new NotFoundError(`Model instance ${instance_id} not found`)
      }

      // Parse event type filters
      const eventFilters: SSEEventType[] = types
        ? (types
            .split(',')
            .filter((t) => VALID_EVENT_TYPES.includes(t as SSEEventType)) as SSEEventType[])
        : [...VALID_EVENT_TYPES]

      // Set up SSE headers using raw response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'Access-Control-Allow-Origin': '*', // CORS for SSE
      })

      const connectionId = randomUUID()
      fastify.log.info(
        { connectionId, instance_id, filters: eventFilters },
        'SSE connection opened'
      )

      // Helper to send SSE event
      const sendEvent = (event: SSEEvent): void => {
        if (!eventFilters.includes(event.eventType)) return

        try {
          const data = JSON.stringify(event)
          reply.raw.write(`id: ${event.id}\n`)
          reply.raw.write(`event: ${event.eventType}\n`)
          reply.raw.write(`data: ${data}\n\n`)
        } catch (err) {
          fastify.log.debug({ connectionId, err }, 'Failed to write SSE event')
        }
      }

      // Create SSE connection object
      const connection: SSEConnection = {
        id: connectionId,
        send: sendEvent,
        filters: eventFilters,
      }

      // Replay existing logs if requested
      if (shouldReplayLogs && eventFilters.includes('log')) {
        const existingLogs = processLogBuffer.getBuffer(instance_id)
        let lineNumber = 0
        for (const entry of existingLogs) {
          sendEvent(eventBus.createLogEvent(instance_id, entry, lineNumber))
          lineNumber++
        }
      }

      // Send current status if available
      if (instance && eventFilters.includes('status')) {
        sendEvent(
          eventBus.createStatusEvent(
            instance_id,
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

      // Subscribe to future events via EventBus
      eventBus.subscribe(instance_id, connection)

      // Subscribe to log entries directly from ProcessLogBuffer
      const unsubscribeLogs = processLogBuffer.onLog(instance_id, (entry) => {
        sendEvent(eventBus.createLogEvent(instance_id, entry))
      })

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n')
        } catch {
          // Connection closed
        }
      }, 30000)

      // Clean up on connection close
      request.raw.on('close', () => {
        clearInterval(heartbeat)
        unsubscribeLogs()
        eventBus.unsubscribe(instance_id, connection)
        fastify.log.info({ connectionId, instance_id }, 'SSE connection closed')
      })

      // Don't end the response - keep it open for streaming
      // Return nothing to prevent Fastify from sending a response
    }
  )
}
