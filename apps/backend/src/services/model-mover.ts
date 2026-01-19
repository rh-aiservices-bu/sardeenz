/**
 * Model Mover Service
 * Orchestrates blue-green model moves between GPUs
 */

import { randomUUID } from 'crypto'
import type { Logger } from '@sardeenz/utils'
import type { MoveOperation, MoveOperationPhase } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import { moveStore } from '../stores/move-store.js'
import { metricsStore } from '../stores/metrics-store.js'
import { getModelManager, type ModelManager } from './model-manager.js'
import { getGpuSelector, type GpuSelector } from './gpu-selector.js'
import { NotFoundError, ConflictError, BadRequestError } from '../utils/errors.js'
import { processLogBuffer } from './process-log-buffer.js'
import { LoadProgressTracker } from '../utils/load-progress-tracker.js'

/** Move progress event for SSE streaming */
export interface MoveProgressEvent {
  id: string
  timestamp: string
  moveId: string
  phase: MoveOperationPhase
  message: string
  progress?: number
  error?: string
}

/** SSE connection for move events */
interface MoveSSEConnection {
  id: string
  send: (event: MoveProgressEvent) => void
}

export class ModelMover {
  private logger: Logger
  private modelManager: ModelManager
  private gpuSelector: GpuSelector

  /** SSE connections per move ID */
  private moveConnections: Map<string, Set<MoveSSEConnection>> = new Map()

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'ModelMover' })
    this.modelManager = getModelManager(logger)
    this.gpuSelector = getGpuSelector(logger)
  }

  /**
   * Initiate a model move operation.
   * Returns immediately with move ID for SSE tracking.
   */
  async moveModel(request: {
    instanceId: string
    targetGpuIds: number[]
    drainTimeoutMs?: number
  }): Promise<{
    moveId: string
    sourceInstanceId: string
    targetGpuIds: number[]
  }> {
    const { instanceId, targetGpuIds, drainTimeoutMs = 60000 } = request

    // 1. Validate source exists and is running or sleeping
    const source = modelStore.get(instanceId)
    if (!source) {
      throw new NotFoundError(`Model instance ${instanceId} not found`)
    }

    if (source.status !== 'running' && source.status !== 'sleeping') {
      throw new BadRequestError(
        `Cannot move model in status '${source.status}'. Model must be running or sleeping.`
      )
    }

    // 2. Validate not already being moved
    const existingMove = moveStore.getBySourceInstance(instanceId)
    if (existingMove) {
      throw new ConflictError(
        `Model ${instanceId} is already being moved (move ID: ${existingMove.id})`
      )
    }

    // 3. Validate target GPUs different from source
    const sourceGpuSet = new Set(source.gpuIds)
    const allSameGpus =
      targetGpuIds.length === source.gpuIds.length &&
      targetGpuIds.every((id) => sourceGpuSet.has(id))
    if (allSameGpus) {
      throw new BadRequestError('Target GPUs must be different from source GPUs')
    }

    // 4. Validate tensor parallelism matches
    if (targetGpuIds.length !== source.tensorParallelSize) {
      throw new BadRequestError(
        `Target GPU count (${targetGpuIds.length}) must match tensor parallel size (${source.tensorParallelSize})`
      )
    }

    // 5. Check target GPU memory (pre-flight)
    // Use source's memory baseline as estimate
    const requiredMemoryGb = source.memoryBaselineByGpu
      ? Math.max(...Object.values(source.memoryBaselineByGpu))
      : (source.memoryMetrics?.totalGpuMemoryGiB ?? 8) // Fallback estimate

    const memoryCheck = await this.gpuSelector.checkMemoryAvailability(targetGpuIds, requiredMemoryGb)
    if (!memoryCheck.available) {
      throw new BadRequestError(`Insufficient GPU memory: ${memoryCheck.message}`)
    }

    // 6. Create move operation record
    const moveId = randomUUID()
    const operation: MoveOperation = {
      id: moveId,
      sourceInstanceId: instanceId,
      targetInstanceId: '', // Will be set during spawn
      targetGpuIds,
      drainTimeoutMs,
      phase: 'validating',
      startedAt: new Date(),
    }

    moveStore.create(operation) // This acquires the lock

    // 7. Start async move process
    this.executeMoveAsync(moveId).catch((err) => {
      this.logger.error({ moveId, err }, 'Move execution failed')
    })

    // 8. Return move ID for SSE tracking
    return {
      moveId,
      sourceInstanceId: instanceId,
      targetGpuIds,
    }
  }

  /**
   * Execute the move operation asynchronously
   */
  private async executeMoveAsync(moveId: string): Promise<void> {
    const op = moveStore.get(moveId)
    if (!op) {
      this.logger.error({ moveId }, 'Move operation not found')
      return
    }

    const source = modelStore.get(op.sourceInstanceId)
    if (!source) {
      this.emitProgress(moveId, 'failed', 'Source model disappeared', undefined, 'Source model not found')
      moveStore.complete(moveId, 'failed', 'Source model not found')
      return
    }

    try {
      // Phase: SPAWNING
      this.emitProgress(moveId, 'spawning', 'Loading model on target GPU...')
      moveStore.update(moveId, { phase: 'spawning' })

      // Launch new instance with same config on target GPUs
      const targetInstance = await this.modelManager.launchModel({
        modelPath: source.modelPath,
        maxTokens: source.maxTokens,
        gpuIds: op.targetGpuIds,
        tensorParallelSize: source.tensorParallelSize,
        servedModelName: source.modelName,
        enableSleepMode: source.sleepModeEnabled,
      })

      // Update operation with target instance ID
      moveStore.update(moveId, { targetInstanceId: targetInstance.id })

      // Wait for target to reach 'running' status
      await this.waitForRunning(targetInstance.id, moveId)

      // Phase: SWITCHING
      this.emitProgress(moveId, 'switching', 'Switching traffic to new instance...')
      moveStore.update(moveId, { phase: 'switching' })

      // Make source non-routable (stops new requests going to it)
      modelStore.setRoutable(op.sourceInstanceId, false)

      // Phase: DRAINING
      this.emitProgress(moveId, 'draining', 'Waiting for active connections to complete...')
      moveStore.update(moveId, { phase: 'draining' })

      // Wait for source connections to drain
      await this.waitForDrain(op.sourceInstanceId, op.drainTimeoutMs, moveId)

      // Phase: COMPLETING
      this.emitProgress(moveId, 'completing', 'Unloading source instance...')
      moveStore.update(moveId, { phase: 'completing' })

      // Unload source instance
      await this.modelManager.unloadModel(op.sourceInstanceId)

      // Success!
      this.emitProgress(moveId, 'completed', 'Move completed successfully')
      moveStore.complete(moveId, 'completed')

      this.logger.info(
        {
          moveId,
          sourceId: op.sourceInstanceId,
          targetId: targetInstance.id,
          targetGpus: op.targetGpuIds,
        },
        'Model move completed successfully'
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      this.logger.error({ moveId, err }, 'Move operation failed')

      // Attempt rollback
      await this.rollback(moveId, op, errorMessage)
    }
  }

  /**
   * Wait for target instance to reach 'running' status
   * Uses log-based milestone detection for meaningful progress updates
   */
  private async waitForRunning(instanceId: string, moveId: string): Promise<void> {
    const maxWait = 30 * 60 * 1000 // 30 minutes max
    const pollInterval = 2000 // 2 seconds
    const startTime = Date.now()
    let lastProgress = 0

    // Create progress tracker for log-based milestone detection
    const progressTracker = new LoadProgressTracker()

    // Subscribe to log events for real-time milestone detection
    const unsubscribe = processLogBuffer.onLog(instanceId, (entry) => {
      const milestoneProgress = progressTracker.processLogLine(entry.content)
      if (milestoneProgress !== undefined && milestoneProgress > lastProgress) {
        const message = LoadProgressTracker.getProgressMessage(milestoneProgress)
        this.emitProgress(moveId, 'spawning', message, milestoneProgress)
        lastProgress = milestoneProgress
      }
    })

    // Process existing log buffer to catch milestones that fired before subscription
    const existingLogs = processLogBuffer.getBuffer(instanceId)
    if (existingLogs.length > 0) {
      const catchUpProgress = progressTracker.processExistingLogs(existingLogs)
      if (catchUpProgress !== undefined && catchUpProgress > lastProgress) {
        const message = LoadProgressTracker.getProgressMessage(catchUpProgress)
        this.emitProgress(moveId, 'spawning', message, catchUpProgress)
        lastProgress = catchUpProgress
      }
    }

    try {
      while (Date.now() - startTime < maxWait) {
        const instance = modelStore.get(instanceId)
        if (!instance) {
          throw new Error('Target instance disappeared during loading')
        }

        if (instance.status === 'running') {
          this.emitProgress(moveId, 'spawning', 'Target model is ready', 100)
          return
        }

        if (instance.status === 'failed') {
          throw new Error(instance.errorMessage || 'Target model failed to load')
        }

        // Get interpolated progress between milestones
        const interpolatedProgress = progressTracker.getInterpolatedProgress()
        if (interpolatedProgress > lastProgress) {
          const message = LoadProgressTracker.getProgressMessage(interpolatedProgress)
          this.emitProgress(moveId, 'spawning', message, interpolatedProgress)
          lastProgress = interpolatedProgress
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      }

      throw new Error('Timeout waiting for target model to become ready')
    } finally {
      unsubscribe()
    }
  }

  /**
   * Wait for source connections to drain
   */
  private async waitForDrain(
    instanceId: string,
    timeoutMs: number,
    moveId: string
  ): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 500 // 500ms

    while (Date.now() - startTime < timeoutMs) {
      const connections = metricsStore.getInstanceConnections(instanceId)

      if (connections === 0) {
        this.emitProgress(moveId, 'draining', 'All connections drained', 100)
        return
      }

      const elapsed = Date.now() - startTime
      const progress = Math.min(99, Math.floor((elapsed / timeoutMs) * 100))
      this.emitProgress(
        moveId,
        'draining',
        `Waiting for ${connections} active connection(s) to complete...`,
        progress
      )

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    // Timeout reached - force continue
    const remaining = metricsStore.getInstanceConnections(instanceId)
    this.logger.warn(
      { moveId, instanceId, remaining },
      'Drain timeout reached, force completing with active connections'
    )
    this.emitProgress(
      moveId,
      'draining',
      `Drain timeout - ${remaining} connection(s) may be interrupted`,
      100
    )
  }

  /**
   * Rollback on failure - keep source, cleanup target
   */
  private async rollback(
    moveId: string,
    op: MoveOperation,
    errorMessage: string
  ): Promise<void> {
    this.logger.info({ moveId }, 'Rolling back move operation')

    try {
      // Restore source routability
      modelStore.setRoutable(op.sourceInstanceId, true)

      // Cleanup target if it was created
      if (op.targetInstanceId) {
        try {
          await this.modelManager.unloadModel(op.targetInstanceId)
        } catch (unloadErr) {
          this.logger.warn(
            { moveId, targetId: op.targetInstanceId, err: unloadErr },
            'Failed to cleanup target instance during rollback'
          )
        }
      }
    } catch (rollbackErr) {
      this.logger.error({ moveId, err: rollbackErr }, 'Rollback failed')
    }

    this.emitProgress(moveId, 'failed', `Move failed: ${errorMessage}`, undefined, errorMessage)
    moveStore.complete(moveId, 'failed', errorMessage)
  }

  /**
   * Cancel an in-progress move operation
   */
  async cancelMove(moveId: string, force: boolean = false): Promise<void> {
    const op = moveStore.get(moveId)
    if (!op) {
      throw new NotFoundError(`Move operation ${moveId} not found`)
    }

    if (op.phase === 'completed' || op.phase === 'failed') {
      return // Already terminal, no-op
    }

    if (op.phase === 'completing') {
      throw new ConflictError('Cannot cancel move in completing phase')
    }

    this.logger.info({ moveId, phase: op.phase, force }, 'Cancelling move operation')

    if (force) {
      // Force complete: unload source immediately, keep target
      await this.forceComplete(moveId, op)
    } else {
      // Graceful: revert to source
      await this.revertToSource(moveId, op)
    }
  }

  private async revertToSource(moveId: string, op: MoveOperation): Promise<void> {
    // Restore source routability
    modelStore.setRoutable(op.sourceInstanceId, true)

    // Unload target if exists
    if (op.targetInstanceId) {
      try {
        await this.modelManager.unloadModel(op.targetInstanceId)
      } catch (err) {
        this.logger.warn({ moveId, err }, 'Failed to unload target during cancel')
      }
    }

    this.emitProgress(moveId, 'failed', 'Move cancelled - reverted to source')
    moveStore.complete(moveId, 'failed', 'Cancelled by user - reverted to source')
  }

  private async forceComplete(moveId: string, op: MoveOperation): Promise<void> {
    const connections = metricsStore.getInstanceConnections(op.sourceInstanceId)
    if (connections > 0) {
      this.logger.warn({ moveId, connections }, 'Force completing - connections will be dropped')
    }

    try {
      await this.modelManager.unloadModel(op.sourceInstanceId)
    } catch (err) {
      this.logger.warn({ moveId, err }, 'Failed to unload source during force complete')
    }

    this.emitProgress(moveId, 'completed', 'Move force completed')
    moveStore.complete(moveId, 'completed', 'Force completed by user')
  }

  /**
   * Get move operation by ID
   */
  getMove(moveId: string): MoveOperation | undefined {
    return moveStore.get(moveId)
  }

  /**
   * Subscribe to move progress events
   */
  subscribeMoveEvents(moveId: string, connection: MoveSSEConnection): void {
    if (!this.moveConnections.has(moveId)) {
      this.moveConnections.set(moveId, new Set())
    }
    this.moveConnections.get(moveId)!.add(connection)
  }

  /**
   * Unsubscribe from move events
   */
  unsubscribeMoveEvents(moveId: string, connection: MoveSSEConnection): void {
    this.moveConnections.get(moveId)?.delete(connection)
    if (this.moveConnections.get(moveId)?.size === 0) {
      this.moveConnections.delete(moveId)
    }
  }

  /**
   * Emit progress event to all subscribers
   */
  private emitProgress(
    moveId: string,
    phase: MoveOperationPhase,
    message: string,
    progress?: number,
    error?: string
  ): void {
    const event: MoveProgressEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      moveId,
      phase,
      message,
      progress,
      error,
    }

    const connections = this.moveConnections.get(moveId)
    if (connections) {
      for (const conn of connections) {
        try {
          conn.send(event)
        } catch {
          // Connection closed
        }
      }
    }
  }
}

// Singleton instance
let modelMoverInstance: ModelMover | null = null

export function getModelMover(logger: Logger): ModelMover {
  if (!modelMoverInstance) {
    modelMoverInstance = new ModelMover(logger)
  }
  return modelMoverInstance
}
