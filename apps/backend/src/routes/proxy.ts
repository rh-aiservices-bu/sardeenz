import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
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

/**
 * Pipes a WHATWG ReadableStream to a Fastify raw response.
 * Handles client disconnect gracefully and records completion metrics.
 */
async function pipeStreamToReply(
  reply: FastifyReply,
  response: Response,
  modelPath: string,
  startTime: number
): Promise<void> {
  // Set headers once
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable reverse proxy buffering (nginx, HAProxy)
  })
  // Disable Nagle's algorithm for SSE - reduces latency for small chunks
  reply.raw.socket?.setNoDelay(true)

  // Convert WHATWG stream to Node stream (Node 16.7+)
  const nodeStream = Readable.fromWeb(response.body as ReadableStream)

  // Track client disconnect
  const abortController = new AbortController()
  reply.raw.on('close', () => {
    if (!reply.raw.writableEnded) {
      abortController.abort()
    }
  })

  try {
    // pipeline() handles backpressure automatically
    await pipeline(nodeStream, reply.raw, { signal: abortController.signal })
  } catch (err) {
    // Client disconnected or stream error - not an error condition
    if ((err as Error).name !== 'AbortError') {
      throw err
    }
  } finally {
    // Record completion metrics after stream ends
    const durationMs = Date.now() - startTime
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
          await pipeStreamToReply(reply, result.response as Response, model, result.startTime!)

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
          await pipeStreamToReply(reply, result.response as Response, model, result.startTime!)

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
