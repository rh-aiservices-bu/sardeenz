# Backend Architecture

This document provides detailed backend architecture specifications for the sardeenz Controller API and Unified Proxy.

## Table of Contents

- [Overview](#overview)
- [Key Components](#key-components)
- [Cluster Services](#cluster-services)
- [Cluster Stores](#cluster-stores)
- [Cluster Plugins](#cluster-plugins)
- [Cluster Routes](#cluster-routes)
- [Database Migrations](#database-migrations)
- [Model Loading Flow](#model-loading-flow)
- [Model Unload Flow](#model-unload-flow)
- [Process Management](#process-management)
- [GPU Memory Tracking](#gpu-memory-tracking)
- [Logging Architecture](#logging-architecture)

## Overview

The backend is a Fastify server providing:

- **Controller API**: Model lifecycle management, GPU selection, benchmarking
- **Unified Proxy**: OpenAI-compatible inference routing with <50ms overhead target
- **SSE Events**: Real-time status updates during model operations

**Technology Stack**: Node.js 22.x, TypeScript 5.7+ (strict mode), Fastify 5.1+, SQLite (better-sqlite3)

## Key Components

### ModelManager (`src/services/model-manager.ts`)

Core service managing vLLM subprocess lifecycle:

- **Async model loading**: `launchModel()` returns immediately with `starting` status
- **Sync model loading**: `launchModelAndWait()` waits for model to reach terminal status (for sequential loading)
- **Background monitoring**: Polls health endpoint every 2s, times out after 3 minutes
- **Status transitions**: `starting` → `active` (success) or `failed` (error/timeout)
- **Multi-instance support**: Multiple instances of same model via unique instance IDs
- **Multi-GPU support**: GPU selection via `gpu_ids` and `tensor_parallel_size` parameters
- **kvcached integration**: All single-GPU models share `kvcached_mem_info` IPC segment (disabled for tensor parallel)
- **SIGKILL unload**: Uses SIGKILL (not SIGTERM) to bypass Python cleanup that would delete shared IPC
- **EngineCore PID tracking**: Extracts GPU-using process PID from logs for accurate memory monitoring
- **Conflict group detection**: Union-Find algorithm groups models sharing any GPU for sequential loading
- **Sleep mode**: Put models to sleep to free GPU memory (~90%) while remaining loaded for quick wake-up

**Sleep Mode Methods:**

| Method                          | Description                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sleepModel(instanceId, level)` | Puts a running model to sleep. Level 1 offloads weights to CPU RAM, Level 2 discards weights. Requires model to be loaded with `enableSleepMode: true`. |
| `wakeModel(instanceId, tags?)`  | Wakes a sleeping model, restoring it to running state. Optionally specify `tags` to reload only specific components (weights, kv_cache).                |
| `isSleeping(instanceId)`        | Returns whether the model is currently sleeping and at what level.                                                                                      |

Sleep mode requires the `--enable-sleep-mode` vLLM flag and `VLLM_SERVER_DEV_MODE=1` environment variable, which are automatically set when `enableSleepMode: true` is passed to `launchModel()`.

### ProcessLogBuffer (`src/services/process-log-buffer.ts`)

Ring buffer for capturing vLLM stdout/stderr:

- **Bounded memory**: Max 500 lines per instance
- **Real-time streaming**: Listener registration for SSE push
- **Cleanup behavior**:
  - Immediate clear on successful model unload
  - 30-minute retention on failure for debugging
- **Thread-safe**: Handles concurrent writes from process streams

### EventBus (`src/services/event-bus.ts`)

Singleton for SSE event distribution:

- **Event types**: `log`, `status`, `memory`, `progress`, `error`
- **Per-instance subscriptions**: Connections scoped to model instance ID
- **Event filtering**: Clients can filter by event type
- **Heartbeat**: 30-second keepalive for connection stability
- **Factory methods**: `createLogEvent()`, `createStatusEvent()` for consistent event structure

### Error Parser (`src/utils/error-parser.ts`)

Intelligent extraction of meaningful errors from vLLM output:

| Error Pattern         | Description                             |
| --------------------- | --------------------------------------- |
| CUDA OOM              | Memory allocation failures with details |
| Model not found       | Missing model paths or files            |
| Port conflict         | Address already in use                  |
| CUDA/PyTorch mismatch | Version compatibility issues            |
| Generic exception     | Python traceback extraction             |

Falls back to last stderr lines with exit code if no pattern matches.

### Memory Parser (`src/utils/memory-parser.ts`)

Parses vLLM process logs to extract memory metrics and process information after model loading:

**Memory Metrics Patterns:**

| Log Pattern                                | Extracted Field                  |
| ------------------------------------------ | -------------------------------- |
| `Model loading took X.XX GiB`              | `weightsMemoryGiB`               |
| `Graph capturing finished...took X.XX GiB` | `cudaGraphMemoryGiB`             |
| `Available KV cache memory: X.XX GiB`      | `kvCacheAvailableGiB`            |
| `GPU KV cache size: N tokens`              | Used for per-request calculation |
| `Using max model len N`                    | `maxModelLen`                    |

The `kvCachePerRequestMiB` is calculated as: `(kvCacheAvailableGiB * 1024) / totalTokens * maxModelLen`

**Process ID Patterns:**

| Log Pattern            | Extracted Field | Description                                         |
| ---------------------- | --------------- | --------------------------------------------------- |
| `EngineCore_DP0 pid=N` | `engineCorePid` | The vLLM EngineCore process that allocates GPU VRAM |
| `APIServer pid=N`      | `processId`     | The main API server process (from spawn)            |

Metrics are parsed once when the model transitions to `active` status and stored in the `ModelInstance` fields. Returns `null` if critical metrics cannot be parsed.

### GpuSelector (`src/services/gpu-selector.ts`)

Intelligent GPU selection for model loading:

- **Auto-selection**: Picks GPU(s) with most free memory
- **Manual selection**: Validates user-specified `gpu_ids`
- **Tensor parallel**: Finds contiguous GPUs for multi-GPU models

**Key Methods:**

- `getRecommendedGpu(tensorParallelSize)` - Returns best GPU(s) for loading
- `validateGpuSelection(gpuIds, tensorParallelSize)` - Validates GPU exists
- `getTargetGpus(gpuIds?, tensorParallelSize)` - Determines final GPU assignment
- `getGpuAvailability()` - Returns all GPUs with availability info for UI

**Tensor Parallel Rules:**

- `tensor_parallel_size > 1` requires that many contiguous GPUs
- kvcached is automatically disabled for tensor parallel models
- GPUs passed to vLLM via `CUDA_VISIBLE_DEVICES` environment variable

### BenchmarkRunner (`src/services/benchmark-runner.ts`)

Executes benchmark runs with real-time progress via SSE:

- **Execution modes**: `isolated` (sequential) or `contention` (parallel)
- **Warmup phase**: Configurable warmup requests (not measured)
- **Concurrent requests**: Configurable concurrency per scenario
- **Metrics collection**: TTFT, TPS, E2E latency with percentiles
- **Progress events**: Real-time SSE updates during execution
- **Cancellation**: Supports mid-run cancellation via API

### ProxyRouter (`src/services/proxy-router.ts`)

Request routing for inference proxy:

- **Model lookup**: Resolves model name to running instance
- **Round-robin**: Load balances across multiple instances of same model
- **Metrics tracking**: Records request latency and counts

### Inference Auth Plugin (`src/plugins/inference-auth.ts`)

Separate authentication for inference endpoints:

- **Dual-auth model**: Inference endpoints use API key auth, not JWT
- **Optional protection**: When `INFERENCE_API_KEY` is empty, inference endpoints are open
- **OpenAI-compatible**: Uses `Authorization: Bearer <key>` header format
- **Route detection**: `isInferenceRoute()` helper identifies inference endpoints (`/v1/*`, `/api/direct/*`, etc.)
- **Frontend integration**: API key passed to frontend after admin login for seamless testing

**Protected Routes:**

- `/v1/*` - OpenAI-compatible endpoints
- `/api/direct/:port/*` - Direct port-based proxy
- `/tokenize`, `/detokenize`, `/pooling`, `/classification`, `/score`, `/re-rank`

### ModelConfigurationStore (`src/stores/model-configuration-store.ts`)

SQLite-backed store for model configuration presets:

- **Save current state**: Captures all running model configurations (path, GPU, tokens, extra args)
- **Load order preservation**: Entries stored with `load_order` for sequential restoration
- **GPU assignment capture**: Saves `gpuIds` and `tensorParallelSize` per model
- **CRUD operations**: Create, read, update, delete configurations
- **Entry management**: Each configuration contains multiple model entries

### ModelMover (`src/services/model-mover.ts`)

Orchestrates moving models between GPUs using a blue-green deployment pattern:

- **Zero-downtime moves**: Target instance spins up while source continues serving
- **Graceful drain**: Waits for in-flight requests to complete before unloading source
- **Automatic rollback**: On failure, restores source to routable state
- **Concurrent limit**: Only 1 move operation can run system-wide at a time

**Move Phases:**

| Phase | Description |
|-------|-------------|
| VALIDATING | Pre-flight checks (GPU memory, tensor parallelism, source status) |
| SPAWNING | Loading model on target GPU with progress tracking (0-100%) |
| SWITCHING | Removing source from routing table (target now receives requests) |
| DRAINING | Waiting for active connections on source to complete |
| COMPLETING | Unloading source instance |
| COMPLETED/FAILED | Terminal states |

**Key Methods:**

| Method | Description |
|--------|-------------|
| `moveModel(request)` | Initiates move operation, returns move ID for tracking |
| `cancelMove(moveId, force)` | Cancels in-progress move (graceful or forced) |
| `waitForDrain(instanceId, timeout)` | Polls for connection drain with configurable timeout |

**Integration Points:**

- **ModelManager**: Launches target instance, unloads source
- **ModelStore**: Controls `routable` flag to exclude source from routing
- **MetricsStore**: Tracks per-instance connection counts for drain monitoring
- **GpuSelector**: Pre-flight memory availability check
- **EventBus**: SSE progress events to frontend

**Routing Control:**

During a move, the source instance's `routable` flag is set to `false`. The `getRunningByName()` method filters out non-routable instances, ensuring new requests go only to the target while existing connections on the source complete naturally.

### MoveStore (`src/stores/move-store.ts`)

In-memory store for tracking move operations:

- **Concurrent move limiting**: Singleton lock ensures max 1 move at a time
- **Operation tracking**: CRUD operations for move records
- **Lookup methods**: Find moves by source or target instance ID
- **Auto-pruning**: Keeps only last 10 completed operations

## Cluster Services

### ClusterManager (`src/services/cluster-manager.ts`)

Facade that orchestrates all cluster sub-services. Implements `HeartbeatDataProvider` to supply local pod state (models, GPUs, term, role) to the heartbeat protocol.

**Key Methods:**

| Method | Description |
|--------|-------------|
| `start()` | Registers self as peer, starts discovery + election + heartbeat if in cluster mode |
| `stop()` | Stops all timers, cleans up peer store |
| `isClusterMode()` | Returns true if `KUBERNETES_SERVICE_HOST` or `CLUSTER_PEERS` is configured |
| `isLeader()` | Delegates to leader election service |
| `getClusterState()` | Returns clusterId, term, leaderId, peers, routing table, expected size |
| `getLeaderAddress()` | Resolves leader pod's IP:port for redirect |
| `getPodId()` | Returns pod identifier (K8s hostname or `host:port` for static) |
| `refreshGpuInfo()` | Calls nvidia-smi every 5s, updates peer store with GPU metrics |

**Lazy Activation:** Single-instance mode has zero overhead (no timers). Cluster services auto-activate when the first peer is discovered via `handlePeerAdded()`. Enforces a maximum cluster size of 8 pods.

### LeaderElection (`src/services/leader-election.ts`)

Factory-created election service with three strategy implementations:

| Strategy | Class | Detection | Details |
|----------|-------|-----------|---------|
| **Kubernetes** | `KubernetesLeaderElection` | `KUBERNETES_SERVICE_HOST` | K8s Lease API, 15s duration, 10s renewal |
| **Heartbeat** | `HeartbeatLeaderElection` | `CLUSTER_PEERS` | Bully algorithm, lowest podId wins, quorum required |
| **Single** | `SingleInstanceElection` | Neither | Always leader (no-op) |

**Interface:**

| Method | Description |
|--------|-------------|
| `start()` | Begin election cycle |
| `stop()` | Stop election monitoring |
| `isLeader()` | Is this pod the current leader? |
| `getCurrentTerm()` | Current election term/epoch |
| `getLeaderId()` | Current leader pod ID |
| `onLeaderChange` | Callback fired when leadership changes |

**Quorum:** Heartbeat-based election requires `floor(clusterSize / 2) + 1` healthy peers to maintain leadership, preventing split-brain in network partitions. Uses `CLUSTER_EXPECTED_PODS` for quorum calculation when some pods are not yet visible.

### PeerDiscovery (`src/services/peer-discovery.ts`)

Discovers peers dynamically via Kubernetes Watch API or static peer health polling:

| Strategy | Class | Mechanism |
|----------|-------|-----------|
| **Kubernetes** | `KubernetesPeerDiscovery` | Watches pods with label `app=sardeenz`, waits for `Running` phase + IP assignment |
| **Static** | `StaticPeerDiscovery` | Polls `GET /internal/ping` on each peer every 10s (5s timeout), removes unresponsive peers |
| **No-op** | `NoOpPeerDiscovery` | Single instance (no discovery needed) |

**Callbacks:** `onPeerAdded(peer)` and `onPeerRemoved(podId)` fire into `ClusterManager`.

### HeartbeatService (`src/services/heartbeat.ts`)

Peer-to-peer heartbeat messaging with failure detection state machine:

**Timing Constants:**

| Constant | Value | Purpose |
|----------|-------|---------|
| `HEARTBEAT_INTERVAL_MS` | 5000 | Heartbeat send + reap cycle |
| `SUSPECT_THRESHOLD` | 10000 | Time before marking peer suspect |
| `UNAVAILABLE_THRESHOLD` | 15000 | Time before marking peer unavailable |

**Key Methods:**

| Method | Description |
|--------|-------------|
| `start()` | Begin heartbeat sending and failure detection (with startup jitter) |
| `stop()` | Stop all timers |
| `processIncomingHeartbeat(message)` | Updates peer store, schedules routing table rebuild (debounced 500ms) |

**Heartbeat Payload:**

```typescript
interface HeartbeatMessage {
  podId: string
  role: 'leader' | 'follower'
  term: number
  timestamp: number
  models: PeerModelEntry[]    // Running models with status, port, gpuIds
  gpus: PeerGpuInfo[]         // GPU memory, temp, utilization
  clusterVersion: number      // Routing table version for consistency
}
```

**Failure Detection States:** `healthy` → `suspect` (10s) → `unavailable` (15s, removed from routing table).

### PodScheduler (`src/services/pod-scheduler.ts`)

Places models onto cluster GPUs according to strategy and resource constraints:

**Key Methods:**

| Method | Description |
|--------|-------------|
| `placeModels(request)` | Places model entries onto available GPU slots, returns decisions + failures |
| `reconcile(preset)` | Diffs a saved preset against current cluster state, returns toUnload/toLoad/unchanged |

**Placement Strategies:**

| Strategy | Behavior |
|----------|----------|
| `maximize-models` | Pack to fewest GPUs (least available VRAM first) |
| `balanced` | Spread across GPUs (fewest models per GPU, then most available VRAM) |

**Placement Algorithm:**
1. Build GPU slots from healthy peers (mutable state for simulation)
2. Sort entries by `loadOrder`
3. For each entry: filter candidates by GPU type, VRAM, KV cache headroom
4. For tensor-parallel: find pod with `tpSize` candidate GPUs
5. Apply strategy-specific sorting, deduct VRAM from slots

**Dependencies:** Uses `peerStore` for healthy peer state and `getMemoryProfileStore()` for VRAM estimation by model.

### Cluster Auth (`src/services/cluster-auth.ts`)

HMAC-SHA256 signing for inter-pod requests with replay protection:

**Key Functions:**

| Function | Description |
|----------|-------------|
| `signRequest(method, path, body, secret)` | Returns `{signature, timestamp}` |
| `verifyRequest(method, path, body, signature, timestamp, secret)` | Returns boolean |
| `verifyRequestDualSecret(...)` | Verifies against current + previous secret (key rotation) |
| `buildSignedHeaders(method, path, body)` | Returns headers dict with `X-Cluster-Signature` and `X-Cluster-Timestamp` |
| `signedFetch(url, method, body?)` | Convenience wrapper for signed HTTP requests |

**Signing Payload:** `METHOD\nPATH\nTIMESTAMP\nBODY` → HMAC-SHA256 hex digest. Replay window: 30 seconds. Uses `timingSafeEqual()` for constant-time comparison.

## Cluster Stores

### ClusterRoutingStore (`src/stores/cluster-routing-store.ts`)

In-memory store mapping model names to available pod endpoints (vLLM ports). Built atomically from peer heartbeats.

**Key Methods:**

| Method | Description |
|--------|-------------|
| `rebuildFromPeers(peers)` | Atomic rebuild from peer model lists (only running models) |
| `getRoutingEntries(modelName)` | Returns all pods serving a model |
| `getLocalEntries(modelName)` | Returns only local pod entries (fallback) |
| `getRoutingTable()` | Returns `{entries: Map, version}` |
| `removeEntriesForPod(podId)` | Remove all routes for a departing peer |
| `swapEntry(modelName, sourcePodId, targetEntry)` | Atomic add-then-remove for zero-downtime moves |

**RoutingEntry Structure:**

```typescript
interface RoutingEntry {
  podId: string
  podAddress: string
  vllmPort: number
  weight: number        // 2 for local, 1 for remote
  lastVerified: number  // timestamp
}
```

Version increments on any change, enabling cache invalidation in the proxy router.

### PeerStore (`src/stores/peer-store.ts`)

In-memory store of all known peers with health, models, GPUs, and role:

**Key Methods:**

| Method | Description |
|--------|-------------|
| `addPeer(peer)` / `removePeer(podId)` | Add or remove a peer |
| `getAllPeers()` / `getHealthyPeers()` | List all or only healthy peers |
| `updateLastHeartbeat(podId, timestamp)` | Updates timestamp and resets status to healthy |
| `markSuspect(podId)` / `markUnavailable(podId)` | Transition peer health status |
| `getPeersByStatus(status)` | Filter by `healthy`, `suspect`, or `unavailable` |

**PeerInfo Structure:**

```typescript
interface PeerInfo {
  podId: string
  address: string
  port: number
  role: 'leader' | 'follower'
  status: 'healthy' | 'suspect' | 'unavailable'
  lastHeartbeat: number
  term: number
  models: PeerModelEntry[]
  gpus: PeerGpuInfo[]
  joinedAt: number
}
```

## Cluster Plugins

### ClusterAuthPlugin (`src/plugins/cluster-auth.ts`)

Fastify `preHandler` hook that validates HMAC signatures on all `/internal/*` routes:

1. Skips if path doesn't start with `/internal/`
2. Skips if `CLUSTER_SECRET` not configured (single-pod mode)
3. Extracts `X-Cluster-Signature` and `X-Cluster-Timestamp` headers
4. Verifies with `verifyRequestDualSecret()` (supports key rotation)
5. Returns 401 on missing or invalid signature

### LeaderRedirectPlugin (`src/plugins/leader-redirect.ts`)

Fastify `onRequest` hook that redirects admin/dashboard requests from follower pods to the leader (307 Temporary Redirect):

**Exempt Routes** (never redirected):
- `/v1/*` — inference (handled by distributed proxy)
- `/api/direct/*` — direct port proxy
- `/internal/*` — inter-pod communication
- `/api/health*` — health checks work on every pod
- `/api/cluster` — cluster status useful from any pod
- `/docs/*`, `/metrics` — operational endpoints

Validates the leader address is a known peer before redirecting (prevents open redirect).

## Cluster Routes

### Public Cluster API (`/api/cluster/*`)

**Status & Info:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cluster` | GET | Cluster health, term, leader, pod count, routing table version |
| `/api/cluster/pods` | GET | All pods with GPU details and model counts |
| `/api/cluster/pods/:podId/models` | GET | Models on a specific pod |
| `/api/cluster/routing-table` | GET | Full routing table with model-to-pod mappings |
| `/api/cluster/pods/:podId/gpu/available` | GET | GPU availability (proxied to pod) |
| `/api/cluster/pods/:podId/memory` | GET | GPU memory usage (proxied to pod) |
| `/api/cluster/pods/:podId/gpu/info` | GET | Full GPU info (proxied to pod) |
| `/api/cluster/pods/:podId/models/full` | GET | Full model instance list (proxied to pod) |

**Model Operations:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cluster/models/load` | POST | Load model on target pod (or local if unspecified) |
| `/api/cluster/models/:instanceId/unload` | POST | Unload from any pod |
| `/api/cluster/models/:instanceId/move` | POST | Cross-pod or intra-pod move with drain timeout |
| `/api/cluster/models/:instanceId/events` | GET | SSE relay for load progress (cross-pod) |
| `/api/cluster/models/:instanceId/sleep` | POST | Sleep model on any pod |
| `/api/cluster/models/:instanceId/wake` | POST | Wake model on any pod |
| `/api/cluster/models/:instanceId/logs` | GET | Logs from any pod |
| `/api/cluster/moves/:moveId/events` | GET | SSE relay for move progress |

**Presets & Profiles:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cluster/presets/:presetId/apply` | POST | Leader-only: reconcile + schedule + execute (dry-run supported) |
| `/api/cluster/memory-profiles/reconcile` | POST | Collect, deduplicate, distribute profiles across cluster |
| `/api/cluster/memory-profiles/export` | GET | Export all profiles as JSON backup |
| `/api/cluster/memory-profiles/import` | POST | Import profiles, distribute to peers |
| `/api/cluster/benchmarks/export` | GET | Export benchmark runs for backup |
| `/api/cluster/benchmarks/import` | POST | Import benchmark runs from backup |

### Internal Routes (`/internal/*`)

All routes protected by cluster-auth plugin (HMAC verification):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/internal/ping` | GET | Liveness check (static discovery) |
| `/internal/heartbeat` | POST | Receive heartbeat from peer |
| `/internal/state` | GET | Full pod state (for sync after reconnection) |
| `/internal/cluster/event` | POST | Receive cluster events |
| `/internal/models/load` | POST | Remote load command from leader |
| `/internal/models/:id/unload` | POST | Remote unload command |
| `/internal/models/:id/events` | GET | SSE relay for model load progress |
| `/internal/models/:id/sleep` | POST | Remote sleep command |
| `/internal/models/:id/wake` | POST | Remote wake command |
| `/internal/models/:id/logs` | GET | Process logs for instance |
| `/internal/models` | GET | Full model list |
| `/internal/gpu/available` | GET | GPU availability for proxying |
| `/internal/memory/multi-gpu` | GET | GPU memory usage for proxying |
| `/internal/gpu/info` | GET | Full GPU info |
| `/internal/presets/sync` | POST | Receive presets from leader (version-based conflict resolution) |
| `/internal/memory-profiles` | GET | Return local profiles for reconciliation |
| `/internal/memory-profiles` | POST | Receive profiles from peers |
| `/internal/moves/:moveId/events` | GET | SSE stream for move progress |

## Database Migrations

### Migration 006: Cluster Schema Extensions (`006-cluster-schema-extensions.sql`)

Extends existing tables for cluster scheduling:

**`model_configurations`:**
- `placement_strategy TEXT` — `'maximize-models'` or `'balanced'`
- `min_kv_cache_mb INTEGER` — Minimum KV cache headroom required
- `version INTEGER DEFAULT 1` — Version for conflict resolution during preset sync

**`model_configuration_entries`:**
- `gpu_type_constraint TEXT` — GPU type filter (e.g., `"A100"`)
- `min_vram_mb INTEGER` — Minimum VRAM required for placement

**`memory_profiles`:**
- `gpu_type TEXT` — GPU model name
- `gpu_vram_mb INTEGER` — GPU total VRAM
- `source_pod_id TEXT` — Which pod measured this profile

### Migration 007: Pod ID in Config Entries (`007-pod-id-in-config-entries.sql`)

**`model_configuration_entries`:**
- `pod_id TEXT` — Which pod should run this entry (cluster-aware save/load)

## Model Loading Flow

```
POST /api/models/load
      │
      ▼
  ModelManager.launchModel()
      │
      ├─► Spawn vLLM process (captures API Server PID)
      ├─► Store instance (status: 'starting')
      ├─► Emit SSE status event
      ├─► Start background monitoring (non-blocking)
      └─► Return immediately to client

  Background: monitorModelStartup()
      │
      ├─► Poll http://localhost:{port}/health every 2s
      │
      ├─► Success (health returns 200):
      │     ├─► Parse logs for EngineCore PID (GPU memory process)
      │     ├─► Parse memory metrics from logs
      │     ├─► Query NVML using EngineCore PID
      │     ├─► Update status to 'active'
      │     └─► Emit SSE status event
      │
      └─► Failure (timeout or crash):
            ├─► Extract error from logs
            ├─► Update status to 'failed'
            ├─► Emit SSE status event
            └─► Schedule log cleanup (30min)
```

## Model Unload Flow

```
DELETE /api/models/instances/:instance_id
      │
      ▼
  ModelManager.unloadModel()
      │
      ├─► Get all descendant PIDs (includes EngineCore)
      ├─► SIGKILL all descendants first (frees GPU memory)
      ├─► SIGKILL parent process (API Server)
      ├─► Wait for process exit
      ├─► Clear process logs
      ├─► Remove from model store
      └─► Emit 'model:unloaded' event
```

## Process Management

### Why SIGKILL Instead of SIGTERM

kvcached registers Python signal handlers in `MemInfoTracker` that delete the shared IPC segment (`kvcached_mem_info`) when receiving SIGTERM. Since all models share this single IPC segment, using SIGTERM to unload one model would break all other running models.

**Solution:** Use SIGKILL which bypasses signal handlers entirely. The shared IPC is only deleted during server shutdown when all models are gone.

### Killing Descendant Processes

vLLM spawns child processes that must be explicitly killed:

- **API Server** (parent) - no GPU memory
- **EngineCore** (child) - allocates GPU VRAM

SIGKILL doesn't propagate to children, so `killProcessImmediate()` uses `getDescendantPids()` to find all child/grandchild processes and kills them before the parent. This ensures the GPU-consuming EngineCore is properly terminated.

### IPC Segment Lifecycle

Each GPU (or GPU-pair for tensor-parallel models) gets its own IPC segment:

**Naming Convention:**

- Single GPU: `kvcached_vllm_GPU{id}` (e.g., `kvcached_vllm_GPU0`)
- Tensor-parallel: `kvcached_vllm_GPU{id1}_GPU{id2}` (e.g., `kvcached_vllm_GPU0_GPU1`)

The segment name is set via `KVCACHED_IPC_NAME` environment variable, configured automatically by the backend based on the model's GPU assignment.

**Lifecycle:**

- **Created:** Automatically by first vLLM process with `ENABLE_KVCACHED=true` on that GPU
- **Preserved:** Not deleted when individual models unload (SIGKILL bypasses cleanup)
- **Deleted:** Only on server shutdown via `cleanup()` → `deleteSharedIpcSegment()`
- **Multi-GPU cleanup:** Both single-GPU and multi-GPU segment patterns are cleaned up

## GPU Memory Tracking

vLLM spawns multiple processes internally. The process returned by `spawn()` is the **API Server**, but GPU memory is allocated by the **EngineCore** process:

```
vLLM Process Architecture:
┌─────────────────────────────────────┐
│  APIServer (pid from spawn)         │ ◄── No GPU memory
│    └── EngineCore_DP0 (child)       │ ◄── Allocates GPU VRAM
│          └── (worker processes)     │
└─────────────────────────────────────┘
```

**Why this matters:**

- NVML shows GPU memory by PID
- Looking up memory by the API Server PID returns 0
- The EngineCore PID must be extracted from logs for accurate memory tracking

**Implementation:**

1. Parse vLLM logs for `EngineCore_DP0 pid=N` pattern
2. Store in `ModelInstance.engineCorePid`
3. Use `engineCorePid` (falling back to `processId`) for NVML lookups
4. Per-model memory breakdown in dashboard uses this PID for accurate reporting

### Memory Baseline Tracking

When a model transitions to 'running' status, the backend captures its memory baseline:

- **`memoryBaselineByGpu: Record<number, number>`** - Memory footprint per GPU in GB
- This represents the idle memory consumption before any inference requests
- Captured from NVML using the EngineCore PID
- For tensor-parallel models, baselines are captured on each GPU

**Purpose:** The memory baseline is used for accurate KVCache total calculation:

```
KVCache Total = GPU Free Memory + Prealloc KVCache + Used KVCache
KVCache Free = max(0, KVCache Total - Used KVCache - Prealloc KVCache)
```

Prealloc memory appears as "used" in nvidia-smi but is actually available to the KVCache pool. This dynamic calculation provides accurate real-time reporting, replacing the old approach of reading `total_size` from the IPC segment.

**Conditional Display:** KVCache metrics are only returned when models are loaded to prevent stale preallocation values from being displayed.

## Logging Architecture

### Quiet Logging

The backend implements quiet logging to reduce noise from frequently-polled endpoints. Routes configured for quiet logging only log successful requests (2xx) at **debug** level, while errors (4xx/5xx) are always logged at **warn/error** levels.

**Quiet routes** (configured in `src/config/quiet-routes.ts`):

- `/api/models` - Frontend polling for model list
- `/api/memory/usage` - Frontend polling for memory metrics
- `/api/health` - Health check endpoint
- `/api/health/ready` - Readiness probe
- `/api/health/live` - Liveness probe

**Configuration:**

- **Route-level control**: Set `logRequests: false` in route config to enable quiet logging
- **Override for debugging**: Set `LOG_ALL_REQUESTS=true` to force all routes to log at info level
- **Custom plugin**: `src/plugins/request-logging.ts` implements the quiet logging behavior

**TypeScript types**: Route logging configuration is defined in `src/types/fastify.d.ts`:

```typescript
interface FastifyContextConfig {
  logRequests?: boolean // false = quiet mode
}
```

---

**See Also:**

- [Architecture Overview](../architecture.md) - High-level system architecture
- [Frontend Architecture](./frontend-architecture.md) - Frontend component specs
- [API Guide](../api-guide.md) - API usage examples
- [kvcached Documentation](../kvcached/README.md) - GPU memory sharing details
