/**
 * PodScheduler - Placement algorithm and preset reconciliation for cluster model scheduling.
 *
 * T062: Placement algorithm (maximize-models / balanced strategies)
 * T063: Preset reconciliation (diff current vs desired state)
 */

import type { Logger } from '@sardeenz/utils'
import type {
  PlacementDecision,
  PlacementFailure,
  ModelConfigurationEntry,
  SavedModelConfiguration,
} from '@sardeenz/types'
import { peerStore } from '../stores/peer-store.js'
import { getMemoryProfileStore } from '../stores/memory-profile-store.js'

// ============ Types ============

export type PlacementStrategy = 'maximize-models' | 'balanced'

export interface PlacementRequest {
  entries: ModelConfigurationEntry[]
  strategy: PlacementStrategy
  minKvCacheMb: number | null
}

export interface PlacementResult {
  decisions: PlacementDecision[]
  failures: PlacementFailure[]
}

export interface ReconciliationPlan {
  toUnload: Array<{ podId: string; instanceId: string; modelPath: string }>
  toLoad: PlacementDecision[]
  failures: PlacementFailure[]
  unchanged: Array<{ podId: string; instanceId: string; modelPath: string }>
}

/** Mutable GPU state used during placement simulation */
interface GpuSlot {
  podId: string
  gpuId: number
  gpuName: string
  totalVramMB: number
  availableVramMB: number
  modelCount: number
}

// ============ PodScheduler ============

class PodScheduler {
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /**
   * T062: Place models onto cluster GPUs according to strategy and constraints.
   */
  async placeModels(request: PlacementRequest): Promise<PlacementResult> {
    const { entries, strategy, minKvCacheMb } = request
    const decisions: PlacementDecision[] = []
    const failures: PlacementFailure[] = []

    // Build mutable GPU slot state from healthy peers (fresh copies, safe for simulation)
    const slots = this.buildGpuSlots()

    if (slots.length === 0) {
      for (const entry of entries) {
        failures.push({
          modelPath: entry.modelPath,
          reason: 'No healthy peers with GPUs available in the cluster',
          candidatePods: [],
        })
      }
      return { decisions, failures }
    }

    // Process each entry in load_order
    const sorted = [...entries].sort((a, b) => a.loadOrder - b.loadOrder)

    for (const entry of sorted) {
      const result = await this.placeEntry(entry, slots, strategy, minKvCacheMb)
      if (result.decision) {
        decisions.push(result.decision)
      } else {
        failures.push(result.failure!)
      }
    }

    return { decisions, failures }
  }

  /**
   * T063: Diff current cluster state against preset desired state.
   * Returns a reconciliation plan: what to unload, what to load, what's unchanged.
   */
  async reconcile(preset: SavedModelConfiguration): Promise<ReconciliationPlan> {
    const entries = preset.entries ?? []
    const strategy: PlacementStrategy = preset.placementStrategy ?? 'balanced'
    const minKvCacheMb = preset.minKvCacheMb ?? null

    // Collect all currently loaded models across the cluster
    const peers = peerStore.getHealthyPeers()
    const currentModels: Array<{ podId: string; instanceId: string; modelPath: string }> = []
    for (const peer of peers) {
      for (const model of peer.models) {
        if (model.status === 'running' || model.status === 'sleeping') {
          currentModels.push({
            podId: peer.podId,
            instanceId: model.instanceId,
            modelPath: model.modelPath,
          })
        }
      }
    }

    // Build sets for comparison
    const desiredPaths = new Set(entries.map((e) => e.modelPath))

    // Models to unload: loaded but not in preset
    const toUnload = currentModels.filter((m) => !desiredPaths.has(m.modelPath))

    // Models already loaded (unchanged)
    const unchanged = currentModels.filter((m) => desiredPaths.has(m.modelPath))

    // Models to load: in preset but not currently loaded
    const alreadyLoadedPaths = new Set(unchanged.map((m) => m.modelPath))
    const missingEntries = entries.filter((e) => !alreadyLoadedPaths.has(e.modelPath))

    // Place missing models using the scheduler
    const { decisions: toLoad, failures } = await this.placeModels({
      entries: missingEntries,
      strategy,
      minKvCacheMb,
    })

    this.logger.info(
      {
        unchanged: unchanged.length,
        toUnload: toUnload.length,
        toLoad: toLoad.length,
        failures: failures.length,
      },
      'Reconciliation plan computed'
    )

    return { toUnload, toLoad, failures, unchanged }
  }

