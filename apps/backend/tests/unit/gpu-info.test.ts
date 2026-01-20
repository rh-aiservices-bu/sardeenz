import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Create mock device factory
const createMockDevice = (
  index: number,
  name: string,
  totalMemoryBytes: bigint
): {
  index: number
  getName: () => { ok: true; value: string }
  getMemoryInfo: () => { ok: true; value: { total: bigint; used: bigint; free: bigint } }
  getStatus: () => { ok: true; value: Record<string, unknown> }
  getProcesses: () => { ok: true; value: unknown[] }
  getPciInfo: () => { ok: true; value: { busId: string } }
  getEccErrorsCorrected: () => { ok: true; value: null }
} => ({
  index,
  getName: () => ({ ok: true, value: name }),
  getMemoryInfo: () => ({
    ok: true,
    value: { total: totalMemoryBytes, used: BigInt(0), free: totalMemoryBytes },
  }),
  getStatus: () => ({
    ok: true,
    value: {
      index,
      name,
      persistenceMode: false,
      pciBusId: '0000:00:1E.0',
      displayActive: false,
      eccErrorsCorrected: null,
      fanSpeed: 50,
      temperature: 45,
      pstate: 0, // P0
      powerDraw: 150,
      powerLimit: 350,
      memoryUsedMiB: 1024,
      memoryTotalMiB: Number(totalMemoryBytes / BigInt(1024 * 1024)),
      utilizationGpu: 30,
      utilizationMemory: 20,
      computeMode: 0, // DEFAULT
      migMode: null,
    },
  }),
  getProcesses: () => ({ ok: true, value: [] }),
  getPciInfo: () => ({ ok: true, value: { busId: '0000:00:1E.0' } }),
  getEccErrorsCorrected: () => ({ ok: true, value: null }),
})

// Mock @rh-ai-bu/ts-nvml module
let mockIsInitialized = false
let mockDevices: ReturnType<typeof createMockDevice>[] = []

vi.mock('@rh-ai-bu/ts-nvml', () => ({
  Nvml: {
    init: vi.fn(() => {
      mockIsInitialized = true
    }),
    shutdown: vi.fn(() => {
      mockIsInitialized = false
    }),
    isInitialized: vi.fn(() => mockIsInitialized),
    getAllDevices: vi.fn(() => mockDevices),
    getDriverInfo: vi.fn(() => ({
      ok: true,
      value: {
        driverVersion: '535.154.05',
        nvmlVersion: '12.535.154.05',
        cudaVersion: '12.2',
      },
    })),
  },
  unwrapOr: vi.fn(<T>(result: { ok: boolean; value?: T }, defaultValue: T): T => {
    if (result && result.ok && result.value !== undefined) {
      return result.value
    }
    return defaultValue
  }),
  NvmlComputeMode: {
    0: 'DEFAULT',
    1: 'EXCLUSIVE_THREAD',
    2: 'PROHIBITED',
    3: 'EXCLUSIVE_PROCESS',
    DEFAULT: 0,
    EXCLUSIVE_THREAD: 1,
    PROHIBITED: 2,
    EXCLUSIVE_PROCESS: 3,
  },
  NvmlPState: {
    0: 'P0',
    1: 'P1',
    2: 'P2',
    3: 'P3',
    4: 'P4',
    5: 'P5',
    6: 'P6',
    7: 'P7',
    8: 'P8',
    9: 'P9',
    10: 'P10',
    11: 'P11',
    12: 'P12',
    15: 'P15',
    32: 'UNKNOWN',
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4,
    P5: 5,
    P6: 6,
    P7: 7,
    P8: 8,
    P9: 9,
    P10: 10,
    P11: 11,
    P12: 12,
    P15: 15,
    UNKNOWN: 32,
  },
}))

// Dynamic import to test module after mocking
const loadModule = async () => {
  // Reset module cache to get fresh instance with mocks
  vi.resetModules()
  // Re-apply mock after reset
  vi.mock('@rh-ai-bu/ts-nvml', () => ({
    Nvml: {
      init: vi.fn(() => {
        mockIsInitialized = true
      }),
      shutdown: vi.fn(() => {
        mockIsInitialized = false
      }),
      isInitialized: vi.fn(() => mockIsInitialized),
      getAllDevices: vi.fn(() => mockDevices),
      getDriverInfo: vi.fn(() => ({
        ok: true,
        value: {
          driverVersion: '535.154.05',
          nvmlVersion: '12.535.154.05',
          cudaVersion: '12.2',
        },
      })),
    },
    unwrapOr: vi.fn(<T>(result: { ok: boolean; value?: T }, defaultValue: T): T => {
      if (result && result.ok && result.value !== undefined) {
        return result.value
      }
      return defaultValue
    }),
    NvmlComputeMode: {
      0: 'DEFAULT',
      1: 'EXCLUSIVE_THREAD',
      2: 'PROHIBITED',
      3: 'EXCLUSIVE_PROCESS',
      DEFAULT: 0,
      EXCLUSIVE_THREAD: 1,
      PROHIBITED: 2,
      EXCLUSIVE_PROCESS: 3,
    },
    NvmlPState: {
      0: 'P0',
      1: 'P1',
      2: 'P2',
      15: 'P15',
      32: 'UNKNOWN',
      P0: 0,
      P1: 1,
      P2: 2,
      P15: 15,
      UNKNOWN: 32,
    },
  }))
  return import('../../src/utils/gpu-info.js')
}

