import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { hostname } from 'node:os'
import type { ModelInstance, ModelStatus, ClusterEvent } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import { config, isInferenceSimMode } from '../config.js'
import {
  getNextPort,
  killProcessImmediate,
  killProcessGracefully,
  isProcessRunning,
  getDescendantPids,
  findVllmProcessesByPort,
  findProcessesByEnvMarker,
} from '../utils/process.js'
import { NotFoundError, InternalError } from '../utils/errors.js'
import { buildErrorMessage } from '../utils/error-parser.js'
import { parseMemoryMetrics, extractEngineCorePid } from '../utils/memory-parser.js'
import { LoadProgressTracker } from '../utils/load-progress-tracker.js'
import { getNvidiaSmiInfo } from '../utils/gpu-info.js'
import { simGpuTracker } from '../utils/sim-gpu-tracker.js'
import { estimateModelMemory } from '../utils/model-memory-estimator.js'
import type { Logger } from '@sardeenz/utils'
import { processLogBuffer } from './process-log-buffer.js'
import { eventBus } from './event-bus.js'
import { runtimeSettings } from '../stores/runtime-settings.js'
import { peerStore } from '../stores/peer-store.js'
import { GpuSelector } from './gpu-selector.js'
import { signRequest } from './cluster-auth.js'

export interface LaunchModelOptions {
  modelPath: string
  maxTokens?: number
  extraArgs?: string[]
  gpuIds?: number[] // Optional explicit GPU selection (auto-selects if not provided)
  tensorParallelSize?: number // For large models spanning multiple GPUs (default: 1)
  sourceType?: 'huggingface' | 'local' // Model source type (default: 'huggingface')
  servedModelName?: string // Name for vLLM --served-model-name (default: modelPath)
  enableSleepMode?: boolean // Enable vLLM sleep mode for GPU memory offloading
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

/**
 * Build IPC segment name for kvcached based on GPU(s)
 * Single GPU: kvcached_vllm_GPU0
 * Multi-GPU (tensor parallel): kvcached_vllm_GPU0_GPU1
 * Virtual GPU mode: always uses kvcached_vllm_GPU0 (all vGPUs map to physical GPU 0)
 */
function buildIpcSegmentName(gpuIds: number[]): string {
  if (config.virtualGpuCount > 0) {
    // In virtual GPU mode, all GPUs map to physical GPU 0
    return 'kvcached_vllm_GPU0'
  }
  const sortedIds = [...gpuIds].sort((a, b) => a - b)
  return `kvcached_vllm_GPU${sortedIds.join('_GPU')}`
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
   * Broadcast a ClusterEvent to all peers (fire-and-forget).
   * Only sends when in cluster mode (CLUSTER_PEERS or K8s env detected).
   */
  private broadcastClusterEvent(event: ClusterEvent): void {
    const isClusterMode = !!(process.env.KUBERNETES_SERVICE_HOST || config.clusterPeers)
    if (!isClusterMode) return

    const localPodId = hostname()
    const peers = peerStore.getAllPeers().filter((p) => p.podId !== localPodId)
    if (peers.length === 0) return

    const path = '/internal/cluster/event'
    const body = JSON.stringify(event)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (config.clusterSecret) {
      const { signature, timestamp } = signRequest('POST', path, body, config.clusterSecret)
      headers['x-cluster-signature'] = signature
      headers['x-cluster-timestamp'] = String(timestamp)
    }

    for (const peer of peers) {
      fetch(`http://${peer.address}:${peer.port}${path}`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      }).catch((err) => {
        this.logger.debug({ err, podId: peer.podId }, 'Failed to broadcast cluster event')
      })
    }
  }

