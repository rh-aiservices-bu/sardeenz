# LLM Benchmarking & Memory Profiling - Implementation Plan

**Spec Location:** `specs/002-benchmarking/`

---

## 1. Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ BenchmarkConfig  │  │ BenchmarkProgress│  │ ResultsPanel  │ │
│  │      Form        │──│   (SSE Client)   │──│  (Charts)     │ │
│  └────────┬─────────┘  └────────▲─────────┘  └───────▲───────┘ │
└───────────│─────────────────────│────────────────────│─────────┘
            │ POST /api/benchmarks│ SSE events         │ GET results
            ▼                     │                    │
┌───────────────────────────────────────────────────────────────┐
│                        Backend                                 │
│  ┌──────────────────┐      ┌──────────────────────┐           │
│  │  Benchmark API   │──────│   BenchmarkRunner    │           │
│  │   (Routes)       │      │     (Service)        │           │
│  └────────┬─────────┘      └──────────┬───────────┘           │
│           │                           │                        │
│  ┌────────▼─────────┐      ┌──────────▼───────────┐           │
│  │ BenchmarkStore   │◄─────│     EventBus         │           │
│  │   (SQLite)       │      │  (SSE Distribution)  │           │
│  └──────────────────┘      └──────────┬───────────┘           │
└───────────────────────────────────────│───────────────────────┘
                                        │ HTTP requests (streaming)
                                        ▼
                              ┌───────────────────┐
                              │   vLLM Instances  │
                              │  (Model Servers)  │
                              └───────────────────┘
```

### Data Flow

1. **Configuration** → User configures benchmark via form
2. **Creation** → POST request creates benchmark run in SQLite
3. **Execution** → BenchmarkRunner orchestrates inference requests
4. **Measurement** → Streaming responses measure TTFT/TPS
5. **Progress** → EventBus emits SSE events for real-time UI updates
6. **Aggregation** → Percentiles computed, stored in SQLite
7. **Display** → Results fetched and rendered in charts

### Integration Points

| Existing System   | Integration                                                           |
| ----------------- | --------------------------------------------------------------------- |
| **EventBus**      | Emit events with `channel: 'benchmark'`, types: `progress`, `request` |
| **ModelManager**  | Query running instances for model selection                           |
| **MemoryMonitor** | Sample KVCache/GPU usage during benchmarks                            |
| **vLLM API**      | Streaming chat completions for TTFT measurement                       |

---

## 2. Technical Design

### 2.1 Database Schema (SQLite)

```sql
-- Main benchmark runs
CREATE TABLE benchmark_runs (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  mode TEXT NOT NULL,
  kvcached_enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  config_json TEXT NOT NULL,
  error_message TEXT,
  total_requests INTEGER,
  successful_requests INTEGER,
  failed_requests INTEGER,
  duration_seconds REAL
);

-- Scenarios within a run
CREATE TABLE benchmark_scenarios (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  model_path TEXT NOT NULL,
  model_name TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  concurrency INTEGER NOT NULL,
  warmup_requests INTEGER NOT NULL DEFAULT 3,
  total_requests INTEGER NOT NULL,
  sla_threshold_ms REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT
);

-- Individual request results
CREATE TABLE benchmark_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL REFERENCES benchmark_scenarios(id) ON DELETE CASCADE,
  request_sequence INTEGER NOT NULL,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  ttft_ms REAL,
  total_latency_ms REAL NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  tokens_per_second REAL,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  http_status INTEGER,
  executed_at TEXT NOT NULL
);

-- Aggregated metrics per scenario
CREATE TABLE benchmark_metrics (
  scenario_id TEXT PRIMARY KEY REFERENCES benchmark_scenarios(id) ON DELETE CASCADE,
  ttft_min REAL, ttft_max REAL, ttft_avg REAL,
  ttft_p50 REAL, ttft_p90 REAL, ttft_p95 REAL, ttft_p99 REAL,
  tps_min REAL, tps_max REAL, tps_avg REAL,
  tps_p50 REAL, tps_p90 REAL, tps_p95 REAL, tps_p99 REAL,
  e2e_min REAL, e2e_max REAL, e2e_avg REAL,
  e2e_p50 REAL, e2e_p90 REAL, e2e_p95 REAL, e2e_p99 REAL,
  goodput_count INTEGER,
  goodput_percent REAL,
  sla_threshold_ms REAL,
  kvcache_used_avg_gb REAL,
  kvcache_peak_gb REAL,
  gpu_memory_peak_gb REAL,
  total_requests INTEGER NOT NULL,
  successful_requests INTEGER NOT NULL,
  failed_requests INTEGER NOT NULL,
  requests_per_second REAL,
  tokens_per_second_total REAL
);

