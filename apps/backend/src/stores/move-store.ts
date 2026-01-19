import type { MoveOperation } from '@sardeenz/types'

/**
 * In-memory store for model move operations
 * Tracks move operation state and provides concurrency control
 * Only one move operation can be active at a time
 */
class MoveStore {
  private operations: Map<string, MoveOperation> = new Map()
  private activeMove: string | null = null // Lock for concurrent moves

  // ============ Concurrency Control ============

  /**
   * Try to acquire the move lock for a given operation
   * @returns true if lock acquired, false if another move is in progress
   */
  tryAcquireLock(moveId: string): boolean {
    if (this.activeMove !== null) return false
    this.activeMove = moveId
    return true
  }

  /**
   * Release the move lock for a given operation
   */
  releaseLock(moveId: string): void {
    if (this.activeMove === moveId) {
      this.activeMove = null
    }
  }

  /**
   * Check if any move operation is currently in progress
   */
  isMoveInProgress(): boolean {
    return this.activeMove !== null
  }

  /**
   * Get the ID of the currently active move operation
   */
  getActiveMoveId(): string | null {
    return this.activeMove
  }

  // ============ CRUD Operations ============

  /**
   * Create a new move operation
   * @throws Error if another move operation is already in progress
   */
  create(op: MoveOperation): void {
    if (!this.tryAcquireLock(op.id)) {
      throw new Error('Another move operation is already in progress')
    }
    this.operations.set(op.id, op)
  }

  /**
   * Get a move operation by ID
   */
  get(moveId: string): MoveOperation | undefined {
    return this.operations.get(moveId)
  }

  /**
   * Update an existing move operation
   * @returns true if operation was found and updated, false otherwise
   */
  update(moveId: string, updates: Partial<MoveOperation>): boolean {
    const op = this.operations.get(moveId)
    if (!op) return false
    Object.assign(op, updates)
    this.operations.set(moveId, op)
    return true
  }

  /**
   * Complete a move operation (success or failure)
   * Releases the lock and prunes old completed operations
   */
  complete(moveId: string, status: 'completed' | 'failed', error?: string): void {
    const op = this.operations.get(moveId)
    if (op) {
      op.phase = status
      if (error) op.error = error
      this.operations.set(moveId, op)
    }
    this.releaseLock(moveId)
    this.pruneCompletedOperations()
  }

  // ============ Lookup Operations ============

  /**
   * Get active move operation by source instance ID
   * Only returns operations that are not completed or failed
   */
  getBySourceInstance(instanceId: string): MoveOperation | undefined {
    for (const op of this.operations.values()) {
      if (
        op.sourceInstanceId === instanceId &&
        op.phase !== 'completed' &&
        op.phase !== 'failed'
      ) {
        return op
      }
    }
    return undefined
  }

  /**
   * Get active move operation by target instance ID
   * Only returns operations that are not completed or failed
   */
  getByTargetInstance(instanceId: string): MoveOperation | undefined {
    for (const op of this.operations.values()) {
      if (
        op.targetInstanceId === instanceId &&
        op.phase !== 'completed' &&
        op.phase !== 'failed'
      ) {
        return op
      }
    }
    return undefined
  }

  // ============ Maintenance ============

  /**
   * Keep only the last 10 completed/failed operations
   * Called automatically after completing an operation
   */
  private pruneCompletedOperations(): void {
    const completed = Array.from(this.operations.values())
      .filter((op) => op.phase === 'completed' || op.phase === 'failed')
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())

    if (completed.length > 10) {
      for (const op of completed.slice(10)) {
        this.operations.delete(op.id)
      }
    }
  }

  /**
   * Clear all operations and release any locks
   */
  clear(): void {
    this.operations.clear()
    this.activeMove = null
  }
}

// Singleton instance
export const moveStore = new MoveStore()