  /**
   * Launch a new model instance
   * Supports multiple instances of the same model (FR-004)
   * GPU memory is managed by kvcached
   */
  async launchModel(options: LaunchModelOptions): Promise<ModelInstance> {
    const {
      modelPath,
      maxTokens = 4096,
      extraArgs = [],
      gpuIds,
      tensorParallelSize = 1,
      servedModelName,
      enableSleepMode = false,
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

    // Determine kvcached status
    // kvcached supports tensor parallelism as of Q2 2025
    // inference-sim mode never uses kvcached
    const enableKvcached = isInferenceSimMode() ? false : config.enableKvcached

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
      memoryBaselineByGpu: {}, // Will be populated when model becomes ready
      sleepModeEnabled: enableSleepMode,
      routable: true, // Default to routable; set to false during move operations
    }

    try {
      // Build command and environment based on backend mode
      let spawnBinary: string
      let allArgs: string[]
      let spawnEnv: NodeJS.ProcessEnv

      if (isInferenceSimMode()) {
        // inference-sim mode: simple arg list, minimal environment
        spawnBinary = config.inferenceSimBinary
        const simArgs = [
          '--model', modelPath,
          '--port', String(port),
          '--served-model-name', effectiveModelName,
          '--max-model-len', String(maxTokens),
          '--startup-duration', config.simStartupDuration,
          '--time-to-first-token', '50ms',
          '--inter-token-latency', '15ms',
          '--mode', 'echo',
        ]
        if (enableSleepMode) {
          simArgs.push('--enable-sleep-mode')
        }
        allArgs = simArgs

        spawnEnv = {
          ...process.env,
          SARDEENZ_INSTANCE_ID: instanceId,
          ...(enableSleepMode ? { VLLM_SERVER_DEV_MODE: '1' } : {}),
        }

        instance.ipcSegmentName = ''
        instance.launchCommand = `${spawnBinary} ${allArgs.join(' ')}`
      } else {
        // vLLM mode: full arg construction with GPU/kvcached configuration
        spawnBinary = 'vllm'
        const hfToken = runtimeSettings.getHfToken()

        const baseArgs = ['serve', modelPath, '--disable-log-stats', `--port=${port}`]

        if (!hasArg(sanitizedExtraArgs, '--served-model-name')) {
          baseArgs.push(`--served-model-name=${effectiveModelName}`)
        }

        if (!hasArg(sanitizedExtraArgs, '--max-model-len')) {
          baseArgs.push(`--max-model-len=${maxTokens}`)
        }

        if (tensorParallelSize > 1) {
          baseArgs.push(`--tensor-parallel-size=${tensorParallelSize}`)
        }

        if (enableKvcached) {
          baseArgs.push('--no-enable-prefix-caching')
        }

        if (enableSleepMode) {
          baseArgs.push('--enable-sleep-mode')
        }

        allArgs = [...baseArgs, ...sanitizedExtraArgs]

        const kvcachedIpcName = enableKvcached ? buildIpcSegmentName(targetGpuIds) : undefined
        const cudaVisibleDevices = config.virtualGpuCount > 0 ? '0' : targetGpuIds.join(',')
        if (config.virtualGpuCount > 0) {
          this.logger.info(
            { virtualGpuIds: targetGpuIds, physicalGpu: 0 },
            'Virtual GPU mode: mapping to physical GPU 0'
          )
        }

        const envVars = [`CUDA_VISIBLE_DEVICES=${cudaVisibleDevices}`]
        if (kvcachedIpcName) {
          envVars.push(`KVCACHED_IPC_NAME=${kvcachedIpcName}`)
        }
        instance.launchCommand = `${envVars.join(' ')} vllm ${allArgs.join(' ')}`

        spawnEnv = {
          ...process.env,
          SARDEENZ_INSTANCE_ID: instanceId,
          CUDA_VISIBLE_DEVICES: cudaVisibleDevices,
          ENABLE_KVCACHED: enableKvcached ? 'true' : 'false',
          KVCACHED_AUTOPATCH: config.kvcachedAutopatch && enableKvcached ? '1' : '0',
          ...(kvcachedIpcName ? { KVCACHED_IPC_NAME: kvcachedIpcName } : {}),
          ...(hfToken ? { HF_TOKEN: hfToken } : {}),
          ...(enableSleepMode ? { VLLM_SERVER_DEV_MODE: '1' } : {}),
        }
      }

      const proc = spawn(spawnBinary, allArgs, {
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const backendLabel = isInferenceSimMode() ? 'inference-sim' : 'vLLM'

      if (!proc.pid) {
        throw new InternalError(`Failed to spawn ${backendLabel} process`)
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
        this.logger.info({ modelPath, instanceId, output }, `${backendLabel} stdout`)
      })

      proc.stderr?.on('data', (data) => {
        const output = data.toString().trim()
        processLogBuffer.append(instanceId, 'stderr', output)
        this.logger.info({ modelPath, instanceId, output }, `${backendLabel} stderr`)
      })

      // Handle process exit
      proc.on('exit', (code, signal) => {
        this.logger.info({ modelPath, instanceId, code, signal }, `${backendLabel} process exited`)
        this.handleProcessExit(instanceId, code, signal)
      })

      proc.on('error', (err) => {
        this.logger.error({ modelPath, instanceId, err }, `${backendLabel} process error`)
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
   * Launch a model and wait for it to reach terminal status (running or failed).
   * Use this for sequential loading where you need to wait for one model
   * to fully load before starting another (e.g., configuration restore).
   */
  async launchModelAndWait(options: LaunchModelOptions): Promise<ModelInstance> {
    const instance = await this.launchModel(options)

    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        const current = modelStore.get(instance.id)
        if (!current) {
          reject(new Error('Model instance disappeared during loading'))
          return
        }
        if (current.status === 'running') {
          resolve(current)
        } else if (current.status === 'failed') {
          reject(new Error(current.errorMessage || 'Model failed to load'))
        } else {
          // Still starting, check again in 1 second
          setTimeout(checkStatus, 1000)
        }
      }
      checkStatus()
    })
  }

  /**
   * Monitor model startup in background and update status when ready
   * Called without await so API can return immediately
   */
  private async monitorModelStartup(
    instanceId: string,
    port: number,
    modelPath: string
  ): Promise<void> {
    // Set up progress tracking before waiting for ready
    const progressTracker = new LoadProgressTracker()
    let lastProgress = 0

    // Emit initial progress event
    eventBus.emitEvent(
      eventBus.createProgressEvent(instanceId, 'loading', 0, 'Initializing model load...')
    )

    // Subscribe to log events for real-time milestone detection
    const unsubscribe = processLogBuffer.onLog(instanceId, (entry) => {
      const milestoneProgress = progressTracker.processLogLine(entry.content)
      if (milestoneProgress !== undefined && milestoneProgress > lastProgress) {
        const message = LoadProgressTracker.getProgressMessage(milestoneProgress)
        eventBus.emitEvent(
          eventBus.createProgressEvent(instanceId, 'loading', milestoneProgress, message)
        )
        lastProgress = milestoneProgress
      }
    })

    // Process existing log buffer to catch milestones that already fired
    const existingLogs = processLogBuffer.getBuffer(instanceId)
    if (existingLogs.length > 0) {
      const catchUpProgress = progressTracker.processExistingLogs(existingLogs)
      if (catchUpProgress !== undefined && catchUpProgress > lastProgress) {
        const message = LoadProgressTracker.getProgressMessage(catchUpProgress)
        eventBus.emitEvent(
          eventBus.createProgressEvent(instanceId, 'loading', catchUpProgress, message)
        )
        lastProgress = catchUpProgress
      }
    }

    try {
      // Wait for model to be ready (configurable via VLLM_STARTUP_TIMEOUT)
      await this.waitForReady(port, modelPath, config.vllmStartupTimeout)

      // Emit final progress event for ready state
      eventBus.emitEvent(
        eventBus.createProgressEvent(instanceId, 'ready', 100, 'Model ready for inference')
      )

      // Clean up progress subscription
      unsubscribe()

      // Get current instance state
      const instance = modelStore.get(instanceId)
      if (!instance) {
        this.logger.warn({ instanceId }, 'Instance not found after model ready')
        return
      }

      // Update status to running
      instance.status = 'running' as ModelStatus
      instance.readyAt = new Date()

      if (isInferenceSimMode()) {
        // inference-sim mode: estimate memory and allocate on simulated GPUs
        const estimate = estimateModelMemory(modelPath, config.simModelMemoryGB)
        const estimatedMemoryMB = estimate.estimatedMemoryGB * 1024

        for (const gpuIndex of instance.gpuIds) {
          const perGpuMemoryMB =
            instance.gpuIds.length > 1
              ? Math.ceil(estimatedMemoryMB / instance.gpuIds.length)
              : estimatedMemoryMB
          simGpuTracker.allocate(gpuIndex, instanceId, perGpuMemoryMB)
        }

        // Set memory fields from estimate
        const gpuInfo = simGpuTracker.getNvidiaSmiInfo()
        const gpuTotalMB = gpuInfo.gpus[0]?.memoryTotalMB ?? config.simGpuMemoryGB * 1024
        instance.gpuMemoryUtilization = gpuTotalMB > 0 ? estimatedMemoryMB / gpuTotalMB : 0

        const memoryByGpu: Record<number, number> = {}
        for (const gpuIndex of instance.gpuIds) {
          const perGpuGB =
            instance.gpuIds.length > 1
              ? estimate.estimatedMemoryGB / instance.gpuIds.length
              : estimate.estimatedMemoryGB
          memoryByGpu[gpuIndex] = perGpuGB
        }
        instance.memoryBaselineByGpu = memoryByGpu
        instance.hasChatTemplate = true

        this.logger.info(
          {
            instanceId,
            modelPath,
            estimatedMemoryGB: estimate.estimatedMemoryGB,
            source: estimate.source,
            detectedSizeB: estimate.detectedSizeB,
          },
          'Allocated simulated GPU memory for inference-sim model'
        )
      } else {
        // vLLM mode: extract EngineCore PID, query NVML, parse logs

        const logs = processLogBuffer.getBuffer(instanceId)

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

        let actualGpuMemoryGiB: number | undefined
        try {
          const gpuInfo = await getNvidiaSmiInfo()

          const primaryPid = instance.engineCorePid ?? instance.processId
          const descendantPids = await getDescendantPids(primaryPid)
          const allPids = new Set([primaryPid, ...descendantPids])

          if (instance.engineCorePid) {
            allPids.add(instance.processId)
            const apiServerDescendants = await getDescendantPids(instance.processId)
            for (const pid of apiServerDescendants) {
              allPids.add(pid)
            }
          }

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
              'Got actual GPU memory usage from NVML'
            )
          } else {
            this.logger.warn(
              {
                modelPath,
                instanceId,
                engineCorePid: instance.engineCorePid,
                processId: instance.processId,
                searchedPids: Array.from(allPids),
              },
              'No matching processes found in NVML output'
            )
          }

          const memoryByGpu: Record<number, number> = {}
          for (const proc of gpuInfo.processes) {
            if (allPids.has(proc.pid) && instance.gpuIds.includes(proc.gpu)) {
              memoryByGpu[proc.gpu] = (memoryByGpu[proc.gpu] ?? 0) + proc.gpuMemoryMB / 1024
            }
          }
          instance.memoryBaselineByGpu = memoryByGpu
          this.logger.info(
            { instanceId, modelPath, memoryBaselineByGpu: memoryByGpu },
            'Captured memory baseline per GPU'
          )
        } catch (err) {
          this.logger.warn({ modelPath, instanceId, err }, 'Failed to get GPU memory from NVML')
        }

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

          if (testResponse.status === 400) {
            const errorData = await testResponse.json()
            const errorMsg = JSON.stringify(errorData).toLowerCase()

            if (errorMsg.includes('chat template') || errorMsg.includes('chat_template')) {
              instance.hasChatTemplate = false
              this.logger.info(
                { modelPath, instanceId },
                'Model does not support chat templates (will need manual wrapping)'
              )
            } else {
              instance.hasChatTemplate = true
              this.logger.info({ modelPath, instanceId }, 'Model supports chat templates')
            }
          } else {
            instance.hasChatTemplate = true
            this.logger.info({ modelPath, instanceId }, 'Model supports chat templates')
          }
        } catch (err) {
          instance.hasChatTemplate = true
          this.logger.warn(
            { modelPath, instanceId, err },
            'Failed to test chat template support, assuming true'
          )
        }
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

      // Broadcast cluster event to peers
      this.broadcastClusterEvent({
        type: 'model-loaded',
        podId: hostname(),
        term: 0,
        timestamp: Date.now(),
        payload: { instanceId, modelPath, modelName: instance.modelName, port },
      })
    } catch (err) {
      // Clean up progress subscription
      unsubscribe()

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

      this.logger.info(
        { instanceId: instance.id, modelPath: instance.modelPath },
        'Model entry removed'
      )
      this.emit('model:unloaded', instance)

      this.broadcastClusterEvent({
        type: 'model-unloaded',
        podId: hostname(),
        term: 0,
        timestamp: Date.now(),
        payload: { instanceId: instance.id, modelPath: instance.modelPath },
      })
      return
    }

    // Update status for active process
    instance.status = 'stopping' as ModelStatus
    modelStore.set(instance)

    try {
      if (isInferenceSimMode()) {
        // inference-sim: graceful SIGTERM shutdown, no child process cleanup needed
        await killProcessGracefully(proc)
        simGpuTracker.deallocate(instance.id)
      } else {
        // vLLM: SIGKILL to bypass Python signal handlers that would delete
        // the shared kvcached IPC segment (kvcached_mem_info)
        await killProcessImmediate(proc)

        if (instance.engineCorePid) {
          try {
            process.kill(instance.engineCorePid, 'SIGKILL')
            this.logger.debug(
              { instanceId: instance.id, engineCorePid: instance.engineCorePid },
              'Killed EngineCore process'
            )
          } catch {
            // Process may have already exited
          }
        }

        const markedPids = await findProcessesByEnvMarker('SARDEENZ_INSTANCE_ID', instance.id)
        if (markedPids.length > 0) {
          this.logger.info(
            { instanceId: instance.id, markedPids },
            'Found processes with instance marker, killing them'
          )
          for (const pid of markedPids) {
            try {
              process.kill(pid, 'SIGKILL')
            } catch {
              // Process may have already exited
            }
          }
        }

        const portPids = await findVllmProcessesByPort(instance.port)
        if (portPids.length > 0) {
          this.logger.info(
            { instanceId: instance.id, portPids, port: instance.port },
            'Found remaining vLLM processes by port, killing them'
          )
          for (const pid of portPids) {
            try {
              process.kill(pid, 'SIGKILL')
            } catch {
              // Process may have already exited
            }
          }
        }
      }

      // Remove from stores
      modelStore.delete(instance.id)
      this.processes.delete(instance.id)

      this.logger.info(
        { instanceId: instance.id, modelPath: instance.modelPath },
        'Model unloaded successfully'
      )
      this.emit('model:unloaded', instance)

      this.broadcastClusterEvent({
        type: 'model-unloaded',
        podId: hostname(),
        term: 0,
        timestamp: Date.now(),
        payload: { instanceId: instance.id, modelPath: instance.modelPath },
      })
    } catch (err) {
      this.logger.error({ instanceId: instance.id, err }, 'Error unloading model')
      throw new InternalError(
        `Failed to unload model: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
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
   * Put a model instance to sleep.
   * Offloads model weights to CPU RAM and frees GPU memory.
   * Requires model to have been loaded with enableSleepMode=true.
   */
  async sleepModel(instanceId: string, level: 1 | 2 = 1): Promise<void> {
    const instance = modelStore.get(instanceId)
    if (!instance) {
      throw new NotFoundError(`Model instance ${instanceId} not found`)
    }

    if (!instance.sleepModeEnabled) {
      throw new InternalError('Model was not loaded with sleep mode enabled')
    }

    if (instance.status !== 'running') {
      throw new InternalError(`Cannot sleep model: current status is ${instance.status}`)
    }

    try {
      // Call vLLM sleep endpoint
      const response = await fetch(`http://localhost:${instance.port}/sleep?level=${level}`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        throw new InternalError(`Failed to put model to sleep: ${errorText}`)
      }

      // Update instance state
      const previousStatus = instance.status
      instance.status = 'sleeping' as ModelStatus
      instance.sleepLevel = level
      instance.sleptAt = new Date()
      modelStore.set(instance)

      // Emit status event
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          previousStatus,
          'sleeping' as ModelStatus,
          `Model sleeping (level ${level})`
        )
      )

