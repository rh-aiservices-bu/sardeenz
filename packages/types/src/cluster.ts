import type { ModelStatus } from './models.js'

// Peer and cluster roles/status
//
// `term` (present on PeerInfo, ClusterState, HeartbeatMessage, HeartbeatAck, ClusterEvent)
// is the Raft election term — a monotonically increasing counter incremented each time the
// cluster elects a new leader. Term 1 means the cluster completed its initial election.
// A rapidly increasing term indicates leader instability (frequent re-elections).

export type PeerRole = 'leader' | 'follower'

export type PeerStatus = 'healthy' | 'suspect' | 'unavailable'

export type ClusterEventType =
  | 'model-loaded'
  | 'model-unloaded'
  | 'model-moved'
  | 'leader-elected'
  | 'pod-joined'
  | 'pod-left'

// GPU info for a remote peer

export interface PeerGpuInfo {
  gpuId: number
  name: string
  totalVramMB: number
  usedVramMB: number
  temperature: number
  utilization: number
}

// Compact model info exchanged during heartbeats

export interface PeerModelEntry {
  instanceId: string
  modelPath: string
  modelName: string
  port: number
  status: ModelStatus
  gpuIds: number[]
  tensorParallelSize: number
  maxTokens: number
}

// A known peer in the cluster

export interface PeerInfo {
  podId: string
  address: string
  port: number
  role: PeerRole
  status: PeerStatus
  lastHeartbeat: number
  /** Raft election term last reported by this peer. */
  term: number
  models: PeerModelEntry[]
  gpus: PeerGpuInfo[]
  joinedAt: number
}

// Routing

export interface RoutingEntry {
  podId: string
  podAddress: string
  vllmPort: number
  weight: number
  lastVerified: number
}

export interface ClusterRoutingTable {
  entries: Map<string, RoutingEntry[]>
  version: number
}

// Overall cluster state (leader only)

export interface ClusterState {
  clusterId: string
  /** Current Raft election term for the cluster. Increments on every leader election. */
  term: number
  leaderId: string
  peers: Map<string, PeerInfo>
  routingTable: ClusterRoutingTable
  expectedSize: number
}

// Heartbeat protocol

export interface HeartbeatMessage {
  podId: string
  role: PeerRole
  /** Sender's current Raft election term. Receivers reject messages from stale terms. */
  term: number
  timestamp: number
  models: PeerModelEntry[]
  gpus: PeerGpuInfo[]
  clusterVersion: number
}

export interface HeartbeatAck {
  podId: string
  /** Acknowledging pod's current Raft election term. */
  term: number
  role: PeerRole
  clusterVersion: number
}

// Cluster events

export interface ClusterEvent {
  type: ClusterEventType
  podId: string
  /** Raft election term at the time this event was emitted. */
  term: number
  timestamp: number
  payload: Record<string, unknown>
}

// Placement

export interface PlacementDecision {
  modelPath: string
  targetPodId: string
  targetGpuIds: number[]
  estimatedVramMB: number
  reason: string
}

export interface PlacementFailure {
  modelPath: string
  reason: string
  candidatePods: Array<{ podId: string; availableVramMB: number }>
}
