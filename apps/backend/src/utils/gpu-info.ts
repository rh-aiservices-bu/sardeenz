/**
 * Utility for detecting GPU information using NVML (via @rh-ai-bu/ts-nvml bindings)
 */

import { Nvml, unwrapOr, NvmlComputeMode, NvmlPState } from '@rh-ai-bu/ts-nvml'

import { config, isInferenceSimMode } from '../config.js'
import { simGpuTracker } from './sim-gpu-tracker.js'

export interface GpuInfo {
  index: number
  name: string
  totalMemoryMB: number
  totalMemoryGB: number
}

/** Full GPU status information */
export interface GpuStatus {
  index: number
  name: string
  persistenceMode: string
  busId: string
  displayActive: string
  eccErrors: string | null
  fan: string
  temperature: string
  performanceState: string
  powerUsage: string
  powerCap: string
  memoryUsed: string
  memoryTotal: string
  memoryUsedMB: number
  memoryTotalMB: number
  gpuUtilization: string
  computeMode: string
  migMode: string | null
}

/** GPU process information */
export interface GpuProcess {
  gpu: number
  gi: string
  ci: string
  pid: number
  type: string
  processName: string
  gpuMemory: string
  gpuMemoryMB: number
}

/** Driver information */
export interface DriverInfo {
  nvidiaSmiVersion: string
  driverVersion: string
  cudaVersion: string
}

/** Complete GPU system information */
export interface NvidiaSmiInfo {
  timestamp: string
  driver: DriverInfo
  gpus: GpuStatus[]
  processes: GpuProcess[]
}

const DEFAULT_GPU_MEMORY_GB = 24.0

// Cached GPU info (singleton)
let cachedGpuInfo: GpuInfo[] | null = null
let initializationPromise: Promise<GpuInfo[]> | null = null

/**
 * Initialize NVML library
 * Must be called once at application startup before any GPU operations
 */
export function initializeNvml(): void {
  if (Nvml.isInitialized()) {
    return
  }

  try {
    Nvml.init()
    console.info('[gpu-info] NVML initialized successfully')
  } catch (error) {
    console.error('[gpu-info] Failed to initialize NVML:', error)
    // Don't throw - allow graceful degradation with defaults
  }
}

/**
 * Shutdown NVML library
 * Should be called at application shutdown for clean resource release
 */
export function shutdownNvml(): void {
  if (!Nvml.isInitialized()) {
    return
  }

  try {
    Nvml.shutdown()
    console.info('[gpu-info] NVML shutdown complete')
  } catch (error) {
    console.error('[gpu-info] Error during NVML shutdown:', error)
  }
}

/**
 * Detect GPU information using NVML
 * Returns cached result after first call
 */
export async function detectGpuInfo(): Promise<GpuInfo[]> {
  // Return cached result if available
  if (cachedGpuInfo !== null) {
    return cachedGpuInfo
  }

  // If initialization is already in progress, wait for it
  if (initializationPromise !== null) {
    return initializationPromise
  }

  // Start initialization
  initializationPromise = doDetectGpuInfo()

  try {
    cachedGpuInfo = await initializationPromise
    return cachedGpuInfo
  } finally {
    initializationPromise = null
  }
}

/**
 * Get the primary GPU info (first GPU, index 0)
 * Returns default values if NVML fails
 */
export async function getPrimaryGpuInfo(): Promise<GpuInfo> {
  const gpus = await detectGpuInfo()

  if (gpus.length === 0) {
    return {
      index: 0,
      name: 'Unknown GPU',
      totalMemoryMB: DEFAULT_GPU_MEMORY_GB * 1024,
      totalMemoryGB: DEFAULT_GPU_MEMORY_GB,
    }
  }

  return gpus[0]
}

/**
 * Get cached GPU info synchronously (returns null if not initialized)
 */
export function getCachedGpuInfo(): GpuInfo[] | null {
  return cachedGpuInfo
}

/**
 * Get cached primary GPU info synchronously (returns default if not initialized)
 */
export function getCachedPrimaryGpuInfo(): GpuInfo {
  if (cachedGpuInfo !== null && cachedGpuInfo.length > 0) {
    return cachedGpuInfo[0]
  }

  return {
    index: 0,
    name: 'Unknown GPU',
    totalMemoryMB: DEFAULT_GPU_MEMORY_GB * 1024,
    totalMemoryGB: DEFAULT_GPU_MEMORY_GB,
  }
}

/**
 * Internal function to detect real GPU info from NVML
 */
function detectRealGpuInfo(): GpuInfo[] {
  if (!Nvml.isInitialized()) {
    return []
  }

  try {
    const devices = Nvml.getAllDevices()
    return devices.map((device) => {
      const name = unwrapOr(device.getName(), 'Unknown GPU')
      const memInfo = unwrapOr(device.getMemoryInfo(), {
        total: BigInt(0),
        used: BigInt(0),
        free: BigInt(0),
      })
      // Memory is in bytes (bigint), convert to MiB
      const totalMemoryMB = Number(memInfo.total / BigInt(1024 * 1024))

      return {
        index: device.index,
        name,
        totalMemoryMB,
        totalMemoryGB: totalMemoryMB / 1024,
      }
    })
  } catch {
    // NVML error - return empty array, caller should use default
    return []
  }
}

/**
 * Internal function to detect GPU info (real, virtual, or simulated)
 */
