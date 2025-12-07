import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Logger } from '@sardeenz/utils'
import {
  CompletionRequestSchema,
  ChatCompletionRequestSchema,
  ErrorResponseSchema,
  type CompletionRequest,
  type ChatCompletionRequest,
} from '@sardeenz/types'
import { ProxyRouter } from '../services/proxy-router.js'
import { metricsStore } from '../stores/metrics-store.js'
import { AppError, NotFoundError } from '../utils/errors.js'
import { config } from '../config.js'

/**
 * Streams a WHATWG ReadableStream to a Fastify raw response using manual read/write.
 * Uses direct chunk writing to avoid Node.js stream buffering issues with SSE.
 * Handles client disconnect gracefully and records completion metrics.
 */
async function pipeStreamToReply(
  reply: FastifyReply,
  response: Response,
  modelPath: string,
  startTime: number,
  logger: Logger
): Promise<void> {
  const debugStreaming = config.debugStreaming

  // Set SSE headers (including CORS for OpenShift HAProxy compatibility)
  const sseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering (HAProxy uses timeout-tunnel)
    'Access-Control-Allow-Origin': '*', // Required for SSE through OpenShift routes
  }
  reply.raw.writeHead(200, sseHeaders)

  if (debugStreaming) {
    logger.info(
      { stage: 'sse_connection_established', modelPath, headers: sseHeaders },
      'SSE Debug: Connection established to frontend'
    )
  }

  // Disable Nagle's algorithm for SSE - reduces latency for small chunks
  reply.raw.socket?.setNoDelay(true)

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let clientDisconnected = false
  let chunkIndex = 0
  let totalBytes = 0

  // Heartbeat to keep HAProxy connection alive during long inference
  const heartbeat = setInterval(() => {
    if (!clientDisconnected && !reply.raw.writableEnded) {
      try {
        reply.raw.write(': heartbeat\n\n')
      } catch {
        // Connection closed, ignore
      }
    }
  }, 15000) // 15 seconds

  // Track client disconnect
  reply.raw.on('close', () => {
    clientDisconnected = true
    clearInterval(heartbeat)
    if (debugStreaming) {
      logger.info(
        { stage: 'client_disconnected', modelPath, chunkIndex, totalBytes },
        'SSE Debug: Client disconnected'
      )
    }
    reader.cancel().catch(() => {
      // Ignore cancel errors
    })
  })

  try {
    while (!clientDisconnected) {
      const { done, value } = await reader.read()
      if (done) break

      // Decode and write immediately (no buffering)
      const chunk = decoder.decode(value, { stream: true })
      if (chunk && !clientDisconnected) {
        chunkIndex++
        totalBytes += value.length

        if (debugStreaming) {
          logger.info(
            {
              stage: 'chunk_forwarded',
              modelPath,
              chunkIndex,
              chunkBytes: value.length,
              chunkPreview: chunk.slice(0, 200),
            },
            `SSE Debug: Chunk #${chunkIndex} forwarded (${value.length} bytes)`
          )
        }

        reply.raw.write(chunk)
      }
    }

    // Flush any remaining bytes from the decoder
    const remaining = decoder.decode()
    if (remaining && !clientDisconnected) {
      reply.raw.write(remaining)
      totalBytes += remaining.length
    }
  } catch (err) {
    // Client disconnected or stream cancelled - not an error condition
    if (!clientDisconnected) {
      throw err
    }
  } finally {
    clearInterval(heartbeat)
    if (!reply.raw.writableEnded) {
      reply.raw.end()
    }
    // Record completion metrics after stream ends
    const durationMs = Date.now() - startTime

    if (debugStreaming) {
      logger.info(
        { stage: 'stream_complete', modelPath, totalChunks: chunkIndex, totalBytes, durationMs },
        `SSE Debug: Stream complete - ${chunkIndex} chunks, ${totalBytes} bytes, ${durationMs}ms`
      )
    }

    setImmediate(() => metricsStore.recordRequest(modelPath, true, durationMs))
  }
}