-- Memory profiles for capacity planning
CREATE TABLE memory_profiles (
  id TEXT PRIMARY KEY,
  profile_name TEXT NOT NULL,
  model_path TEXT NOT NULL,
  max_tokens INTEGER NOT NULL,

  -- Memory metrics (extracted from vLLM logs)
  weights_memory_gib REAL NOT NULL,
  cuda_graphs_gib REAL NOT NULL,
  kv_cache_available_gib REAL NOT NULL,
  kv_cache_per_request_mib REAL,

  -- GPU context at profiling time
  gpu_name TEXT,
  gpu_total_memory_gib REAL,

  -- Metadata
  comments TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,

  UNIQUE(model_path, max_tokens, gpu_name)
);

CREATE INDEX idx_memory_profiles_model_path ON memory_profiles(model_path);
CREATE INDEX idx_benchmark_results_scenario_warmup ON benchmark_results(scenario_id, is_warmup);
```

### 2.2 API Endpoints

#### Performance Benchmarking

| Method | Endpoint                                     | Description                                                 |
| ------ | -------------------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/benchmarks`                            | Create and start benchmark                                  |
| GET    | `/api/benchmarks`                            | List runs (paginated, filterable)                           |
| GET    | `/api/benchmarks/:id`                        | Get run details + scenarios + metrics                       |
| GET    | `/api/benchmarks/:id/events`                 | SSE stream for real-time progress                           |
| GET    | `/api/benchmarks/:id/scenarios/:sid/results` | Individual request results (paginated: `?page=1&limit=100`) |
| DELETE | `/api/benchmarks/:id`                        | Cancel running (sets status=cancelled) / delete completed   |
| POST   | `/api/benchmarks/:id/export`                 | Export as CSV/JSON                                          |

**Benchmark Run Status Values:**

| Status      | Meaning                                          |
| ----------- | ------------------------------------------------ |
| `pending`   | Created, not started                             |
| `running`   | Actively executing                               |
| `completed` | Finished successfully                            |
| `cancelled` | User aborted mid-run (partial results preserved) |
| `failed`    | Error during execution                           |

**Export Formats:**

**CSV Export:** One row per request result

- Columns: `run_id, scenario_id, model_path, sequence, ttft_ms, tps, latency_ms, success, timestamp`

**JSON Export:**

```json
{
  "run": {
    /* run metadata */
  },
  "scenarios": [
    {
      "model": "...",
      "config": {
        /* scenario config */
      },
      "metrics": {
        /* aggregated metrics */
      },
      "results": [
        /* individual requests */
      ]
    }
  ]
}
```

#### Memory Profiling

| Method | Endpoint                        | Description                                |
| ------ | ------------------------------- | ------------------------------------------ |
| GET    | `/api/memory/profiles`          | List all memory profiles                   |
| GET    | `/api/memory/profiles/:id`      | Get profile by ID                          |
| GET    | `/api/memory/profiles/lookup`   | Find by model_path + max_tokens + gpu_name |
| POST   | `/api/memory/profiles`          | Create from instance or manual entry       |
| PUT    | `/api/memory/profiles/:id`      | Update name/comments                       |
| DELETE | `/api/memory/profiles/:id`      | Delete profile                             |
| POST   | `/api/memory/check-before-load` | Pre-load memory check with warnings        |

### 2.3 SSE Event Types