  // ============ Private helpers ============

  /** Build mutable GPU slots from all healthy peers. */
  private buildGpuSlots(): GpuSlot[] {
    const peers = peerStore.getHealthyPeers()
    const slots: GpuSlot[] = []

    for (const peer of peers) {
      for (const gpu of peer.gpus) {
        // Count models currently on this GPU
        const modelCount = peer.models.filter(
          (m) =>
            m.gpuIds.includes(gpu.gpuId) &&
            (m.status === 'running' || m.status === 'starting' || m.status === 'sleeping')
        ).length

        slots.push({
          podId: peer.podId,
          gpuId: gpu.gpuId,
          gpuName: gpu.name,
          totalVramMB: gpu.totalVramMB,
          availableVramMB: gpu.totalVramMB - gpu.usedVramMB,
          modelCount,
        })
      }
    }

    return slots
  }

  /** Estimate VRAM for a model entry using memory profiles. */
  private async estimateVramMB(entry: ModelConfigurationEntry): Promise<number | null> {
    const profileStore = getMemoryProfileStore()
    const profiles = await profileStore.findProfilesByModelPath(entry.modelPath)

    if (profiles.length === 0) return null

    // Find best match by maxTokens
    const exactMatch = profiles.find((p) => p.maxTokens === entry.maxTokens)
    const profile = exactMatch ?? profiles[0]

    // Convert GiB to MB (1 GiB ≈ 1073.74 MB, but we use 1024 for consistency)
    return Math.ceil(profile.totalGpuMemoryGib * 1024)
  }

  /** Place a single entry onto available GPU slots. */
  private async placeEntry(
    entry: ModelConfigurationEntry,
    slots: GpuSlot[],
    strategy: PlacementStrategy,
    minKvCacheMb: number | null
  ): Promise<{ decision?: PlacementDecision; failure?: PlacementFailure }> {
    const estimatedVramMB = await this.estimateVramMB(entry)
    const requiredVramMB = entry.minVramMb ?? estimatedVramMB ?? 0
    const tpSize = entry.tensorParallelSize ?? 1

    // Filter candidate slots
    const candidates = slots.filter((slot) => {
      // GPU type constraint
      if (entry.gpuTypeConstraint && !slot.gpuName.includes(entry.gpuTypeConstraint)) {
        return false
      }
      // VRAM check: need enough free memory
      if (requiredVramMB > 0 && slot.availableVramMB < requiredVramMB / tpSize) {
        return false
      }
      // Min KV cache headroom
      if (minKvCacheMb !== null) {
        const headroom = slot.availableVramMB - requiredVramMB / tpSize
        if (headroom < minKvCacheMb) {
          return false
        }
      }
      return true
    })

    // For tensor parallel, need tpSize GPUs on the same pod
    if (tpSize > 1) {
      return this.placeTensorParallel(entry, candidates, slots, strategy, requiredVramMB, tpSize)
    }

    // Single GPU placement
    if (candidates.length === 0) {
      return {
        failure: {
          modelPath: entry.modelPath,
          reason:
            requiredVramMB > 0
              ? `Insufficient VRAM on any available GPU (need ${requiredVramMB} MB)`
              : 'No GPUs match constraints',
          candidatePods: this.buildCandidatePodSummary(slots),
        },
      }
    }

    // Sort candidates by strategy
    const chosen = this.selectByStrategy(candidates, strategy)

    // Deduct from slot (mutate for subsequent placements)
    const perGpuVram = requiredVramMB > 0 ? requiredVramMB : 0
    chosen.availableVramMB -= perGpuVram
    chosen.modelCount += 1

    return {
      decision: {
        modelPath: entry.modelPath,
        targetPodId: chosen.podId,
        targetGpuIds: [chosen.gpuId],
        estimatedVramMB: requiredVramMB,
        reason: this.buildReason(chosen, strategy, requiredVramMB),
      },
    }
  }

