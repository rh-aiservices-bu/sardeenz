import type { FastifyInstance } from 'fastify'

export default async function clusterRoutes(fastify: FastifyInstance) {
  await fastify.register(import('./status.js'))
  await fastify.register(import('./models.js'))
  await fastify.register(import('./presets.js'))
  await fastify.register(import('./profiles.js'))
  await fastify.register(import('./benchmarks.js'))
}
