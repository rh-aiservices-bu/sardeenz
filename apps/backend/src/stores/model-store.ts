import type { ModelInstance } from '@sardeenz/types'

/**
 * In-memory store for model instances
 * Supports multiple instances of the same model (FR-004)
 * Uses dual maps: instances by ID and indexes by model path and model name
 */
class ModelStore {
  // Primary storage: keyed by instance ID (UUID)
  private instances: Map<string, ModelInstance> = new Map()
  // Index: model path -> Set of instance IDs
  private instancesByPath: Map<string, Set<string>> = new Map()
  // Index: model name -> Set of instance IDs (for --served-model-name support)
  private instancesByName: Map<string, Set<string>> = new Map()

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

    // If updating existing instance, check if modelName changed
    if (existingInstance && existingInstance.modelName !== instance.modelName) {
      // Remove from old name index
      const oldNameIds = this.instancesByName.get(existingInstance.modelName)
      if (oldNameIds) {
        oldNameIds.delete(instance.id)
        if (oldNameIds.size === 0) {
          this.instancesByName.delete(existingInstance.modelName)
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

    // Update name index
    let nameIds = this.instancesByName.get(instance.modelName)
    if (!nameIds) {
      nameIds = new Set()
      this.instancesByName.set(instance.modelName, nameIds)
    }
    nameIds.add(instance.id)
  }

  /**
   * Get a model instance by ID
   */
  get(instanceId: string): ModelInstance | undefined {
    return this.instances.get(instanceId)
  }

  /**
   * Get a model instance by model path (returns first running, or first found)
   * For backwards compatibility with existing code
   */
  getByPath(modelPath: string): ModelInstance | undefined {
    const ids = this.instancesByPath.get(modelPath)
    if (!ids || ids.size === 0) return undefined

    // Prefer running instances
    for (const id of ids) {
      const instance = this.instances.get(id)
      if (instance?.status === 'running') {
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
   * Get all running and routable instances for a model path
   * Excludes instances marked as non-routable (e.g., during move operations)
   */
  getRunningByPath(modelPath: string): ModelInstance[] {
    return this.getAllByPath(modelPath).filter(
      (i) => i.status === 'running' && i.routable !== false
    )
  }

  /**
   * Get all instances for a model name (for --served-model-name support)
   */
  getAllByName(modelName: string): ModelInstance[] {
    const ids = this.instancesByName.get(modelName)
    if (!ids) return []

    return Array.from(ids)
      .map((id) => this.instances.get(id))
      .filter((instance): instance is ModelInstance => instance !== undefined)
  }

  /**
   * Get all running and routable instances for a model name
   * Excludes instances marked as non-routable (e.g., during move operations)
   */
  getRunningByName(modelName: string): ModelInstance[] {
    return this.getAllByName(modelName).filter(
      (i) => i.status === 'running' && i.routable !== false
    )
  }

  // ============ Routable Status ============

  /**
   * Set whether an instance is routable (available for request routing)
   * Used during move operations to drain connections from an instance
   * @param instanceId - The instance ID
   * @param routable - Whether the instance should receive new requests
   * @returns true if instance exists and status was set, false otherwise
   */
  setRoutable(instanceId: string, routable: boolean): boolean {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    instance.routable = routable
    return true
  }

  /**
   * Check if an instance is routable (available for request routing)
   * Defaults to true if instance routable property is not explicitly false
   * @param instanceId - The instance ID
   * @returns true if instance is routable, false if explicitly set to non-routable or instance doesn't exist
   */
  isRoutable(instanceId: string): boolean {
    const instance = this.instances.get(instanceId)
    return instance?.routable !== false
  }

  // ============ Existence Checks ============

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

    // Remove from name index
    const nameIds = this.instancesByName.get(instance.modelName)
    if (nameIds) {
      nameIds.delete(instanceId)
      if (nameIds.size === 0) {
        this.instancesByName.delete(instance.modelName)
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
    this.instancesByName.clear()
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

  /**
   * Get all unique model names
   */
  getAllNames(): string[] {
    return Array.from(this.instancesByName.keys())
  }
}

// Singleton instance
export const modelStore = new ModelStore()
