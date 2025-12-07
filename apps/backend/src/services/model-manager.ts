import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { ModelInstance, ModelStatus } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import { config } from '../config.js'
import { getNextPort, killProcessImmediate, isProcessRunning, getDescendantPids } from '../utils/process.js'
import { NotFoundError, InternalError } from '../utils/errors.js'
import { buildErrorMessage } from '../utils/error-parser.js'
import { parseMemoryMetrics, extractEngineCorePid } from '../utils/memory-parser.js'
import { getNvidiaSmiInfo } from '../utils/gpu-info.js'
import type { Logger } from '@sardeenz/utils'
import { processLogBuffer } from './process-log-buffer.js'
import { eventBus } from './event-bus.js'
import { runtimeSettings } from '../stores/runtime-settings.js'
import { GpuSelector } from './gpu-selector.js'

export interface LaunchModelOptions {
  modelPath: string
  maxTokens?: number
  extraArgs?: string[]
  gpuIds?: number[] // Optional explicit GPU selection (auto-selects if not provided)
  tensorParallelSize?: number // For large models spanning multiple GPUs (default: 1)
  sourceType?: 'huggingface' | 'local' // Model source type (default: 'huggingface')
  servedModelName?: string // Name for vLLM --served-model-name (default: modelPath)
}

/** Arguments that are managed by the system and should be filtered out from user input */
const FORBIDDEN_ARGS = [
  '--gpu-memory-utilization',
  '--port',
  '--no-enable-prefix-caching',
  '--disable-log-requests',
  '--disable-log-stats',
]

/**
 * Sanitize user-provided vLLM arguments:
 * - Filter out empty lines
 * - Ensure args start with - or --
 * - Remove system-managed arguments (but allow overridable ones)
 */
function sanitizeVllmArgs(args: string[]): string[] {
  return args
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0)
    .filter((arg) => arg.startsWith('-'))
    .filter((arg) => {
      const argName = arg.split('=')[0].toLowerCase()
      return !FORBIDDEN_ARGS.some((forbidden) => argName === forbidden.toLowerCase())
    })
}

/**
 * Check if a specific argument is present in the args list
 */
function hasArg(args: string[], argName: string): boolean {
  const lowerArgName = argName.toLowerCase()
  return args.some((arg) => arg.split('=')[0].toLowerCase() === lowerArgName)
}

export class ModelManager extends EventEmitter {
  private logger: Logger
  // Keyed by instance ID (UUID) for multi-instance support
  private processes: Map<string, ChildProcess> = new Map()
  private gpuSelector: GpuSelector

  constructor(logger: Logger) {
    super()
    this.logger = logger.child({ component: 'ModelManager' })
    this.gpuSelector = new GpuSelector(logger)
  }

