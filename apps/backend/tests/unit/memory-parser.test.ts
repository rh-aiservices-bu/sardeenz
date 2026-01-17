import { describe, it, expect } from 'vitest'
import {
  extractVllmMemoryInfo,
  calculateGpuMemoryUsed,
  calculateGpuUtilization,
  type VllmMemoryInfo,
} from '../../src/utils/memory-parser.js'
import type { LogEntry } from '../../src/services/process-log-buffer.js'

// Helper to create log entries
function createLogEntry(content: string, stream: 'stdout' | 'stderr' = 'stdout'): LogEntry {
  return {
    timestamp: new Date(),
    stream,
    content,
  }
}

describe('memory-parser utility', () => {
  describe('extractVllmMemoryInfo', () => {
    it('should extract model loading size from logs', () => {
      const logs: LogEntry[] = [
        createLogEntry(
          'INFO 11-26 17:29:24 [gpu_model_runner.py:2602] Starting to load model Qwen/Qwen3-0.6B...'
        ),
        createLogEntry(
          'INFO 11-26 17:29:25 [default_loader.py:267] Loading weights took 0.40 seconds'
        ),
        createLogEntry(
          'INFO 11-26 17:29:26 [gpu_model_runner.py:2653] Model loading took 1.1201 GiB and 0.760489 seconds'
        ),
      ]

      const result = extractVllmMemoryInfo(logs)

      expect(result).not.toBeNull()
      expect(result?.modelWeightsGB).toBeCloseTo(1.1201, 4)
    })

    it('should extract CUDA graphs size from logs', () => {
      const logs: LogEntry[] = [
        createLogEntry(
          'Capturing CUDA graphs (decode, FULL): 100%|██████████| 35/35 [00:01<00:00, 24.62it/s]',
          'stderr'
        ),
        createLogEntry(
          'INFO 11-26 17:29:40 [gpu_model_runner.py:3480] Graph capturing finished in 4 secs, took 0.55 GiB'
        ),
      ]

      const result = extractVllmMemoryInfo(logs)

      expect(result).not.toBeNull()
      expect(result?.cudaGraphsGB).toBeCloseTo(0.55, 2)
    })

    it('should extract KV cache available memory from logs', () => {
      const logs: LogEntry[] = [
        createLogEntry(
          'INFO 11-26 17:29:35 [gpu_worker.py:298] Available KV cache memory: 4.34 GiB'
        ),
      ]

      const result = extractVllmMemoryInfo(logs)

      expect(result).not.toBeNull()
      expect(result?.kvCacheAvailableGB).toBeCloseTo(4.34, 2)
    })

    it('should extract GPU total from free memory warning', () => {
      const logs: LogEntry[] = [
        createLogEntry(
          '[kvcached][WARNING][2025-11-26 17:29:24][patches.py:749] Ignoring GPU free-memory check: Free memory on device (6.53/7.62 GiB) on startup is less than desired GPU memory utilization (0.9, 6.86 GiB).',
          'stderr'
        ),
      ]

      const result = extractVllmMemoryInfo(logs)

      expect(result).not.toBeNull()
      expect(result?.gpuTotalFromLogGB).toBeCloseTo(7.62, 2)
    })

    it('should extract all memory info from real vLLM logs', () => {
      // Real log entries from a Qwen/Qwen3-0.6B load
      const logs: LogEntry[] = [
        createLogEntry(
          '[kvcached][INFO][2025-11-26 17:29:11][patch_base.py:98] Applying 6 patches for vllm',
          'stderr'
        ),
        createLogEntry(
          'INFO 11-26 17:29:12 [__init__.py:216] Automatically detected platform cuda.'
        ),
        createLogEntry(
          '[kvcached][WARNING][2025-11-26 17:29:24][patches.py:749] Ignoring GPU free-memory check: Free memory on device (6.53/7.62 GiB) on startup is less than desired GPU memory utilization (0.9, 6.86 GiB).',
          'stderr'
        ),
        createLogEntry(
          'INFO 11-26 17:29:24 [gpu_model_runner.py:2602] Starting to load model Qwen/Qwen3-0.6B...'
        ),
        createLogEntry(
          'INFO 11-26 17:29:25 [default_loader.py:267] Loading weights took 0.40 seconds'
        ),
        createLogEntry(
          'INFO 11-26 17:29:26 [gpu_model_runner.py:2653] Model loading took 1.1201 GiB and 0.760489 seconds'
        ),
        createLogEntry(
          'INFO 11-26 17:29:35 [gpu_worker.py:298] Available KV cache memory: 4.34 GiB'
        ),
        createLogEntry(
          'INFO 11-26 17:29:40 [gpu_model_runner.py:3480] Graph capturing finished in 4 secs, took 0.55 GiB'
        ),
      ]

      const result = extractVllmMemoryInfo(logs)

      expect(result).not.toBeNull()
      expect(result?.modelWeightsGB).toBeCloseTo(1.1201, 4)
      expect(result?.cudaGraphsGB).toBeCloseTo(0.55, 2)
      expect(result?.kvCacheAvailableGB).toBeCloseTo(4.34, 2)
      expect(result?.gpuTotalFromLogGB).toBeCloseTo(7.62, 2)
    })

    it('should return null when no memory info found', () => {
      const logs: LogEntry[] = [
        createLogEntry('INFO: Server started'),
        createLogEntry('INFO: Request received'),
      ]

      const result = extractVllmMemoryInfo(logs)

      expect(result).toBeNull()
    })

    it('should return partial info when only some patterns match', () => {
      const logs: LogEntry[] = [
        createLogEntry(
          'INFO 11-26 17:29:26 [gpu_model_runner.py:2653] Model loading took 2.5 GiB and 1.0 seconds'
        ),
        createLogEntry('INFO: No other memory info'),
      ]

      const result = extractVllmMemoryInfo(logs)

      expect(result).not.toBeNull()
      expect(result?.modelWeightsGB).toBeCloseTo(2.5, 1)
      expect(result?.cudaGraphsGB).toBeUndefined()
      expect(result?.kvCacheAvailableGB).toBeUndefined()
    })

    it('should handle empty log array', () => {
      const result = extractVllmMemoryInfo([])
      expect(result).toBeNull()
    })
  })

  describe('calculateGpuMemoryUsed', () => {
    it('should calculate total memory from weights and graphs', () => {
      const memoryInfo: VllmMemoryInfo = {
        modelWeightsGB: 1.1201,
        cudaGraphsGB: 0.55,
        kvCacheAvailableGB: 4.34,
      }

      const used = calculateGpuMemoryUsed(memoryInfo)

      expect(used).toBeCloseTo(1.6701, 4)
    })

    it('should handle missing values', () => {
      const memoryInfo: VllmMemoryInfo = {
        modelWeightsGB: 2.0,
      }

      const used = calculateGpuMemoryUsed(memoryInfo)

      expect(used).toBeCloseTo(2.0, 1)
    })

    it('should return 0 when no values present', () => {
      const memoryInfo: VllmMemoryInfo = {}

      const used = calculateGpuMemoryUsed(memoryInfo)

      expect(used).toBe(0)
    })
  })

  describe('calculateGpuUtilization', () => {
    it('should calculate utilization percentage correctly', () => {
      const memoryInfo: VllmMemoryInfo = {
        modelWeightsGB: 1.1201,
        cudaGraphsGB: 0.55,
      }

      // With 8GB GPU: (1.1201 + 0.55) / 8 = 0.208
      const utilization = calculateGpuUtilization(memoryInfo, 8.0)

      expect(utilization).toBeCloseTo(0.208, 2)
    })

    it('should clamp to 1.0 when over 100%', () => {
      const memoryInfo: VllmMemoryInfo = {
        modelWeightsGB: 10.0,
        cudaGraphsGB: 5.0,
      }

      // With 8GB GPU: should clamp to 1.0
      const utilization = calculateGpuUtilization(memoryInfo, 8.0)

      expect(utilization).toBe(1.0)
    })

    it('should return 0 when GPU total is 0', () => {
      const memoryInfo: VllmMemoryInfo = {
        modelWeightsGB: 1.0,
      }

      const utilization = calculateGpuUtilization(memoryInfo, 0)

      expect(utilization).toBe(0)
    })

    it('should return 0 when no memory used', () => {
      const memoryInfo: VllmMemoryInfo = {}

      const utilization = calculateGpuUtilization(memoryInfo, 24.0)

      expect(utilization).toBe(0)
    })

    it('should calculate realistic utilization for Qwen 0.6B on 8GB GPU', () => {
      const memoryInfo: VllmMemoryInfo = {
        modelWeightsGB: 1.1201,
        cudaGraphsGB: 0.55,
        kvCacheAvailableGB: 4.34,
        gpuTotalFromLogGB: 7.62,
      }

      // (1.1201 + 0.55) / 7.62 = 0.219
      const utilization = calculateGpuUtilization(memoryInfo, 7.62)

      expect(utilization).toBeCloseTo(0.219, 2)
    })
  })
})
