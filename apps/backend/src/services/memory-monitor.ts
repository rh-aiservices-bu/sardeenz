import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import type { ResourceMetrics, MemoryUsageResponse, KVCacheMetrics, GpuMetrics, ModelGpuMemory } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import type { Logger } from '@sardeenz/utils'
import { InternalError } from '../utils/errors.js'
import { getPrimaryGpuInfo, getNvidiaSmiInfo } from '../utils/gpu-info.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** KVCache segment info from Python script (reads /dev/shm like kvtop) */
interface KvcacheSegment {
  ipc_name: string
  total_size: number // bytes
  used_size: number // bytes
  prealloc_size: number // bytes
}

// Color palette for model visualization (PatternFly-inspired)
const MODEL_COLORS = [
  '#0066CC', // Blue
  '#5752D1', // Purple
  '#009596', // Cyan
  '#EC7A08', // Orange
  '#A30000', // Red
  '#3E8635', // Green
  '#8B5CF6', // Violet
  '#06B6D4', // Teal
]

/**
 * Get a color for a model based on its index in the list.
 * Uses sequential assignment to guarantee unique colors for the first 8 models.
 */
function getModelColor(_instanceId: string, index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length]
}

/**
 * Extract display name from model path (e.g., "meta-llama/Llama-3.2-1B" -> "Llama-3.2-1B")
 */
function getDisplayName(modelPath: string): string {
  const parts = modelPath.split('/')
  return parts[parts.length - 1] || modelPath
}

