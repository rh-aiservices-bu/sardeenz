import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { simGpuTracker } from '../../src/utils/sim-gpu-tracker.js'
import { estimateModelMemory } from '../../src/utils/model-memory-estimator.js'

const hasInferenceSimBinary = (() => {
  try {
    execSync('which llm-d-inference-sim', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasInferenceSimBinary)(
  'Inference-sim model lifecycle (requires llm-d-inference-sim in PATH)',
  () => {
    beforeEach(() => {
      simGpuTracker.reset()
      simGpuTracker.initialize(2, 24)
    })

    afterEach(() => {
      simGpuTracker.reset()
    })

    it('should simulate full load → allocate → deallocate cycle', () => {
      const modelPath = 'meta-llama/Llama-3.2-7B-Instruct'
      const instanceId = 'test-instance-001'

      // Estimate memory
      const estimate = estimateModelMemory(modelPath, 4)
      expect(estimate.detectedSizeB).toBe(7)
      expect(estimate.estimatedMemoryGB).toBe(14)

      // Allocate on GPU 0
      const memoryMB = estimate.estimatedMemoryGB * 1024
      simGpuTracker.allocate(0, instanceId, memoryMB)

      // Verify GPU info reflects allocation
      const gpuInfo = simGpuTracker.getGpuInfo()
      expect(gpuInfo).toHaveLength(2)

      const smiInfo = simGpuTracker.getNvidiaSmiInfo()
      expect(smiInfo.gpus[0].memoryUsedMB).toBe(memoryMB)
      expect(smiInfo.gpus[1].memoryUsedMB).toBe(0)
      expect(smiInfo.processes).toHaveLength(1)
      expect(smiInfo.processes[0].gpuMemoryMB).toBe(memoryMB)

      // Verify available memory decreased
      expect(simGpuTracker.getAvailableMemoryMB(0)).toBe(24 * 1024 - memoryMB)

      // Deallocate
      simGpuTracker.deallocate(instanceId)
      const afterDeallocate = simGpuTracker.getNvidiaSmiInfo()
      expect(afterDeallocate.gpus[0].memoryUsedMB).toBe(0)
      expect(afterDeallocate.processes).toHaveLength(0)
    })

    it('should reject allocation exceeding GPU capacity', () => {
      const modelPath = 'meta-llama/Llama-3.1-70B-Instruct'
      const estimate = estimateModelMemory(modelPath, 4)

      // 70B model → 37 GB, but GPU only has 24 GB
      expect(estimate.estimatedMemoryGB).toBe(37)

      expect(() => {
        simGpuTracker.allocate(0, 'too-big', estimate.estimatedMemoryGB * 1024)
      }).toThrow(/Insufficient simulated GPU memory/)
    })

    it('should support multiple models on same GPU', () => {
      // Load two small models
      const est1 = estimateModelMemory('Qwen/Qwen3-0.6B', 4)
      const est2 = estimateModelMemory('microsoft/phi-3-mini-4k-instruct', 4)

      simGpuTracker.allocate(0, 'model-1', est1.estimatedMemoryGB * 1024)
      simGpuTracker.allocate(0, 'model-2', est2.estimatedMemoryGB * 1024)

      const smi = simGpuTracker.getNvidiaSmiInfo()
      expect(smi.gpus[0].memoryUsedMB).toBe(
        (est1.estimatedMemoryGB + est2.estimatedMemoryGB) * 1024
      )
      expect(smi.processes).toHaveLength(2)

      // Deallocate one
      simGpuTracker.deallocate('model-1')
      const after = simGpuTracker.getNvidiaSmiInfo()
      expect(after.gpus[0].memoryUsedMB).toBe(est2.estimatedMemoryGB * 1024)
      expect(after.processes).toHaveLength(1)
    })
  }
)
