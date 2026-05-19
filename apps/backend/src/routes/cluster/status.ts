import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { MultiGpuMemoryUsageResponse, GpuAvailabilityResponse, ListModelsResponse } from '@sardeenz/types'
import { getNvidiaSmiInfo, type NvidiaSmiInfo } from '../../utils/gpu-info.js'
import { getClusterManager } from '../../services/cluster-manager.js'
import { getModelManager } from '../../services/model-manager.js'
import { MemoryMonitor } from '../../services/memory-monitor.js'
import { GpuSelector } from '../../services/gpu-selector.js'
import { buildSignedHeaders } from '../../services/cluster-auth.js'
import { peerStore } from '../../stores/peer-store.js'
import { clusterRoutingStore } from '../../stores/cluster-routing-store.js'
import { toModelDTO } from '../../utils/model-dto.js'

function computeClusterHealth(podCount: number, healthyCount: number): 'healthy' | 'degraded' | 'critical' {
  if (healthyCount === 0) return 'critical'
  if (healthyCount < podCount) return 'degraded'
  return 'healthy'
}

const PodIdParamsSchema = Type.Object({
  podId: Type.String(),
})

export default async function clusterStatusRoutes(fastify: FastifyInstance) {
  const clusterManager = getClusterManager(fastify.log)

  // T028: GET /api/cluster — ClusterStatus
  fastify.get(
    '/api/cluster',
    {
      schema: {
        tags: ['cluster'],
        description: 'Get cluster health and status',
        response: {
          200: Type.Object({
            clusterId: Type.String(),
            isClusterMode: Type.Boolean(),
            localPodId: Type.String(),
            podCount: Type.Integer(),
            healthyPodCount: Type.Integer(),
            leaderId: Type.String(),
            leaderAddress: Type.Union([Type.String(), Type.Null()]),
            term: Type.Integer(),
            expectedSize: Type.Integer(),
            totalModelsLoaded: Type.Integer(),
            totalGpus: Type.Integer(),
            routingTableVersion: Type.Integer(),
            health: Type.Union([Type.Literal('healthy'), Type.Literal('degraded'), Type.Literal('critical')]),
          }),
        },
      },
    },
    async () => {
      const allPeers = peerStore.getAllPeers()
      const healthyPeers = peerStore.getHealthyPeers()
      const state = clusterManager.getClusterState()

      const totalModelsLoaded = allPeers.reduce(
        (sum, p) => sum + p.models.filter((m) => m.status === 'running').length,
        0
      )
      const totalGpus = allPeers.reduce((sum, p) => sum + p.gpus.length, 0)

      return {
        clusterId: state.clusterId,
        isClusterMode: clusterManager.isClusterMode(),
        localPodId: clusterManager.getPodId(),
        podCount: allPeers.length,
        healthyPodCount: healthyPeers.length,
        leaderId: state.leaderId,
        leaderAddress: clusterManager.getLeaderAddress(),
        term: state.term,
        expectedSize: state.expectedSize,
        totalModelsLoaded,
        totalGpus,
        routingTableVersion: clusterRoutingStore.getVersion(),
        health: computeClusterHealth(allPeers.length, healthyPeers.length),
      }
    }
  )

  // T029: GET /api/cluster/pods — list all pods with details
  fastify.get(
    '/api/cluster/pods',
    {
      schema: {
        tags: ['cluster'],
        description: 'List all pods in the cluster with GPU and model details',
        response: {
          200: Type.Object({
            pods: Type.Array(Type.Any()),
          }),
        },
      },
    },
    async () => {
      return {
        pods: peerStore.getAllPeers().map((p) => ({
          podId: p.podId,
          address: p.address,
          role: p.role,
          status: p.status,
          lastHeartbeat: new Date(p.lastHeartbeat).toISOString(),
          joinedAt: new Date(p.joinedAt).toISOString(),
          modelCount: p.models.length,
          gpus: p.gpus.map((g) => ({
            gpuId: g.gpuId,
            name: g.name,
            totalVramMB: g.totalVramMB,
            usedVramMB: g.usedVramMB,
            temperature: g.temperature,
            utilization: g.utilization,
          })),
          models: p.models.map((m) => ({
            instanceId: m.instanceId,
            podId: p.podId,
            modelPath: m.modelPath,
            modelName: m.modelName,
            status: m.status,
            port: m.port,
            gpuIds: m.gpuIds,
            tensorParallelSize: m.tensorParallelSize,
          })),
        })),
      }
    }
  )

  // T030: GET /api/cluster/pods/:podId/models — models for a specific pod
  fastify.get<{ Params: { podId: string } }>(
    '/api/cluster/pods/:podId/models',
    {
      schema: {
        tags: ['cluster'],
        description: 'List models on a specific pod',
        params: PodIdParamsSchema,
        response: {
          200: Type.Object({
            models: Type.Array(Type.Any()),
          }),
          404: Type.Object({
            error: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { podId } = request.params
      const peer = peerStore.getPeer(podId)

      if (!peer) {
        return reply.code(404).send({ error: `Pod ${podId} not found` })
      }

      return {
        models: peer.models.map((m) => ({
          instanceId: m.instanceId,
          podId: peer.podId,
          modelPath: m.modelPath,
          modelName: m.modelName,
          status: m.status,
          port: m.port,
          gpuIds: m.gpuIds,
          tensorParallelSize: m.tensorParallelSize,
        })),
      }
    }
  )

  // T051: GET /api/cluster/routing-table — current routing table with version
  fastify.get(
    '/api/cluster/routing-table',
    {
      schema: {
        tags: ['cluster'],
        description: 'Get the cluster routing table with model-to-pod mappings',
        response: {
          200: Type.Object({
            version: Type.Integer(),
            entries: Type.Record(
              Type.String(),
              Type.Array(
                Type.Object({
                  podId: Type.String(),
                  podAddress: Type.String(),
                  vllmPort: Type.Integer(),
                  weight: Type.Integer(),
                })
              )
            ),
          }),
        },
      },
    },
    async () => {
      const table = clusterRoutingStore.getRoutingTable()

      // Convert Map to plain object for JSON serialization
      const entries: Record<string, Array<{ podId: string; podAddress: string; vllmPort: number; weight: number }>> = {}
      for (const [modelName, routingEntries] of table.entries) {
        entries[modelName] = routingEntries.map((e) => ({
          podId: e.podId,
          podAddress: e.podAddress,
          vllmPort: e.vllmPort,
          weight: e.weight,
        }))
      }

      return {
        version: table.version,
        entries,
      }
    }
  )

  // GET /api/cluster/pods/:podId/gpu/available — GPU availability for a specific pod
  fastify.get<{ Params: { podId: string } }>(
    '/api/cluster/pods/:podId/gpu/available',
    {
      schema: {
        tags: ['cluster'],
        description: 'Get GPU availability for a specific pod (proxies to remote pod if needed)',
        params: PodIdParamsSchema,
        response: {
          404: Type.Object({ error: Type.String() }),
          502: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { podId } = request.params
      const localPodId = clusterManager.getPodId()

      if (podId === localPodId) {
        const gpuSelector = new GpuSelector(fastify.log)
        try {
          return await gpuSelector.getGpuAvailability()
        } catch (err) {
          fastify.log.error({ err }, 'Failed to get local GPU availability')
          return reply.code(500).send({ error: (err as Error).message })
        }
      }

      const peer = peerStore.getPeer(podId)
      if (!peer) {
        return reply.code(404).send({ error: `Pod ${podId} not found` })
      }

      const internalPath = '/internal/gpu/available'
      const headers = buildSignedHeaders('GET', internalPath, '')

      try {
        const response = await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        })

        if (!response.ok) {
          return reply.code(response.status).send({ error: 'Failed to fetch GPU availability from remote pod' })
        }

        return await response.json() as GpuAvailabilityResponse
      } catch (err) {
        fastify.log.error({ err, podId }, 'Failed to proxy GPU availability to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podId}` })
      }
    }
  )

  // GET /api/cluster/pods/:podId/memory — GPU memory usage for a specific pod
  fastify.get<{ Params: { podId: string } }>(
    '/api/cluster/pods/:podId/memory',
    {
      schema: {
        tags: ['cluster'],
        description: 'Get GPU memory usage for a specific pod (proxies to remote pod if needed)',
        params: PodIdParamsSchema,
        response: {
          404: Type.Object({ error: Type.String() }),
          502: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { podId } = request.params
      const localPodId = clusterManager.getPodId()

      // Local pod: return directly
      if (podId === localPodId) {
        const memoryMonitor = new MemoryMonitor(fastify.log)
        try {
          return await memoryMonitor.getMultiGpuMemoryUsage()
        } catch (err) {
          fastify.log.error({ err }, 'Failed to get local memory usage')
          return reply.code(500).send({ error: (err as Error).message })
        }
      }

      // Remote pod: proxy via internal endpoint
      const peer = peerStore.getPeer(podId)
      if (!peer) {
        return reply.code(404).send({ error: `Pod ${podId} not found` })
      }

      const internalPath = '/internal/memory/multi-gpu'
      const headers = buildSignedHeaders('GET', internalPath, '')

      try {
        const response = await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        })

        if (!response.ok) {
          return reply.code(response.status).send({ error: 'Failed to fetch memory data from remote pod' })
        }

        return await response.json() as MultiGpuMemoryUsageResponse
      } catch (err) {
        fastify.log.error({ err, podId }, 'Failed to proxy memory request to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podId}` })
      }
    }
  )

  // GET /api/cluster/pods/:podId/gpu/info — full NvidiaSmiInfo from any pod
  fastify.get<{ Params: { podId: string } }>(
    '/api/cluster/pods/:podId/gpu/info',
    {
      schema: {
        tags: ['cluster'],
        description: 'Get full GPU info for a specific pod (proxies to remote pod if needed)',
        params: PodIdParamsSchema,
        response: {
          404: Type.Object({ error: Type.String() }),
          502: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { podId } = request.params
      const localPodId = clusterManager.getPodId()

      if (podId === localPodId) {
        try {
          return await getNvidiaSmiInfo()
        } catch (err) {
          fastify.log.error({ err }, 'Failed to get local GPU info')
          return reply.code(500).send({ error: (err as Error).message })
        }
      }

      const peer = peerStore.getPeer(podId)
      if (!peer) {
        return reply.code(404).send({ error: `Pod ${podId} not found` })
      }

      const internalPath = '/internal/gpu/info'
      const headers = buildSignedHeaders('GET', internalPath, '')

      try {
        const response = await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        })

        if (!response.ok) {
          return reply.code(response.status).send({ error: 'Failed to fetch GPU info from remote pod' })
        }

        return await response.json() as NvidiaSmiInfo
      } catch (err) {
        fastify.log.error({ err, podId }, 'Failed to proxy GPU info to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podId}` })
      }
    }
  )

  // GET /api/cluster/pods/:podId/models/full — full ModelInstanceDTO list from any pod
  fastify.get<{ Params: { podId: string } }>(
    '/api/cluster/pods/:podId/models/full',
    {
      schema: {
        tags: ['cluster'],
        description: 'Get full model instance list from a specific pod (proxies to remote pod)',
        params: PodIdParamsSchema,
        response: {
          404: Type.Object({ error: Type.String() }),
          502: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { podId } = request.params
      const clusterManager = getClusterManager(fastify.log)
      const isLocal = podId === clusterManager.getPodId()

      if (isLocal) {
        const modelManager = getModelManager(fastify.log)
        const instances = modelManager.listModels()
        return { models: instances.map(toModelDTO), total: instances.length }
      }

      const peer = peerStore.getPeer(podId)
      if (!peer) {
        return reply.code(404).send({ error: `Pod ${podId} not found` })
      }

      const internalPath = '/internal/models'
      const headers = buildSignedHeaders('GET', internalPath, '')

      try {
        const response = await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        })

        if (!response.ok) {
          return reply.code(response.status).send({ error: 'Failed to fetch models from remote pod' })
        }

        return await response.json() as ListModelsResponse
      } catch (err) {
        fastify.log.error({ err, podId }, 'Failed to proxy model list request to remote pod')
        return reply.code(502).send({ error: `Failed to reach pod ${podId}` })
      }
    }
  )
}
