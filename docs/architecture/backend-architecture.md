# Backend Architecture

This document provides detailed backend architecture specifications for the sardeenz Controller API and Unified Proxy.

## Table of Contents

- [Overview](#overview)
- [Key Components](#key-components)
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
- [kvcached Documentation](../kvcached/) - GPU memory sharing details
