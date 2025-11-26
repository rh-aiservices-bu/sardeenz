import type { InferenceRequest } from '@sardeenz/types'

/**
 * In-memory circular buffer for inference requests (per model)
 * Keeps the last N requests for each model
 */
class RequestStore {
  private requests: Map<string, InferenceRequest[]> = new Map()
  private maxSizePerModel: number

  constructor(maxSizePerModel: number = 1000) {
    this.maxSizePerModel = maxSizePerModel
  }

  /**
   * Add a new request for a model
   */
  add(modelPath: string, request: InferenceRequest): void {
    if (!this.requests.has(modelPath)) {
      this.requests.set(modelPath, [])
    }

    const modelRequests = this.requests.get(modelPath)!
    modelRequests.push(request)

    // Remove oldest if we've exceeded max size
    if (modelRequests.length > this.maxSizePerModel) {
      modelRequests.shift()
    }
  }

  /**
   * Get a specific request by ID
   */
  get(requestId: string): InferenceRequest | undefined {
    for (const requests of this.requests.values()) {
      const found = requests.find((r) => r.id === requestId)
      if (found) return found
    }
    return undefined
  }

  /**
   * Get all requests for a model
   */
  getByModel(modelPath: string): InferenceRequest[] {
    return this.requests.get(modelPath) || []
  }

  /**
   * Get recent requests for a model
   */
  getRecent(modelPath: string, limit: number = 100): InferenceRequest[] {
    const requests = this.requests.get(modelPath) || []
    return requests.slice(-limit)
  }

  /**
   * Get count of requests for a model
   */
  count(modelPath: string): number {
    return this.requests.get(modelPath)?.length || 0
  }

  /**
   * Clear all requests for a model
   */
  clearModel(modelPath: string): void {
    this.requests.delete(modelPath)
  }

  /**
   * Clear all requests
   */
  clearAll(): void {
    this.requests.clear()
  }

  /**
   * Get statistics for a model
   */
  getStats(modelPath: string): {
    total: number
    completed: number
    failed: number
    avgDurationMs: number
  } {
    const requests = this.getByModel(modelPath)

    const total = requests.length
    const completed = requests.filter((r) => r.status === 'completed').length
    const failed = requests.filter((r) => r.status === 'failed').length

    const completedRequests = requests.filter(
      (r) => r.status === 'completed' && r.durationMs !== undefined
    )
    const avgDurationMs =
      completedRequests.length > 0
        ? completedRequests.reduce((sum, r) => sum + (r.durationMs || 0), 0) /
          completedRequests.length
        : 0

    return {
      total,
      completed,
      failed,
      avgDurationMs,
    }
  }
}

// Singleton instance
export const requestStore = new RequestStore(1000)
