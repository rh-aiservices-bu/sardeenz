import type { ResourceMetrics } from '@sardeenz/types'

/**
 * In-memory store for resource metrics
 * Uses Map for O(1) lookups by model path
 * Also tracks per-instance connection counts for move operation drain tracking
 */
class MetricsStore {
  private metrics: Map<string, ResourceMetrics> = new Map()
  // Per-instance connection tracking for move operation drain support
  private instanceConnections: Map<string, number> = new Map()

  /**
   * Set or update metrics for a model
   */
  set(modelPath: string, metrics: ResourceMetrics): void {
    this.metrics.set(modelPath, metrics)
  }

  /**
   * Get metrics for a model
   */
  get(modelPath: string): ResourceMetrics | undefined {
    return this.metrics.get(modelPath)
  }

  /**
   * Check if metrics exist for a model
   */
  has(modelPath: string): boolean {
    return this.metrics.has(modelPath)
  }

  /**
   * Remove metrics for a model
   */
  delete(modelPath: string): boolean {
    return this.metrics.delete(modelPath)
  }

  /**
   * Get all metrics
   */
  getAll(): ResourceMetrics[] {
    return Array.from(this.metrics.values())
  }

  /**
   * Update connection count for a model
   */
  updateConnections(modelPath: string, delta: number): void {
    const metrics = this.metrics.get(modelPath)
    if (metrics) {
      metrics.activeConnections = Math.max(0, metrics.activeConnections + delta)
      metrics.lastUpdated = new Date()
      this.metrics.set(modelPath, metrics)
    }
  }

  /**
   * Record a request for a model
   */
  recordRequest(modelPath: string, success: boolean, durationMs: number): void {
    const metrics = this.metrics.get(modelPath)
    if (metrics) {
      metrics.totalRequests++
      if (success) {
        metrics.successfulRequests++
      } else {
        metrics.failedRequests++
      }

      // Update average response time (simple moving average)
      const totalCompleted = metrics.successfulRequests
      if (metrics.avgResponseTimeMs === undefined) {
        metrics.avgResponseTimeMs = durationMs
      } else {
        metrics.avgResponseTimeMs =
          (metrics.avgResponseTimeMs * (totalCompleted - 1) + durationMs) / totalCompleted
      }

      metrics.lastUpdated = new Date()
      this.metrics.set(modelPath, metrics)
    }
  }

  // ============ Per-Instance Connection Tracking ============

  /**
   * Update connection count for a specific instance
   * @param instanceId - The model instance ID
   * @param delta - Change in connection count (+1 for connect, -1 for disconnect)
   */
  updateInstanceConnections(instanceId: string, delta: number): void {
    const current = this.instanceConnections.get(instanceId) ?? 0
    const newCount = Math.max(0, current + delta)
    this.instanceConnections.set(instanceId, newCount)
  }

  /**
   * Get current connection count for a specific instance
   * @param instanceId - The model instance ID
   * @returns Current connection count (defaults to 0 if not tracked)
   */
  getInstanceConnections(instanceId: string): number {
    return this.instanceConnections.get(instanceId) ?? 0
  }

  /**
   * Check if an instance has any active connections
   * @param instanceId - The model instance ID
   * @returns true if instance has active connections
   */
  hasActiveConnections(instanceId: string): boolean {
    return (this.instanceConnections.get(instanceId) ?? 0) > 0
  }

  /**
   * Clear connection tracking for a specific instance
   * @param instanceId - The model instance ID
   */
  clearInstanceConnections(instanceId: string): void {
    this.instanceConnections.delete(instanceId)
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear()
    this.instanceConnections.clear()
  }
}

// Singleton instance
export const metricsStore = new MetricsStore()
