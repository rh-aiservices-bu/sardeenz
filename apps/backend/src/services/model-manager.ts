import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { ModelInstance, ModelStatus } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import { config } from '../config.js'
import { getNextPort, killProcessGracefully, isProcessRunning, getDescendantPids } from '../utils/process.js'
import { NotFoundError, InternalError } from '../utils/errors.js'
import { buildErrorMessage } from '../utils/error-parser.js'
import { getNvidiaSmiInfo } from '../utils/gpu-info.js'
import type { Logger } from '@sardeenz/utils'
import { processLogBuffer } from './process-log-buffer.js'
import { eventBus } from './event-bus.js'
import { runtimeSettings } from '../stores/runtime-settings.js'

export interface LaunchModelOptions {
  modelPath: string
  maxTokens?: number
}

export class ModelManager extends EventEmitter {
  private logger: Logger
  // Keyed by instance ID (UUID) for multi-instance support
  private processes: Map<string, ChildProcess> = new Map()

  constructor(logger: Logger) {
    super()
    this.logger = logger.child({ component: 'ModelManager' })
  }

  /**
   * Launch a new model instance
   * Supports multiple instances of the same model (FR-004)
   * GPU memory is managed by KVCached
   */
  async launchModel(options: LaunchModelOptions): Promise<ModelInstance> {
    const { modelPath, maxTokens = 4096 } = options

    this.logger.info({ modelPath }, 'Launching model')

    // Get next available port
    const usedPorts = modelStore.getUsedPorts()
    const port = getNextPort(config.vllmBasePort, usedPorts)

    // Create instance record with unique ID
    const instanceId = randomUUID()
    const instance: ModelInstance = {
      id: instanceId,
      modelPath,
      status: 'starting' as ModelStatus,
      port,
      processId: 0, // Will be set after spawn
      maxTokens,
      gpuMemoryUtilization: 0, // Placeholder - will be measured after loading
      loadedAt: new Date(),
      ipcSegmentName: this.getIpcSegmentName(modelPath, instanceId),
    }

    try {
      // Spawn vLLM process
      // Note: GPU memory is managed by KVCached, no --gpu-memory-utilization flag needed
      // Get HF token from runtime settings (may be from env or set via API)
      const hfToken = runtimeSettings.getHfToken()

      const proc = spawn('vllm', [
        'serve',
        modelPath,
        '--disable-log-requests',
        '--disable-log-stats',
        '--no-enable-prefix-caching', // Required for KVCached
        `--port=${port}`,
        `--max-model-len=${maxTokens}`,
      ], {
        env: {
          ...process.env,
          ENABLE_KVCACHED: config.enableKvcached ? 'true' : 'false',
          KVCACHED_AUTOPATCH: config.kvcachedAutopatch ? '1' : '0',
          ...(hfToken ? { HF_TOKEN: hfToken } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      if (!proc.pid) {
        throw new InternalError('Failed to spawn vLLM process')
      }

      instance.processId = proc.pid

      // Store process reference by instance ID
      this.processes.set(instanceId, proc)

      // Store instance
      modelStore.set(instance)

      // Emit status event for starting state
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          null,
          'starting' as ModelStatus,
          'Initializing model load'
        )
      )

      // Set up logging for process output
      // Log at 'info' level during startup so output is always visible
      proc.stdout?.on('data', (data) => {
        const output = data.toString().trim()
        processLogBuffer.append(instanceId, 'stdout', output)
        this.logger.info({ modelPath, instanceId, output }, 'vLLM stdout')
      })

      proc.stderr?.on('data', (data) => {
        const output = data.toString().trim()
        processLogBuffer.append(instanceId, 'stderr', output)
        this.logger.info({ modelPath, instanceId, output }, 'vLLM stderr')
      })

      // Handle process exit
      proc.on('exit', (code, signal) => {
        this.logger.info({ modelPath, instanceId, code, signal }, 'vLLM process exited')
        this.handleProcessExit(instanceId, code, signal)
      })

      proc.on('error', (err) => {
        this.logger.error({ modelPath, instanceId, err }, 'vLLM process error')
        this.handleProcessError(instanceId, err)
      })

      // Start background monitoring for model readiness (don't await)
      // This allows the API to return immediately so frontend can subscribe to SSE
      this.monitorModelStartup(instanceId, port, modelPath).catch((err) => {
        this.logger.error({ instanceId, err }, 'Background model monitoring failed')
      })

      // Return immediately with 'starting' status
      // Frontend can now subscribe to SSE and receive real-time updates
      return instance
    } catch (err) {
      // Clean up on spawn failure (before monitoring starts)
      instance.status = 'failed' as ModelStatus
      instance.errorMessage = err instanceof Error ? err.message : 'Unknown error'
      modelStore.set(instance)

      // Emit status event for failed state
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          'starting' as ModelStatus,
          'failed' as ModelStatus,
          undefined,
          instance.errorMessage
        )
      )

      this.logger.error({ modelPath, instanceId, err }, 'Failed to launch model')

      // Kill process if it exists
      const proc = this.processes.get(instanceId)
      if (proc && proc.pid && isProcessRunning(proc.pid)) {
        proc.kill('SIGKILL')
      }
      this.processes.delete(instanceId)

      throw err
    }
  }

