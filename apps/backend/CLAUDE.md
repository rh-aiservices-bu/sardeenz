# CLAUDE.md - Backend Context

> **Note for AI Assistants**: Backend-specific context for **sardeenz**. For project overview, see root [CLAUDE.md](../../CLAUDE.md). For frontend context, see [frontend/CLAUDE.md](../frontend/CLAUDE.md).

## Backend Overview

Fastify backend providing Controller API and Unified Proxy for multi-model LLM management. Manages vLLM subprocess lifecycle with real-time event streaming.

**Technology Stack**: Node.js 22.x, TypeScript 5.7+ (strict mode), Fastify 5.1+, PostgreSQL (pg/node-postgres)

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
| `src/routes/cluster/index.ts`        | Cluster route group — registers status, models, presets, profiles, benchmarks  |
| `src/routes/cluster/status.ts`       | Cluster status, per-pod GPU/memory info, aggregated model list                 |
| `src/routes/cluster/models.ts`       | Cross-pod model load/unload/sleep/wake with SSE relay                          |
| `src/routes/cluster/presets.ts`      | Cluster-wide preset application with pod scheduler placement                   |
| `src/routes/cluster/profiles.ts`     | Cluster-wide memory profile aggregation and cross-pod profiling                |
| `src/routes/cluster/benchmarks.ts`   | Cluster benchmark export/import                                                |
| `src/routes/internal.ts`             | Inter-pod endpoints (HMAC-authed) for heartbeat, model ops, presets, profiles  |
| `src/plugins/inference-auth.ts`      | Inference API key auth (separate from admin JWT)                               |
| `src/plugins/cluster-auth.ts`        | HMAC auth for `/internal/*` inter-pod routes                                   |
| `src/plugins/leader-redirect.ts`     | Redirects admin requests from follower pods to the leader                      |

**Sleep Mode Endpoints** (in `src/routes/models.ts`):

- `POST /api/models/instances/:instance_id/sleep` - Put model to sleep (frees ~90% GPU memory)
- `POST /api/models/instances/:instance_id/wake` - Wake sleeping model
- `GET /api/models/instances/:instance_id/sleep-status` - Check sleep status

## Stores

### In-Memory Stores

| Store                                  | Purpose                                             |
| -------------------------------------- | --------------------------------------------------- |
| `src/stores/model-store.ts`            | ModelInstance tracking by ID/path                    |
| `src/stores/operation-store.ts`        | ControllerOperation audit trail                      |
| `src/stores/runtime-settings.ts`       | Runtime settings (HF token)                          |
| `src/stores/cluster-routing-store.ts`  | Cluster routing table (model→pod mapping for proxy)  |
| `src/stores/peer-store.ts`             | Cluster peer info (pod status, addresses, GPUs)      |
| `src/stores/move-store.ts`             | Model move operation state with concurrency lock     |
| `src/stores/metrics-store.ts`          | Resource metrics and per-instance connection counts  |

### PostgreSQL-Backed Stores

| Store                                     | Purpose                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `src/stores/benchmark-store.ts`           | BenchmarkRun, Scenario, Results, Metrics persistence |
| `src/stores/memory-profile-store.ts`      | MemoryProfile storage and lookup                     |
| `src/stores/model-configuration-store.ts` | SavedModelConfiguration persistence                  |

## Cluster Services

| Service                              | Purpose                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `src/services/cluster-manager.ts`    | Top-level orchestrator: peer discovery, leader election, heartbeat |
| `src/services/leader-election.ts`    | K8s Lease-based leader election (falls back to static for dev)  |
| `src/services/peer-discovery.ts`     | K8s endpoint-based peer discovery (or static `CLUSTER_PEERS`)   |
| `src/services/heartbeat.ts`          | Periodic heartbeat with model/GPU data; reaps unavailable peers |
| `src/services/pod-scheduler.ts`      | Placement algorithm and preset reconciliation for cluster scheduling |
| `src/services/model-mover.ts`        | Blue-green model moves between GPUs/pods with drain tracking    |
| `src/services/cluster-auth.ts`       | HMAC-SHA256 signing/verification for inter-pod requests         |

## Inference-Sim Utilities

| Utility                                 | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `src/utils/sim-gpu-tracker.ts`          | Simulated GPU memory tracking for inference-sim mode |
| `src/utils/model-memory-estimator.ts`   | Estimates model memory from model path/name          |

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
| `SARDEENZ_VLLM_BASE_PORT`       | 12346            | Base port for vLLM instances (auto-offset per pod in cluster mode)                           |
| `SARDEENZ_VLLM_STARTUP_TIMEOUT` | 1800000          | Model startup timeout in ms (30 min default)                                                 |
| `ENABLE_KVCACHED`      | true                      | Enable kvcached GPU sharing                                                                  |
| `KVCACHED_AUTOPATCH`   | 1                         | Auto-patch vLLM for kvcached                                                                 |
| `LOG_LEVEL`            | info                      | Pino log level                                                                               |
| `LOG_ALL_REQUESTS`     | false                     | Force all routes to log at info level (debugging)                                            |
| `HF_TOKEN`             | (none)                    | HuggingFace token for gated models                                                           |
| `DATABASE_URL`         | `postgresql://sardeenz:sardeenz@localhost:5432/sardeenz` | PostgreSQL connection string                                              |
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
| `INFERENCE_BACKEND`  | `vllm`                   | Inference backend: `vllm` or `inference-sim`                                             |
| `SIM_GPU_MEMORY_GB`  | `24`                     | Total memory per simulated GPU in GB (inference-sim only)                                |
| `SIM_MODEL_MEMORY_GB`| `4`                      | Default model memory estimate in GB (inference-sim only)                                 |
| `SIM_STARTUP_DURATION`| `3s`                    | Simulated model loading time (inference-sim only)                                        |
| `INFERENCE_SIM_BINARY`| `llm-d-inference-sim`   | Path to inference-sim binary (inference-sim only)                                        |
| `CLUSTER_PEERS`      | (none)                   | Comma-separated `id=host:port` list for static peer discovery (local dev)                |
| `CLUSTER_SECRET`     | (none)                   | HMAC secret for inter-pod auth (required in cluster mode, min 32 chars)                  |
| `CLUSTER_EXPECTED_PODS`| 0                      | Expected pod count for cluster readiness checks                                          |

## Testing Notes

- Uses Vitest with `vi.mock()` for mocking
- Tests use `supertest` for HTTP assertions
- Mock vLLM process behavior for unit tests
- Integration tests require actual vLLM (skip in CI)
