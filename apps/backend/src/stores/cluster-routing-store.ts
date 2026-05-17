import type { RoutingEntry, PeerInfo, ClusterRoutingTable } from '@sardeenz/types'

/**
 * In-memory store for the cluster routing table.
 * Maps model names to pod locations for inference routing.
 */
class ClusterRoutingStore {
  private entries: Map<string, RoutingEntry[]> = new Map()
  private version = 0
  private localPodId: string | null = null

  /**
   * Set the local pod ID (used for weight calculation: local=2, remote=1).
   */
  setLocalPodId(podId: string): void {
    this.localPodId = podId
  }

  /**
   * Rebuild the entire routing table from peer model lists.
   * Clears existing entries and reconstructs from scratch.
   */
  rebuildFromPeers(peers: PeerInfo[]): void {
    // Build new table without clearing the current one
    const newEntries = new Map<string, RoutingEntry[]>()

    for (const peer of peers) {
      if (peer.status === 'unavailable') continue

      for (const model of peer.models) {
        if (model.status !== 'running') continue

        const entry: RoutingEntry = {
          podId: peer.podId,
          podAddress: peer.address,
          vllmPort: model.port,
          weight: peer.podId === this.localPodId ? 2 : 1,
          lastVerified: Date.now(),
        }

        let modelEntries = newEntries.get(model.modelName)
        if (!modelEntries) {
          modelEntries = []
          newEntries.set(model.modelName, modelEntries)
        }
        modelEntries.push(entry)
      }
    }

    // Atomic swap
    this.entries = newEntries
    this.version++
  }

  /**
   * Get routing entries for a specific model name.
   * Returns empty array in single-pod mode (no routing table populated).
   */
  getRoutingEntries(modelName: string): RoutingEntry[] {
    return this.entries.get(modelName) ?? []
  }

  /**
   * Get only local routing entries for a model (entries matching localPodId).
   * Used as fallback when remote peers are unreachable.
   */
  getLocalEntries(modelName: string): RoutingEntry[] {
    const entries = this.entries.get(modelName)
    if (!entries) return []
    return entries.filter((e) => e.podId === this.localPodId)
  }

  /**
   * Get the full routing table with version.
   */
  getRoutingTable(): ClusterRoutingTable {
    return {
      entries: new Map(this.entries),
      version: this.version,
    }
  }

  /**
   * Get the current routing table version.
   */
  getVersion(): number {
    return this.version
  }

  /**
   * Remove all routing entries for a departing peer.
   */
  removeEntriesForPod(podId: string): void {
    let changed = false

    for (const [modelName, entries] of this.entries) {
      const filtered = entries.filter((e) => e.podId !== podId)
      if (filtered.length !== entries.length) {
        changed = true
        if (filtered.length === 0) {
          this.entries.delete(modelName)
        } else {
          this.entries.set(modelName, filtered)
        }
      }
    }

    if (changed) {
      this.version++
    }
  }

  /**
   * Add a single routing entry for a model.
   */
  addEntry(modelName: string, entry: RoutingEntry): void {
    let modelEntries = this.entries.get(modelName)
    if (!modelEntries) {
      modelEntries = []
      this.entries.set(modelName, modelEntries)
    }
    modelEntries.push(entry)
    this.version++
  }

  /**
   * Remove a specific routing entry by podId and model name.
   */
  removeEntry(modelName: string, podId: string): void {
    const entries = this.entries.get(modelName)
    if (!entries) return

    const filtered = entries.filter((e) => e.podId !== podId)
    if (filtered.length !== entries.length) {
      if (filtered.length === 0) {
        this.entries.delete(modelName)
      } else {
        this.entries.set(modelName, filtered)
      }
      this.version++
    }
  }

  /**
   * Atomically swap a routing entry from one pod to another for a model.
   * Keeps the source entry active until the target entry is added, then removes source.
   * Ensures no inference downtime during cross-pod moves.
   */
  swapEntry(modelName: string, sourcePodId: string, targetEntry: RoutingEntry): void {
    let modelEntries = this.entries.get(modelName)
    if (!modelEntries) {
      modelEntries = []
      this.entries.set(modelName, modelEntries)
    }

    // Add target entry first (ensures at least one route exists)
    modelEntries.push(targetEntry)

    // Remove source entry
    const filtered = modelEntries.filter((e) => e.podId !== sourcePodId)
    if (filtered.length === 0) {
      this.entries.delete(modelName)
    } else {
      this.entries.set(modelName, filtered)
    }

    this.version++
  }

  /**
   * Get all model names in the routing table.
   */
  getAllModelNames(): string[] {
    return Array.from(this.entries.keys())
  }

  count(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
    this.version++
  }
}

// Singleton instance
export const clusterRoutingStore = new ClusterRoutingStore()