  /**
   * Monitor model startup in background and update status when ready
   * Called without await so API can return immediately
   */
  private async monitorModelStartup(instanceId: string, port: number, modelPath: string): Promise<void> {
    try {
      // Wait for model to be ready (up to 3 minutes)
      await this.waitForReady(port, modelPath, 180000)

      // Get current instance state
      const instance = modelStore.get(instanceId)
      if (!instance) {
        this.logger.warn({ instanceId }, 'Instance not found after model ready')
        return
      }

      // Update status to active
      instance.status = 'active' as ModelStatus
      instance.readyAt = new Date()

      // Get actual GPU memory usage from nvidia-smi process list
      // vLLM uses multiprocessing/Ray, so we need to find all descendant processes
      try {
        const gpuInfo = await getNvidiaSmiInfo()

        // Get all descendant PIDs of the vLLM process (child workers use the GPU)
        const descendantPids = await getDescendantPids(instance.processId)
        const allPids = new Set([instance.processId, ...descendantPids])

        // Sum GPU memory from all descendant processes
        let totalGpuMemoryMB = 0
        for (const proc of gpuInfo.processes) {
          if (allPids.has(proc.pid)) {
            totalGpuMemoryMB += proc.gpuMemoryMB
          }
        }

        if (totalGpuMemoryMB > 0 && gpuInfo.gpus.length > 0) {
          const gpuTotalMB = gpuInfo.gpus[0].memoryTotalMB
          instance.gpuMemoryUtilization = gpuTotalMB > 0 ? totalGpuMemoryMB / gpuTotalMB : 0

          this.logger.info(
            {
              modelPath,
              instanceId,
              processId: instance.processId,
              descendantPids,
              totalGpuMemoryMB,
              gpuTotalMB,
              gpuUtilization: instance.gpuMemoryUtilization,
            },
            'Got GPU memory usage from nvidia-smi (including child processes)'
          )
        } else {
          this.logger.warn(
            { modelPath, instanceId, processId: instance.processId, descendantPids },
            'No matching processes found in nvidia-smi output'
          )
        }
      } catch (err) {
        this.logger.warn({ modelPath, instanceId, err }, 'Failed to get GPU memory from nvidia-smi')
      }

      modelStore.set(instance)

      // Emit status event for active state
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          'starting' as ModelStatus,
          'active' as ModelStatus,
          'Model ready for inference'
        )
      )