  /**
   * Launch a new model instance
   * Supports multiple instances of the same model (FR-004)
   * GPU memory is managed by KVCached
   */
  async launchModel(options: LaunchModelOptions): Promise<ModelInstance> {
    const {
      modelPath,
      maxTokens = 4096,
      extraArgs = [],
      gpuIds,
      tensorParallelSize = 1,
      servedModelName,
    } = options

    // Use explicit servedModelName if provided, otherwise fall back to modelPath
    const effectiveModelName = servedModelName?.trim() || modelPath

    // Sanitize user-provided extra arguments
    const sanitizedExtraArgs = sanitizeVllmArgs(extraArgs)

    // Determine target GPUs (auto-select or validate manual selection)
    const { gpuIds: targetGpuIds, wasAutoSelected } = await this.gpuSelector.getTargetGpus(
      gpuIds,
      tensorParallelSize
    )

    // Determine KVCached status
    // KVCached supports tensor parallelism as of Q2 2025
    const enableKvcached = config.enableKvcached

    this.logger.info(
      {
        modelPath,
        extraArgs: sanitizedExtraArgs,
        targetGpuIds,
        tensorParallelSize,
        enableKvcached,
        wasAutoSelected,
      },
      'Launching model with GPU selection'
    )

    // Get next available port
    const usedPorts = modelStore.getUsedPorts()
    const port = getNextPort(config.vllmBasePort, usedPorts)

    // Create instance record with unique ID
    const instanceId = randomUUID()
    const instance: ModelInstance = {
      id: instanceId,
      modelPath,
      modelName: effectiveModelName,
      status: 'starting' as ModelStatus,
      port,
      processId: 0, // Will be set after spawn
      maxTokens,
      gpuMemoryUtilization: 0, // Placeholder - will be measured after loading
      loadedAt: new Date(),
      ipcSegmentName: this.getIpcSegmentName(modelPath, instanceId),
      gpuIds: targetGpuIds,
      tensorParallelSize,
      kvcachedEnabled: enableKvcached,
    }

    try {
      // Spawn vLLM process
      // Note: GPU memory is managed by KVCached, no --gpu-memory-utilization flag needed
      // Get HF token from runtime settings (may be from env or set via API)
      const hfToken = runtimeSettings.getHfToken()

      // Build the command arguments array
      const baseArgs = [
        'serve',
        modelPath,
        '--disable-log-stats',
        `--port=${port}`,
      ]

      // Add --served-model-name only if not overridden in extra args
      if (!hasArg(sanitizedExtraArgs, '--served-model-name')) {
        baseArgs.push(`--served-model-name=${effectiveModelName}`)
      }

      // Add --max-model-len only if not overridden in extra args
      if (!hasArg(sanitizedExtraArgs, '--max-model-len')) {
        baseArgs.push(`--max-model-len=${maxTokens}`)
      }

      // Add tensor parallel size if > 1
      if (tensorParallelSize > 1) {
        baseArgs.push(`--tensor-parallel-size=${tensorParallelSize}`)
      }

      // Only add prefix caching flag if KVCached is enabled
      if (enableKvcached) {
        baseArgs.push('--no-enable-prefix-caching') // Required for KVCached
      }

      // Append sanitized user-provided extra arguments (may include overrides)
      const allArgs = [...baseArgs, ...sanitizedExtraArgs]

      // Build and store the full launch command for debugging/reproduction
      instance.launchCommand = `CUDA_VISIBLE_DEVICES=${targetGpuIds.join(',')} vllm ${allArgs.join(' ')}`

      const proc = spawn('vllm', allArgs, {
        env: {
          ...process.env,
          CUDA_VISIBLE_DEVICES: targetGpuIds.join(','), // GPU restriction
          ENABLE_KVCACHED: enableKvcached ? 'true' : 'false',
          KVCACHED_AUTOPATCH: config.kvcachedAutopatch && enableKvcached ? '1' : '0',
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
      // Wait for model to be ready (configurable via VLLM_STARTUP_TIMEOUT)
      await this.waitForReady(port, modelPath, config.vllmStartupTimeout)

      // Get current instance state
      const instance = modelStore.get(instanceId)
      if (!instance) {
        this.logger.warn({ instanceId }, 'Instance not found after model ready')
        return
      }

      // Update status to running
      instance.status = 'running' as ModelStatus
      instance.readyAt = new Date()

      // Parse logs first to extract EngineCore PID and memory metrics
      const logs = processLogBuffer.getBuffer(instanceId)

      // Extract EngineCore PID (the process that actually uses GPU VRAM)
      // The vLLM API Server (instance.processId) doesn't allocate GPU memory directly
      const engineCorePid = extractEngineCorePid(logs)
      if (engineCorePid) {
        instance.engineCorePid = engineCorePid
        this.logger.info(
          { instanceId, modelPath, engineCorePid, apiServerPid: instance.processId },
          'Extracted EngineCore PID from vLLM logs'
        )
      } else {
        this.logger.warn(
          { instanceId, modelPath },
          'Could not extract EngineCore PID from vLLM logs, will use main process PID for GPU memory lookup'
        )
      }

      // Get actual GPU memory usage from nvidia-smi FIRST
      // This is the source of truth for total GPU memory consumption
      let actualGpuMemoryGiB: number | undefined
      try {
        const gpuInfo = await getNvidiaSmiInfo()

        // Use EngineCore PID if available, otherwise fall back to main process + descendants
        const primaryPid = instance.engineCorePid ?? instance.processId
        const descendantPids = await getDescendantPids(primaryPid)
        const allPids = new Set([primaryPid, ...descendantPids])

        // If we have EngineCore PID, also include main process ID and its descendants
        if (instance.engineCorePid) {
          allPids.add(instance.processId)
          const apiServerDescendants = await getDescendantPids(instance.processId)
          for (const pid of apiServerDescendants) {
            allPids.add(pid)
          }
        }

        // Sum GPU memory from all matching processes
        let totalGpuMemoryMB = 0
        for (const proc of gpuInfo.processes) {
          if (allPids.has(proc.pid)) {
            totalGpuMemoryMB += proc.gpuMemoryMB
          }
        }

        if (totalGpuMemoryMB > 0 && gpuInfo.gpus.length > 0) {
          const gpuTotalMB = gpuInfo.gpus[0].memoryTotalMB
          instance.gpuMemoryUtilization = gpuTotalMB > 0 ? totalGpuMemoryMB / gpuTotalMB : 0
          actualGpuMemoryGiB = totalGpuMemoryMB / 1024

          this.logger.info(
            {
              modelPath,
              instanceId,
              engineCorePid: instance.engineCorePid,
              processId: instance.processId,
              matchedPids: Array.from(allPids),
              totalGpuMemoryMB,
              actualGpuMemoryGiB,
              gpuTotalMB,
              gpuUtilization: instance.gpuMemoryUtilization,
            },
            'Got actual GPU memory usage from nvidia-smi'
          )
        } else {
          this.logger.warn(
            { modelPath, instanceId, engineCorePid: instance.engineCorePid, processId: instance.processId, searchedPids: Array.from(allPids) },
            'No matching processes found in nvidia-smi output'
          )
        }
      } catch (err) {
        this.logger.warn({ modelPath, instanceId, err }, 'Failed to get GPU memory from nvidia-smi')
      }

      // Parse memory metrics from logs, passing actual GPU memory for total/overhead calculation
      const memoryMetrics = parseMemoryMetrics(logs, instance.maxTokens, actualGpuMemoryGiB)
      if (memoryMetrics) {
        instance.memoryMetrics = memoryMetrics
        this.logger.info(
          { instanceId, modelPath, memoryMetrics },
          'Parsed memory metrics from vLLM logs'
        )
      } else {
        this.logger.warn(
          { instanceId, modelPath },
          'Could not parse memory metrics from vLLM logs'
        )
      }

      // Test if model supports chat templates
      try {
        const testRequest = {
          model: modelPath,
          messages: [{ role: 'user', content: 'what is the color of the sky?' }],
          max_tokens: 10,
        }

        const testResponse = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testRequest),
        })

        // If we get any response (even error), check the status
        if (testResponse.status === 400) {
          const errorData = await testResponse.json()
          const errorMsg = JSON.stringify(errorData).toLowerCase()

          // Check if error is about missing chat template
          if (errorMsg.includes('chat template') || errorMsg.includes('chat_template')) {
            instance.hasChatTemplate = false
            this.logger.info({ modelPath, instanceId }, 'Model does not support chat templates (will need manual wrapping)')
          } else {
            // Different 400 error, assume templates work
            instance.hasChatTemplate = true
            this.logger.info({ modelPath, instanceId }, 'Model supports chat templates')
          }
        } else {
          // Success or other error status, assume templates work
          instance.hasChatTemplate = true
          this.logger.info({ modelPath, instanceId }, 'Model supports chat templates')
        }
      } catch (err) {
        // Network error or other issue, assume templates work (we'll find out later)
        instance.hasChatTemplate = true
        this.logger.warn(
          { modelPath, instanceId, err },
          'Failed to test chat template support, assuming true'
        )
      }

      modelStore.set(instance)

      // Emit status event for running state
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          'starting' as ModelStatus,
          'running' as ModelStatus,
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

      // Note: We don't delete the IPC segment here - it's shared by all models

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
      // Use SIGKILL to bypass Python signal handlers that would delete
      // the shared KVCached IPC segment (kvcached_mem_info)
      await killProcessImmediate(proc)

      // Note: We intentionally do NOT delete the IPC segment here.
      // All models share 'kvcached_mem_info' - it's only deleted on server shutdown.

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
   * Delete the shared KVCached IPC segment
   * Called only during server shutdown when all models are unloaded
   */
  private async deleteSharedIpcSegment(): Promise<void> {
    const segmentName = 'kvcached_mem_info'
    try {
      const proc = spawn('kvctl', ['delete', segmentName])
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve())
        proc.on('error', () => resolve()) // Ignore errors
      })
      this.logger.info('Deleted shared KVCached IPC segment')
    } catch {
      // Non-critical, segment may not exist
      this.logger.debug({ segmentName }, 'Failed to delete shared IPC segment (non-critical)')
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

    // Delete the shared KVCached IPC segment now that all models are unloaded
    await this.deleteSharedIpcSegment()
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
