import type { ModelInstance } from '@sardeenz/types'

/**
 * In-memory store for model instances
 * Supports multiple instances of the same model (FR-004)
 * Uses dual maps: instances by ID and index by model path
 */
class ModelStore {
  // Primary storage: keyed by instance ID (UUID)
  private instances: Map<string, ModelInstance> = new Map()
  // Index: model path -> Set of instance IDs
  private instancesByPath: Map<string, Set<string>> = new Map()

  /**
   * Add or update a model instance
   * @param instance - The model instance to add/update
   */
  set(instance: ModelInstance): void {
    const existingInstance = this.instances.get(instance.id)

    // If updating existing instance, check if modelPath changed
    if (existingInstance && existingInstance.modelPath !== instance.modelPath) {
      // Remove from old path index
      const oldPathIds = this.instancesByPath.get(existingInstance.modelPath)
      if (oldPathIds) {
        oldPathIds.delete(instance.id)
        if (oldPathIds.size === 0) {
          this.instancesByPath.delete(existingInstance.modelPath)
        }
      }
    }

    // Store instance
    this.instances.set(instance.id, instance)

    // Update path index
    let pathIds = this.instancesByPath.get(instance.modelPath)
    if (!pathIds) {
      pathIds = new Set()
      this.instancesByPath.set(instance.modelPath, pathIds)
    }
    pathIds.add(instance.id)
  }

  /**
   * Get a model instance by ID
   */
  get(instanceId: string): ModelInstance | undefined {
    return this.instances.get(instanceId)
  }

  /**
   * Get a model instance by model path (returns first active, or first found)
   * For backwards compatibility with existing code
   */
  getByPath(modelPath: string): ModelInstance | undefined {
    const ids = this.instancesByPath.get(modelPath)
    if (!ids || ids.size === 0) return undefined

    // Prefer active instances
    for (const id of ids) {
      const instance = this.instances.get(id)
      if (instance?.status === 'active') {
        return instance
      }
    }

    // Fall back to first instance
    const firstId = ids.values().next().value
    return firstId ? this.instances.get(firstId) : undefined
  }

  /**
   * Get all instances for a model path
   */
  getAllByPath(modelPath: string): ModelInstance[] {
    const ids = this.instancesByPath.get(modelPath)
    if (!ids) return []

    return Array.from(ids)
      .map((id) => this.instances.get(id))
      .filter((instance): instance is ModelInstance => instance !== undefined)
  }

  /**
   * Get all active instances for a model path
   */
  getActiveByPath(modelPath: string): ModelInstance[] {
    return this.getAllByPath(modelPath).filter((i) => i.status === 'active')
  }

  /**
   * Check if a model path has any instances
   */
  hasPath(modelPath: string): boolean {
    const ids = this.instancesByPath.get(modelPath)
    return ids !== undefined && ids.size > 0
  }

  /**
   * Check if an instance ID exists
   */
  has(instanceId: string): boolean {
    return this.instances.has(instanceId)
  }

  /**
   * Remove a model instance by ID
   */
  delete(instanceId: string): boolean {
    const instance = this.instances.get(instanceId)
    if (!instance) return false

    // Remove from path index
    const pathIds = this.instancesByPath.get(instance.modelPath)
    if (pathIds) {
      pathIds.delete(instanceId)
      if (pathIds.size === 0) {
        this.instancesByPath.delete(instance.modelPath)
      }
    }

    return this.instances.delete(instanceId)
  }

  /**
   * Get all model instances
   */
  getAll(): ModelInstance[] {
    return Array.from(this.instances.values())
  }

  /**
   * Get count of loaded model instances
   */
  count(): number {
    return this.instances.size
  }

  /**
   * Get count of unique model paths
   */
  countUniquePaths(): number {
    return this.instancesByPath.size
  }

  /**
   * Clear all instances
   */
  clear(): void {
    this.instances.clear()
    this.instancesByPath.clear()
  }

  /**
   * Get all used ports
   */
  getUsedPorts(): Set<number> {
    const ports = new Set<number>()
    for (const instance of this.instances.values()) {
      ports.add(instance.port)
    }
    return ports
  }

  /**
   * Get all unique model paths
   */
  getAllPaths(): string[] {
    return Array.from(this.instancesByPath.keys())
  }
}

// Singleton instance
export const modelStore = new ModelStore()
