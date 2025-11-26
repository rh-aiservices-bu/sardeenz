import { spawn } from 'child_process'
import type { ResourceMetrics } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import type { Logger } from '@sardeenz/utils'
import { InternalError } from '../utils/errors.js'

interface KvctlListEntry {
  name: string
  size_gb: number
  limit_gb: number
  usage_percent: number
}

export class MemoryMonitor {
  private logger: Logger
  private metricsCache: Map<string, ResourceMetrics> = new Map()

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'MemoryMonitor' })
  }

  /**
   * Get GPU memory usage for all models
   */
  async getMemoryUsage(): Promise<{
    gpu_total_gb: number
    gpu_used_gb: number
    gpu_free_gb: number
    models: Array<{
      model_path: string
      gpu_memory_used_gb: number
      gpu_memory_limit_gb: number
      gpu_memory_usage_percent: number
    }>
  }> {
    try {
      const kvctlOutput = await this.runKvctlList()
      const segments = this.parseKvctlOutput(kvctlOutput)

      // Filter for vLLM segments
      const vllmSegments = segments.filter((s) => s.name.startsWith('VLLM_'))

      // Calculate totals (assuming 24GB GPU for now, should read from nvidia-smi)
      const totalGpu = 24.0
      const usedGpu = vllmSegments.reduce((sum, s) => sum + s.size_gb, 0)

      // Map segments to models
      const models = vllmSegments.map((segment) => {
        // Convert segment name back to model path
        const modelPath = this.segmentNameToModelPath(segment.name)

        return {
          model_path: modelPath,
          gpu_memory_used_gb: segment.size_gb,
          gpu_memory_limit_gb: segment.limit_gb,
          gpu_memory_usage_percent: segment.usage_percent,
        }
      })

      return {
        gpu_total_gb: totalGpu,
        gpu_used_gb: usedGpu,
        gpu_free_gb: totalGpu - usedGpu,
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

      const metrics: ResourceMetrics = {
        modelPath,
        gpuMemoryUsedGB: modelMemory.gpu_memory_used_gb,
        gpuMemoryLimitGB: modelMemory.gpu_memory_limit_gb,
        gpuMemoryUsagePercent: modelMemory.gpu_memory_usage_percent,
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
   * Run kvctl list command and return output
   */
  private async runKvctlList(): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('kvctl', ['list', '--json'])
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
          reject(new Error(`kvctl list failed with code ${code}: ${stderr}`))
        } else {
          resolve(stdout.trim())
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
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
   * Parse kvctl list JSON output
   */
  private parseKvctlOutput(output: string): KvctlListEntry[] {
    try {
      const data = JSON.parse(output)
      if (Array.isArray(data)) {
        return data as KvctlListEntry[]
      }
      return []
    } catch (err) {
      this.logger.warn({ err, output }, 'Failed to parse kvctl output')
      return []
    }
  }

  /**
   * Convert IPC segment name back to model path
   */
  private segmentNameToModelPath(segmentName: string): string {
    // Convert "VLLM_META_LLAMA_LLAMA_3_2_1B" -> "meta-llama/Llama-3.2-1B"
    // This is approximate reverse mapping
    const withoutPrefix = segmentName.replace(/^VLLM_/, '')
    return withoutPrefix.toLowerCase().replace(/_/g, '-')
  }

  /**
   * Get cached metrics
   */
  getCachedMetrics(modelPath: string): ResourceMetrics | undefined {
    return this.metricsCache.get(modelPath)
  }
}