export default async function proxyRoutes(fastify: FastifyInstance) {
  const proxyRouter = new ProxyRouter(fastify.log)

  /**
   * POST /v1/completions - OpenAI-compatible completions endpoint
   */
  fastify.post<{ Body: CompletionRequest }>(
    '/v1/completions',
    {
      schema: {
        tags: ['proxy'],
        description: 'Generate completions using a loaded model (OpenAI-compatible)',
        body: CompletionRequestSchema,
        response: {
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
      // NO AUTH - proxy endpoint is public
    },
    async (request: FastifyRequest<{ Body: CompletionRequest }>, reply: FastifyReply) => {
      const { model, stream } = request.body
      const isStreaming = stream === true

      const routingTimer = fastify.sardeenzMetrics.routingLatency.startTimer()

      try {
        if (isStreaming) {
          // Debug: Log incoming streaming request
          if (config.debugStreaming) {
            fastify.log.info(
              {
                stage: 'incoming_streaming_request',
                endpoint: '/v1/completions',
                model,
                body: request.body,
              },
              'SSE Debug: Incoming streaming request'
            )
          }

          // Handle streaming response using optimized stream piping
          const result = await proxyRouter.routeRequest({
            modelPath: model,
            endpoint: '/v1/completions',
            method: 'POST',
            body: request.body as unknown as Record<string, unknown>,
            streaming: true,
          })

          // Check if vLLM returned an error (before streaming started)
          if (result.statusCode >= 400) {
            routingTimer({ model, endpoint: '/v1/completions' })
            fastify.sardeenzMetrics.inferenceRequests.inc({
              model,
              status: 'error',
              streaming: 'true',
            })
            return reply.code(result.statusCode).send(result.response)
          }

          // Pipe stream to client - handles TCP_NODELAY, backpressure, and client disconnect
          await pipeStreamToReply(reply, result.response as Response, model, result.startTime!, fastify.log)

          routingTimer({ model, endpoint: '/v1/completions' })
          fastify.sardeenzMetrics.inferenceRequests.inc({
            model,
            status: 'success',
            streaming: 'true',
          })
          return
        }

        // Handle non-streaming response
        const result = await proxyRouter.routeRequest({
          modelPath: model,
          endpoint: '/v1/completions',
          method: 'POST',
          body: request.body as unknown as Record<string, unknown>,
          streaming: false,
        })

        routingTimer({ model, endpoint: '/v1/completions' })
        fastify.sardeenzMetrics.inferenceRequests.inc({
          model,
          status: result.statusCode < 400 ? 'success' : 'error',
          streaming: 'false',
        })

        if (result.statusCode >= 400) {
          return reply.code(result.statusCode).send(result.response)
        }

        return result.response
      } catch (err) {
        routingTimer({ model, endpoint: '/v1/completions' })
        fastify.sardeenzMetrics.inferenceRequests.inc({
          model,
          status: 'error',
          streaming: isStreaming ? 'true' : 'false',
        })

        if (err instanceof NotFoundError) {
          return reply.code(404).send(err.toJSON())
        }

        if (err instanceof AppError) {
          return reply.code(err.statusCode).send(err.toJSON())
        }

        return reply.code(502).send({
          error: {
            message: err instanceof Error ? err.message : 'Unknown error',
            type: 'bad_gateway',
          },
        })
      }
    }
  )

  /**
   * POST /v1/chat/completions - OpenAI-compatible chat completions endpoint
   */
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    {
      schema: {
        tags: ['proxy'],
        description: 'Generate chat completions using a loaded model (OpenAI-compatible)',
        body: ChatCompletionRequestSchema,
        response: {
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
      // NO AUTH - proxy endpoint is public
    },
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply: FastifyReply) => {
      const { model, stream } = request.body
      const isStreaming = stream === true

      const routingTimer = fastify.sardeenzMetrics.routingLatency.startTimer()

      try {
        if (isStreaming) {
          // Debug: Log incoming streaming request
          if (config.debugStreaming) {
            fastify.log.info(
              {
                stage: 'incoming_streaming_request',
                endpoint: '/v1/chat/completions',
                model,
                body: request.body,
              },
              'SSE Debug: Incoming streaming request'
            )
          }

          // Handle streaming response using optimized stream piping
          const result = await proxyRouter.routeRequest({
            modelPath: model,
            endpoint: '/v1/chat/completions',
            method: 'POST',
            body: request.body as unknown as Record<string, unknown>,
            streaming: true,
          })

          // Check if vLLM returned an error (before streaming started)
          if (result.statusCode >= 400) {
            routingTimer({ model, endpoint: '/v1/chat/completions' })
            fastify.sardeenzMetrics.inferenceRequests.inc({
              model,
              status: 'error',
              streaming: 'true',
            })
            return reply.code(result.statusCode).send(result.response)
          }

          // Pipe stream to client - handles TCP_NODELAY, backpressure, and client disconnect
          await pipeStreamToReply(reply, result.response as Response, model, result.startTime!, fastify.log)

          routingTimer({ model, endpoint: '/v1/chat/completions' })
          fastify.sardeenzMetrics.inferenceRequests.inc({
            model,
            status: 'success',
            streaming: 'true',
          })
          return
        }

        // Handle non-streaming response
        const result = await proxyRouter.routeRequest({
          modelPath: model,
          endpoint: '/v1/chat/completions',
          method: 'POST',
          body: request.body as unknown as Record<string, unknown>,
          streaming: false,
        })

        routingTimer({ model, endpoint: '/v1/chat/completions' })
        fastify.sardeenzMetrics.inferenceRequests.inc({
          model,
          status: result.statusCode < 400 ? 'success' : 'error',
          streaming: 'false',
        })

        if (result.statusCode >= 400) {
          return reply.code(result.statusCode).send(result.response)
        }

        return result.response
      } catch (err) {
        routingTimer({ model, endpoint: '/v1/chat/completions' })
        fastify.sardeenzMetrics.inferenceRequests.inc({
          model,
          status: 'error',
          streaming: isStreaming ? 'true' : 'false',
        })

        if (err instanceof NotFoundError) {
          return reply.code(404).send(err.toJSON())
        }

        if (err instanceof AppError) {
          return reply.code(err.statusCode).send(err.toJSON())
        }

        return reply.code(502).send({
          error: {
            message: err instanceof Error ? err.message : 'Unknown error',
            type: 'bad_gateway',
          },
        })
      }
    }
  )
}
