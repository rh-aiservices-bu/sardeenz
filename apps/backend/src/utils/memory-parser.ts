/**
 * Utility for extracting GPU memory information from vLLM process output
 */

import type { LogEntry } from '../services/process-log-buffer.js'

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
export function calculateGpuUtilization(
  memoryInfo: VllmMemoryInfo,
  gpuTotalGB: number
): number {
  const usedGB = calculateGpuMemoryUsed(memoryInfo)

  if (gpuTotalGB <= 0) {
    return 0
  }

  // Clamp to 0.0 - 1.0 range
  return Math.min(1.0, Math.max(0.0, usedGB / gpuTotalGB))
}
