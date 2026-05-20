import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'
import { verifyRequestDualSecret } from '../services/cluster-auth.js'

const SIGNATURE_HEADER = 'x-cluster-signature'
const TIMESTAMP_HEADER = 'x-cluster-timestamp'

async function clusterAuthPlugin(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only protect /internal/* routes
    if (!request.url.startsWith('/internal/')) {
      return
    }

    // Skip verification if CLUSTER_SECRET is not configured (single-pod mode)
    if (!config.clusterSecret) {
      return
    }

    const signature = request.headers[SIGNATURE_HEADER]
    const timestampStr = request.headers[TIMESTAMP_HEADER]

    if (!signature || typeof signature !== 'string') {
      reply.code(401).send({ error: 'Missing X-Cluster-Signature header' })
      return
    }

    if (!timestampStr || typeof timestampStr !== 'string') {
      reply.code(401).send({ error: 'Missing X-Cluster-Timestamp header' })
      return
    }

    const timestamp = parseInt(timestampStr, 10)
    if (isNaN(timestamp)) {
      reply.code(401).send({ error: 'Invalid X-Cluster-Timestamp header' })
      return
    }

    // Get raw body as string for verification
    const body = request.body ? JSON.stringify(request.body) : ''

    const valid = verifyRequestDualSecret(
      request.method,
      request.url.split('?')[0],
      body,
      signature,
      timestamp,
      config.clusterSecret
    )

    if (!valid) {
      reply.code(401).send({ error: 'Invalid cluster signature' })
      return
    }
  })
}

export default fp(clusterAuthPlugin, {
  name: 'cluster-auth-plugin',
})
