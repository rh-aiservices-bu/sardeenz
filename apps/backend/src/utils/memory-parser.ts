/**
 * Utility for extracting GPU memory information from vLLM process output
 */

import type { LogEntry } from '../services/process-log-buffer.js'
import type { ModelMemoryMetrics } from '@sardeenz/types'

/**
 * Memory information extracted from vLLM logs
 */
export interface VllmMemoryInfo {
  /** Model weights size in GiB (from "Model loading took X.XX GiB") */
  modelWeightsGB?: number
  /** CUDA graphs size in GiB (from "Graph capturing... took X.XX GiB") */
  cudaGraphsGB?: number
  /** Available KV cache memory in GiB (from "Available KV cache memory: X.XX GiB") */
  kvCacheAvailableGB?: number
  /** Total GPU memory from warning (from "Free memory on device (X/Y GiB)") */
  gpuTotalFromLogGB?: number
}

/**
 * Regex patterns for extracting memory information from vLLM logs
 */
const MEMORY_PATTERNS = {
  // "Model loading took 1.1201 GiB and 0.760489 seconds"
  modelLoading: /Model loading took ([\d.]+) GiB/,

  // "Graph capturing finished in 4 secs, took 0.55 GiB"
  cudaGraphs: /Graph capturing finished.*took ([\d.]+) GiB/,

  // "Available KV cache memory: 4.34 GiB"
  kvCacheAvailable: /Available KV cache memory: ([\d.]+) GiB/,

  // "Free memory on device (6.53/7.62 GiB)" - from kvcached warning
  gpuTotal: /Free memory on device \([\d.]+\/([\d.]+) GiB\)/,

  // "GPU KV cache size: 284,928 tokens"
  kvCacheTotalTokens: /GPU KV cache size: ([\d,]+) tokens/,

  // "Using max model len 4096"
  maxModelLen: /Using max model len (\d+)/,
}

/**
 * Regex patterns for extracting process IDs from vLLM logs
 */
const PID_PATTERNS = {
  // "EngineCore_DP0 pid=76355" - the process that allocates GPU VRAM
  engineCore: /EngineCore_DP\d+ pid=(\d+)/,

  // "APIServer pid=76195" - the main API server process (for reference)
  apiServer: /APIServer pid=(\d+)/,
}

/**
 * Extract GPU memory information from vLLM process logs
 *
 * @param logs - Array of log entries from ProcessLogBuffer
 * @returns VllmMemoryInfo with extracted values, or null if no memory info found
 */
export function extractVllmMemoryInfo(logs: LogEntry[]): VllmMemoryInfo | null {
  const result: VllmMemoryInfo = {}
  let foundAny = false

  // Process all log lines
  for (const entry of logs) {
    const content = entry.content

    // Model loading size
    if (result.modelWeightsGB === undefined) {
      const modelMatch = content.match(MEMORY_PATTERNS.modelLoading)
      if (modelMatch) {
        result.modelWeightsGB = parseFloat(modelMatch[1])
        foundAny = true
      }
    }

    // CUDA graphs size
    if (result.cudaGraphsGB === undefined) {
      const graphsMatch = content.match(MEMORY_PATTERNS.cudaGraphs)
      if (graphsMatch) {
        result.cudaGraphsGB = parseFloat(graphsMatch[1])
        foundAny = true
      }
    }

    // KV cache available
    if (result.kvCacheAvailableGB === undefined) {
      const kvMatch = content.match(MEMORY_PATTERNS.kvCacheAvailable)
      if (kvMatch) {
        result.kvCacheAvailableGB = parseFloat(kvMatch[1])
        foundAny = true
      }
    }

    // GPU total from warning
    if (result.gpuTotalFromLogGB === undefined) {
      const gpuMatch = content.match(MEMORY_PATTERNS.gpuTotal)
      if (gpuMatch) {
        result.gpuTotalFromLogGB = parseFloat(gpuMatch[1])
        foundAny = true
      }
    }

    // Exit early if we found all values
    if (
      result.modelWeightsGB !== undefined &&
      result.cudaGraphsGB !== undefined &&
      result.kvCacheAvailableGB !== undefined &&
      result.gpuTotalFromLogGB !== undefined
    ) {
      break
    }
  }

  return foundAny ? result : null
}

/**
 * Calculate total GPU memory used by a model based on extracted memory info
 *
 * @param memoryInfo - Memory info extracted from vLLM logs
 * @returns Total GPU memory used in GiB
 */
export function calculateGpuMemoryUsed(memoryInfo: VllmMemoryInfo): number {
  const modelWeights = memoryInfo.modelWeightsGB ?? 0
  const cudaGraphs = memoryInfo.cudaGraphsGB ?? 0

  return modelWeights + cudaGraphs
}

/**
 * Calculate GPU memory utilization percentage
 *
 * @param memoryInfo - Memory info extracted from vLLM logs
 * @param gpuTotalGB - Total GPU memory in GiB
 * @returns GPU memory utilization as a decimal (0.0 to 1.0)
 */