      this.logger.info({ instanceId, modelPath: instance.modelPath, level }, 'Model put to sleep')
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof InternalError) {
        throw err
      }
      throw new InternalError(
        `Failed to put model to sleep: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Wake a sleeping model instance.
   * Reloads model weights from CPU RAM back to GPU.
   */
  async wakeModel(instanceId: string, tags?: 'weights' | 'kv_cache'): Promise<void> {
    const instance = modelStore.get(instanceId)
    if (!instance) {
      throw new NotFoundError(`Model instance ${instanceId} not found`)
    }

    if (instance.status !== 'sleeping') {
      throw new InternalError('Model is not sleeping')
    }

    try {
      // Build request body for optional tags
      const requestBody = tags ? JSON.stringify({ tags: [tags] }) : undefined
      const headers: Record<string, string> = {}
      if (requestBody) {
        headers['Content-Type'] = 'application/json'
      }

      // Call vLLM wake_up endpoint
      const response = await fetch(`http://localhost:${instance.port}/wake_up`, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(60000), // Wake may take longer
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        throw new InternalError(`Failed to wake model: ${errorText}`)
      }

      // Poll for ready state (model may need time to reload weights)
      const pollStart = Date.now()
      const pollTimeout = 120000 // 2 minutes max
      const pollInterval = 2000

      while (Date.now() - pollStart < pollTimeout) {
        try {
          const healthResponse = await fetch(`http://localhost:${instance.port}/health`, {
            signal: AbortSignal.timeout(2000),
          })

          if (healthResponse.ok) {
            break // Model is ready
          }
        } catch {
          // Continue polling
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      }

      // Update instance state
      const previousStatus = instance.status
      instance.status = 'running' as ModelStatus
      instance.sleepLevel = undefined
      instance.sleptAt = undefined
      modelStore.set(instance)

      // Emit status event
      eventBus.emitEvent(
        eventBus.createStatusEvent(
          instanceId,
          previousStatus,
          'running' as ModelStatus,
          'Model woken up and ready'
        )
      )

      this.logger.info({ instanceId, modelPath: instance.modelPath }, 'Model woken up')
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof InternalError) {
        throw err
      }
      throw new InternalError(
        `Failed to wake model: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Check if a model instance is sleeping.
   */
  async isSleeping(instanceId: string): Promise<{ isSleeping: boolean; level?: 1 | 2 }> {
    const instance = modelStore.get(instanceId)
    if (!instance) {
      throw new NotFoundError(`Model instance ${instanceId} not found`)
    }

    // If status is sleeping in our store, return that
    if (instance.status === 'sleeping') {
      return { isSleeping: true, level: instance.sleepLevel }
    }

    // Optionally verify with vLLM endpoint if sleep mode is enabled
    if (instance.sleepModeEnabled && instance.status === 'running') {
      try {
        const response = await fetch(`http://localhost:${instance.port}/is_sleeping`, {
          signal: AbortSignal.timeout(5000),
        })

        if (response.ok) {
          const data = (await response.json()) as { is_sleeping: boolean }
          return {
            isSleeping: data.is_sleeping,
            level: data.is_sleeping ? instance.sleepLevel : undefined,
          }
        }
      } catch {
        // If endpoint fails, rely on stored state
      }
    }

    return { isSleeping: false }
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
   * Get IPC segment name for kvcached
   * Include instance ID suffix for uniqueness when running multiple instances
   */
  private getIpcSegmentName(modelPath: string, instanceId: string): string {
    // Convert "meta-llama/Llama-3.2-1B" -> "VLLM_META_LLAMA_LLAMA_3_2_1B"
    const name = modelPath.replace(/\//g, '_').replace(/-/g, '_').replace(/\./g, '_').toUpperCase()
    // Add short instance suffix for uniqueness
    const suffix = instanceId.slice(0, 8).toUpperCase()
    return `VLLM_${name}_${suffix}`
  }

  /**
   * Delete all GPU-specific kvcached IPC segments
   * Called only during server shutdown when all models are unloaded
   */
  private async deleteSharedIpcSegment(): Promise<void> {
    // Collect unique IPC segment names from currently loaded models
    const segmentNames = new Set<string>()
    for (const model of this.listModels()) {
      const name = buildIpcSegmentName(model.gpuIds)
      segmentNames.add(name)
    }

    // Also try common single-GPU segments (0-7) in case models were already unloaded
    for (let i = 0; i < 8; i++) {
      segmentNames.add(`kvcached_vllm_GPU${i}`)
    }

    // Try common multi-GPU combinations for tensor-parallel models
    // Common 2-GPU pairs
    for (let i = 0; i < 8; i += 2) {
      segmentNames.add(`kvcached_vllm_GPU${i}_GPU${i + 1}`)
    }
    // Common 4-GPU groups
    segmentNames.add('kvcached_vllm_GPU0_GPU1_GPU2_GPU3')
    segmentNames.add('kvcached_vllm_GPU4_GPU5_GPU6_GPU7')
    // 8-GPU group
    segmentNames.add('kvcached_vllm_GPU0_GPU1_GPU2_GPU3_GPU4_GPU5_GPU6_GPU7')

    // Delete each segment
    for (const segmentName of segmentNames) {
      try {
        const proc = spawn('kvctl', ['delete', segmentName])
        await new Promise<void>((resolve) => {
          proc.on('exit', (code) => {
            if (code === 0) {
              this.logger.info({ segmentName }, 'Deleted kvcached IPC segment')
            }
            resolve()
          })
          proc.on('error', () => resolve())
        })
      } catch {
        // Non-critical, segment may not exist
        this.logger.debug({ segmentName }, 'Failed to delete IPC segment (non-critical)')
      }
    }

    // Also try deleting the legacy global segment for backward compatibility
    try {
      const proc = spawn('kvctl', ['delete', 'kvcached_mem_info'])
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve())
        proc.on('error', () => resolve())
      })
    } catch {
      // Ignore - legacy segment may not exist
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(
    instanceId: string,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const instance = modelStore.get(instanceId)
    if (!instance) return

    // Free simulated GPU memory on unexpected exit
    if (isInferenceSimMode()) {
      simGpuTracker.deallocate(instanceId)
    }

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

      this.logger.error(
        { instanceId, modelPath: instance.modelPath, errorMessage },
        'Model failed to load'
      )
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
    const extractedError = logs.length > 0 ? buildErrorMessage(logs, null, null) : err.message

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

    this.logger.error(
      { instanceId, modelPath: instance.modelPath, errorMessage: extractedError },
      'Model process error'
    )
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
        this.logger.error(
          { instanceId: model.id, modelPath: model.modelPath, err },
          'Error cleaning up model'
        )
      }
    }

    // Clean up log buffer
    processLogBuffer.cleanup()

    // Delete the shared kvcached IPC segment now that all models are unloaded
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

// Singleton instance
let _modelManagerInstance: ModelManager | null = null

/**
 * Get the singleton ModelManager instance.
 * This ensures all routes share the same instance and its processes Map.
 */
export function getModelManager(logger: Logger): ModelManager {
  if (!_modelManagerInstance) {
    _modelManagerInstance = new ModelManager(logger)
  }
  return _modelManagerInstance
}