async function doDetectGpuInfo(): Promise<GpuInfo[]> {
  if (isInferenceSimMode()) {
    return simGpuTracker.getGpuInfo()
  }

  // Get real GPU info first
  const realGpus = detectRealGpuInfo()

  // If virtual GPUs enabled and we have at least one real GPU
  if (config.virtualGpuCount > 0 && realGpus.length > 0) {
    const baseGpu = realGpus[0]
    console.info(
      `[gpu-info] Virtual GPU mode enabled: creating ${config.virtualGpuCount} virtual GPUs based on ${baseGpu.name}`
    )
    return Array.from({ length: config.virtualGpuCount }, (_, i) => ({
      index: i,
      name: `${baseGpu.name} (vGPU)`,
      totalMemoryMB: baseGpu.totalMemoryMB,
      totalMemoryGB: baseGpu.totalMemoryGB,
    }))
  }

  return realGpus
}

/**
 * Reset cached GPU info (for testing)
 */
export function resetGpuInfoCache(): void {
  cachedGpuInfo = null
  initializationPromise = null
}

/**
 * Get complete GPU system information (not cached - for real-time monitoring)
 */
export async function getNvidiaSmiInfo(): Promise<NvidiaSmiInfo> {
  if (isInferenceSimMode()) {
    return simGpuTracker.getNvidiaSmiInfo()
  }

  const timestamp = new Date().toISOString()

  // Get driver info
  const driver = getDriverInfo()

  // Get real GPU status
  const realGpus = getGpuStatus()

  // Get process list
  const processes = getGpuProcesses()

  // If virtual GPUs enabled, create virtual GPU status entries
  let gpus: GpuStatus[]
  if (config.virtualGpuCount > 0 && realGpus.length > 0) {
    const baseGpu = realGpus[0]
    gpus = Array.from({ length: config.virtualGpuCount }, (_, i) => ({
      ...baseGpu,
      index: i,
      name: `${baseGpu.name} (vGPU)`,
      busId: `vGPU${i}:${baseGpu.busId}`,
    }))
  } else {
    gpus = realGpus
  }

  return {
    timestamp,
    driver,
    gpus,
    processes,
  }
}

/**
 * Get driver and CUDA version information
 */
function getDriverInfo(): DriverInfo {
  if (!Nvml.isInitialized()) {
    return {
      nvidiaSmiVersion: 'Unknown',
      driverVersion: 'Unknown',
      cudaVersion: 'Unknown',
    }
  }

  const result = Nvml.getDriverInfo()
  if (!result.ok) {
    return {
      nvidiaSmiVersion: 'Unknown',
      driverVersion: 'Unknown',
      cudaVersion: 'Unknown',
    }
  }

  return {
    nvidiaSmiVersion: result.value.nvmlVersion,
    driverVersion: result.value.driverVersion,
    cudaVersion: result.value.cudaVersion,
  }
}

/**
 * Get full GPU status for all GPUs
 */
function getGpuStatus(): GpuStatus[] {
  if (!Nvml.isInitialized()) {
    return []
  }

  try {
    const devices = Nvml.getAllDevices()
    const gpus: GpuStatus[] = []

    for (const device of devices) {
      const status = unwrapOr(device.getStatus(), null)
      if (!status) continue

      gpus.push({
        index: status.index,
        name: status.name,
        persistenceMode: status.persistenceMode ? 'Enabled' : 'Disabled',
        busId: status.pciBusId,
        displayActive: status.displayActive ? 'Enabled' : 'Disabled',
        eccErrors:
          status.eccErrorsCorrected !== null ? String(status.eccErrorsCorrected) : null,
        fan: status.fanSpeed !== null ? `${status.fanSpeed}%` : 'N/A',
        temperature: `${status.temperature}C`,
        performanceState: NvmlPState[status.pstate],
        powerUsage: `${Math.round(status.powerDraw)}W`,
        powerCap: `${Math.round(status.powerLimit)}W`,
        memoryUsed: `${status.memoryUsedMiB}MiB`,
        memoryTotal: `${status.memoryTotalMiB}MiB`,
        memoryUsedMB: status.memoryUsedMiB,
        memoryTotalMB: status.memoryTotalMiB,
        gpuUtilization: `${status.utilizationGpu}%`,
        computeMode: NvmlComputeMode[status.computeMode],
        migMode: status.migMode !== null ? (status.migMode ? 'Enabled' : 'Disabled') : null,
      })
    }

    return gpus
  } catch {
    return []
  }
}

/**
 * Get list of all processes using GPU memory
 */
function getGpuProcesses(): GpuProcess[] {
  if (!Nvml.isInitialized()) {
    return []
  }

  try {
    const devices = Nvml.getAllDevices()
    const allProcesses: GpuProcess[] = []

    for (const device of devices) {
      const procs = unwrapOr(device.getProcesses(), [])

      for (const proc of procs) {
        allProcesses.push({
          gpu: device.index,
          gi: 'N/A', // MIG instance - not tracked in basic NVML
          ci: 'N/A', // Compute instance - not tracked in basic NVML
          pid: proc.pid,
          type: 'C', // Compute type - ts-nvml returns compute processes
          processName: proc.processName,
          gpuMemory: `${proc.usedMemoryMiB}MiB`,
          gpuMemoryMB: proc.usedMemoryMiB,
        })
      }
    }

    // Sort by GPU memory descending (preserve current behavior)
    return allProcesses.sort((a, b) => b.gpuMemoryMB - a.gpuMemoryMB)
  } catch {
    return []
  }
}