export class MemoryMonitor {
  private logger: Logger
  private metricsCache: Map<string, ResourceMetrics> = new Map()

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'MemoryMonitor' })
  }

  /**
   * Get GPU memory usage for all models (new enhanced format)
   */
  async getMemoryUsage(): Promise<MemoryUsageResponse> {
    try {
      // Get KVCache segments from Python script (reads /dev/shm like kvtop)
      // and GPU info from nvidia-smi in parallel
      const [kvcacheSegments, gpuInfo, nvidiaSmiInfo] = await Promise.all([
        this.runKvcacheStats(),
        getPrimaryGpuInfo(),
        getNvidiaSmiInfo(),
      ])

      // Calculate KVCache pool metrics (aggregate from all segments)
      const kvcacheTotalBytes = kvcacheSegments.reduce((sum, s) => sum + s.total_size, 0)
      const kvcacheUsedBytes = kvcacheSegments.reduce((sum, s) => sum + s.used_size, 0)
      const kvcachePreallocBytes = kvcacheSegments.reduce((sum, s) => sum + s.prealloc_size, 0)
      // Free = total - used - prealloc
      const kvcacheFreeBytes = Math.max(0, kvcacheTotalBytes - kvcacheUsedBytes - kvcachePreallocBytes)

      const kvcache: KVCacheMetrics = {
        total_gb: kvcacheTotalBytes / 1024 ** 3,
        prealloc_gb: kvcachePreallocBytes / 1024 ** 3,
        used_gb: kvcacheUsedBytes / 1024 ** 3,
        free_gb: kvcacheFreeBytes / 1024 ** 3,
      }

      // Get GPU metrics from nvidia-smi
      const primaryGpu = nvidiaSmiInfo.gpus[0]
      const gpuUsedMB = primaryGpu?.memoryUsedMB ?? 0
      const gpuTotalMB = primaryGpu?.memoryTotalMB ?? gpuInfo.totalMemoryMB

      const gpu: GpuMetrics = {
        total_gb: gpuTotalMB / 1024,
        used_gb: gpuUsedMB / 1024,
        free_gb: (gpuTotalMB - gpuUsedMB) / 1024,
        utilization_percent: parseFloat(primaryGpu?.gpuUtilization?.replace('%', '') || '0'),
      }

      // Build map of PID -> GPU memory from nvidia-smi processes
      const processMemoryByPid = new Map<number, number>()
      for (const proc of nvidiaSmiInfo.processes) {
        processMemoryByPid.set(proc.pid, proc.gpuMemoryMB)
      }

      // Build per-model GPU memory breakdown using actual nvidia-smi process memory
      const allInstances = modelStore.getAll()
      const runningInstances = allInstances.filter((instance) => instance.status === 'running')

      // Track display name counts to generate unique suffixes for duplicates
      const displayNameCounts = new Map<string, number>()

      const models: ModelGpuMemory[] = runningInstances.map((instance, index) => {
        // Use EngineCore PID if available (it's the process that allocates GPU VRAM)
        // Fall back to main process ID if EngineCore PID not extracted from logs
        const gpuPid = instance.engineCorePid ?? instance.processId
        const processMemoryMB = processMemoryByPid.get(gpuPid) ?? 0
        const gpuMemoryGb = processMemoryMB / 1024

        // Generate unique display name with suffix for duplicates
        const baseName = getDisplayName(instance.modelPath)
        const count = (displayNameCounts.get(baseName) ?? 0) + 1
        displayNameCounts.set(baseName, count)
        const displayName = count === 1 ? baseName : `${baseName} (${count})`

        return {
          model_path: instance.modelPath,
          instance_id: instance.id,
          display_name: displayName,
          gpu_memory_gb: gpuMemoryGb,
          color: getModelColor(instance.id, index),
        }
      })

      return {
        kvcache,
        gpu,
        models,
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to get memory usage')
      throw new InternalError(`Failed to get memory usage: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  /**
   * Set memory limits for a model via kvctl
   */
  async setMemoryLimits(modelPath: string, limitGb: number): Promise<void> {
    const instance = modelStore.get(modelPath)
    if (!instance) {
      throw new InternalError(`Model ${modelPath} not found`)
    }

    const segmentName = instance.ipcSegmentName

    try {
      await this.runKvctlSetLimit(segmentName, limitGb)
      this.logger.info({ modelPath, segmentName, limitGb }, 'Memory limit set successfully')
    } catch (err) {
      this.logger.error({ modelPath, err }, 'Failed to set memory limit')
      throw new InternalError(`Failed to set memory limit: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  /**
   * Collect resource metrics for a specific model
   */
  async collectMetrics(modelPath: string): Promise<ResourceMetrics | undefined> {
    const instance = modelStore.get(modelPath)
    if (!instance) {
      return undefined
    }

    try {
      const memoryUsage = await this.getMemoryUsage()
      const modelMemory = memoryUsage.models.find((m) => m.model_path === modelPath)

      if (!modelMemory) {
        return undefined
      }

      // Calculate usage percentage based on model's footprint relative to total GPU
      const usagePercent =
        memoryUsage.gpu.total_gb > 0 ? (modelMemory.gpu_memory_gb / memoryUsage.gpu.total_gb) * 100 : 0

      const metrics: ResourceMetrics = {
        modelPath,
        gpuMemoryUsedGB: modelMemory.gpu_memory_gb,
        gpuMemoryLimitGB: memoryUsage.gpu.total_gb, // Use total GPU as limit for now
        gpuMemoryUsagePercent: usagePercent,
        activeConnections: 0, // Will be tracked by ProxyRouter
        totalRequests: 0, // Will be tracked by ProxyRouter
        successfulRequests: 0,
        failedRequests: 0,
        lastUpdated: new Date(),
      }

      // Cache metrics
      this.metricsCache.set(modelPath, metrics)

      return metrics
    } catch (err) {
      this.logger.error({ modelPath, err }, 'Failed to collect metrics')
      return undefined
    }
  }

  /**
   * Run kvctl limit command
   */
  private async runKvctlSetLimit(segmentName: string, limitGb: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('kvctl', ['limit', segmentName, `${limitGb}G`])
      let stderr = ''

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`kvctl limit failed with code ${code}: ${stderr}`))
        } else {
          resolve()
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }

  /**
   * Run Python script to read KVCache stats from shared memory (like kvtop)
   * Returns empty array if script fails or no segments found
   */
  private async runKvcacheStats(): Promise<KvcacheSegment[]> {
    return new Promise((resolve) => {
      // Script is in scripts/ relative to src/services/
      const scriptPath = path.join(__dirname, '../../scripts/kvcache-stats.py')
      const proc = spawn('python3', [scriptPath])
      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('exit', (code) => {
        if (code !== 0) {
          this.logger.warn({ code, stderr }, 'kvcache-stats.py failed')
          resolve([])
        } else {
          try {
            const segments = JSON.parse(stdout.trim()) as KvcacheSegment[]
            this.logger.debug({ segmentCount: segments.length }, 'Got KVCache segments from Python script')
            resolve(segments)
          } catch (err) {
            this.logger.warn({ err, stdout: stdout.substring(0, 200) }, 'Failed to parse kvcache-stats.py output')
            resolve([])
          }
        }
      })

      proc.on('error', (err) => {
        this.logger.warn({ err }, 'Failed to spawn kvcache-stats.py')
        resolve([])
      })
    })
  }

  /**
   * Get cached metrics
   */
  getCachedMetrics(modelPath: string): ResourceMetrics | undefined {
    return this.metricsCache.get(modelPath)
  }
}
