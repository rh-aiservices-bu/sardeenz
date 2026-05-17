import { describe, it, expect, beforeEach } from 'vitest'
import { simGpuTracker } from '../../src/utils/sim-gpu-tracker.js'

describe('SimGpuTracker', () => {
  beforeEach(() => {
    simGpuTracker.reset()
  })

  describe('initialize', () => {
    it('should create correct number of GPUs with correct memory', () => {
      simGpuTracker.initialize(2, 24)
      const info = simGpuTracker.getGpuInfo()
      expect(info).toHaveLength(2)
      expect(info[0].index).toBe(0)
      expect(info[0].totalMemoryMB).toBe(24 * 1024)
      expect(info[0].totalMemoryGB).toBe(24)
      expect(info[1].index).toBe(1)
      expect(info[1].name).toContain('Simulated')
    })
  })

  describe('allocate', () => {
    beforeEach(() => {
      simGpuTracker.initialize(2, 24)
    })

    it('should update used memory correctly', () => {
      simGpuTracker.allocate(0, 'instance-1', 4096)
      const info = simGpuTracker.getNvidiaSmiInfo()
      expect(info.gpus[0].memoryUsedMB).toBe(4096)
      expect(info.gpus[1].memoryUsedMB).toBe(0)
    })

    it('should track multiple models on same GPU', () => {
      simGpuTracker.allocate(0, 'instance-1', 4096)
      simGpuTracker.allocate(0, 'instance-2', 2048)
      const info = simGpuTracker.getNvidiaSmiInfo()
      expect(info.gpus[0].memoryUsedMB).toBe(6144)
    })

    it('should throw when exceeding capacity', () => {
      const totalMB = 24 * 1024
      expect(() => {
        simGpuTracker.allocate(0, 'instance-1', totalMB + 1)
      }).toThrow(/Insufficient simulated GPU memory/)
    })

    it('should throw for non-existent GPU', () => {
      expect(() => {
        simGpuTracker.allocate(99, 'instance-1', 1024)
      }).toThrow(/GPU 99 not found/)
    })
  })

  describe('deallocate', () => {
    beforeEach(() => {
      simGpuTracker.initialize(2, 24)
    })

    it('should free memory correctly', () => {
      simGpuTracker.allocate(0, 'instance-1', 4096)
      simGpuTracker.deallocate('instance-1')
      const info = simGpuTracker.getNvidiaSmiInfo()
      expect(info.gpus[0].memoryUsedMB).toBe(0)
    })

    it('should remove from all GPUs', () => {
      simGpuTracker.allocate(0, 'instance-1', 4096)
      simGpuTracker.allocate(1, 'instance-1', 4096)
      simGpuTracker.deallocate('instance-1')
      const info = simGpuTracker.getNvidiaSmiInfo()
      expect(info.gpus[0].memoryUsedMB).toBe(0)
      expect(info.gpus[1].memoryUsedMB).toBe(0)
    })

    it('should be safe to deallocate non-existent instance', () => {
      expect(() => simGpuTracker.deallocate('nonexistent')).not.toThrow()
    })
  })

  describe('getGpuInfo', () => {
    it('should return GpuInfo[] with correct shape', () => {
      simGpuTracker.initialize(1, 16)
      const info = simGpuTracker.getGpuInfo()
      expect(info).toHaveLength(1)
      expect(info[0]).toEqual({
        index: 0,
        name: expect.stringContaining('Simulated'),
        totalMemoryMB: 16 * 1024,
        totalMemoryGB: 16,
      })
    })
  })

  describe('getNvidiaSmiInfo', () => {
    it('should return NvidiaSmiInfo with correct shape', () => {
      simGpuTracker.initialize(1, 24)
      const info = simGpuTracker.getNvidiaSmiInfo()
      expect(info.timestamp).toBeDefined()
      expect(info.driver).toBeDefined()
      expect(info.gpus).toHaveLength(1)
      expect(info.processes).toHaveLength(0)
    })

    it('should include processes for loaded models', () => {
      simGpuTracker.initialize(1, 24)
      simGpuTracker.allocate(0, 'test-instance', 8192)
      const info = simGpuTracker.getNvidiaSmiInfo()
      expect(info.processes).toHaveLength(1)
      expect(info.processes[0].gpu).toBe(0)
      expect(info.processes[0].gpuMemoryMB).toBe(8192)
    })
  })

  describe('getAvailableMemoryMB', () => {
    it('should return correct available memory', () => {
      simGpuTracker.initialize(1, 24)
      expect(simGpuTracker.getAvailableMemoryMB(0)).toBe(24 * 1024)
      simGpuTracker.allocate(0, 'instance-1', 4096)
      expect(simGpuTracker.getAvailableMemoryMB(0)).toBe(24 * 1024 - 4096)
    })

    it('should throw for non-existent GPU', () => {
      simGpuTracker.initialize(1, 24)
      expect(() => simGpuTracker.getAvailableMemoryMB(5)).toThrow(/GPU 5 not found/)
    })
  })

  describe('reset', () => {
    it('should clear all state', () => {
      simGpuTracker.initialize(2, 24)
      simGpuTracker.allocate(0, 'instance-1', 4096)
      simGpuTracker.reset()
      expect(simGpuTracker.getGpuInfo()).toHaveLength(0)
    })
  })
})
