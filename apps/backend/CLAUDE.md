# CLAUDE.md - Backend Context

> **Note for AI Assistants**: Backend-specific context for **sardeenz**. For project overview, see root [CLAUDE.md](../../CLAUDE.md). For frontend context, see [frontend/CLAUDE.md](../frontend/CLAUDE.md).

## Backend Overview

Fastify backend providing Controller API and Unified Proxy for multi-model LLM management. Manages vLLM subprocess lifecycle with real-time event streaming.

**Technology Stack**: Node.js 22.x, TypeScript 5.7+ (strict mode), Fastify 5.1+

## Key Components

### ModelManager (`src/services/model-manager.ts`)

Core service managing vLLM subprocess lifecycle:
- **Async model loading**: `launchModel()` returns immediately with `starting` status
- **Background monitoring**: Polls health endpoint every 2s, times out after 3 minutes
- **Status transitions**: `starting` → `active` (success) or `failed` (error/timeout)
- **Multi-instance support**: Multiple instances of same model via unique instance IDs
- **KVCached integration**: All models share single `kvcached_mem_info` IPC segment
- **SIGKILL unload**: Uses SIGKILL (not SIGTERM) to bypass Python cleanup that would delete shared IPC
- **EngineCore PID tracking**: Extracts GPU-using process PID from logs for accurate memory monitoring

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
- **Factory methods**: `createLogEvent()`, `createStatusEvent()`

### Error Parser (`src/utils/error-parser.ts`)

Intelligent extraction of meaningful errors from vLLM output:
- **CUDA OOM**: Extracts memory allocation details
- **Model not found**: Identifies missing model paths
- **Port conflicts**: Detects address-in-use errors
- **CUDA/PyTorch mismatch**: Version compatibility issues
- **Fallback**: Last stderr lines with exit code if no pattern matches

## API Routes

| Route File | Purpose |
|------------|---------|
| `src/routes/models.ts` | Model CRUD: load, unload, list, get, health check, logs |
| `src/routes/events.ts` | SSE event streaming endpoint |
| `src/routes/health.ts` | Backend health checks (`/api/health`, `/api/health/ready`, `/api/health/live`) |
| `src/routes/proxy.ts` | OpenAI-compatible inference proxy |
| `src/routes/memory.ts` | GPU memory info via kvctl |
| `src/routes/orphans.ts` | Orphan process detection |
| `src/routes/settings.ts` | Application settings (HF token) |

## Stores (In-Memory)

| Store | Purpose |
|-------|---------|
| `src/stores/model-store.ts` | ModelInstance tracking by ID/path |
| `src/stores/operation-store.ts` | ControllerOperation audit trail |
| `src/stores/runtime-settings.ts` | Runtime settings (HF token) |

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
      │     ├─► Query nvidia-smi using EngineCore PID
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

### Why SIGKILL Instead of SIGTERM

KVCached registers Python signal handlers in `MemInfoTracker` that delete the shared IPC segment (`kvcached_mem_info`) when receiving SIGTERM. Since all models share this single IPC segment, using SIGTERM to unload one model would break all other running models.

**Solution:** Use SIGKILL which bypasses signal handlers entirely. The shared IPC is only deleted during server shutdown when all models are gone.

### Killing Descendant Processes

vLLM spawns child processes that must be explicitly killed:
- **API Server** (parent) - no GPU memory
- **EngineCore** (child) - allocates GPU VRAM

SIGKILL doesn't propagate to children, so `killProcessImmediate()` uses `getDescendantPids()` to find all child/grandchild processes and kills them before the parent. This ensures the GPU-consuming EngineCore is properly terminated.

### IPC Segment Lifecycle

- **Created:** Automatically by first vLLM process with `ENABLE_KVCACHED=true`
- **Shared:** All models use the same `kvcached_mem_info` segment
- **Preserved:** Not deleted when individual models unload (SIGKILL bypasses cleanup)
- **Deleted:** Only on server shutdown via `cleanup()` → `deleteSharedIpcSegment()`

### GPU Memory PID Tracking

vLLM spawns multiple processes. The spawned process is the API Server, but GPU memory is allocated by EngineCore:

```
vLLM logs:
  "APIServer pid=76195"      ◄── processId (from spawn, no GPU memory)
  "EngineCore_DP0 pid=76355" ◄── engineCorePid (allocates GPU VRAM)
```

The backend extracts `EngineCore_DP0 pid=N` from logs and stores it in `ModelInstance.engineCorePid`. This PID is used for accurate nvidia-smi GPU memory lookups in both:
- `model-manager.ts`: Initial GPU utilization calculation
- `memory-monitor.ts`: Real-time per-model memory breakdown

## Development Commands

```bash
# Development
npm run dev -w apps/backend      # Start dev server (port 3000)

# Testing
npm run test -w apps/backend     # Run Vitest tests
npm run test:cov -w apps/backend # Coverage report

# Building
npm run build -w apps/backend    # TypeScript compile

# Linting
npm run lint -w apps/backend     # ESLint check
npm run type-check -w apps/backend  # TypeScript type check
```

## Logging

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
  logRequests?: boolean  // false = quiet mode
}
```

## Environment Variables

See `apps/backend/.env.example` for a complete reference.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Backend server port |
| `VLLM_BASE_PORT` | 5001 | Base port for vLLM instances |
| `ENABLE_KVCACHED` | true | Enable KVCached GPU sharing |
| `KVCACHED_AUTOPATCH` | 1 | Auto-patch vLLM for KVCached |
| `LOG_LEVEL` | info | Pino log level |
| `LOG_ALL_REQUESTS` | false | Force all routes to log at info level (debugging) |
| `HF_TOKEN` | (none) | HuggingFace token for gated models |

## Testing Notes

- Uses Vitest with `vi.mock()` for mocking
- Tests use `supertest` for HTTP assertions
- Mock vLLM process behavior for unit tests
- Integration tests require actual vLLM (skip in CI)
