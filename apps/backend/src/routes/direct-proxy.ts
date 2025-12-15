import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'

/**
 * Lightweight port-based proxy routes.
 * Forwards requests directly to localhost:${port}/${path} without model name routing.
 * Used for "direct" model access from the frontend InferenceTests page.
 */
export default async function directProxyRoutes(fastify: FastifyInstance) {
  const debugStreaming = config.debugStreaming
  /**
   * ALL /api/direct/:port/* - Lightweight port-based proxy
   * Forwards requests directly to localhost:${port}/${path}
   * No model name lookup - simpler and faster than the full proxy
   */
  fastify.all<{
    Params: { port: string; '*': string }
  }>(
    '/api/direct/:port/*',
    async (
      request: FastifyRequest<{ Params: { port: string; '*': string } }>,
      reply: FastifyReply
    ) => {
      const port = parseInt(request.params.port, 10)
      const path = request.params['*'] // Everything after /api/direct/:port/

      if (isNaN(port) || port < 1 || port > 65535) {
        return reply.code(400).send({ error: { message: 'Invalid port number' } })
      }

      const targetUrl = `http://localhost:${port}/${path}`
      const requestHeaders = { 'Content-Type': 'application/json' }
      const requestBody =
        request.method !== 'GET' && request.method !== 'HEAD'
          ? JSON.stringify(request.body)
          : undefined

      try {
        // Debug: Log outgoing request to vLLM
        if (debugStreaming) {
          fastify.log.info(
            {
              stage: 'request_to_vllm',
              targetUrl,
              method: request.method,
              headers: requestHeaders,
              body: request.body,
            },
            'SSE Debug: Sending request to vLLM (direct proxy)'
          )
        }

        // Forward request with same method, headers, body
        const response = await fetch(targetUrl, {
          method: request.method,
          headers: requestHeaders,
          body: requestBody,
        })

        // Check if streaming response (SSE)
        const contentType = response.headers.get('content-type') || ''

        // Debug: Log vLLM response info
        if (debugStreaming) {
          const responseHeaders: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value
          })
          fastify.log.info(
            {
              stage: 'vllm_response',
              status: response.status,
              contentType,
              allHeaders: responseHeaders,
              isStreaming: contentType.includes('text/event-stream'),
            },
            'SSE Debug: vLLM response received (direct proxy)'
          )
        }

        if (contentType.includes('text/event-stream')) {
          // Set SSE headers (including CORS for OpenShift HAProxy compatibility)
          const sseHeaders = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering (HAProxy uses timeout-tunnel)
            'Access-Control-Allow-Origin': '*', // Required for SSE through OpenShift routes
          }
          reply.raw.writeHead(response.status, sseHeaders)

          if (debugStreaming) {
            fastify.log.info(
              { stage: 'sse_connection_established', targetUrl, headers: sseHeaders },
              'SSE Debug: Connection established to frontend (direct proxy)'
            )
          }

          // Disable Nagle's algorithm for SSE
          reply.raw.socket?.setNoDelay(true)

          // Manual streaming to avoid Node.js stream buffering
          const reader = response.body!.getReader()
          const decoder = new TextDecoder()
          let clientDisconnected = false
          let chunkIndex = 0
          let totalBytes = 0
          const streamStartTime = Date.now()

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

          reply.raw.on('close', () => {
            clientDisconnected = true
            clearInterval(heartbeat)
            if (debugStreaming) {
              fastify.log.info(
                { stage: 'client_disconnected', targetUrl, chunkIndex, totalBytes },
                'SSE Debug: Client disconnected (direct proxy)'
              )
            }
            reader.cancel().catch(() => {})
          })

          try {
            while (!clientDisconnected) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              if (chunk && !clientDisconnected) {
                chunkIndex++
                totalBytes += value.length

                if (debugStreaming) {
                  fastify.log.info(
                    {
                      stage: 'chunk_forwarded',
                      targetUrl,
                      chunkIndex,
                      chunkBytes: value.length,
                      chunkPreview: chunk.slice(0, 200),
                    },
                    `SSE Debug: Chunk #${chunkIndex} forwarded (${value.length} bytes) (direct proxy)`
                  )
                }

                reply.raw.write(chunk)
              }
            }

            const remaining = decoder.decode()
            if (remaining && !clientDisconnected) {
              reply.raw.write(remaining)
              totalBytes += remaining.length
            }
          } finally {
            clearInterval(heartbeat)
            if (!reply.raw.writableEnded) {
              reply.raw.end()
            }

            if (debugStreaming) {
              const durationMs = Date.now() - streamStartTime
              fastify.log.info(
                { stage: 'stream_complete', targetUrl, totalChunks: chunkIndex, totalBytes, durationMs },
                `SSE Debug: Stream complete - ${chunkIndex} chunks, ${totalBytes} bytes, ${durationMs}ms (direct proxy)`
              )
            }
          }
          return
        }

        // Non-streaming: return JSON response
        const data = await response.json()
        return reply.code(response.status).send(data)
      } catch (err) {
        fastify.log.error({ err, port, path }, 'Direct proxy error')
        return reply.code(502).send({
          error: {
            message: err instanceof Error ? err.message : 'Proxy error',
            type: 'bad_gateway',
          },
        })
      }
    }
  )
}
