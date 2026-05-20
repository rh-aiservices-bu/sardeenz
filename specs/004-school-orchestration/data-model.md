# Data Model: School of Sardeenz (004)

**Date**: 2026-03-27

## Entities

### ClusterState (in-memory, leader only)

Represents the overall cluster state maintained by the leader pod.

| Field | Type | Description |
|---|---|---|
| `clusterId` | `string` | Unique cluster identifier (derived from namespace + app label) |
| `term` | `number` | Current leadership term (monotonically increasing) |
| `leaderId` | `string` | Pod ID of the current leader |
| `peers` | `Map<string, PeerInfo>` | All known peers (including self) |
| `routingTable` | `ClusterRoutingTable` | Model-to-pod routing mappings |
| `expectedSize` | `number` | Expected cluster size (1-8, from config) |

### PeerInfo (in-memory, all pods)

Represents a known peer in the cluster.

| Field | Type | Description |
|---|---|---|
| `podId` | `string` | Unique pod identifier (hostname from StatefulSet) |
| `address` | `string` | Pod IP or DNS name |
| `port` | `number` | Fastify server port (default 3000) |
| `role` | `'leader' \| 'follower'` | Current role |
| `status` | `'healthy' \| 'suspect' \| 'unavailable'` | Health status |
| `lastHeartbeat` | `number` | Unix timestamp of last received heartbeat |
| `term` | `number` | Term number from last heartbeat |
| `models` | `PeerModelEntry[]` | Models loaded on this peer |
| `gpus` | `PeerGpuInfo[]` | GPU configuration on this peer |
| `joinedAt` | `number` | When this peer first joined the cluster |

**State transitions for `status`:**
- `healthy` → `suspect`: 1 missed heartbeat (5-10s)
- `suspect` → `unavailable`: 3 missed heartbeats (15s total)
- `unavailable` → `healthy`: Heartbeat received again
- `suspect` → `healthy`: Heartbeat received before timeout

### PeerModelEntry (in-memory, synced via heartbeat)

Compact model info exchanged during heartbeats.

| Field | Type | Description |
|---|---|---|
| `instanceId` | `string` | Model instance UUID |
| `modelPath` | `string` | HuggingFace model identifier |
| `modelName` | `string` | Served model name |
| `port` | `number` | vLLM listening port on the peer |
| `status` | `ModelStatus` | running, starting, sleeping, etc. |
| `gpuIds` | `number[]` | GPU assignment on the peer |
| `tensorParallelSize` | `number` | TP configuration |

### PeerGpuInfo (in-memory, synced via heartbeat)

GPU info for a remote peer.

| Field | Type | Description |
|---|---|---|
| `gpuId` | `number` | GPU index on the peer |
| `name` | `string` | GPU model name (e.g., "NVIDIA A100") |
| `totalVramMB` | `number` | Total VRAM in MB |
| `usedVramMB` | `number` | Used VRAM in MB |
| `temperature` | `number` | GPU temperature in Celsius |
| `utilization` | `number` | GPU utilization percentage |

### ClusterRoutingTable (in-memory, all pods)

Maps model identifiers to pod locations for inference routing.

| Field | Type | Description |
|---|---|---|
| `entries` | `Map<string, RoutingEntry[]>` | Model name → list of pod locations |
| `version` | `number` | Incremented on any change (for sync detection) |

### RoutingEntry

| Field | Type | Description |
|---|---|---|
| `podId` | `string` | Pod hosting this model |
| `podAddress` | `string` | Pod IP/DNS |
| `vllmPort` | `number` | Direct vLLM port (for FR-008 bypass) |
| `weight` | `number` | Routing weight (2 for local, 1 for remote) |
| `lastVerified` | `number` | Last successful request timestamp |

### HeartbeatMessage

Message exchanged between pods every 5 seconds.

| Field | Type | Description |
|---|---|---|
| `podId` | `string` | Sender pod ID |
| `role` | `'leader' \| 'follower'` | Sender's current role |
| `term` | `number` | Current leadership term |
| `timestamp` | `number` | Unix ms |
| `models` | `PeerModelEntry[]` | All models on this pod |
| `gpus` | `PeerGpuInfo[]` | GPU status on this pod |
| `clusterVersion` | `number` | Routing table version (for drift detection) |

### HeartbeatAck (in-memory, transient)

Response to a heartbeat message from a peer.

| Field | Type | Description |
|---|---|---|
| `podId` | `string` | Responding pod's ID |
| `term` | `number` | Responding pod's current term |
| `role` | `'leader' \| 'follower'` | Responding pod's current role |
| `clusterVersion` | `number` | Responding pod's routing table version |

### ClusterEvent

Immediate event sent to all peers (not waiting for heartbeat cycle).