describe('gpu-info utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsInitialized = false
    mockDevices = []
  })

  afterEach(async () => {
    // Reset the cache after each test
    const module = await loadModule()
    module.resetGpuInfoCache()
    mockIsInitialized = false
    mockDevices = []
  })

  describe('detectGpuInfo', () => {
    it('should parse NVML output correctly', async () => {
      // Setup mock device (10240 MiB = 10 GiB)
      mockDevices = [createMockDevice(0, 'NVIDIA GeForce RTX 3080', BigInt(10240 * 1024 * 1024))]
      mockIsInitialized = true

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
      mockDevices = [
        createMockDevice(0, 'NVIDIA GeForce RTX 3090', BigInt(24576 * 1024 * 1024)),
        createMockDevice(1, 'NVIDIA GeForce RTX 3080', BigInt(10240 * 1024 * 1024)),
      ]
      mockIsInitialized = true

      const module = await loadModule()
      const gpus = await module.detectGpuInfo()

      expect(gpus).toHaveLength(2)
      expect(gpus[0].name).toBe('NVIDIA GeForce RTX 3090')
      expect(gpus[0].totalMemoryGB).toBe(24)
      expect(gpus[1].name).toBe('NVIDIA GeForce RTX 3080')
      expect(gpus[1].totalMemoryGB).toBe(10)
    })

    it('should return empty array when NVML not initialized', async () => {
      mockIsInitialized = false
      mockDevices = []

      const module = await loadModule()
      const gpus = await module.detectGpuInfo()

      expect(gpus).toEqual([])
    })

    it('should cache results after first call', async () => {
      mockDevices = [createMockDevice(0, 'NVIDIA Tesla V100', BigInt(16384 * 1024 * 1024))]
      mockIsInitialized = true

      const module = await loadModule()

      // First call
      const gpus1 = await module.detectGpuInfo()
      expect(gpus1).toHaveLength(1)

      // Second call should use cache
      const gpus2 = await module.detectGpuInfo()
      expect(gpus2).toHaveLength(1)
      expect(gpus1).toBe(gpus2) // Same reference
    })
  })

  describe('getPrimaryGpuInfo', () => {
    it('should return first GPU when available', async () => {
      mockDevices = [
        createMockDevice(0, 'NVIDIA GeForce RTX 3090', BigInt(24576 * 1024 * 1024)),
        createMockDevice(1, 'NVIDIA GeForce RTX 3080', BigInt(10240 * 1024 * 1024)),
      ]
      mockIsInitialized = true

      const module = await loadModule()
      const gpu = await module.getPrimaryGpuInfo()

      expect(gpu.index).toBe(0)
      expect(gpu.name).toBe('NVIDIA GeForce RTX 3090')
      expect(gpu.totalMemoryGB).toBe(24)
    })

    it('should return default values when no GPU detected', async () => {
      mockIsInitialized = false
      mockDevices = []

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
      mockDevices = [createMockDevice(0, 'NVIDIA A100', BigInt(40960 * 1024 * 1024))]
      mockIsInitialized = true

      const module = await loadModule()

      // Initialize cache
      await module.detectGpuInfo()

      // Get cached
      const gpu = module.getCachedPrimaryGpuInfo()

      expect(gpu.name).toBe('NVIDIA A100')
      expect(gpu.totalMemoryGB).toBe(40)
    })
  })

  describe('initializeNvml', () => {
    it('should initialize NVML', async () => {
      mockIsInitialized = false

      const module = await loadModule()
      module.initializeNvml()

      // The mock sets mockIsInitialized to true
      expect(mockIsInitialized).toBe(true)
    })

    it('should not reinitialize if already initialized', async () => {
      mockIsInitialized = true

      const module = await loadModule()
      module.initializeNvml()

      // Should remain true, init not called again
      expect(mockIsInitialized).toBe(true)
    })
  })

  describe('shutdownNvml', () => {
    it('should shutdown NVML', async () => {
      mockIsInitialized = true

      const module = await loadModule()
      module.shutdownNvml()

      expect(mockIsInitialized).toBe(false)
    })

    it('should not shutdown if not initialized', async () => {
      mockIsInitialized = false

      const module = await loadModule()
      module.shutdownNvml()

      expect(mockIsInitialized).toBe(false)
    })
  })
})
