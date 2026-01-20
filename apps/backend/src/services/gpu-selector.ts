/**
 * GPU Selector Service
 * Handles GPU selection for model loading with auto-balance and manual selection support
 */

import { getNvidiaSmiInfo } from '../utils/gpu-info.js'
import { modelStore } from '../stores/model-store.js'
import type {
  GpuAvailabilityResponse,
  GpuRecommendation,
  GpuInfo,
  ModelInstance,
} from '@sardeenz/types'
import type { Logger } from '@sardeenz/utils'
import type { GpuMemoryErrorDetails } from '../utils/errors.js'

export interface GpuValidationResult {
  valid: boolean
  error?: string
  gpuIds: number[]
}

export class GpuSelector {
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'GpuSelector' })
  }

  /**
   * Get recommended GPU(s) for a new model based on free memory.
   * For tensor parallel, returns the starting GPU index of contiguous GPUs with most combined free memory.
   */
  async getRecommendedGpu(tensorParallelSize: number = 1): Promise<GpuRecommendation> {
    const nvidiaSmi = await getNvidiaSmiInfo()
    const gpus = nvidiaSmi.gpus

    if (gpus.length === 0) {
      throw new Error('No GPUs detected')
    }

    if (tensorParallelSize === 1) {
      // Single GPU: select one with most free memory
      const sorted = [...gpus].sort(
        (a, b) => b.memoryTotalMB - b.memoryUsedMB - (a.memoryTotalMB - a.memoryUsedMB)
      )
      const best = sorted[0]
      const freeGb = (best.memoryTotalMB - best.memoryUsedMB) / 1024

      return {
        gpu_id: best.index,
        free_memory_gb: freeGb,
        reason: `GPU ${best.index} has most free memory (${freeGb.toFixed(1)} GB)`,
      }
    }

    // Tensor parallel: find contiguous GPUs with most combined free memory
    if (tensorParallelSize > gpus.length) {
      throw new Error(
        `Requested tensor_parallel_size=${tensorParallelSize} but only ${gpus.length} GPUs available`
      )
    }

    // Sort by index to ensure contiguous search
    const sortedByIndex = [...gpus].sort((a, b) => a.index - b.index)

    let bestStart = 0
    let bestFreeTotal = 0

    for (let start = 0; start <= sortedByIndex.length - tensorParallelSize; start++) {
      let freeTotal = 0
      for (let i = start; i < start + tensorParallelSize; i++) {
        const gpu = sortedByIndex[i]
        freeTotal += gpu.memoryTotalMB - gpu.memoryUsedMB
      }
      if (freeTotal > bestFreeTotal) {
        bestFreeTotal = freeTotal
        bestStart = start
      }
    }

    const startGpuIndex = sortedByIndex[bestStart].index
    const endGpuIndex = sortedByIndex[bestStart + tensorParallelSize - 1].index

    return {
      gpu_id: startGpuIndex,
      free_memory_gb: bestFreeTotal / 1024,
      reason: `GPUs ${startGpuIndex}-${endGpuIndex} have most combined free memory (${(bestFreeTotal / 1024).toFixed(1)} GB)`,
    }
  }

  /**
   * Validate that requested GPUs exist and are valid for the given tensor parallel size.
   */
  async validateGpuSelection(
    gpuIds: number[],
    tensorParallelSize?: number
  ): Promise<GpuValidationResult> {
    if (gpuIds.length === 0) {
      return {
        valid: false,
        error: 'No GPUs specified',
        gpuIds: [],
      }
    }

    const nvidiaSmi = await getNvidiaSmiInfo()
    const availableIndices = new Set(nvidiaSmi.gpus.map((g) => g.index))

    // Check all requested GPUs exist
    for (const id of gpuIds) {
      if (!availableIndices.has(id)) {
        return {
          valid: false,
          error: `GPU ${id} not found. Available GPUs: ${Array.from(availableIndices).join(', ')}`,
          gpuIds: [],
        }
      }
    }

    // For tensor parallel, verify we have enough GPUs
    const effectiveTPSize = tensorParallelSize ?? 1
    if (effectiveTPSize > 1 && effectiveTPSize > gpuIds.length) {
      return {
        valid: false,
        error: `tensor_parallel_size=${effectiveTPSize} requires ${effectiveTPSize} GPUs but only ${gpuIds.length} selected`,
        gpuIds: [],
      }
    }

    // For tensor parallel with more GPUs selected than needed, use only the first N
    const effectiveGpuIds =
      effectiveTPSize > 1 ? gpuIds.slice(0, effectiveTPSize) : gpuIds.slice(0, 1)

    return { valid: true, gpuIds: effectiveGpuIds }
  }

  /**
   * Determine the target GPUs for model loading.
   * If gpuIds provided, validates and uses them.
   * Otherwise, auto-selects based on free memory.
   */
  async getTargetGpus(
    gpuIds?: number[],
    tensorParallelSize: number = 1
  ): Promise<{ gpuIds: number[]; wasAutoSelected: boolean }> {
    if (gpuIds && gpuIds.length > 0) {
      // Manual selection: validate
      const validation = await this.validateGpuSelection(gpuIds, tensorParallelSize)
      if (!validation.valid) {
        throw new Error(validation.error!)
      }
      return { gpuIds: validation.gpuIds, wasAutoSelected: false }
    }

    // Auto-select: get recommendation
    const recommendation = await this.getRecommendedGpu(tensorParallelSize)

    if (tensorParallelSize > 1) {
      // For tensor parallel, return contiguous GPUs starting from recommended
      const gpuIdArray = Array.from(
        { length: tensorParallelSize },
        (_, i) => recommendation.gpu_id + i
      )
      this.logger.info(
        { gpuIds: gpuIdArray, tensorParallelSize, reason: recommendation.reason },
        'Auto-selected GPUs for tensor parallel model'
      )
      return { gpuIds: gpuIdArray, wasAutoSelected: true }
    }

    // Single GPU
    this.logger.info(
      { gpuId: recommendation.gpu_id, reason: recommendation.reason },
      'Auto-selected GPU for model'
    )
    return { gpuIds: [recommendation.gpu_id], wasAutoSelected: true }
  }

  /**
   * Get all GPUs with availability info for UI display.
   */
  async getGpuAvailability(): Promise<GpuAvailabilityResponse> {
    const nvidiaSmi = await getNvidiaSmiInfo()
    const allModels = modelStore.getAll()

    // Count models per GPU
    const modelsPerGpu = new Map<number, number>()
    for (const model of allModels) {
      if (model.status === 'running' && model.gpuIds) {
        for (const gpuId of model.gpuIds) {
          modelsPerGpu.set(gpuId, (modelsPerGpu.get(gpuId) ?? 0) + 1)
        }
      }
    }

    const recommendation = await this.getRecommendedGpu()

    const gpus: GpuInfo[] = nvidiaSmi.gpus.map((gpu) => {
      const utilization = parseFloat(gpu.gpuUtilization.replace('%', '')) || 0
      return {
        index: gpu.index,
        name: gpu.name,
        memory_total_mb: gpu.memoryTotalMB,
        memory_used_mb: gpu.memoryUsedMB,
        memory_free_mb: gpu.memoryTotalMB - gpu.memoryUsedMB,
        utilization_percent: utilization,
        models_loaded: modelsPerGpu.get(gpu.index) ?? 0,
        recommended: gpu.index === recommendation.gpu_id,
      }
    })

    return {
      gpus,
      recommendation,
    }
  }

  /**
   * Check if target GPU(s) have sufficient free memory for a model.
   * Used for pre-flight validation before model move operations.
   *
   * @param gpuIds Target GPU indices
   * @param requiredMemoryGb Required memory per GPU in GB
   * @returns Object with availability status, actual free memory, and optional message
   */
  async checkMemoryAvailability(
    gpuIds: number[],
    requiredMemoryGb: number
  ): Promise<{ available: boolean; freeMemoryGb: number; message?: string }> {
    const nvidiaSmi = await getNvidiaSmiInfo()
    const gpuMap = new Map(nvidiaSmi.gpus.map((g) => [g.index, g]))

    let totalFreeMemory = 0
    const unavailableGpus: string[] = []

    for (const gpuId of gpuIds) {
      const gpu = gpuMap.get(gpuId)
      if (!gpu) {
        return {
          available: false,
          freeMemoryGb: 0,
          message: `GPU ${gpuId} not found`,
        }
      }

      const freeGb = (gpu.memoryTotalMB - gpu.memoryUsedMB) / 1024
      totalFreeMemory += freeGb

      if (freeGb < requiredMemoryGb) {
        unavailableGpus.push(
          `GPU ${gpuId}: ${freeGb.toFixed(1)} GB free, need ${requiredMemoryGb.toFixed(1)} GB`
        )
      }
    }

    if (unavailableGpus.length > 0) {
      return {
        available: false,
        freeMemoryGb: totalFreeMemory,
        message: `Insufficient memory: ${unavailableGpus.join('; ')}`,
      }
    }

    this.logger.debug(
      { gpuIds, requiredMemoryGb, totalFreeMemory },
      'Memory availability check passed'
    )

    return {
      available: true,
      freeMemoryGb: totalFreeMemory,
    }
  }

  /**
   * Check GPU memory availability with detailed information for error messages.
   * Used for model move operations where rich error context is needed.
   *
   * @param gpuIds Target GPU indices
   * @param requiredMemoryGb Required memory per GPU in GB
   * @param sourceInstance Source model instance (for memory breakdown in error)
   * @returns Detailed result with per-GPU breakdown and loaded models info
   */
  async checkMemoryAvailabilityDetailed(
    gpuIds: number[],
    requiredMemoryGb: number,
    sourceInstance?: ModelInstance
  ): Promise<{
    available: boolean
    freeMemoryGb: number
    message?: string
    details?: GpuMemoryErrorDetails
  }> {
    const nvidiaSmi = await getNvidiaSmiInfo()
    const gpuMap = new Map(nvidiaSmi.gpus.map((g) => [g.index, g]))
    const allModels = modelStore.getAll()

    let totalFreeMemory = 0
    const gpuDetails: GpuMemoryErrorDetails['gpus'] = []
    let hasInsufficientMemory = false

    for (const gpuId of gpuIds) {
      const gpu = gpuMap.get(gpuId)
      if (!gpu) {
        return {
          available: false,
          freeMemoryGb: 0,
          message: `GPU ${gpuId} not found`,
        }
      }

      const freeGb = (gpu.memoryTotalMB - gpu.memoryUsedMB) / 1024
      const totalGb = gpu.memoryTotalMB / 1024
      totalFreeMemory += freeGb

      // Find models loaded on this GPU (exclude the source model being moved)
      const modelsOnGpu = allModels
        .filter(
          (m) =>
            m.gpuIds.includes(gpuId) &&
            m.status === 'running' &&
            (!sourceInstance || m.id !== sourceInstance.id)
        )
        .map((m) => ({
          instanceId: m.id,
          modelName: m.modelName,
          memoryGb: m.memoryBaselineByGpu?.[gpuId] ?? m.memoryMetrics?.totalGpuMemoryGiB ?? 0,
        }))

      const shortfallGb = Math.max(0, requiredMemoryGb - freeGb)

      if (freeGb < requiredMemoryGb) {
        hasInsufficientMemory = true
      }

      gpuDetails.push({
        index: gpuId,
        name: gpu.name,
        totalGb,
        freeGb,
        requiredGb: requiredMemoryGb,
        shortfallGb,
        loadedModels: modelsOnGpu,
      })
    }

    if (hasInsufficientMemory) {
      // Build human-readable message with GPU names and shortfall
      const gpuMessages = gpuDetails
        .filter((g) => g.shortfallGb > 0)
        .map(
          (g) =>
            `GPU ${g.index} (${g.name}): ${g.freeGb.toFixed(1)} GB free, ` +
            `need ${g.requiredGb.toFixed(1)} GB (short ${g.shortfallGb.toFixed(1)} GB)`
        )

      // Build source model details if available
      let sourceModelDetails: GpuMemoryErrorDetails['sourceModel'] | undefined
      if (sourceInstance) {
        sourceModelDetails = {
          instanceId: sourceInstance.id,
          modelName: sourceInstance.modelName,
          weightsGb: sourceInstance.memoryMetrics?.weightsMemoryGiB,
          cudaGraphsGb: sourceInstance.memoryMetrics?.cudaGraphMemoryGiB,
          overheadGb: sourceInstance.memoryMetrics?.overheadMemoryGiB,
          totalGb: sourceInstance.memoryMetrics?.totalGpuMemoryGiB ?? requiredMemoryGb,
        }
      }

      return {
        available: false,
        freeMemoryGb: totalFreeMemory,
        message: `Insufficient GPU memory: ${gpuMessages.join('; ')}`,
        details: {
          gpus: gpuDetails,
          sourceModel: sourceModelDetails,
        },
      }
    }

    this.logger.debug(
      { gpuIds, requiredMemoryGb, totalFreeMemory },
      'Detailed memory availability check passed'
    )

    return {
      available: true,
      freeMemoryGb: totalFreeMemory,
    }
  }
}

// Singleton instance for easy access
let gpuSelectorInstance: GpuSelector | null = null

export function getGpuSelector(logger: Logger): GpuSelector {
  if (!gpuSelectorInstance) {
    gpuSelectorInstance = new GpuSelector(logger)
  }
  return gpuSelectorInstance
}
