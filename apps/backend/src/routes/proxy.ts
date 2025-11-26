import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  CompletionRequestSchema,
  ChatCompletionRequestSchema,
  ErrorResponseSchema,
  type CompletionRequest,
  type ChatCompletionRequest,
} from '@sardeenz/types'
import { ProxyRouter } from '../services/proxy-router.js'
import { AppError, NotFoundError } from '../utils/errors.js'

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
          // Handle streaming response
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })

          await proxyRouter.routeRequest({
            modelPath: model,
            endpoint: '/v1/completions',
            method: 'POST',
            body: request.body as unknown as Record<string, unknown>,
            streaming: true,
            onChunk: (chunk) => {
              reply.raw.write(chunk)
            },
          })

          reply.raw.end()
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
          // Handle streaming response
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })

          await proxyRouter.routeRequest({
            modelPath: model,
            endpoint: '/v1/chat/completions',
            method: 'POST',
            body: request.body as unknown as Record<string, unknown>,
            streaming: true,
            onChunk: (chunk) => {
              reply.raw.write(chunk)
            },
          })

          reply.raw.end()
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
