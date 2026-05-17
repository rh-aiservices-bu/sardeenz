import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getClusterManager } from '../services/cluster-manager.js'
import { peerStore } from '../stores/peer-store.js'

/**
 * Fastify plugin: redirects dashboard/admin requests from follower pods to the leader.
 *
 * T052: Intercepts requests on follower pods and returns 307 Temporary Redirect.
 * T053: Uses ClusterManager.getLeaderAddress() to build the redirect URL.
 *
 * Routes NOT redirected:
 * - /v1/* (inference — handled by distributed proxy)
 * - /api/direct/* (direct proxy)
 * - /internal/* (inter-pod cluster communication)
 * - /api/health/* (health checks must work on every pod)
 * - /api/cluster (cluster status — useful from any pod)
 * - /docs/* and /metrics (operational endpoints)
 */
function shouldRedirect(url: string): boolean {
  // Never redirect these paths — they must work on every pod
  if (url.startsWith('/v1/')) return false
  if (url.startsWith('/api/direct/')) return false
  if (url.startsWith('/internal/')) return false
  if (url.startsWith('/api/health')) return false
  if (url.startsWith('/api/cluster')) return false
  if (url.startsWith('/docs')) return false
  if (url.startsWith('/metrics')) return false

  // Redirect admin API requests and dashboard (everything else)
  return true
}

export default fp(
  async function leaderRedirectPlugin(fastify: FastifyInstance) {
    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const clusterManager = getClusterManager(fastify.log)

      // Skip if not in cluster mode or if this pod IS the leader
      if (!clusterManager.isClusterMode() || clusterManager.isLeader()) {
        return
      }

      // Skip routes that should work on any pod
      if (!shouldRedirect(request.url)) {
        return
      }

      // Resolve leader address
      const leaderAddress = clusterManager.getLeaderAddress()
      if (!leaderAddress) {
        // Leader unknown — return 503 Service Unavailable
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Cluster leader is not available. Please try again later.',
        })
      }

      // Validate leaderAddress is a known peer to prevent open redirect attacks
      const knownPeers = peerStore.getAllPeers()
      const isKnownPeer = knownPeers.some(
        (p) => leaderAddress === `${p.address}:${p.port}` || leaderAddress === p.address
      )
      if (!isKnownPeer) {
        fastify.log.warn({ leaderAddress }, 'Leader address not found in known peers, refusing redirect')
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Leader address could not be verified. Please try again later.',
        })
      }

      // Build redirect URL preserving the original path and query string
      let redirectUrl: string
      try {
        const url = new URL(`http://${leaderAddress}`)
        url.pathname = request.url.split('?')[0]
        url.search = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''
        redirectUrl = url.toString()
      } catch {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Leader address is invalid. Please try again later.',
        })
      }

      return reply.code(307).redirect(redirectUrl)
    })
  },
  {
    name: 'leader-redirect',
    fastify: '5.x',
  }
)
