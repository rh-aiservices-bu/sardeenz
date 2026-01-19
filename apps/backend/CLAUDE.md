# CLAUDE.md - Backend Context

> **Note for AI Assistants**: Backend-specific context for **sardeenz**. For project overview, see root [CLAUDE.md](../../CLAUDE.md). For frontend context, see [frontend/CLAUDE.md](../frontend/CLAUDE.md).

## Backend Overview

Fastify backend providing Controller API and Unified Proxy for multi-model LLM management. Manages vLLM subprocess lifecycle with real-time event streaming.

**Technology Stack**: Node.js 22.x, TypeScript 5.7+ (strict mode), Fastify 5.1+, SQLite (better-sqlite3)

**Detailed Architecture**: See [Backend Architecture](../../docs/architecture/backend-architecture.md) for component details, flow diagrams, and process management.

## API Routes

| Route File                           | Purpose                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `src/routes/models.ts`               | Model CRUD: load, unload, list, get, health check, logs, sleep, wake           |
| `src/routes/model-configurations.ts` | Configuration CRUD: save, load, list, delete model presets                     |
| `src/routes/events.ts`               | SSE event streaming endpoint                                                   |
| `src/routes/health.ts`               | Backend health checks (`/api/health`, `/api/health/ready`, `/api/health/live`) |
| `src/routes/proxy.ts`                | OpenAI-compatible inference proxy (`/v1/*`) with round-robin load balancing    |
| `src/routes/direct-proxy.ts`         | Port-based direct proxy (`/api/direct/:port/*`) - bypasses model routing       |
| `src/routes/gpu.ts`                  | GPU info and availability (`/api/gpu/info`, `/api/gpu/available`)              |
| `src/routes/memory.ts`               | GPU memory info (`/api/memory/usage`, `/api/memory/usage/multi-gpu`)           |
| `src/routes/memory-profiles.ts`      | Memory profile CRUD, lookup, pre-load checks                                   |
| `src/routes/benchmarks.ts`           | Benchmark run CRUD, SSE progress, results                                      |
| `src/routes/orphans.ts`              | Orphan process detection                                                       |
| `src/routes/settings.ts`             | Application settings (HF token)                                                |
| `src/routes/auth.ts`                 | Authentication endpoints: info, login, callback, logout, me                    |
| `src/plugins/inference-auth.ts`      | Inference API key auth (separate from admin JWT)                               |

**Sleep Mode Endpoints** (in `src/routes/models.ts`):

- `POST /api/models/instances/:instance_id/sleep` - Put model to sleep (frees ~90% GPU memory)
- `POST /api/models/instances/:instance_id/wake` - Wake sleeping model
- `GET /api/models/instances/:instance_id/sleep-status` - Check sleep status

## Stores

### In-Memory Stores

| Store                            | Purpose                           |
| -------------------------------- | --------------------------------- |
| `src/stores/model-store.ts`      | ModelInstance tracking by ID/path |
| `src/stores/operation-store.ts`  | ControllerOperation audit trail   |
| `src/stores/runtime-settings.ts` | Runtime settings (HF token)       |

### SQLite-Backed Stores

| Store                                     | Purpose                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `src/stores/benchmark-store.ts`           | BenchmarkRun, Scenario, Results, Metrics persistence |
| `src/stores/memory-profile-store.ts`      | MemoryProfile storage and lookup                     |
| `src/stores/model-configuration-store.ts` | SavedModelConfiguration persistence                  |

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

| Variable               | Default                   | Description                                                                                  |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| `PORT`                 | 3000                      | Backend server port                                                                          |
| `VLLM_BASE_PORT`       | 5001                      | Base port for vLLM instances                                                                 |
| `VLLM_STARTUP_TIMEOUT` | 1800000                   | Model startup timeout in ms (30 min default)                                                 |
| `ENABLE_KVCACHED`      | true                      | Enable kvcached GPU sharing                                                                  |
| `KVCACHED_AUTOPATCH`   | 1                         | Auto-patch vLLM for kvcached                                                                 |
| `LOG_LEVEL`            | info                      | Pino log level                                                                               |
| `LOG_ALL_REQUESTS`     | false                     | Force all routes to log at info level (debugging)                                            |
| `HF_TOKEN`             | (none)                    | HuggingFace token for gated models                                                           |
| `DB_PATH`              | `./data/sardeenz.db`      | SQLite database file path                                                                    |
| `AUTH_MODE`            | `none`                    | Auth mode: `none`, `simple`, `oauth`                                                         |
| `ADMIN_USERNAME`       | `admin`                   | Username for simple auth mode                                                                |
| `ADMIN_PASSWORD`       | (none)                    | Password for simple auth (required when AUTH_MODE=simple)                                    |
| `JWT_SECRET`           | `change-me-in-production` | Secret for JWT signing                                                                       |
| `JWT_EXPIRATION_HOURS` | `8`                       | Token expiration in hours                                                                    |
| `API_BASE_URL`         | `http://localhost:3000`   | Base URL for OAuth callbacks                                                                 |
| `OAUTH_ISSUER_URL`     | (none)                    | OAuth provider URL (required when AUTH_MODE=oauth)                                           |
| `K8S_API_URL`          | (none)                    | Kubernetes API URL for user info (required when AUTH_MODE=oauth)                             |
| `OAUTH_CLIENT_ID`      | `sardeenz`                | OAuth2 client ID                                                                             |
| `OAUTH_CLIENT_SECRET`  | (none)                    | OAuth2 client secret (required when AUTH_MODE=oauth)                                         |
| `INFERENCE_API_KEY`    | (none)                    | API key for inference endpoints. When set, `/v1/*` and `/api/direct/*` require Bearer token. |
| `DEV_VIRTUAL_GPU_COUNT` | 0                        | (Dev only) Create N virtual GPUs for testing multi-GPU features with single GPU hardware. |

## Testing Notes

- Uses Vitest with `vi.mock()` for mocking
- Tests use `supertest` for HTTP assertions
- Mock vLLM process behavior for unit tests
- Integration tests require actual vLLM (skip in CI)
