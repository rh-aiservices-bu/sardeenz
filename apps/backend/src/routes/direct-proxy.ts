import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

/**
 * Lightweight port-based proxy routes.
 * Forwards requests directly to localhost:${port}/${path} without model name routing.
 * Used for "direct" model access from the frontend InferenceTests page.
 */
export default async function directProxyRoutes(fastify: FastifyInstance) {
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

      try {
        // Forward request with same method, headers, body
        const response = await fetch(targetUrl, {
          method: request.method,
          headers: {
            'Content-Type': 'application/json',
            // Don't forward host header
          },
          body:
            request.method !== 'GET' && request.method !== 'HEAD'
              ? JSON.stringify(request.body)
              : undefined,
        })

        // Check if streaming response (SSE)
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('text/event-stream')) {
          // Set SSE headers
          reply.raw.writeHead(response.status, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering (HAProxy uses timeout-tunnel)
          })

          // Disable Nagle's algorithm for SSE
          reply.raw.socket?.setNoDelay(true)

          // Manual streaming to avoid Node.js stream buffering
          const reader = response.body!.getReader()
          const decoder = new TextDecoder()
          let clientDisconnected = false

          reply.raw.on('close', () => {
            clientDisconnected = true
            reader.cancel().catch(() => {})
          })

          try {
            while (!clientDisconnected) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              if (chunk && !clientDisconnected) {
                reply.raw.write(chunk)
              }
            }

            const remaining = decoder.decode()
            if (remaining && !clientDisconnected) {
              reply.raw.write(remaining)
            }
          } finally {
            if (!reply.raw.writableEnded) {
              reply.raw.end()
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