      this.logger.info({ modelPath, port, instanceId }, 'Model loaded successfully')
      this.emit('model:loaded', instance)
    } catch (err) {
      // Model failed to become ready
      const instance = modelStore.get(instanceId)
      if (!instance) {
        this.logger.warn({ instanceId }, 'Instance not found after model failure')
        return
      }

      instance.status = 'failed' as ModelStatus
      instance.errorMessage = err instanceof Error ? err.message : 'Unknown error'
      modelStore.set(instance)

      // Emit status event for failed state
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          'starting' as ModelStatus,
          'failed' as ModelStatus,
          undefined,
          instance.errorMessage
        )
      )

      this.logger.error({ modelPath, instanceId, err }, 'Model failed to become ready')
      this.emit('model:failed', instance)

      // Kill process if it exists
      const proc = this.processes.get(instanceId)
      if (proc && proc.pid && isProcessRunning(proc.pid)) {
        proc.kill('SIGKILL')
      }
      this.processes.delete(instanceId)
    }
  }

  /**
   * Unload a model instance by ID
   */
  async unloadModel(instanceId: string): Promise<void> {
    this.logger.info({ instanceId }, 'Unloading model instance')

    const instance = modelStore.get(instanceId)
    if (!instance) {
      // Try to find by path for backwards compatibility
      const byPath = modelStore.getByPath(instanceId)
      if (byPath) {
        return this.unloadModel(byPath.id)
      }
      throw new NotFoundError(`Model instance ${instanceId} not found`)
    }

    const proc = this.processes.get(instance.id)

    // If no process exists (e.g., failed model), just clean up the store
    if (!proc) {
      this.logger.info({ instanceId: instance.id }, 'No process to kill, cleaning up store entry')

      // Clean up IPC segment (may not exist, but try anyway)
      await this.deleteIpcSegment(instance.ipcSegmentName)

      // Clean up logs
      processLogBuffer.clear(instance.id)

      // Remove from store
      modelStore.delete(instance.id)

      this.logger.info({ instanceId: instance.id, modelPath: instance.modelPath }, 'Model entry removed')
      this.emit('model:unloaded', instance)
      return
    }

    // Update status for active process
    instance.status = 'stopping' as ModelStatus
    modelStore.set(instance)

    try {
      // Graceful shutdown with timeout
      await killProcessGracefully(proc, 30000)

      // Clean up IPC segment via kvctl
      await this.deleteIpcSegment(instance.ipcSegmentName)

      // Remove from stores
      modelStore.delete(instance.id)
      this.processes.delete(instance.id)

      this.logger.info({ instanceId: instance.id, modelPath: instance.modelPath }, 'Model unloaded successfully')
      this.emit('model:unloaded', instance)
    } catch (err) {
      this.logger.error({ instanceId: instance.id, err }, 'Error unloading model')
      throw new InternalError(`Failed to unload model: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  /**
   * Unload a model by path (unloads first matching instance)
   * For backwards compatibility
   */
  async unloadModelByPath(modelPath: string): Promise<void> {
    const instance = modelStore.getByPath(modelPath)
    if (!instance) {
      throw new NotFoundError(`Model ${modelPath} not found`)
    }
    return this.unloadModel(instance.id)
  }

  /**
   * Get model status by instance ID
   */
  getModelStatus(instanceId: string): ModelInstance | undefined {
    return modelStore.get(instanceId)
  }

  /**
   * Get model status by path (returns first active instance)
   */
  getModelStatusByPath(modelPath: string): ModelInstance | undefined {
    return modelStore.getByPath(modelPath)
  }

  /**
   * Get all instances for a model path
   */
  getInstancesByPath(modelPath: string): ModelInstance[] {
    return modelStore.getAllByPath(modelPath)
  }

  /**
   * List all models
   */
  listModels(): ModelInstance[] {
    return modelStore.getAll()
  }

  /**
   * Wait for model to be ready by polling health endpoint
   */
  private async waitForReady(port: number, modelPath: string, timeout: number): Promise<void> {
    const start = Date.now()
    const interval = 2000 // Poll every 2 seconds

    while (Date.now() - start < timeout) {
      try {
        const response = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        })

        if (response.ok) {
          this.logger.info({ modelPath, port }, 'Model is ready')
          return
        }
      } catch {
        // Continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    throw new InternalError(`Model failed to start within ${timeout}ms`)
  }

  /**
   * Get IPC segment name for KVCached
   * Include instance ID suffix for uniqueness when running multiple instances
   */
  private getIpcSegmentName(modelPath: string, instanceId: string): string {
    // Convert "meta-llama/Llama-3.2-1B" -> "VLLM_META_LLAMA_LLAMA_3_2_1B"
    const name = modelPath
      .replace(/\//g, '_')
      .replace(/-/g, '_')
      .replace(/\./g, '_')
      .toUpperCase()
    // Add short instance suffix for uniqueness
    const suffix = instanceId.slice(0, 8).toUpperCase()
    return `VLLM_${name}_${suffix}`
  }

  /**
   * Delete IPC segment via kvctl
   */
  private async deleteIpcSegment(segmentName: string): Promise<void> {
    try {
      const proc = spawn('kvctl', ['delete', segmentName])
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve())
        proc.on('error', () => resolve()) // Ignore errors
      })
    } catch {
      // Non-critical, segment may have been auto-cleaned
      this.logger.debug({ segmentName }, 'Failed to delete IPC segment (non-critical)')
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(instanceId: string, code: number | null, signal: NodeJS.Signals | null): void {
    const instance = modelStore.get(instanceId)
    if (!instance) return

    if (instance.status !== 'stopping') {
      // Unexpected exit - extract meaningful error from logs
      const logs = processLogBuffer.getBuffer(instanceId)
      const errorMessage = buildErrorMessage(logs, code, signal)

      const previousStatus = instance.status
      instance.status = 'failed' as ModelStatus
      instance.errorMessage = errorMessage
      modelStore.set(instance)

      // Emit status event for failed state
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          previousStatus,
          'failed' as ModelStatus,
          undefined,
          errorMessage
        )
      )

      this.logger.error({ instanceId, modelPath: instance.modelPath, errorMessage }, 'Model failed to load')
      this.emit('model:failed', instance)

      // Schedule cleanup of logs after 30 minutes for failed instances
      processLogBuffer.scheduleCleanup(instanceId)
    } else {
      // Clean shutdown - clear logs immediately
      processLogBuffer.clear(instanceId)
    }

    this.processes.delete(instanceId)
  }

  /**
   * Handle process error
   */
  private handleProcessError(instanceId: string, err: Error): void {
    const instance = modelStore.get(instanceId)
    if (!instance) return

    // Try to extract better error from logs, fall back to err.message
    const logs = processLogBuffer.getBuffer(instanceId)
    const extractedError = logs.length > 0
      ? buildErrorMessage(logs, null, null)
      : err.message

    const previousStatus = instance.status
    instance.status = 'failed' as ModelStatus
    instance.errorMessage = extractedError
    modelStore.set(instance)

    // Emit status event for failed state
    eventBus.emitEvent(
      eventBus.createStatusEvent(
        instanceId,
        previousStatus,
        'failed' as ModelStatus,
        undefined,
        extractedError
      )
    )

    this.logger.error({ instanceId, modelPath: instance.modelPath, errorMessage: extractedError }, 'Model process error')
    this.emit('model:failed', instance)

    // Schedule cleanup of logs after 30 minutes for failed instances
    processLogBuffer.scheduleCleanup(instanceId)

    this.processes.delete(instanceId)
  }

  /**
   * Cleanup all models on shutdown
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up all models')
    const models = this.listModels()

    for (const model of models) {
      try {
        await this.unloadModel(model.id)
      } catch (err) {
        this.logger.error({ instanceId: model.id, modelPath: model.modelPath, err }, 'Error cleaning up model')
      }
    }

    // Clean up log buffer
    processLogBuffer.cleanup()
  }

  /**
   * Get buffered logs for a model instance
   */
  getLogs(instanceId: string): { logs: string; lineCount: number } {
    const buffer = processLogBuffer.getBuffer(instanceId)
    return {
      logs: processLogBuffer.getLastLines(instanceId, 500),
      lineCount: buffer.length,
    }
  }
}
