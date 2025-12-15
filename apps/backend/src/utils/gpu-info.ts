/**
 * Utility for detecting GPU information using nvidia-smi
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface GpuInfo {
  index: number
  name: string
  totalMemoryMB: number
  totalMemoryGB: number
}

/** Full GPU status information from nvidia-smi */
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

/** Complete nvidia-smi output */
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
 * Detect GPU information using nvidia-smi
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
 * Returns default values if nvidia-smi fails
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
 * Internal function to detect GPU info
 */
async function doDetectGpuInfo(): Promise<GpuInfo[]> {
  try {
    // Query nvidia-smi for GPU information
    // Format: index, name, memory.total (in MiB)
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits',
      { timeout: 5000 }
    )

    const gpus: GpuInfo[] = []

    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue

      const parts = line.split(',').map((p) => p.trim())
      if (parts.length >= 3) {
        const index = parseInt(parts[0], 10)
        const name = parts[1]
        const totalMemoryMB = parseInt(parts[2], 10)

        if (!isNaN(index) && !isNaN(totalMemoryMB)) {
          gpus.push({
            index,
            name,
            totalMemoryMB,
            totalMemoryGB: totalMemoryMB / 1024,
          })
        }
      }
    }

    return gpus
  } catch {
    // nvidia-smi not available or failed
    // Return empty array, caller should use default
    return []
  }
}

/**
 * Reset cached GPU info (for testing)
 */
export function resetGpuInfoCache(): void {
  cachedGpuInfo = null
  initializationPromise = null
}

/**
 * Get complete nvidia-smi information (not cached - for real-time monitoring)
 */
export async function getNvidiaSmiInfo(): Promise<NvidiaSmiInfo> {
  const timestamp = new Date().toISOString()

  // Get driver info
  const driver = await getDriverInfo()

  // Get GPU status
  const gpus = await getGpuStatus()

  // Get process list
  const processes = await getGpuProcesses()

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
async function getDriverInfo(): Promise<DriverInfo> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=driver_version --format=csv,noheader,nounits',
      { timeout: 5000 }
    )
    const driverVersion = stdout.trim().split('\n')[0]?.trim() || 'Unknown'

    // Get nvidia-smi version and CUDA version from the header output
    await execAsync('nvidia-smi --version 2>/dev/null || nvidia-smi | head -1', {
      timeout: 5000,
    })

    // Parse CUDA version from nvidia-smi output
    const { stdout: cudaOutput } = await execAsync(
      "nvidia-smi | grep -oP 'CUDA Version: \\K[0-9.]+'",
      { timeout: 5000 }
    )
    const cudaVersion = cudaOutput.trim() || 'Unknown'

    // Parse nvidia-smi version
    const { stdout: smiVersionOutput } = await execAsync(
      "nvidia-smi | grep -oP 'NVIDIA-SMI \\K[0-9.]+'",
      { timeout: 5000 }
    )
    const nvidiaSmiVersion = smiVersionOutput.trim() || 'Unknown'

    return {
      nvidiaSmiVersion,
      driverVersion,
      cudaVersion,
    }
  } catch {
    return {
      nvidiaSmiVersion: 'Unknown',
      driverVersion: 'Unknown',
      cudaVersion: 'Unknown',
    }
  }
}

/**
 * Get full GPU status for all GPUs
 */