export function calculateGpuUtilization(memoryInfo: VllmMemoryInfo, gpuTotalGB: number): number {
  const usedGB = calculateGpuMemoryUsed(memoryInfo)

  if (gpuTotalGB <= 0) {
    return 0
  }

  // Clamp to 0.0 - 1.0 range
  return Math.min(1.0, Math.max(0.0, usedGB / gpuTotalGB))
}

/**
 * Parse memory metrics from vLLM process logs into ModelMemoryMetrics format
 *
 * @param logs - Array of log entries from the process buffer
 * @param fallbackMaxTokens - Fallback max tokens value if not found in logs
 * @param actualGpuMemoryGiB - Actual GPU memory from NVML (optional, used for total and overhead)
 * @returns Parsed memory metrics or null if insufficient data
 */
export function parseMemoryMetrics(
  logs: LogEntry[],
  fallbackMaxTokens: number,
  actualGpuMemoryGiB?: number
): ModelMemoryMetrics | null {
  let weightsMemoryGiB: number | undefined
  let cudaGraphMemoryGiB: number | undefined
  let kvCacheAvailableGiB: number | undefined
  let kvCacheTotalTokens: number | undefined
  let maxModelLen: number | undefined

  // Process all log lines to find metrics
  for (const entry of logs) {
    const content = entry.content

    // Model weights
    if (weightsMemoryGiB === undefined) {
      const match = content.match(MEMORY_PATTERNS.modelLoading)
      if (match) {
        weightsMemoryGiB = parseFloat(match[1])
      }
    }

    // CUDA graphs
    if (cudaGraphMemoryGiB === undefined) {
      const match = content.match(MEMORY_PATTERNS.cudaGraphs)
      if (match) {
        cudaGraphMemoryGiB = parseFloat(match[1])
      }
    }

    // KV cache available
    if (kvCacheAvailableGiB === undefined) {
      const match = content.match(MEMORY_PATTERNS.kvCacheAvailable)
      if (match) {
        kvCacheAvailableGiB = parseFloat(match[1])
      }
    }

    // KV cache total tokens
    if (kvCacheTotalTokens === undefined) {
      const match = content.match(MEMORY_PATTERNS.kvCacheTotalTokens)
      if (match) {
        kvCacheTotalTokens = parseInt(match[1].replace(/,/g, ''), 10)
      }
    }

    // Max model len
    if (maxModelLen === undefined) {
      const match = content.match(MEMORY_PATTERNS.maxModelLen)
      if (match) {
        maxModelLen = parseInt(match[1], 10)
      }
    }
  }

  // Check if we have the minimum required metrics
  if (
    weightsMemoryGiB === undefined ||
    cudaGraphMemoryGiB === undefined ||
    kvCacheAvailableGiB === undefined
  ) {
    // Missing critical metrics
    return null
  }

  // Use fallback for maxModelLen if not found in logs
  const finalMaxModelLen = maxModelLen ?? fallbackMaxTokens

  // Calculate KV cache per request
  // Formula: (kvCacheAvailableGiB * 1024) / kvCacheTotalTokens * maxModelLen
  let kvCachePerRequestMiB = 0

  if (kvCacheTotalTokens && kvCacheTotalTokens > 0) {
    const kvCacheAvailableMiB = kvCacheAvailableGiB * 1024
    const perTokenMiB = kvCacheAvailableMiB / kvCacheTotalTokens
    kvCachePerRequestMiB = perTokenMiB * finalMaxModelLen
  }

  // Calculate total and overhead
  // If actualGpuMemoryGiB is provided (from NVML), use it as the source of truth
  // Otherwise, fallback to sum of weights + CUDA graphs (underestimate)
  const totalGpuMemoryGiB = actualGpuMemoryGiB ?? weightsMemoryGiB + cudaGraphMemoryGiB
  const overheadMemoryGiB =
    actualGpuMemoryGiB !== undefined
      ? Math.max(0, actualGpuMemoryGiB - weightsMemoryGiB - cudaGraphMemoryGiB)
      : 0

  return {
    totalGpuMemoryGiB: Math.round(totalGpuMemoryGiB * 1000) / 1000, // Round to 3 decimals
    weightsMemoryGiB,
    cudaGraphMemoryGiB,
    overheadMemoryGiB: Math.round(overheadMemoryGiB * 1000) / 1000, // Round to 3 decimals
    kvCacheAvailableGiB,
    kvCachePerRequestMiB: Math.round(kvCachePerRequestMiB * 100) / 100, // Round to 2 decimals
    maxModelLen: finalMaxModelLen,
  }
}

/**
 * Extract EngineCore process ID from vLLM logs
 *
 * vLLM logs the EngineCore PID during startup with format: "EngineCore_DP0 pid=76355"
 * The EngineCore process is the one that actually allocates GPU VRAM, not the API server.
 *
 * @param logs - Array of log entries from ProcessLogBuffer
 * @returns EngineCore PID if found, null otherwise
 */
export function extractEngineCorePid(logs: LogEntry[]): number | null {
  for (const entry of logs) {
    const match = entry.content.match(PID_PATTERNS.engineCore)
    if (match) {
      const pid = parseInt(match[1], 10)
      if (!isNaN(pid)) {
        return pid
      }
    }
  }
  return null
}
