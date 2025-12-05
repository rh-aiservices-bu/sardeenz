# Architecture

This document provides a detailed overview of the Sardeenz architecture, design decisions, and system components.

## Table of Contents

- [System Overview](#system-overview)
- [Technology Stack](#technology-stack)
- [Component Architecture](#component-architecture)
- [Data Model](#data-model)
- [Process Management](#process-management)
- [Memory Management](#memory-management)
- [Security Model](#security-model)
- [Performance Considerations](#performance-considerations)

## System Overview

Sardeenz is a multi-model management platform designed to:
1. **Dynamically load/unload** multiple LLM instances without downtime
2. **Route inference requests** to the appropriate model via a unified proxy
3. **Share GPU memory** efficiently across multiple models using KVCached
4. **Monitor and manage** resources through a web-based dashboard

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Admin Dashboard                        │
│              (React + PatternFly 6 UI)                      │
│                  (served on Port 3000)                      │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS (OAuth/OIDC)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Fastify Backend (Port 3000)                    │
├─────────────────────────────────────────────────────────────┤
│  Controller API (/api/*)           Inference Proxy (/v1/*) │
│  • Model lifecycle (load/unload)   • OpenAI-compatible API  │
│  • Status & metrics endpoints      • Model routing          │
│  • GPU selection & management      • Streaming support (SSE)│
│  • Static file serving (frontend)  • <50ms routing overhead │
└────────────────┬────────────────────────────────────────────┘
                 │ subprocess management
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              vLLM Model Instances (N processes)             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Model A    │  │   Model B    │  │   Model C    │      │
│  │  (Port 5001) │  │  (Port 5002) │  │  (Port 5003) │      │
│  │   OpenAI API │  │   OpenAI API │  │   OpenAI API │      │
│  │   GPU 0      │  │   GPU 0      │  │  GPU 0-1 TP  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└───────────┬─────────────────────────────────────────────────┘
            │ KVCached IPC shared memory (single-GPU models)
            ▼
┌─────────────────────────────────────────────────────────────┐
│                   GPU Memory (CUDA)                         │
│  • Shared KV cache segments (via KVCached)                  │
│  • Model weights (per-GPU or tensor parallel)               │
│  • Compute kernels                                          │
└─────────────────────────────────────────────────────────────┘
                     ▲
                     │ HTTPS
                     │
                  Clients
```

## Technology Stack

### Backend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Runtime** | Node.js | 22.x | Server-side JavaScript execution |
| **Language** | TypeScript | 5.7+ | Type-safe development (strict mode) |
| **Framework** | Fastify | 5.1+ | High-performance HTTP server |
| **Database** | SQLite | 3.x | Benchmark/profile persistence (better-sqlite3) |
| **Auth** | @fastify/oauth2 | Latest | OAuth 2.0 / OIDC integration |
| **Metrics** | fastify-metrics | Latest | Prometheus-format metrics |
| **API Docs** | @fastify/swagger | Latest | OpenAPI 3.1 specification |
| **Process Mgmt** | child_process | Built-in | vLLM subprocess management |

### Frontend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Framework** | React | 18.3+ | UI component library |
| **Language** | TypeScript | 5.7+ | Type-safe development |
| **UI Library** | PatternFly | 6.x | Red Hat design system |
| **Build Tool** | Vite | 6.0+ | Fast dev server + bundler |
| **Router** | React Router | 6.28+ | Client-side routing |

### Infrastructure

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Inference Engine** | vLLM | 0.11.0 | OpenAI-compatible LLM serving |
| **Memory Sharing** | KVCached | Latest | GPU memory IPC for multi-model |
| **Container Base** | CUDA | 12.x | NVIDIA GPU support |
| **Python Runtime** | Python | 3.12 | vLLM dependencies |
| **Orchestration** | OpenShift/K8s | 4.x+ | Container deployment platform |

### Monorepo Structure

```
sardeenz/
├── apps/
│   ├── backend/              # Fastify backend
│   │   ├── src/
│   │   │   ├── db/           # SQLite database layer
│   │   │   │   ├── connection.ts    # Database connection
│   │   │   │   ├── migrate.ts       # Migration runner
│   │   │   │   └── migrations/      # SQL migration files
│   │   │   ├── services/     # Business logic
│   │   │   ├── stores/       # Data stores (in-memory + SQLite)
│   │   │   ├── routes/       # API routes
│   │   │   └── server.ts     # Entry point
│   │   └── package.json
│   └── frontend/             # React frontend
│       ├── src/
│       │   ├── components/   # UI components
│       │   ├── pages/        # Route pages
│       │   ├── hooks/        # Custom hooks
│       │   └── App.tsx       # Root component
│       └── package.json
├── packages/
│   ├── types/                # Shared TypeScript types
│   ├── contracts/            # OpenAPI schemas
│   └── utils/                # Shared utilities
└── package.json              # Root workspace config
```

## Component Architecture

### 1. Controller API

**Responsibility:** Manage model lifecycle and provide system status.

**Key Endpoints:**

- `POST /api/v1/models/load` - Load a new model instance
- `POST /api/v1/models/{id}/unload` - Unload a running model
- `GET /api/v1/models` - List all model instances
- `GET /api/v1/models/{id}` - Get model instance details
- `GET /api/v1/metrics` - Prometheus-format metrics
- `GET /api/health` - Health check endpoint
- `GET /api/health/ready` - Readiness probe endpoint
- `GET /api/health/live` - Liveness probe endpoint

**Benchmarking Endpoints:**

- `POST /api/benchmarks` - Create and start a benchmark run
- `GET /api/benchmarks` - List all benchmark runs
- `GET /api/benchmarks/{id}` - Get benchmark run details with scenarios
- `GET /api/benchmarks/{id}/events` - SSE stream for real-time progress
- `DELETE /api/benchmarks/{id}` - Delete a benchmark run

**Memory Profile Endpoints:**

- `GET /api/memory/profiles` - List all saved memory profiles
- `POST /api/memory/profiles` - Create a memory profile from running model
- `GET /api/memory/profiles/lookup` - Find profile by model_path + max_tokens + gpu_name
- `POST /api/memory/profiles/check` - Pre-load memory check (will model fit?)
- `GET /api/memory/profiles/{id}` - Get a specific profile
- `DELETE /api/memory/profiles/{id}` - Delete a profile

**Authentication:** OAuth 2.0 / OIDC with RBAC
- `admin` role: Full control (load/unload)
- `admin-readonly` role: Read-only access

**Implementation Details:**
- Built with Fastify for high performance
- Uses `child_process.spawn()` for vLLM process management
- In-memory state management (Map data structures)
- Event-driven architecture for process lifecycle events

#### ProcessLogBuffer

Captures vLLM process stdout/stderr for debugging and real-time streaming:

- **Ring buffer design**: Bounded to 500 lines per instance
- **Real-time listeners**: Supports SSE push via callback registration
- **Cleanup policy**:
  - Immediate clear on successful model unload
  - 30-minute retention on failure for debugging
- **Thread-safe**: Handles concurrent writes from stdout/stderr

#### EventBus

Singleton service for SSE event distribution:

- **Event types**: `log`, `status`, `memory`, `progress`, `error`
- **Per-instance subscriptions**: Connections scoped to model instance ID
- **Event filtering**: Clients can subscribe to specific event types
- **Heartbeat**: 30-second keepalive messages
- **Factory methods**: `createLogEvent()`, `createStatusEvent()` for consistent event structure

#### Error Parser

Extracts meaningful error messages from vLLM process output:

| Error Pattern | Description |
|---------------|-------------|
| CUDA OOM | Memory allocation failures with details |
| Model not found | Missing model paths or files |
| Port conflict | Address already in use |
| CUDA/PyTorch mismatch | Version compatibility issues |
| Generic exception | Python traceback extraction |

Falls back to last stderr lines with exit code if no pattern matches.

#### Memory Parser

Parses vLLM process logs to extract memory metrics and process information after model loading:

**Memory Metrics Patterns:**

| Log Pattern | Extracted Field |
|-------------|-----------------|
| `Model loading took X.XX GiB` | `weightsMemoryGiB` |
| `Graph capturing finished...took X.XX GiB` | `cudaGraphMemoryGiB` |
| `Available KV cache memory: X.XX GiB` | `kvCacheAvailableGiB` |
| `GPU KV cache size: N tokens` | Used for per-request calculation |
| `Using max model len N` | `maxModelLen` |

The `kvCachePerRequestMiB` is calculated as: `(kvCacheAvailableGiB * 1024) / totalTokens * maxModelLen`

**Process ID Patterns:**

| Log Pattern | Extracted Field | Description |
|-------------|-----------------|-------------|
| `EngineCore_DP0 pid=N` | `engineCorePid` | The vLLM EngineCore process that allocates GPU VRAM |
| `APIServer pid=N` | `processId` | The main API server process (from spawn) |

Metrics are parsed once when the model transitions to `active` status and stored in the `ModelInstance` fields. Returns `null` if critical metrics cannot be parsed.

#### GPU Memory Tracking

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
- `nvidia-smi` shows GPU memory by PID
- Looking up memory by the API Server PID returns 0
- The EngineCore PID must be extracted from logs for accurate memory tracking

**Implementation:**
1. Parse vLLM logs for `EngineCore_DP0 pid=N` pattern
2. Store in `ModelInstance.engineCorePid`
3. Use `engineCorePid` (falling back to `processId`) for nvidia-smi lookups
4. Per-model memory breakdown in dashboard uses this PID for accurate reporting

#### GPU Selector

The GPU Selector service (`src/services/gpu-selector.ts`) handles intelligent GPU assignment for model loading:

**Selection Strategies:**
- **Auto-select (default):** Chooses GPU(s) with most free memory
- **Manual selection:** User specifies `gpu_ids` in load request
- **Tensor parallel:** For large models spanning multiple GPUs

**Key Methods:**
- `getRecommendedGpu(tensorParallelSize)` - Returns GPU(s) with most free memory
- `validateGpuSelection(gpuIds, tensorParallelSize)` - Validates user-specified GPUs exist
- `getTargetGpus(gpuIds?, tensorParallelSize)` - Determines final GPU assignment
- `getGpuAvailability()` - Returns all GPUs with availability info for UI

**Multi-GPU / Tensor Parallel:**
- For `tensor_parallel_size > 1`, finds contiguous GPUs with most combined free memory
- KVCached is automatically disabled for tensor parallel models (incompatible)
- GPU indices are passed to vLLM via `CUDA_VISIBLE_DEVICES` environment variable

### 2. Unified Proxy

**Responsibility:** Route inference requests to correct model instances.

**Key Features:**
- OpenAI-compatible API (`/v1/completions`, `/v1/chat/completions`)
- Model identification via `model` field in request body
- Streaming support using Server-Sent Events (SSE)
- Connection pooling to vLLM backends
- Round-robin load balancing for multiple instances of same model
- Direct port-based proxy (`/api/direct/:port/*`) for testing

**Performance Target:** <50ms routing overhead (p95)

**Routing Logic:**
1. Parse incoming request to extract model identifier
2. Lookup model instance in registry (Map lookup: O(1))
3. For multiple instances: round-robin load balancing
4. Forward request to vLLM instance port
5. Stream response back to client

**Direct Proxy Mode:**
For testing and debugging, the `/api/direct/:port/*` endpoint bypasses model routing and forwards requests directly to a specific port. Example: `POST /api/direct/5001/v1/chat/completions`

### 3. Admin Dashboard

**Responsibility:** Provide web UI for model management and monitoring.

**Key Pages:**
- **Dashboard**: Overview of all models, GPU usage, request metrics
- **Model Management**: Load/unload models with configuration
- **Metrics**: Real-time charts (GPU memory, request latency, throughput)
- **Logs**: Request logs and operation audit trail

**UI Components:**
- PatternFly 6 components (Cards, Tables, Charts, Forms)
- React Query for server state management
- WebSocket connection for real-time updates

### 4. vLLM Model Instances

**Responsibility:** Execute LLM inference requests.

**Process Configuration:**
```bash
python -m vllm.entrypoints.openai.api_server \
  --model /path/to/model \
  --port 5001 \
  --gpu-memory-utilization 0.3 \
  --no-enable-prefix-caching \
  --kv-cache-dtype auto
```

**Environment Variables:**
- `ENABLE_KVCACHED=true` - Enable KVCached memory sharing
- `KVCACHED_AUTOPATCH=1` - Auto-patch vLLM for KVCached
- `CUDA_VISIBLE_DEVICES=0` - GPU device assignment

**Lifecycle States:**
- `starting` → Process spawning, waiting for API readiness
- `active` → Serving requests
- `stopping` → Graceful shutdown in progress
- `failed` → Process crashed or failed health check

**Background Monitoring:**

Model loading is asynchronous. After `launchModel()` returns:
1. Background task polls `http://localhost:{port}/health` every 2 seconds
2. Timeout after 3 minutes if health check never succeeds
3. On success: status transitions to `active`, SSE status event emitted
4. On failure: error extracted from logs, status transitions to `failed`, SSE status event emitted

**SSE Event Streaming:**

Clients can subscribe to real-time events via `/api/v1/models/instances/{id}/events`:
- `log` events: vLLM stdout/stderr in real-time
- `status` events: State transitions with error details on failure
- Buffered logs replayed on connection (optional)

## Data Model

See [`specs/001-multi-model-platform/data-model.md`](../specs/001-multi-model-platform/data-model.md) for detailed schema definitions.

### Core Entities

#### ModelInstance (Runtime State)

```typescript
interface ModelInstance {
  id: string;                      // Unique instance ID
  modelPath: string;               // Path to model files
  displayName: string;             // Human-readable name
  status: 'starting' | 'active' | 'stopping' | 'failed';
  port: number;                    // vLLM API port
  processId: number;               // API Server PID (from spawn)
  engineCorePid?: number;          // EngineCore PID (allocates GPU VRAM)
  gpuMemoryLimit: number;          // GB allocated
  gpuIds: number[];                // GPU indices this model runs on
  tensorParallelSize: number;      // 1 = single GPU, >1 = spanning multiple GPUs
  kvcachedEnabled: boolean;        // False for tensor parallel models
  createdAt: Date;
  startedAt?: Date;
  stoppedAt?: Date;
  errorMessage?: string;
  memoryMetrics?: ModelMemoryMetrics; // Parsed from vLLM logs after loading
}

interface ModelMemoryMetrics {
  weightsMemoryGiB: number;        // Model weights memory
  cudaGraphMemoryGiB: number;      // CUDA graph capture memory
  kvCacheAvailableGiB: number;     // Available KV cache memory
  kvCachePerRequestMiB: number;    // KV cache per max-size request
  maxModelLen: number;             // Max context length
}
```

#### ResourceMetrics (Real-Time)

```typescript
interface ResourceMetrics {
  modelId: string;
  timestamp: Date;
  gpuMemoryUsed: number;           // GB (from kvctl)
  requestCount: number;            // Total requests
  activeConnections: number;       // Current connections
  avgResponseTime: number;         // ms (p50)
  p95ResponseTime: number;         // ms (p95)
}
```

#### BenchmarkRun (SQLite Persisted)

```typescript
interface BenchmarkRun {
  id: string;                      // UUID
  name?: string;                   // Optional run name
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  mode: 'isolated' | 'contention'; // Execution mode
  kvcachedEnabled: boolean;        // System KVCached status
  createdAt: string;               // ISO timestamp
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  totalRequests: number;           // Sum across scenarios
  successfulRequests: number;
  failedRequests: number;
  durationSeconds?: number;
  scenarios: BenchmarkScenario[];  // Child scenarios
}

interface BenchmarkScenario {
  id: string;
  runId: string;
  instanceId: string;              // Model instance being tested
  routingMode: 'direct' | 'proxy'; // Route to vLLM or through proxy
  modelPath: string;
  modelName: string;
  inputTokens: number;             // Target input token count
  outputTokens: number;            // Target max_tokens
  concurrency: number;             // Parallel requests
  warmupRequests: number;          // Unmeasured warmup
  totalRequests: number;           // Measured requests
  slaThresholdMs?: number;         // For goodput calculation
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface BenchmarkMetrics {
  scenarioId: string;
  // TTFT (Time To First Token) in ms
  ttftMin: number; ttftMax: number; ttftAvg: number;
  ttftP50: number; ttftP90: number; ttftP95: number; ttftP99: number;
  // TPS (Tokens Per Second)
  tpsMin: number; tpsMax: number; tpsAvg: number;
  tpsP50: number; tpsP90: number; tpsP95: number; tpsP99: number;
  // E2E Latency in ms
  e2eMin: number; e2eMax: number; e2eAvg: number;
  e2eP50: number; e2eP90: number; e2eP95: number; e2eP99: number;
  // Goodput
  goodputCount: number;            // Requests under SLA
  goodputPercent: number;
  // Throughput
  requestsPerSecond: number;
  tokensPerSecondTotal: number;
}
```

#### MemoryProfile (SQLite Persisted)

```typescript
interface MemoryProfile {
  id: string;                      // UUID
  profileName: string;             // Human-readable name
  modelPath: string;               // Model identifier
  maxTokens: number;               // Context length when profiled

  // Memory breakdown (GiB)
  totalGpuMemoryGib: number;       // Total GPU memory consumed
  weightsMemoryGib: number;        // Model weights
  cudaGraphsGib: number;           // CUDA graph capture
  overheadMemoryGib: number;       // Other overhead
  kvCacheAvailableGib: number;     // Available KV cache (deprecated with KVCached)
  kvCachePerRequestMib?: number;   // Estimated per-request KV cache

  // GPU context
  gpuName?: string;                // GPU where profiled
  gpuTotalMemoryGib?: number;      // Total GPU memory

  // Metadata
  comments?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}
```

## Process Management

### Why Direct Subprocess Management?

**Problem:** KVCached Controller requires restart to change model configuration, causing unacceptable downtime.

**Solution:** Node.js backend manages individual vLLM processes directly.

**Benefits:**
- Zero-downtime model loading/unloading
- Fine-grained control over each model instance
- Independent scaling of models
- Easier debugging and monitoring

### Implementation

```typescript
import { spawn } from 'child_process';

const vllmProcess = spawn('python', [
  '-m', 'vllm.entrypoints.openai.api_server',
  '--model', modelPath,
  '--port', port.toString(),
  '--gpu-memory-utilization', gpuMemoryLimit.toString(),
  '--no-enable-prefix-caching',
], {
  env: {
    ...process.env,
    ENABLE_KVCACHED: 'true',
    KVCACHED_AUTOPATCH: '1',
  }
});

vllmProcess.stdout.on('data', (data) => {
  // Parse logs for readiness signals
});

vllmProcess.on('exit', (code) => {
  // Update instance status
});
```

### Health Checks

Periodic health checks to vLLM instances:
```bash
GET http://localhost:{port}/health
```

If health check fails 3 consecutive times, mark instance as `failed`.

## Memory Management

### KVCached Integration

**KVCached** enables multiple vLLM instances to share GPU memory via IPC segments.

**Memory Segment Naming:**
```
VLLM_META_LLAMA_LLAMA_3_2_1B  # Derived from model path
```

**Memory Limit Enforcement:**
```bash
kvctl limit VLLM_META_LLAMA_LLAMA_3_2_1B 8GB
```

**Memory Cleanup on Unload:**
```bash
kvctl delete VLLM_META_LLAMA_LLAMA_3_2_1B
```

**Monitoring:**
```bash
kvctl status  # Shows all segments and usage
```

### GPU Memory Allocation Strategy

1. **Query available GPU memory** via `nvidia-smi`
2. **Reserve 2GB for CUDA overhead**
3. **Divide remaining memory** among requested models
4. **Set per-model limits** via `--gpu-memory-utilization`

Example (24GB GPU):
- Total: 24GB
- Reserved: 2GB (CUDA)
- Available: 22GB
- Model A (7B params): 8GB
- Model B (3B params): 6GB
- Model C (1B params): 4GB
- Buffer: 4GB

For detailed KVCached documentation, see [`kvcached/README.md`](./kvcached/README.md).

## Security Model

### Authentication

**Controller API:** OAuth 2.0 / OIDC with JWT tokens
- Keycloak / Auth0 / Okta compatible
- RBAC roles encoded in JWT claims

**Proxy API:** Assumes gateway-level authentication
- Designed to run behind API gateway (e.g., OpenShift Router)
- Optional API key validation (future enhancement)

### Authorization (RBAC)

| Role | Permissions |
|------|-------------|
| `admin` | Load models, unload models, view all data |
| `admin-readonly` | View models, view metrics (no modifications) |

### Security Best Practices

- **No credentials in logs**: Sanitize all log output
- **Process isolation**: Each vLLM instance runs in separate process
- **Resource limits**: Prevent memory exhaustion via KVCached limits
- **API versioning**: URL-based versioning (`/api/v1/`) for backward compatibility

## Performance Considerations

### Critical Performance Goals

1. **Proxy Routing Overhead:** <50ms (p95) [CRITICAL]
2. **Model Load Time:** <60s for small models (1-3B params)
3. **Model Unload Time:** <30s
4. **Concurrent Models:** 3-5 models on 24GB GPU
5. **Request Throughput:** Limited by vLLM, proxy adds <5% overhead

### Optimization Techniques

#### Proxy Performance

- **TCP Passthrough:** Fastify `reply.hijack()` for zero-copy streaming
- **Connection Pooling:** Reuse HTTP connections to vLLM backends
- **No Buffering:** Stream responses directly to clients
- **Model Lookup:** O(1) Map lookup by model ID

#### vLLM Performance

- **Prefix Caching:** Disabled (incompatible with KVCached)
- **GPU Utilization:** Tuned per-model based on expected load
- **Batch Size:** Dynamic batching handled by vLLM
- **Attention Backend:** FlashAttention 2.0 (automatic)

#### Frontend Performance

- **Code Splitting:** Route-based chunking via Vite
- **Lazy Loading:** Components loaded on demand
- **Memoization:** React.memo for expensive components
- **Virtual Scrolling:** For large tables/lists

### Monitoring Metrics

Expose Prometheus metrics for:
- Request latency histograms (proxy, per-model)
- Request count (success/failure, per-model)
- GPU memory usage (per-model, total)
- Active connections (proxy, per-model)
- Process health status

## Design Principles

This architecture follows the principles defined in [`.specify/memory/constitution.md`](../specs/001-multi-model-platform/):

1. **Type Safety & Monorepo**: TypeScript strict mode, workspace structure
2. **Performance-First**: <50ms routing, streaming support, connection pooling
3. **API-First Design**: OpenAPI 3.1 specs, URL versioning
4. **Security by Design**: OAuth/OIDC + RBAC from day 1
5. **Container-Native**: Docker-first development, GPU-aware containers
6. **Observability**: Prometheus metrics, structured logging, health endpoints
7. **Simplicity & Pragmatism**: YAGNI principle, integration tests mandatory

## Implemented Features (Recent)

- **Multi-GPU Support:** Models can span multiple GPUs via tensor parallelism
- **GPU Auto-Selection:** Intelligent GPU assignment based on free memory
- **Direct Proxy:** Port-based proxy for testing (`/api/direct/:port/*`)
- **Simplified Container:** Single-process Fastify serves both API and frontend (no NGINX)

## Future Enhancements

- **Persistent State:** Optional database backend (PostgreSQL) for model configuration catalog
- **Autoscaling:** Dynamic model loading based on request patterns
- **A/B Testing:** Traffic splitting between model versions
- **Request Queueing:** Priority queue for high-demand models
- **LoRA Adapter Support:** Dynamic adapter loading for fine-tuned models

---

**See Also:**
- [API Guide](./api-guide.md) - API usage examples
- [Deployment Guide](./deployment.md) - Container and OpenShift deployment
- [KVCached Documentation](./kvcached/) - GPU memory sharing details
