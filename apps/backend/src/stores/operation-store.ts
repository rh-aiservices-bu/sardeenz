import type { ControllerOperation } from '@sardeenz/types'

/**
 * In-memory circular buffer for controller operations (audit log)
 * Keeps the last N operations
 */
class OperationStore {
  private operations: ControllerOperation[] = []
  private maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }

  /**
   * Add a new operation to the store
   * If max size is reached, removes oldest operation
   */
  add(operation: ControllerOperation): void {
    this.operations.push(operation)

    // Remove oldest if we've exceeded max size
    if (this.operations.length > this.maxSize) {
      this.operations.shift()
    }
  }

  /**
   * Get an operation by ID
   */
  get(id: string): ControllerOperation | undefined {
    return this.operations.find((op) => op.id === id)
  }

  /**
   * Get all operations
   */
  getAll(): ControllerOperation[] {
    return [...this.operations]
  }

  /**
   * Get operations for a specific model
   */
  getByModel(modelPath: string): ControllerOperation[] {
    return this.operations.filter((op) => op.modelPath === modelPath)
  }

  /**
   * Get recent operations (last N)
   */
  getRecent(limit: number = 10): ControllerOperation[] {
    return this.operations.slice(-limit)
  }

  /**
   * Get count of operations
   */
  count(): number {
    return this.operations.length
  }

  /**
   * Clear all operations
   */
  clear(): void {
    this.operations = []
  }
}

// Singleton instance
export const operationStore = new OperationStore(100)
