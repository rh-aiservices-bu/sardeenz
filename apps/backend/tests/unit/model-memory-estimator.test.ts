import { describe, it, expect } from 'vitest'
import { estimateModelMemory } from '../../src/utils/model-memory-estimator.js'

describe('ModelMemoryEstimator', () => {
  describe('size detection from model name', () => {
    it('should detect 7B model → 14 GB (fp16)', () => {
      const result = estimateModelMemory('meta-llama/Llama-3.2-7B-Instruct', 4)
      expect(result.detectedSizeB).toBe(7)
      expect(result.estimatedMemoryGB).toBe(14)
      expect(result.source).toBe('name-detection')
    })

    it('should detect 1.5B model → 3 GB (fp16)', () => {
      const result = estimateModelMemory('Qwen/Qwen2.5-1.5B-Instruct', 4)
      expect(result.detectedSizeB).toBe(1.5)
      expect(result.estimatedMemoryGB).toBe(3)
      expect(result.source).toBe('name-detection')
    })

    it('should detect 70B model → 37 GB (quantized)', () => {
      const result = estimateModelMemory('meta-llama/Llama-3.1-70B-Instruct', 4)
      expect(result.detectedSizeB).toBe(70)
      expect(result.estimatedMemoryGB).toBe(37)
      expect(result.source).toBe('name-detection')
    })

    it('should detect 72b model (lowercase) → 38 GB (quantized)', () => {
      const result = estimateModelMemory('qwen2.5-72b-instruct', 4)
      expect(result.detectedSizeB).toBe(72)
      expect(result.estimatedMemoryGB).toBe(38)
      expect(result.source).toBe('name-detection')
    })

    it('should detect 30B model as fp16 boundary → 60 GB', () => {
      const result = estimateModelMemory('some-model-30B', 4)
      expect(result.detectedSizeB).toBe(30)
      expect(result.estimatedMemoryGB).toBe(60)
      expect(result.source).toBe('name-detection')
    })

    it('should detect 32B model as quantized → 18 GB', () => {
      const result = estimateModelMemory('some-model-32B-Instruct', 4)
      expect(result.detectedSizeB).toBe(32)
      expect(result.estimatedMemoryGB).toBe(18)
      expect(result.source).toBe('name-detection')
    })
  })

  describe('fallback to default', () => {
    it('should use default when no size indicator found', () => {
      const result = estimateModelMemory('my-custom-model', 4)
      expect(result.detectedSizeB).toBeNull()
      expect(result.estimatedMemoryGB).toBe(4)
      expect(result.source).toBe('default')
    })

    it('should use provided default value', () => {
      const result = estimateModelMemory('custom-model', 8)
      expect(result.estimatedMemoryGB).toBe(8)
      expect(result.source).toBe('default')
    })
  })

  describe('regex edge cases', () => {
    it('should handle model path with org prefix', () => {
      const result = estimateModelMemory('meta-llama/Llama-3.2-7B-Instruct', 4)
      expect(result.detectedSizeB).toBe(7)
    })

    it('should handle decimal sizes like 0.6B', () => {
      const result = estimateModelMemory('Qwen/Qwen3-0.6B', 4)
      expect(result.detectedSizeB).toBe(0.6)
      expect(result.estimatedMemoryGB).toBeCloseTo(1.2)
    })

    it('should not match numbers not followed by B', () => {
      const result = estimateModelMemory('model-v3.2-instruct', 4)
      expect(result.detectedSizeB).toBeNull()
      expect(result.source).toBe('default')
    })

    it('should preserve modelPath in result', () => {
      const path = 'meta-llama/Llama-3.2-7B-Instruct'
      const result = estimateModelMemory(path, 4)
      expect(result.modelPath).toBe(path)
    })
  })
})
