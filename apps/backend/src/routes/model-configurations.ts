/**
 * Model Configuration API Routes
 *
 * CRUD operations for saved model configurations.
 */

import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  CreateModelConfigurationRequestSchema,
  UpdateModelConfigurationRequestSchema,
  ListModelConfigurationsResponseSchema,
  GetModelConfigurationResponseSchema,
  DeleteModelConfigurationResponseSchema,
  LoadConfigurationResponseSchema,
  ConfigurationErrorResponseSchema,
  type CreateModelConfigurationRequest,
  type UpdateModelConfigurationRequest,
  type SavedModelConfiguration,
  type ModelConfigurationEntry,
  type ModelInstanceDTO,
} from '@sardeenz/types'
import { getModelConfigurationStore } from '../stores/model-configuration-store.js'
import { modelStore } from '../stores/model-store.js'
import { getModelManager } from '../services/model-manager.js'
import { getClusterManager } from '../services/cluster-manager.js'
import { peerStore } from '../stores/peer-store.js'
import { buildSignedHeaders } from '../services/cluster-auth.js'

const ConfigIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

// Helper to convert domain object to API response format (snake_case)
function configToResponse(config: SavedModelConfiguration) {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    model_count: config.modelCount,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
    entries: config.entries?.map((e: ModelConfigurationEntry) => ({
      id: e.id,
      config_id: e.configId,
      model_path: e.modelPath,
      served_model_name: e.servedModelName,
      max_tokens: e.maxTokens,
      source_type: e.sourceType,
      extra_args: e.extraArgs,
      gpu_ids: e.gpuIds,
      tensor_parallel_size: e.tensorParallelSize,
      load_order: e.loadOrder,
      pod_id: e.podId,
    })),
  }
}

