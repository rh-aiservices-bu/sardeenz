import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { getClusterManager } from '../../services/cluster-manager.js'
import { getModelManager } from '../../services/model-manager.js'
import { getPodScheduler } from '../../services/pod-scheduler.js'
import { buildSignedHeaders } from '../../services/cluster-auth.js'
import { peerStore } from '../../stores/peer-store.js'
import { getModelConfigurationStore } from '../../stores/model-configuration-store.js'

export default async function clusterPresetRoutes(fastify: FastifyInstance) {
  const clusterManager = getClusterManager(fastify.log)

  // ---------------------------------------------------------------------------
  // T064: POST /api/cluster/presets/:presetId/apply — reconcile + schedule + execute
  // ---------------------------------------------------------------------------
  fastify.post<{
    Params: { presetId: string }
    Body: { dryRun?: boolean }
  }>(
    '/api/cluster/presets/:presetId/apply',
    {
      schema: {
        tags: ['cluster', 'presets'],
        description: 'Apply a preset to the cluster with automatic scheduling',
        params: Type.Object({
          presetId: Type.String(),
        }),
        body: Type.Object({
          dryRun: Type.Optional(Type.Boolean({ default: false })),
        }),
        response: {
          200: Type.Object({
            presetId: Type.String(),
            presetName: Type.String(),
            dryRun: Type.Boolean(),
            placed: Type.Array(Type.Any()),
            unplaceable: Type.Array(Type.Any()),
            unloaded: Type.Array(Type.Any()),
          }),
          403: Type.Object({ error: Type.String() }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      // Leader-only check
      if (clusterManager.isClusterMode() && !clusterManager.isLeader()) {
        return reply.code(403).send({ error: 'Only the leader can apply presets' })
      }

      const { presetId } = request.params
      const dryRun = request.body?.dryRun ?? false

      // Load the preset
      const configStore = getModelConfigurationStore()
      const preset = await configStore.getConfiguration(presetId)
      if (!preset) {
        return reply.code(404).send({ error: `Preset ${presetId} not found` })
      }

      // Reconcile
      const scheduler = getPodScheduler(fastify.log)
      const plan = await scheduler.reconcile(preset)

      const placed = plan.toLoad.map((d) => ({
        modelPath: d.modelPath,
        podId: d.targetPodId,
        gpuIds: d.targetGpuIds,
        reason: d.reason,
      }))

      const unplaceable = plan.failures.map((f) => ({
        modelPath: f.modelPath,
        reason: f.reason,
      }))

      const unloaded = plan.toUnload.map((u) => ({
        modelPath: u.modelPath,
        podId: u.podId,
        reason: 'Not in preset',
      }))

      if (dryRun) {
        return {
          presetId: preset.id,
          presetName: preset.name,
          dryRun: true,
          placed,
          unplaceable,
          unloaded,
        }
      }

      // Execute: unload models not in preset
      for (const item of plan.toUnload) {
        try {
          const isLocal = item.podId === clusterManager.getPodId()
          if (isLocal) {
            const modelManager = getModelManager(fastify.log)
            await modelManager.unloadModel(item.instanceId)
          } else {
            const peer = peerStore.getPeer(item.podId)
            if (peer) {
              const internalPath = `/internal/models/${item.instanceId}/unload`
              const unloadBody = '{}'
              const headers = buildSignedHeaders('POST', internalPath, unloadBody)
              await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
                method: 'POST',
                headers,
                body: unloadBody,
                signal: AbortSignal.timeout(10_000),
              })
            }
          }
        } catch (err) {
          fastify.log.warn({ err, instanceId: item.instanceId, podId: item.podId }, 'Failed to unload model during preset apply')
        }
      }

      // Execute: load models that need placement
      for (const decision of plan.toLoad) {
        try {
          const isLocal = decision.targetPodId === clusterManager.getPodId()
          if (isLocal) {
            const modelManager = getModelManager(fastify.log)
            // Find the matching entry for extra parameters
            const entry = preset.entries?.find((e) => e.modelPath === decision.modelPath)
            await modelManager.launchModel({
              modelPath: decision.modelPath,
              gpuIds: decision.targetGpuIds,
              tensorParallelSize: entry?.tensorParallelSize,
              maxTokens: entry?.maxTokens,
              servedModelName: entry?.servedModelName,
              enableSleepMode: entry?.sleepModeEnabled,
            })
          } else {
            const peer = peerStore.getPeer(decision.targetPodId)
            if (peer) {
              const entry = preset.entries?.find((e) => e.modelPath === decision.modelPath)
              const internalPath = '/internal/models/load'
              const bodyStr = JSON.stringify({
                modelPath: decision.modelPath,
                gpuIds: decision.targetGpuIds,
                tensorParallelSize: entry?.tensorParallelSize,
                maxTokens: entry?.maxTokens,
                servedModelName: entry?.servedModelName,
                enableSleepMode: entry?.sleepModeEnabled,
              })
              const headers = buildSignedHeaders('POST', internalPath, bodyStr)
              await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
                method: 'POST',
                headers,
                body: bodyStr,
                signal: AbortSignal.timeout(10_000),
              })
            }
          }
        } catch (err) {
          fastify.log.warn({ err, modelPath: decision.modelPath, podId: decision.targetPodId }, 'Failed to load model during preset apply')
        }
      }

      return {
        presetId: preset.id,
        presetName: preset.name,
        dryRun: false,
        placed,
        unplaceable,
        unloaded,
      }
    }
  )
}
