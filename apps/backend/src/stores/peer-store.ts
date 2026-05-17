import type { PeerInfo, PeerStatus } from '@sardeenz/types'

/**
 * In-memory store for cluster peer information.
 * Tracks all known peers (including self) keyed by podId.
 */
class PeerStore {
  private peers: Map<string, PeerInfo> = new Map()

  addPeer(peer: PeerInfo): void {
    this.peers.set(peer.podId, peer)
  }

  removePeer(podId: string): boolean {
    return this.peers.delete(podId)
  }

  updatePeer(podId: string, updates: Partial<Omit<PeerInfo, 'podId'>>): boolean {
    const peer = this.peers.get(podId)
    if (!peer) return false
    Object.assign(peer, updates)
    return true
  }

  getPeer(podId: string): PeerInfo | undefined {
    return this.peers.get(podId)
  }

  getAllPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  getHealthyPeers(): PeerInfo[] {
    return this.getAllPeers().filter((p) => p.status === 'healthy')
  }

  /**
   * Updates the last heartbeat timestamp for a peer and resets status to healthy.
   */
  updateLastHeartbeat(podId: string, timestamp: number): boolean {
    const peer = this.peers.get(podId)
    if (!peer) return false
    peer.lastHeartbeat = timestamp
    peer.status = 'healthy'
    return true
  }

  /**
   * Marks a peer as suspect (1 missed heartbeat).
   * Only transitions from 'healthy' → 'suspect'.
   */
  markSuspect(podId: string): boolean {
    const peer = this.peers.get(podId)
    if (!peer) return false
    if (peer.status === 'healthy') {
      peer.status = 'suspect'
    }
    return true
  }

  /**
   * Marks a peer as unavailable (3 missed heartbeats).
   * Transitions from 'healthy' or 'suspect' → 'unavailable'.
   */
  markUnavailable(podId: string): boolean {
    const peer = this.peers.get(podId)
    if (!peer) return false
    if (peer.status === 'healthy' || peer.status === 'suspect') {
      peer.status = 'unavailable'
    }
    return true
  }

  /**
   * Get peers filtered by status.
   */
  getPeersByStatus(status: PeerStatus): PeerInfo[] {
    return this.getAllPeers().filter((p) => p.status === status)
  }

  count(): number {
    return this.peers.size
  }

  clear(): void {
    this.peers.clear()
  }
}

// Singleton instance
export const peerStore = new PeerStore()
