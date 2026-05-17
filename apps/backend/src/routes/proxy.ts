import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Logger } from '@sardeenz/utils'
import {
  CompletionRequestSchema,
  ChatCompletionRequestSchema,
  EmbeddingRequestSchema,
  TokenizeRequestSchema,
  DetokenizeRequestSchema,
  VLLMGenericRequestSchema,
  VLLMModelsListResponseSchema,
  ErrorResponseSchema,
  type CompletionRequest,
  type ChatCompletionRequest,
} from '@sardeenz/types'
import { ProxyRouter, FORWARDED_HEADER } from '../services/proxy-router.js'
import { modelStore } from '../stores/model-store.js'
import { metricsStore } from '../stores/metrics-store.js'
import { AppError, NotFoundError } from '../utils/errors.js'
import { config } from '../config.js'

// Interface for request body with model field
interface ModelRequest {
  model: string
  stream?: boolean
  [key: string]: unknown
}

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
  logger: Logger,
  onStreamComplete?: () => void
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

    // Decrement connection counts after stream ends
    onStreamComplete?.()
  }
}

/**
 * Generic handler for JSON proxy requests to vLLM endpoints.
 * Handles both streaming and non-streaming responses.
 */
async function handleJsonProxyRequest(
  fastify: FastifyInstance,
  request: FastifyRequest<{ Body: ModelRequest }>,
  reply: FastifyReply,
  endpoint: string,
  proxyRouter: ProxyRouter,
  supportsStreaming: boolean = false
): Promise<unknown> {
  const body = request.body
  const model = body.model
  const isStreaming = supportsStreaming && body.stream === true

  // Validate model field
  if (!model || typeof model !== 'string') {
    return reply.code(400).send({
      error: {
        message: 'Missing required field: model',
        type: 'invalid_request_error',
      },
    })
  }

  // T046: Detect if this request was already forwarded from another pod (loop prevention)
  const isForwarded = !!request.headers[FORWARDED_HEADER]

  const routingTimer = fastify.sardeenzMetrics.routingLatency.startTimer()

  try {
    if (isStreaming) {
      // Debug: Log incoming streaming request
      if (config.debugStreaming) {
        fastify.log.info(
          {
            stage: 'incoming_streaming_request',
            endpoint,
            model,
            body,
          },
          'SSE Debug: Incoming streaming request'
        )
      }

      // Handle streaming response using optimized stream piping
      const result = await proxyRouter.routeRequest({
        modelPath: model,
        endpoint,
        method: 'POST',
        body: body as Record<string, unknown>,
        streaming: true,
        isForwarded,
      })

      // Check if vLLM returned an error (before streaming started)
      if (result.statusCode >= 400) {
        routingTimer({ model, endpoint })
        fastify.sardeenzMetrics.inferenceRequests.inc({
          model,
          status: 'error',
          streaming: 'true',
        })
        return reply.code(result.statusCode).send(result.response)
      }

      // Pipe stream to client - handles TCP_NODELAY, backpressure, and client disconnect
      await pipeStreamToReply(
        reply,
        result.response as Response,
        model,
        result.startTime!,
        fastify.log,
        result.onStreamComplete
      )

      routingTimer({ model, endpoint })
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
      endpoint,
      method: 'POST',
      body: body as Record<string, unknown>,
      streaming: false,
      isForwarded,
    })

    routingTimer({ model, endpoint })
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
    routingTimer({ model, endpoint })
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

export default async function proxyRoutes(fastify: FastifyInstance) {
  const proxyRouter = new ProxyRouter(fastify.log)

  // Apply inference API key authentication to all routes in this plugin
  fastify.addHook('preHandler', fastify.authenticateInference)

  // ============================================================
  // OpenAI-Compatible Endpoints (with /v1 prefix)
  // ============================================================

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
    },
    async (request, reply) => {
      return handleJsonProxyRequest(
        fastify,
        request as unknown as FastifyRequest<{ Body: ModelRequest }>,
        reply,
        '/v1/completions',
        proxyRouter,
        true // supports streaming
      )
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
    },
    async (request, reply) => {
      return handleJsonProxyRequest(
        fastify,
        request as unknown as FastifyRequest<{ Body: ModelRequest }>,
        reply,
        '/v1/chat/completions',
        proxyRouter,
        true // supports streaming
      )
    }
  )

  /**
   * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
   */
  fastify.post<{ Body: ModelRequest }>(
    '/v1/embeddings',
    {
      schema: {
        tags: ['proxy'],
        description: 'Generate embeddings using a loaded model (OpenAI-compatible)',
        body: EmbeddingRequestSchema,
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleJsonProxyRequest(fastify, request, reply, '/v1/embeddings', proxyRouter, false)
    }
  )

  /**
   * GET /v1/models - List all available models (aggregated from all running instances)
   */
  fastify.get(
    '/v1/models',
    {
      schema: {
        tags: ['proxy'],
        description: 'List all available models across all running vLLM instances',
        response: {
          200: VLLMModelsListResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      // Get all running instances
      const instances = modelStore.getAll().filter((i) => i.status === 'running')

      if (instances.length === 0) {
        return reply.send({
          object: 'list',
          data: [],
        })
      }

      // Query each instance's /v1/models endpoint in parallel
      const modelResponses = await Promise.allSettled(
        instances.map(async (instance) => {
          const response = await fetch(`http://localhost:${instance.port}/v1/models`)
          if (!response.ok) {
            throw new Error(`Failed to fetch models from instance ${instance.id}`)
          }
          return response.json() as Promise<{ data?: unknown[] }>
        })
      )

      // Aggregate data arrays from all successful responses
      const allModels = modelResponses
        .filter((r): r is PromiseFulfilledResult<{ data?: unknown[] }> => r.status === 'fulfilled')
        .flatMap((r) => r.value.data || [])

      return reply.send({
        object: 'list',
        data: allModels,
      })
    }
  )

  // ============================================================
  // vLLM-Specific Endpoints (without /v1 prefix)
  // ============================================================

  /**
   * POST /tokenize - Tokenize text using a loaded model
   */
  fastify.post<{ Body: ModelRequest }>(
    '/tokenize',
    {
      schema: {
        tags: ['proxy'],
        description: 'Tokenize text using a loaded model (vLLM-specific)',
        body: TokenizeRequestSchema,
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleJsonProxyRequest(fastify, request, reply, '/tokenize', proxyRouter, false)
    }
  )

  /**
   * POST /detokenize - Detokenize tokens using a loaded model
   */
  fastify.post<{ Body: ModelRequest }>(
    '/detokenize',
    {
      schema: {
        tags: ['proxy'],
        description: 'Detokenize tokens using a loaded model (vLLM-specific)',
        body: DetokenizeRequestSchema,
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleJsonProxyRequest(fastify, request, reply, '/detokenize', proxyRouter, false)
    }
  )

  /**
   * POST /pooling - Run pooling inference using a loaded model
   */
  fastify.post<{ Body: ModelRequest }>(
    '/pooling',
    {
      schema: {
        tags: ['proxy'],
        description: 'Run pooling inference using a loaded model (vLLM-specific)',
        body: VLLMGenericRequestSchema,
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleJsonProxyRequest(fastify, request, reply, '/pooling', proxyRouter, false)
    }
  )

  /**
   * POST /classification - Run classification using a loaded model
   */
  fastify.post<{ Body: ModelRequest }>(
    '/classification',
    {
      schema: {
        tags: ['proxy'],
        description: 'Run classification using a loaded model (vLLM-specific)',
        body: VLLMGenericRequestSchema,
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleJsonProxyRequest(fastify, request, reply, '/classification', proxyRouter, false)
    }
  )

  /**
   * POST /score - Run scoring using a loaded model
   */
  fastify.post<{ Body: ModelRequest }>(
    '/score',
    {
      schema: {
        tags: ['proxy'],
        description: 'Run scoring using a loaded model (vLLM-specific)',
        body: VLLMGenericRequestSchema,
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleJsonProxyRequest(fastify, request, reply, '/score', proxyRouter, false)
    }
  )

  /**
   * POST /re-rank - Run re-ranking using a loaded model
   */
  fastify.post<{ Body: ModelRequest }>(
    '/re-rank',
    {
      schema: {
        tags: ['proxy'],
        description: 'Run re-ranking using a loaded model (vLLM-specific)',
        body: VLLMGenericRequestSchema,
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleJsonProxyRequest(fastify, request, reply, '/re-rank', proxyRouter, false)
    }
  )

  // ============================================================
  // Audio Endpoints (multipart/form-data)
  // ============================================================

  /**
   * POST /v1/audio/transcriptions - Transcribe audio using a loaded model
   */
  fastify.post(
    '/v1/audio/transcriptions',
    {
      schema: {
        tags: ['proxy'],
        description: 'Transcribe audio using a loaded model (OpenAI-compatible)',
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleAudioProxyRequest(
        fastify,
        request,
        reply,
        '/v1/audio/transcriptions',
        proxyRouter
      )
    }
  )

  /**
   * POST /v1/audio/translations - Translate audio using a loaded model
   */
  fastify.post(
    '/v1/audio/translations',
    {
      schema: {
        tags: ['proxy'],
        description: 'Translate audio using a loaded model (OpenAI-compatible)',
        response: {
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return handleAudioProxyRequest(fastify, request, reply, '/v1/audio/translations', proxyRouter)
    }
  )
}

/**
 * Handle audio proxy requests with multipart/form-data.
 * Extracts the model field from form data and forwards the entire request to vLLM.
 */
async function handleAudioProxyRequest(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  endpoint: string,
  proxyRouter: ProxyRouter
): Promise<unknown> {
  let releaseConnection: (() => void) | undefined

  try {
    // Check if request is multipart
    const contentType = request.headers['content-type'] || ''
    if (!contentType.includes('multipart/form-data')) {
      return reply.code(400).send({
        error: {
          message: 'Content-Type must be multipart/form-data for audio endpoints',
          type: 'invalid_request_error',
        },
      })
    }

    // Parse multipart data to extract the model field
    const parts = await request.parts()
    const formData: {
      model?: string
      fields: Record<string, unknown>
      files: Array<{ fieldname: string; file: Buffer; filename: string; mimetype: string }>
    } = {
      fields: {},
      files: [],
    }

    for await (const part of parts) {
      if (part.type === 'file') {
        // Collect file data
        const chunks: Buffer[] = []
        for await (const chunk of part.file) {
          chunks.push(chunk)
        }
        formData.files.push({
          fieldname: part.fieldname,
          file: Buffer.concat(chunks),
          filename: part.filename,
          mimetype: part.mimetype,
        })
      } else {
        // Field value
        formData.fields[part.fieldname] = part.value
        if (part.fieldname === 'model') {
          formData.model = part.value as string
        }
      }
    }

    // Validate model field
    if (!formData.model) {
      return reply.code(400).send({
        error: {
          message: 'Missing required field: model',
          type: 'invalid_request_error',
        },
      })
    }

    const model = formData.model

    // Select instance with connection tracking using load balancer
    const { instance, releaseConnection: release } = proxyRouter.selectInstanceForAudio(model)
    releaseConnection = release

    // Rebuild multipart request and forward to vLLM
    const boundary = `----FormBoundary${Date.now()}`
    const bodyParts: Buffer[] = []

    // Add fields
    for (const [key, value] of Object.entries(formData.fields)) {
      bodyParts.push(Buffer.from(`--${boundary}\r\n`))
      bodyParts.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`))
      bodyParts.push(Buffer.from(`${value}\r\n`))
    }

    // Add files
    for (const file of formData.files) {
      bodyParts.push(Buffer.from(`--${boundary}\r\n`))
      bodyParts.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\n`
        )
      )
      bodyParts.push(Buffer.from(`Content-Type: ${file.mimetype}\r\n\r\n`))
      bodyParts.push(file.file)
      bodyParts.push(Buffer.from('\r\n'))
    }

    bodyParts.push(Buffer.from(`--${boundary}--\r\n`))

    const requestBody = Buffer.concat(bodyParts)

    // Forward to vLLM
    const targetUrl = `http://localhost:${instance.port}${endpoint}`
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(requestBody.length),
      },
      body: requestBody,
    })

    const responseData = await response.json()

    if (!response.ok) {
      return reply.code(response.status).send(responseData)
    }

    return reply.send(responseData)
  } catch (err) {
    fastify.log.error({ err, endpoint }, 'Audio proxy request failed')

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
  } finally {
    // Decrement connection counts when request completes
    releaseConnection?.()
  }
}