export default async function modelConfigurationRoutes(fastify: FastifyInstance) {
  const store = getModelConfigurationStore()
  const modelManager = getModelManager(fastify.log)

  /**
   * GET /api/configurations - List all configurations
   */
  fastify.get(
    '/api/configurations',
    {
      schema: {
        tags: ['configurations'],
        description: 'List all saved model configurations',
        response: {
          200: ListModelConfigurationsResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async () => {
      const { configurations, total } = await store.listConfigurations()
      return {
        configurations: configurations.map(configToResponse),
        total,
      }
    }
  )

  /**
   * GET /api/configurations/:id - Get a configuration with entries
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/configurations/:id',
    {
      schema: {
        tags: ['configurations'],
        description: 'Get a model configuration by ID with all entries',
        params: ConfigIdParamsSchema,
        response: {
          200: GetModelConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { id } = request.params
      const config = await store.getConfiguration(id)

      if (!config) {
        return reply.status(404).send({
          error: {
            message: `Configuration not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return { configuration: configToResponse(config) }
    }
  )

  /**
   * POST /api/configurations - Create configuration from current models
   */
  fastify.post<{ Body: CreateModelConfigurationRequest }>(
    '/api/configurations',
    {
      schema: {
        tags: ['configurations'],
        description: 'Save current model configuration',
        body: CreateModelConfigurationRequestSchema,
        response: {
          201: GetModelConfigurationResponseSchema,
          400: ConfigurationErrorResponseSchema,
          409: ConfigurationErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { name, description } = request.body

      // Check for duplicate name
      if (await store.nameExists(name)) {
        return reply.status(409).send({
          error: {
            message: `Configuration with name "${name}" already exists`,
            type: 'conflict',
          },
        })
      }

      // Get current running models (local pod)
      const instances = modelStore.getAll()

      // In cluster mode, also fetch models from remote peers
      const clusterManager = getClusterManager(fastify.log)
      const isClusterMode = clusterManager.isClusterMode()
      const localPodId = isClusterMode ? clusterManager.getPodId() : undefined
      const remoteModels: Array<{ dto: ModelInstanceDTO; podId: string }> = []

      if (isClusterMode) {
        for (const peer of peerStore.getAllPeers()) {
          if (peer.podId === localPodId) continue
          try {
            const internalPath = '/internal/models'
            const resp = await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
              headers: buildSignedHeaders('GET', internalPath, ''),
              signal: AbortSignal.timeout(5_000),
            })
            if (resp.ok) {
              const data = await resp.json() as { models: ModelInstanceDTO[] }
              for (const dto of data.models) {
                remoteModels.push({ dto, podId: peer.podId })
              }
            }
          } catch (err) {
            fastify.log.error({ err, podId: peer.podId }, 'Failed to fetch models from peer during config save')
          }
        }
      }

      const hasAnyRunning =
        instances.some((i) => i.status === 'running' || i.status === 'sleeping') ||
        remoteModels.some((r) => r.dto.status === 'running' || r.dto.status === 'sleeping')

      if (!hasAnyRunning) {
        return reply.status(400).send({
          error: {
            message: 'No running models to save. Load at least one model first.',
            type: 'validation_error',
          },
        })
      }

      const config = await store.createFromRunningModels({ name, description }, instances, localPodId, remoteModels)

      reply.status(201)
      return { configuration: configToResponse((await store.getConfiguration(config.id))!) }
    }
  )

  /**
   * PUT /api/configurations/:id - Update configuration name/description
   */
  fastify.put<{ Params: { id: string }; Body: UpdateModelConfigurationRequest }>(
    '/api/configurations/:id',
    {
      schema: {
        tags: ['configurations'],
        description: 'Update a configuration name or description',
        params: ConfigIdParamsSchema,
        body: UpdateModelConfigurationRequestSchema,
        response: {
          200: GetModelConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
          409: ConfigurationErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { id } = request.params
      const body = request.body

      // Check name conflict if updating name
      if (body.name) {
        const existing = await store.getConfiguration(id)
        if (existing && existing.name !== body.name && await store.nameExists(body.name)) {
          return reply.status(409).send({
            error: {
              message: `Configuration with name "${body.name}" already exists`,
              type: 'conflict',
            },
          })
        }
      }

      const config = await store.updateConfiguration(id, body)

      if (!config) {
        return reply.status(404).send({
          error: {
            message: `Configuration not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return { configuration: configToResponse(config) }
    }
  )

  /**
   * DELETE /api/configurations/:id - Delete a configuration
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/configurations/:id',
    {
      schema: {
        tags: ['configurations'],
        description: 'Delete a model configuration',
        params: ConfigIdParamsSchema,
        response: {
          200: DeleteModelConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { id } = request.params

      const deleted = await store.deleteConfiguration(id)

      if (!deleted) {
        return reply.status(404).send({
          error: {
            message: `Configuration not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return {
        status: 'success' as const,
        id,
        deleted_at: new Date().toISOString(),
      }
    }
  )

  /**
   * POST /api/configurations/:id/load - Load a configuration
   * Cluster-aware: routes each entry to its saved pod, skips entries for missing pods.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/configurations/:id/load',
    {
      schema: {
        tags: ['configurations'],
        description: 'Load a saved configuration (unloads current models first)',
        params: ConfigIdParamsSchema,
        response: {
          200: LoadConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
          400: ConfigurationErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { id } = request.params

      const config = await store.getConfiguration(id)

      if (!config) {
        return reply.status(404).send({
          error: { message: `Configuration not found: ${id}`, type: 'not_found' },
        })
      }

      if (!config.entries || config.entries.length === 0) {
        return reply.status(400).send({
          error: { message: 'Configuration has no model entries', type: 'validation_error' },
        })
      }

      const clusterManager = getClusterManager(fastify.log)
      const isClusterMode = clusterManager.isClusterMode()
      const localPodId = clusterManager.getPodId()

      // Determine which pods are available and which entries are loadable
      let entriesToLoad = config.entries!
      const skippedPods: string[] = []

      if (isClusterMode) {
        const knownPodIds = new Set(peerStore.getAllPeers().map((p) => p.podId))
        knownPodIds.add(localPodId)

        // Only filter by pod if any entries have a pod_id saved
        if (config.entries!.some((e) => e.podId)) {
          const skippedPodSet = new Set<string>()
          entriesToLoad = config.entries!.filter((e) => {
            if (!e.podId || knownPodIds.has(e.podId)) return true
            skippedPodSet.add(e.podId)
            return false
          })
          skippedPods.push(...skippedPodSet)
        }
      }

      const loadableCount = entriesToLoad.length

      setImmediate(async () => {
        try {
          // 1. Unload all models (local + cluster peers)
          for (const instance of modelStore.getAll()) {
            try {
              await modelManager.unloadModel(instance.id)
            } catch (err) {
              fastify.log.error({ err, instanceId: instance.id }, 'Failed to unload local model during config load')
            }
          }

          if (isClusterMode) {
            for (const peer of peerStore.getAllPeers()) {
              if (peer.podId === localPodId) continue
              for (const model of peer.models) {
                try {
                  const internalPath = `/internal/models/${model.instanceId}/unload`
                  await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
                    method: 'POST',
                    headers: buildSignedHeaders('POST', internalPath, ''),
                    signal: AbortSignal.timeout(10_000),
                  })
                } catch (err) {
                  fastify.log.error({ err, podId: peer.podId, instanceId: model.instanceId }, 'Failed to unload remote model during config load')
                }
              }
            }
          }

          // 2. Load entries
          if (isClusterMode) {
            const localEntries = entriesToLoad.filter((e) => !e.podId || e.podId === localPodId)
            const remoteEntriesByPod = new Map<string, ModelConfigurationEntry[]>()
            for (const entry of entriesToLoad) {
              if (entry.podId && entry.podId !== localPodId) {
                const arr = remoteEntriesByPod.get(entry.podId) ?? []
                arr.push(entry)
                remoteEntriesByPod.set(entry.podId, arr)
              }
            }

            // Load local entries with conflict-group ordering
            await loadEntriesLocally(localEntries, modelManager, fastify.log)

            // Load remote entries sequentially per pod, in load_order
            for (const [podId, entries] of remoteEntriesByPod) {
              const peer = peerStore.getPeer(podId)
              if (!peer) continue
              for (const entry of entries.sort((a, b) => a.loadOrder - b.loadOrder)) {
                try {
                  const internalPath = '/internal/models/load'
                  const body = JSON.stringify({
                    modelPath: entry.modelPath,
                    maxTokens: entry.maxTokens,
                    gpuIds: entry.gpuIds,
                    tensorParallelSize: entry.tensorParallelSize,
                    servedModelName: entry.servedModelName,
                    enableSleepMode: entry.sleepModeEnabled,
                  })
                  await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
                    method: 'POST',
                    headers: buildSignedHeaders('POST', internalPath, body),
                    body,
                    signal: AbortSignal.timeout(30_000),
                  })
                } catch (err) {
                  fastify.log.error({ err, podId, modelPath: entry.modelPath }, 'Failed to load remote model during config load')
                }
              }
            }
          } else {
            await loadEntriesLocally(entriesToLoad, modelManager, fastify.log)
          }

          fastify.log.info({ configId: id, configName: config.name }, 'Configuration load completed')
        } catch (err) {
          fastify.log.error({ err, configId: id }, 'Configuration load failed')
        }
      })

      const message = skippedPods.length > 0
        ? `Loading configuration "${config.name}" with ${loadableCount} model(s). ${skippedPods.length} pod(s) not available and will be skipped: ${skippedPods.join(', ')}. Current models will be unloaded first.`
        : `Loading configuration "${config.name}" with ${loadableCount} model(s). Current models will be unloaded first.`

      return {
        status: 'started' as const,
        configuration_id: id,
        configuration_name: config.name,
        message,
        skipped_pods: skippedPods.length > 0 ? skippedPods : undefined,
        loaded_model_count: loadableCount,
      }
    }
  )
}

/**
 * Load a list of entries on the local pod using conflict-group ordering.
 * Models sharing a GPU are loaded sequentially; independent groups load in parallel.
 */
async function loadEntriesLocally(
  entries: ModelConfigurationEntry[],
  modelManager: ReturnType<typeof getModelManager>,
  log: FastifyInstance['log']
): Promise<void> {
  if (entries.length === 0) return

  const AUTO_GPU_GROUP = -1
  type EntryWithIndex = { entry: ModelConfigurationEntry; index: number }

  const entriesWithIndex: EntryWithIndex[] = entries.map((entry, index) => ({ entry, index }))
  const parent = entriesWithIndex.map((_, i) => i)

  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i])
    return parent[i]
  }

  function union(i: number, j: number): void {
    const pi = find(i)
    const pj = find(j)
    if (pi !== pj) parent[pi] = pj
  }

  function getGpuSet(entry: ModelConfigurationEntry): Set<number> {
    return entry.gpuIds && entry.gpuIds.length > 0 ? new Set(entry.gpuIds) : new Set([AUTO_GPU_GROUP])
  }

  for (let i = 0; i < entriesWithIndex.length; i++) {
    const gpusI = getGpuSet(entriesWithIndex[i].entry)
    for (let j = i + 1; j < entriesWithIndex.length; j++) {
      const gpusJ = getGpuSet(entriesWithIndex[j].entry)
      for (const gpu of gpusI) {
        if (gpusJ.has(gpu)) { union(i, j); break }
      }
    }
  }

  const conflictGroups = new Map<number, EntryWithIndex[]>()
  for (let i = 0; i < entriesWithIndex.length; i++) {
    const root = find(i)
    const group = conflictGroups.get(root) ?? []
    group.push(entriesWithIndex[i])
    conflictGroups.set(root, group)
  }

  for (const group of conflictGroups.values()) {
    group.sort((a, b) => a.entry.loadOrder - b.entry.loadOrder)
  }

  await Promise.all(
    Array.from(conflictGroups.values()).map(async (group) => {
      for (const { entry } of group) {
        try {
          await modelManager.launchModelAndWait({
            modelPath: entry.modelPath,
            maxTokens: entry.maxTokens,
            gpuIds: entry.gpuIds,
            tensorParallelSize: entry.tensorParallelSize,
            sourceType: entry.sourceType,
            servedModelName: entry.servedModelName,
            extraArgs: entry.extraArgs,
            enableSleepMode: entry.sleepModeEnabled,
          })
          log.info({ modelPath: entry.modelPath, gpuIds: entry.gpuIds }, 'Loaded model from config')
        } catch (err) {
          log.error({ err, modelPath: entry.modelPath, gpuIds: entry.gpuIds }, 'Failed to load model during config load')
        }
      }
    })
  )
}
