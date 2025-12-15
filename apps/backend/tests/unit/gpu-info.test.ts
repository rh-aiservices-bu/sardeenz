import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { exec } from 'child_process'
import { promisify } from 'util'

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

// Dynamic import to test module after mocking
const loadModule = async () => {
  // Reset module cache to get fresh instance with mocks
  vi.resetModules()
  return import('../../src/utils/gpu-info.js')
}

describe('gpu-info utility', () => {
  const mockExec = exec as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Reset the cache after each test
    const module = await loadModule()
    module.resetGpuInfoCache()
  })

  describe('detectGpuInfo', () => {
    it('should parse nvidia-smi output correctly', async () => {
      // Mock nvidia-smi output
      mockExec.mockImplementation((_cmd: string, _opts: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback(null, { stdout: '0, NVIDIA GeForce RTX 3080, 10240\n' })
        }
        return { stdout: '', stderr: '' }
      })

      const module = await loadModule()
      const gpus = await module.detectGpuInfo()

      expect(gpus).toHaveLength(1)
      expect(gpus[0]).toEqual({
        index: 0,
        name: 'NVIDIA GeForce RTX 3080',
        totalMemoryMB: 10240,
        totalMemoryGB: 10,
      })
    })

    it('should parse multiple GPUs', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback(null, {
            stdout: '0, NVIDIA GeForce RTX 3090, 24576\n1, NVIDIA GeForce RTX 3080, 10240\n',
          })
        }
        return { stdout: '', stderr: '' }
      })

      const module = await loadModule()
      const gpus = await module.detectGpuInfo()

      expect(gpus).toHaveLength(2)
      expect(gpus[0].name).toBe('NVIDIA GeForce RTX 3090')
      expect(gpus[0].totalMemoryGB).toBe(24)
      expect(gpus[1].name).toBe('NVIDIA GeForce RTX 3080')
      expect(gpus[1].totalMemoryGB).toBe(10)
    })

    it('should return empty array when nvidia-smi fails', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback(new Error('nvidia-smi not found'), null)
        }
        return { stdout: '', stderr: '' }
      })

      const module = await loadModule()
      const gpus = await module.detectGpuInfo()

      expect(gpus).toEqual([])
    })

    it('should cache results after first call', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback(null, { stdout: '0, NVIDIA Tesla V100, 16384\n' })
        }
        return { stdout: '', stderr: '' }
      })

      const module = await loadModule()

      // First call
      const gpus1 = await module.detectGpuInfo()
      expect(gpus1).toHaveLength(1)

      // Second call should use cache
      const gpus2 = await module.detectGpuInfo()
      expect(gpus2).toHaveLength(1)
      expect(gpus1).toBe(gpus2) // Same reference

      // exec should only be called once due to caching
      expect(mockExec).toHaveBeenCalledTimes(1)
    })
  })

  describe('getPrimaryGpuInfo', () => {
    it('should return first GPU when available', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback(null, {
            stdout: '0, NVIDIA GeForce RTX 3090, 24576\n1, NVIDIA GeForce RTX 3080, 10240\n',
          })
        }
        return { stdout: '', stderr: '' }
      })

      const module = await loadModule()
      const gpu = await module.getPrimaryGpuInfo()

      expect(gpu.index).toBe(0)
      expect(gpu.name).toBe('NVIDIA GeForce RTX 3090')
      expect(gpu.totalMemoryGB).toBe(24)
    })

    it('should return default values when no GPU detected', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback(new Error('nvidia-smi not found'), null)
        }
        return { stdout: '', stderr: '' }
      })

      const module = await loadModule()
      const gpu = await module.getPrimaryGpuInfo()

      expect(gpu.index).toBe(0)
      expect(gpu.name).toBe('Unknown GPU')
      expect(gpu.totalMemoryGB).toBe(24) // Default fallback
    })
  })

  describe('getCachedPrimaryGpuInfo', () => {
    it('should return default when not initialized', async () => {
      const module = await loadModule()
      module.resetGpuInfoCache()

      const gpu = module.getCachedPrimaryGpuInfo()

      expect(gpu.name).toBe('Unknown GPU')
      expect(gpu.totalMemoryGB).toBe(24)
    })

    it('should return cached GPU after initialization', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback(null, { stdout: '0, NVIDIA A100, 40960\n' })
        }
        return { stdout: '', stderr: '' }
      })

      const module = await loadModule()

      // Initialize cache
      await module.detectGpuInfo()

      // Get cached
      const gpu = module.getCachedPrimaryGpuInfo()

      expect(gpu.name).toBe('NVIDIA A100')
      expect(gpu.totalMemoryGB).toBe(40)
    })
  })
})