  /** Place a tensor-parallel model requiring multiple GPUs on the same pod. */
  private placeTensorParallel(
    entry: ModelConfigurationEntry,
    candidates: GpuSlot[],
    allSlots: GpuSlot[],
    strategy: PlacementStrategy,
    requiredVramMB: number,
    tpSize: number
  ): { decision?: PlacementDecision; failure?: PlacementFailure } {
    // Group candidates by pod
    const podGroups = new Map<string, GpuSlot[]>()
    for (const slot of candidates) {
      let group = podGroups.get(slot.podId)
      if (!group) {
        group = []
        podGroups.set(slot.podId, group)
      }
      group.push(slot)
    }

    // Find pods with enough candidate GPUs
    const viablePods: Array<{ podId: string; gpus: GpuSlot[] }> = []
    for (const [podId, gpus] of podGroups) {
      if (gpus.length >= tpSize) {
        viablePods.push({ podId, gpus })
      }
    }

    if (viablePods.length === 0) {
      return {
        failure: {
          modelPath: entry.modelPath,
          reason: `No pod has ${tpSize} available GPUs matching constraints`,
          candidatePods: this.buildCandidatePodSummary(allSlots),
        },
      }
    }

    // Select pod by strategy
    let chosenPod: { podId: string; gpus: GpuSlot[] }
    if (strategy === 'balanced') {
      // Pick pod with fewest total models
      viablePods.sort(
        (a, b) =>
          a.gpus.reduce((s, g) => s + g.modelCount, 0) -
          b.gpus.reduce((s, g) => s + g.modelCount, 0)
      )
      chosenPod = viablePods[0]
    } else {
      // maximize-models: pick pod with most free VRAM (can fit more later)
      viablePods.sort(
        (a, b) =>
          b.gpus.reduce((s, g) => s + g.availableVramMB, 0) -
          a.gpus.reduce((s, g) => s + g.availableVramMB, 0)
      )
      chosenPod = viablePods[0]
    }

    // Pick top tpSize GPUs from chosen pod (most available VRAM first)
    const selectedGpus = chosenPod.gpus
      .sort((a, b) => b.availableVramMB - a.availableVramMB)
      .slice(0, tpSize)

    // Deduct VRAM from selected slots
    const perGpuVram = requiredVramMB > 0 ? requiredVramMB / tpSize : 0
    for (const gpu of selectedGpus) {
      gpu.availableVramMB -= perGpuVram
      gpu.modelCount += 1
    }

    return {
      decision: {
        modelPath: entry.modelPath,
        targetPodId: chosenPod.podId,
        targetGpuIds: selectedGpus.map((g) => g.gpuId),
        estimatedVramMB: requiredVramMB,
        reason: `TP${tpSize} on ${chosenPod.podId} GPUs [${selectedGpus.map((g) => g.gpuId).join(',')}] (${strategy})`,
      },
    }
  }

  /** Select best GPU slot based on strategy. */
  private selectByStrategy(candidates: GpuSlot[], strategy: PlacementStrategy): GpuSlot {
    if (strategy === 'maximize-models') {
      // Pack: prefer GPUs that already have models (least available VRAM that still fits)
      candidates.sort((a, b) => a.availableVramMB - b.availableVramMB)
    } else {
      // Balanced: prefer GPUs with fewest models, then most available VRAM
      candidates.sort((a, b) => {
        if (a.modelCount !== b.modelCount) return a.modelCount - b.modelCount
        return b.availableVramMB - a.availableVramMB
      })
    }
    return candidates[0]
  }

  /** Build reason string for a placement decision. */
  private buildReason(slot: GpuSlot, strategy: PlacementStrategy, vramMB: number): string {
    return `GPU ${slot.gpuId} on ${slot.podId}: ${slot.availableVramMB + vramMB} MB free → ${slot.availableVramMB} MB after (${strategy})`
  }

  /** Build candidate pod summary for failure reporting. */
  private buildCandidatePodSummary(
    slots: GpuSlot[]
  ): Array<{ podId: string; availableVramMB: number }> {
    const podMap = new Map<string, number>()
    for (const slot of slots) {
      const current = podMap.get(slot.podId) ?? 0
      podMap.set(slot.podId, current + slot.availableVramMB)
    }
    return Array.from(podMap.entries()).map(([podId, availableVramMB]) => ({
      podId,
      availableVramMB,
    }))
  }
}

// ============ Singleton ============

let podScheduler: PodScheduler | null = null

export function getPodScheduler(logger: Logger): PodScheduler {
  if (!podScheduler) {
    podScheduler = new PodScheduler(logger)
  }
  return podScheduler
}