```typescript
// Event types aligned with existing EventBus pattern
// Uses channel: 'benchmark' to differentiate from model loading events

// Progress updates during execution
interface BenchmarkProgressEvent {
  channel: 'benchmark'
  type: 'progress'
  data: {
    runId: string
    phase: 'starting' | 'warmup' | 'running' | 'calculating' | 'completed' | 'failed'
    scenarioId?: string
    currentRequest?: number
    totalRequests?: number
    completedScenarios?: number
    totalScenarios?: number
    message: string
  }
}

// Individual request completion
interface BenchmarkRequestEvent {
  channel: 'benchmark'
  type: 'request'
  data: {
    runId: string
    scenarioId: string
    sequence: number
    ttftMs: number
    tps: number
    totalLatencyMs: number
    success: boolean
  }
}
```

**SSE Connection Lifecycle:**

- Client connects to `/api/benchmarks/:id/events` after creating run
- Server sends events until run completes/fails/cancels
- Connection auto-closes with final `completed` or `failed` event
- Client should handle reconnection for long-running benchmarks

**Rolling Average:** Calculated client-side from SSE events. Frontend maintains sliding window of last 10 requests for live TTFT/TPS display.

### 2.4 Concurrency Execution Pattern

For `concurrency > 1`, use a **pool-based dispatch** pattern:

1. Maintain exactly N concurrent requests in flight
2. When a request completes, immediately dispatch next from queue
3. Track individual request timing independently
4. Continue until all `total_requests` are completed

Implementation: Use a semaphore or worker pool pattern (e.g., `p-limit` library).

```typescript
import pLimit from 'p-limit'

async function runScenario(scenario: BenchmarkScenario): Promise<void> {
  const limit = pLimit(scenario.concurrency)
  const tasks = Array.from({ length: scenario.totalRequests }, (_, i) =>
    limit(() => executeRequest(scenario, i))
  )
  await Promise.all(tasks)
}
```

---

## 3. File Manifest

### Files to Create

#### Performance Benchmarking

| File                                                | Purpose                         |
| --------------------------------------------------- | ------------------------------- |
| `packages/types/src/benchmark.ts`                   | Benchmark type definitions      |
| `packages/types/src/memory-profile.ts`              | Memory profile type definitions |
| `packages/types/src/schemas/benchmark.ts`           | TypeBox validation              |
| `apps/backend/src/db/connection.ts`                 | Singleton SQLite connection     |
| `apps/backend/src/db/migrations/001-benchmarks.sql` | Initial schema migration        |
| `apps/backend/src/db/migrate.ts`                    | Run migrations on startup       |
| `apps/backend/src/stores/benchmark-store.ts`        | SQLite persistence              |
| `apps/backend/src/services/benchmark-runner.ts`     | Execution engine                |
| `apps/backend/src/utils/prompt-generator.ts`        | Token-sized prompts             |
| `apps/backend/src/routes/benchmarks.ts`             | API endpoints                   |

#### Memory Profiling

| File                                                           | Purpose                            |
| -------------------------------------------------------------- | ---------------------------------- |
| `apps/backend/src/stores/memory-profile-store.ts`              | SQLite persistence for profiles    |
| `apps/backend/src/services/memory-profiler.ts`                 | Profile creation & pre-load checks |
| `apps/backend/src/routes/memory-profiles.ts`                   | Profile API endpoints              |
| `apps/frontend/src/components/benchmark/MemoryProfilesTab.tsx` | Memory profiles tab                |
| `apps/frontend/src/components/benchmark/CreateProfileCard.tsx` | Capture profile form               |
| `apps/frontend/src/components/benchmark/ProfilesTable.tsx`     | Saved profiles table               |

### Files to Modify

| File                                               | Scope                                    |
| -------------------------------------------------- | ---------------------------------------- |
| `apps/backend/src/server.ts`                       | Register all new routes                  |
| `apps/frontend/src/pages/ModelBenchmark.tsx`       | Add tabs (Performance / Memory Profiles) |
| `apps/frontend/src/services/api.ts`                | API client methods                       |
| `apps/frontend/src/components/LoadModelDialog.tsx` | Add pre-load warnings                    |

---

## 4. Implementation Phases

### Phase 1: Foundation (Backend Core)

- Add `better-sqlite3` and `p-limit` dependencies to `apps/backend`
- Create `apps/backend/src/db/` directory with:
  - `connection.ts` - Singleton SQLite connection
  - `migrations/001-benchmarks.sql` - Initial schema
  - `migrate.ts` - Run migrations on startup