| Field | Type | Description |
|---|---|---|
| `type` | `'model-loaded' \| 'model-unloaded' \| 'model-moved' \| 'leader-elected' \| 'pod-joined' \| 'pod-left'` | Event type |
| `podId` | `string` | Originating pod |
| `term` | `number` | Leadership term |
| `timestamp` | `number` | Unix ms |
| `payload` | `object` | Event-specific data (model info, pod info, etc.) |

### ModelPreset (SQLite, replicated across pods)

Extended from existing `model_configurations` table to support declarative scheduling.

| Field | Type | Description | Change |
|---|---|---|---|
| `id` | `string` | UUID | Existing |
| `name` | `string` | Preset name | Existing |
| `description` | `string \| null` | Description | Existing |
| `model_count` | `number` | Number of models in preset | Existing |
| `placement_strategy` | `'maximize-models' \| 'balanced' \| null` | Scheduling strategy | **New** |
| `min_kv_cache_mb` | `number \| null` | Minimum KV cache headroom per GPU | **New** |
| `created_at` | `string` | ISO timestamp | Existing |
| `updated_at` | `string` | ISO timestamp | Existing |
| `version` | `number` | Optimistic concurrency version | **New** |

### ModelPresetEntry (SQLite, replicated across pods)

Extended from existing `model_configuration_entries` table.

| Field | Type | Description | Change |
|---|---|---|---|
| `id` | `string` | UUID | Existing |
| `config_id` | `string` | FK to model_configurations | Existing |
| `model_path` | `string` | HuggingFace model ID | Existing |
| `served_model_name` | `string \| null` | Custom served name | Existing |
| `max_tokens` | `number \| null` | Max sequence length | Existing |
| `source_type` | `string` | 'huggingface' or 'local' | Existing |
| `extra_args` | `string \| null` | JSON extra vLLM args | Existing |
| `gpu_ids` | `string \| null` | Explicit GPU assignment (single-pod only) | Existing |
| `tensor_parallel_size` | `number` | TP size | Existing |
| `load_order` | `number` | Load sequence | Existing |
| `sleep_mode_enabled` | `boolean` | Enable sleep after load | Existing |
| `gpu_type_constraint` | `string \| null` | Required GPU type (e.g., "A100") | **New** |
| `min_vram_mb` | `number \| null` | Minimum VRAM requirement | **New** |

### PlacementDecision (in-memory, transient)

Output of the scheduler when applying a preset.

| Field | Type | Description |
|---|---|---|
| `modelPath` | `string` | Model to place |
| `targetPodId` | `string` | Chosen pod |
| `targetGpuIds` | `number[]` | Chosen GPUs on that pod |
| `estimatedVramMB` | `number` | Expected VRAM usage (from memory profile) |
| `reason` | `string` | Why this placement was chosen |

### PlacementFailure (in-memory, transient)

Models that couldn't be placed.

| Field | Type | Description |
|---|---|---|
| `modelPath` | `string` | Model that couldn't be placed |
| `reason` | `string` | Why (e.g., "insufficient VRAM on any available GPU") |
| `candidatePods` | `Array<{ podId, availableVramMB }>` | What was available |

### MemoryProfile (SQLite, per-pod, replicated on demand)

Existing entity, extended with GPU configuration metadata for cross-pod utility.

| Field | Type | Description | Change |
|---|---|---|---|
| (existing fields) | ... | ... | Existing |
| `gpu_type` | `string` | GPU model name profile was generated on | **New** |
| `gpu_vram_mb` | `number` | Total VRAM of GPU used for profiling | **New** |
| `source_pod_id` | `string \| null` | Pod that generated this profile | **New** |

## Relationships

```
ClusterState 1──* PeerInfo
PeerInfo 1──* PeerModelEntry
PeerInfo 1──* PeerGpuInfo
ClusterRoutingTable 1──* RoutingEntry
ModelPreset 1──* ModelPresetEntry
PlacementDecision *──1 ModelPresetEntry (by modelPath)
PlacementDecision *──1 PeerInfo (by targetPodId)
```

## Validation Rules

1. **Cluster size**: 1-8 pods (hard cap, SC-006)
2. **Pod ID**: Must be unique within the cluster; derived from hostname
3. **Term number**: Must be monotonically increasing; reject messages with stale terms
4. **Heartbeat freshness**: Reject heartbeats with timestamps >30s old (clock skew protection)
5. **Routing entry weight**: Must be > 0; local entries get weight=2, remote weight=1
6. **Preset placement_strategy**: Must be one of the defined enum values or null
7. **GPU type constraint**: Free-form string matching GPU `name` field (e.g., "A100", "L4")
8. **CLUSTER_SECRET**: Required when >1 pod; all inter-pod communication signed with HMAC-SHA256
