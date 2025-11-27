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
- **KVCached integration**: Manages IPC segment names for GPU memory sharing

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
| `src/routes/health.ts` | Backend health checks |
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
      ├─► Spawn vLLM process
      ├─► Store instance (status: 'starting')
      ├─► Emit SSE status event
      ├─► Start background monitoring (non-blocking)
      └─► Return immediately to client

  Background: monitorModelStartup()
      │
      ├─► Poll http://localhost:{port}/health every 2s
      │
      ├─► Success (health returns 200):
      │     ├─► Update status to 'active'
      │     └─► Emit SSE status event
      │
      └─► Failure (timeout or crash):
            ├─► Extract error from logs
            ├─► Update status to 'failed'
            ├─► Emit SSE status event
            └─► Schedule log cleanup (30min)
```

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

## Environment Variables

See `apps/backend/.env.example` for a complete reference.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Backend server port |
| `VLLM_BASE_PORT` | 5001 | Base port for vLLM instances |
| `ENABLE_KVCACHED` | true | Enable KVCached GPU sharing |
| `KVCACHED_AUTOPATCH` | 1 | Auto-patch vLLM for KVCached |
| `LOG_LEVEL` | info | Pino log level |
| `HF_TOKEN` | (none) | HuggingFace token for gated models |

## Testing Notes

- Uses Vitest with `vi.mock()` for mocking
- Tests use `supertest` for HTTP assertions
- Mock vLLM process behavior for unit tests
- Integration tests require actual vLLM (skip in CI)