- SQLite file location: `data/sardeenz.db` (configurable via `SARDEENZ_DB_PATH` env)
- Create benchmark and memory profile types in `packages/types`
- Create TypeBox validation schemas
- Implement BenchmarkStore and MemoryProfileStore
- Create basic API routes (CRUD for both features)

### Phase 2: Memory Profiling Backend

- Implement MemoryProfiler service
- Profile creation from running instances
- Pre-load check endpoint with warnings
- Profile lookup by model_path + max_tokens + gpu_name

### Phase 3: Performance Benchmarking Engine

- Implement BenchmarkRunner service
- Add prompt generator utility
- Streaming inference with TTFT measurement
- SSE progress emission via EventBus
- Percentile calculation

### Phase 4: Frontend - Tabbed Interface

- Update ModelBenchmark.tsx with tabs (Performance / Memory Profiles)
- Create MemoryProfilesTab component
- Create CreateProfileCard (capture from running model)
- Create ProfilesTable (list saved profiles)
- Wire up API client methods

### Phase 5: Frontend - Pre-Load Warnings

- Modify LoadModelDialog.tsx
- Add debounced pre-load check on model path/max_tokens change
- Display warnings as PatternFly Alerts
- Handle "no profile" gracefully

### Phase 6: Frontend - Performance Results

- BenchmarkConfigForm component
- BenchmarkProgress with SSE subscription
- BenchmarkResultsPanel with Nivo charts
- BenchmarkHistoryTable
- Export functionality

### Phase 7: Polish & Integration

- Comparison view for multiple runs (select 2-4 runs, overlay charts, show deltas)
- Export functionality (CSV/JSON)
- Error handling refinements
- UI polish

---

## 5. Technical Decisions

| Decision                      | Rationale                                                          |
| ----------------------------- | ------------------------------------------------------------------ |
| SQLite over PostgreSQL        | Simpler deployment, no external deps, sufficient for PoC           |
| Streaming for TTFT            | Only way to accurately measure first-token timing                  |
| Store individual results      | Enables accurate percentile calculation post-hoc                   |
| Reuse EventBus                | Consistent with model loading progress pattern                     |
| 4:1 char-to-token ratio       | Reasonable approximation for prompt generation                     |
| Shared SQLite database        | Same infrastructure as benchmarking - avoid multiple DBs           |
| Capture from running instance | Memory metrics already parsed during load - no re-work             |
| Pool-based concurrency        | Maintains steady N concurrent requests for realistic load testing  |
| Channel-based event naming    | Consistent with existing EventBus pattern (`channel: 'benchmark'`) |

---

## 6. Error Handling

| Error                         | Behavior                                            |
| ----------------------------- | --------------------------------------------------- |
| Model goes down mid-benchmark | Mark scenario as failed, continue others            |
| Network timeout on request    | Retry once, then mark request failed                |
| All requests fail in scenario | Mark scenario failed, continue run                  |
| SQLite write failure          | Log error, keep in-memory, retry on next write      |
| User cancels benchmark        | Set status to `cancelled`, preserve partial results |

---

## 7. Testing Strategy

**Testing Without GPU:**

- Mock `ModelManager.getRunningInstances()` to return fake instances
- Mock HTTP requests to return synthetic streaming responses
- Use fixed random seed for reproducible token generation
- Integration tests use SQLite in-memory mode (`:memory:`)

---

## 8. Configuration

| Env Variable               | Default            | Description              |
| -------------------------- | ------------------ | ------------------------ |
| `SARDEENZ_DB_PATH`         | `data/sardeenz.db` | SQLite database location |
| `BENCHMARK_WARMUP_DEFAULT` | `3`                | Default warmup requests  |
| `BENCHMARK_TIMEOUT_MS`     | `60000`            | Per-request timeout      |

---

## References

- [NVIDIA LLM Benchmarking Guide](https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/)
- [BentoML LLM Inference Metrics](https://bentoml.com/llm/inference-optimization/llm-inference-metrics)
- [vLLM Benchmark Documentation](https://docs.vllm.ai/en/latest/contributing/benchmarks.html)