async function getGpuStatus(): Promise<GpuStatus[]> {
  try {
    const fields = [
      'index',
      'name',
      'persistence_mode',
      'pci.bus_id',
      'display_active',
      'ecc.errors.corrected.volatile.total',
      'fan.speed',
      'temperature.gpu',
      'pstate',
      'power.draw',
      'power.limit',
      'memory.used',
      'memory.total',
      'utilization.gpu',
      'compute_mode',
      'mig.mode.current',
    ].join(',')

    const { stdout } = await execAsync(
      `nvidia-smi --query-gpu=${fields} --format=csv,noheader,nounits`,
      { timeout: 5000 }
    )

    const gpus: GpuStatus[] = []

    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue

      const parts = line.split(',').map((p) => p.trim())
      if (parts.length >= 16) {
        const memoryUsedMB = parseInt(parts[11], 10) || 0
        const memoryTotalMB = parseInt(parts[12], 10) || 0

        gpus.push({
          index: parseInt(parts[0], 10) || 0,
          name: parts[1],
          persistenceMode: parts[2],
          busId: parts[3],
          displayActive: parts[4],
          eccErrors: parts[5] === '[N/A]' || parts[5] === 'N/A' ? null : parts[5],
          fan: parts[6] === '[N/A]' || parts[6] === 'N/A' ? 'N/A' : `${parts[6]}%`,
          temperature: `${parts[7]}C`,
          performanceState: parts[8],
          powerUsage: `${parts[9]}W`,
          powerCap: `${parts[10]}W`,
          memoryUsed: `${memoryUsedMB}MiB`,
          memoryTotal: `${memoryTotalMB}MiB`,
          memoryUsedMB,
          memoryTotalMB,
          gpuUtilization: `${parts[13]}%`,
          computeMode: parts[14],
          migMode: parts[15] === '[N/A]' || parts[15] === 'N/A' ? null : parts[15],
        })
      }
    }

    return gpus
  } catch {
    return []
  }
}

/**
 * Get list of ALL processes using GPU memory (including idle processes)
 * Parses standard nvidia-smi text output to capture all processes with GPU memory allocated
 */
async function getGpuProcesses(): Promise<GpuProcess[]> {
  try {
    // Run standard nvidia-smi and parse the Processes section
    // This captures ALL processes with GPU memory, not just active ones
    const { stdout } = await execAsync('nvidia-smi', { timeout: 5000 })
    return parseNvidiaSmiProcesses(stdout)
  } catch {
    return []
  }
}

/**
 * Parse the Processes section from nvidia-smi text output
 * Example line: |    0   N/A  N/A   5082   G   /usr/libexec/Xorg   300MiB |
 */
function parseNvidiaSmiProcesses(output: string): GpuProcess[] {
  const processes: GpuProcess[] = []
  const lines = output.split('\n')
  let inProcessSection = false

  for (const line of lines) {
    // Detect start of process table (header line contains "GPU   GI   CI")
    if (line.includes('GPU   GI   CI')) {
      inProcessSection = true
      continue
    }

    // Skip separator lines
    if (line.includes('|=') || line.includes('+-')) {
      if (inProcessSection && line.includes('+-')) {
        // End of process section
        break
      }
      continue
    }

    if (inProcessSection && line.includes('|')) {
      // Parse process line: |    0   N/A  N/A            5082      G   /usr/libexec/Xorg   300MiB |
      // Regex breakdown:
      // \|\s* - starting pipe and whitespace
      // (\d+)\s+ - GPU index
      // (\S+)\s+ - GI ID (N/A or number)
      // (\S+)\s+ - CI ID (N/A or number)
      // (\d+)\s+ - PID
      // (\w+)\s+ - Type (C or G)
      // (.+?)\s+ - Process name (non-greedy to stop before memory)
      // (\d+)MiB - GPU memory in MiB
      const match = line.match(/\|\s*(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\w+)\s+(.+?)\s+(\d+)MiB\s*\|/)
      if (match) {
        processes.push({
          gpu: parseInt(match[1], 10),
          gi: match[2],
          ci: match[3],
          pid: parseInt(match[4], 10),
          type: match[5],
          processName: match[6].trim(),
          gpuMemory: `${match[7]}MiB`,
          gpuMemoryMB: parseInt(match[7], 10),
        })
      }
    }
  }

  // Sort by GPU memory descending
  processes.sort((a, b) => b.gpuMemoryMB - a.gpuMemoryMB)
  return processes
}
