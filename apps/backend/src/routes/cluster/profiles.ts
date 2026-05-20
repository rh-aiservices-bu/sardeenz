import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { getClusterManager } from '../../services/cluster-manager.js'
import { buildSignedHeaders } from '../../services/cluster-auth.js'
import { peerStore } from '../../stores/peer-store.js'
import { getMemoryProfileStore, type CreateProfileData } from '../../stores/memory-profile-store.js'

export default async function clusterProfileRoutes(fastify: FastifyInstance) {
  const clusterManager = getClusterManager(fastify.log)

  // ---------------------------------------------------------------------------
  // T069: POST /api/cluster/memory-profiles/reconcile — collect, deduplicate, distribute
  // ---------------------------------------------------------------------------
  fastify.post(
    '/api/cluster/memory-profiles/reconcile',
    {
      schema: {
        tags: ['cluster'],
        description: 'Reconcile memory profiles across all pods',
        response: {
          200: Type.Object({
            totalProfiles: Type.Integer(),
            newDistributed: Type.Integer(),
            duplicatesResolved: Type.Integer(),
          }),
        },
      },
    },
    async () => {
      const peers = peerStore.getHealthyPeers()
      const localPodId = clusterManager.getPodId()

      // Collect profiles from all pods (including local)
      type ProfileEntry = { modelPath: string; maxTokens: number; gpuName: string; profile: Record<string, unknown>; updatedAt: string }
      const allProfiles: ProfileEntry[] = []

      // Local profiles
      const profileStore = getMemoryProfileStore()
      const { profiles: localProfiles } = await profileStore.listProfiles()
      for (const p of localProfiles) {
        if (p.gpuName) {
          allProfiles.push({
            modelPath: p.modelPath,
            maxTokens: p.maxTokens,
            gpuName: p.gpuName,
            profile: p as unknown as Record<string, unknown>,
            updatedAt: p.updatedAt ?? p.createdAt,
          })
        }
      }

      // Remote profiles
      for (const peer of peers) {
        if (peer.podId === localPodId) continue

        try {
          const internalPath = '/internal/memory-profiles'
          const headers = buildSignedHeaders('GET', internalPath, '')
          const response = await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
            headers,
            signal: AbortSignal.timeout(10_000),
          })

          if (response.ok) {
            const data = await response.json() as { profiles: Array<Record<string, unknown>> }
            for (const p of data.profiles) {
              const mp = p as { modelPath?: string; maxTokens?: number; gpuName?: string; updatedAt?: string; createdAt?: string }
              if (mp.modelPath && mp.gpuName) {
                allProfiles.push({
                  modelPath: mp.modelPath,
                  maxTokens: mp.maxTokens ?? 0,
                  gpuName: mp.gpuName,
                  profile: p,
                  updatedAt: mp.updatedAt ?? mp.createdAt ?? '',
                })
              }
            }
          }
        } catch (err) {
          fastify.log.warn({ err, podId: peer.podId }, 'Failed to collect profiles from peer')
        }
      }

      // Deduplicate: keep newest by model+maxTokens+gpuName
      const deduped = new Map<string, ProfileEntry>()
      let duplicatesResolved = 0
      for (const entry of allProfiles) {
        const key = `${entry.modelPath}:${entry.maxTokens}:${entry.gpuName}`
        const existing = deduped.get(key)
        if (!existing || entry.updatedAt > existing.updatedAt) {
          if (existing) duplicatesResolved++
          deduped.set(key, entry)
        } else {
          duplicatesResolved++
        }
      }

      // Distribute unified set to all peers
      const unifiedProfiles = Array.from(deduped.values()).map((e) => e.profile)
      let newDistributed = 0

      for (const peer of peers) {
        if (peer.podId === localPodId) continue

        try {
          const internalPath = '/internal/memory-profiles'
          const body = JSON.stringify({ profiles: unifiedProfiles })
          const headers = buildSignedHeaders('POST', internalPath, body)
          const response = await fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10_000),
          })

          if (response.ok) {
            const result = await response.json() as { imported?: number }
            newDistributed += result.imported ?? 0
          }
        } catch (err) {
          fastify.log.warn({ err, podId: peer.podId }, 'Failed to distribute profiles to peer')
        }
      }

      return {
        totalProfiles: deduped.size,
        newDistributed,
        duplicatesResolved,
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T070: GET /api/cluster/memory-profiles/export — export all profiles as JSON
  // ---------------------------------------------------------------------------
  fastify.get(
    '/api/cluster/memory-profiles/export',
    {
      schema: {
        tags: ['cluster'],
        description: 'Export all memory profiles as JSON for backup',
        response: {
          200: Type.Object({
            profiles: Type.Array(Type.Any()),
            exportedAt: Type.String(),
          }),
        },
      },
    },
    async () => {
      const profileStore = getMemoryProfileStore()
      const { profiles } = await profileStore.listProfiles()
      return {
        profiles,
        exportedAt: new Date().toISOString(),
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T070: POST /api/cluster/memory-profiles/import — import profiles from backup
  // ---------------------------------------------------------------------------
  fastify.post<{
    Body: { profiles: Array<Record<string, unknown>> }
  }>(
    '/api/cluster/memory-profiles/import',
    {
      schema: {
        tags: ['cluster'],
        description: 'Import memory profiles from a backup file',
        body: Type.Object({
          profiles: Type.Array(Type.Any()),
        }),
        response: {
          200: Type.Object({
            imported: Type.Integer(),
            skipped: Type.Integer(),
          }),
        },
      },
    },
    async (request) => {
      const profileStore = getMemoryProfileStore()
      const { profiles } = request.body
      let imported = 0
      let skipped = 0

      for (const p of profiles) {
        const mp = p as {
          profileName?: string; modelPath?: string; maxTokens?: number
          totalGpuMemoryGib?: number; weightsMemoryGib?: number; cudaGraphsGib?: number
          overheadMemoryGib?: number; kvCacheAvailableGib?: number; kvCachePerRequestMib?: number
          gpuName?: string; gpuTotalMemoryGib?: number; comments?: string; createdBy?: string
        }

        if (!mp.modelPath || !mp.profileName) {
          skipped++
          continue
        }

        const data: CreateProfileData = {
          profileName: mp.profileName,
          modelPath: mp.modelPath,
          maxTokens: mp.maxTokens ?? 0,
          totalGpuMemoryGib: mp.totalGpuMemoryGib ?? 0,
          weightsMemoryGib: mp.weightsMemoryGib ?? 0,
          cudaGraphsGib: mp.cudaGraphsGib ?? 0,
          overheadMemoryGib: mp.overheadMemoryGib ?? 0,
          kvCacheAvailableGib: mp.kvCacheAvailableGib ?? 0,
          kvCachePerRequestMib: mp.kvCachePerRequestMib,
          gpuName: mp.gpuName,
          gpuTotalMemoryGib: mp.gpuTotalMemoryGib,
          comments: mp.comments,
          createdBy: mp.createdBy,
        }

        await profileStore.upsertProfile(data)
        imported++
      }

      // Distribute imported profiles to peers
      if (imported > 0) {
        const peers = peerStore.getHealthyPeers()
        const localPodId = clusterManager.getPodId()
        const { profiles: allLocal } = await profileStore.listProfiles()

        for (const peer of peers) {
          if (peer.podId === localPodId) continue

          const internalPath = '/internal/memory-profiles'
          const body = JSON.stringify({ profiles: allLocal })
          const headers = buildSignedHeaders('POST', internalPath, body)

          fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10_000),
          }).catch(() => {
            // Fire-and-forget
          })
        }
      }

      return { imported, skipped }
    }
  )
}
