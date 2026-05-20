import { Readable } from 'node:stream'
import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getClusterManager } from '../services/cluster-manager.js'
import { peerStore } from '../stores/peer-store.js'

const FORWARD_TIMEOUT_MS = 30_000

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * Fastify plugin: forwards admin requests from follower pods to the leader.
 *
 * Instead of redirecting the client (307), the follower proxies the request
 * server-side to the leader and streams the response back. This works
 * correctly behind OpenShift Routes / load balancers where the client
 * cannot reach individual pod addresses.
 *
 * Routes NOT forwarded (must work on any pod):
 * - /v1/* (inference — handled by distributed proxy)
 * - /api/direct/* (direct proxy)
 * - /internal/* (inter-pod cluster communication)
 * - /api/health/* (health checks must work on every pod)
 * - /api/cluster (cluster status — useful from any pod)
 * - /docs/* and /metrics (operational endpoints)
 */
function shouldForward(url: string): boolean {
  if (url.startsWith('/v1/')) return false
  if (url.startsWith('/api/direct/')) return false
  if (url.startsWith('/internal/')) return false
  if (url.startsWith('/api/health')) return false
  if (url.startsWith('/api/cluster')) return false
  if (url.startsWith('/docs')) return false
  if (url.startsWith('/metrics')) return false

  return true
}

function filterHeaders(rawHeaders: Record<string, string | string[] | undefined>): Record<string, string> {
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value == null) continue
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue
    if (key.toLowerCase() === 'host') continue
    filtered[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return filtered
}

export default fp(
  async function leaderForwardPlugin(fastify: FastifyInstance) {
    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const clusterManager = getClusterManager(fastify.log)

      if (!clusterManager.isClusterMode() || clusterManager.isLeader()) {
        return
      }

      if (!shouldForward(request.url)) {
        return
      }

      // Loop detection — prevent infinite forwarding
      if (request.headers['x-sardeenz-forwarded']) {
        return reply.code(508).send({
          error: 'Loop Detected',
          message: 'Request has already been forwarded. Possible cluster misconfiguration.',
        })
      }

      const leaderAddress = clusterManager.getLeaderAddress()
      if (!leaderAddress) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Cluster leader is not available. Please try again later.',
        })
      }

      const knownPeers = peerStore.getAllPeers()
      const isKnownPeer = knownPeers.some(
        (p) => leaderAddress === `${p.address}:${p.port}` || leaderAddress === p.address
      )
      if (!isKnownPeer) {
        fastify.log.warn({ leaderAddress }, 'Leader address not found in known peers, refusing to forward')
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Leader address could not be verified. Please try again later.',
        })
      }

      const forwardUrl = `http://${leaderAddress}${request.url}`
      const forwardHeaders = filterHeaders(request.headers as Record<string, string | string[] | undefined>)
      forwardHeaders['x-sardeenz-forwarded'] = 'true'
      forwardHeaders['x-forwarded-for'] = request.ip

      const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'

      let response: Response
      try {
        response = await fetch(forwardUrl, {
          method: request.method,
          headers: forwardHeaders,
          body: hasBody ? (request.raw as unknown as ReadableStream) : undefined,
          signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
          duplex: hasBody ? 'half' : undefined,
        })
      } catch (err: unknown) {
        const isTimeout = err instanceof DOMException && err.name === 'TimeoutError'
        const code = isTimeout ? 504 : 502
        const label = isTimeout ? 'Gateway Timeout' : 'Bad Gateway'
        fastify.log.warn({ err, leaderAddress }, `Leader forward failed: ${label}`)
        return reply.code(code).send({
          error: label,
          message: `Failed to reach cluster leader at ${leaderAddress}.`,
        })
      }

      // Stream the leader's response back to the client
      reply.hijack()

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
          responseHeaders[key] = value
        }
      })

      reply.raw.writeHead(response.status, responseHeaders)

      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream)
        nodeStream.pipe(reply.raw)
        nodeStream.on('error', () => reply.raw.end())
      } else {
        reply.raw.end()
      }
    })
  },
  {
    name: 'leader-forward',
    fastify: '5.x',
  }
)
