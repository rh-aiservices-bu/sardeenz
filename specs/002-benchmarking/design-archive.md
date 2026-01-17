# LLM Benchmarking & Memory Profiling - Design document

**Spec Location:** `specs/002-benchmarking/`

---

## 1. Executive Summary

### What Is This?

A benchmarking feature for sardeenz with two complementary capabilities:

1. **Performance Benchmarking**: Measures LLM inference speed (TTFT, TPS, latency) across loaded models
2. **Memory Profiling**: Measures baseline VRAM consumption for capacity planning and pre-load warnings

Together, these provide quantitative data to answer critical questions about model performance, GPU memory efficiency, and the real-world impact of kvcached memory sharing.

### Why Does This Matter?

Multi-model LLM deployment is complex. Teams need answers to:

**Performance Questions:**

- **"How fast is this model?"** - Baseline latency and throughput metrics
- **"Is kvcached actually helping?"** - A/B comparison with/without memory sharing
- **"Can we handle production load?"** - Contention testing with concurrent models
- **"Which model should we deploy?"** - Data-driven model selection

**Capacity Planning Questions:**

- **"Will this model fit?"** - Know VRAM requirements before loading
- **"How much memory at different token limits?"** - Profile at 512, 1024, 2048, 4096 max_tokens
- **"Which GPU should host this model?"** - Data for multi-GPU/multi-instance scheduling

Without benchmarking and profiling, these decisions rely on guesswork. This feature provides the data.

### Key Value Propositions

| For...                 | Performance Benchmarking                     | Memory Profiling                       |
| ---------------------- | -------------------------------------------- | -------------------------------------- |
| **ML Engineers**       | Quantify model performance before production | Know exact VRAM requirements           |
| **Platform Operators** | Capacity planning with concurrency data      | Pre-load warnings prevent OOM failures |
| **Decision Makers**    | Data-driven model selection                  | Cost optimization via memory awareness |
| **kvcached Users**     | Measure performance impact                   | Understand memory overhead per model   |

---

## 2. Key Concepts & Terminology

### Performance Metrics

| Metric                           | What It Measures                             | Why It Matters                                               |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| **TTFT** (Time to First Token)   | Latency from request to first response token | User-perceived responsiveness; critical for streaming UX     |
| **TPS** (Tokens Per Second)      | Token generation throughput                  | Raw model speed; higher = faster completions                 |
| **TPOT** (Time Per Output Token) | Average time between tokens (excludes TTFT)  | Consistent generation speed; affects streaming smoothness    |
| **E2E Latency**                  | Total request-to-completion time             | Overall response time; combines TTFT + generation            |
| **Goodput**                      | % of requests meeting SLA threshold          | Production reliability; what % of requests are "fast enough" |

### Memory Metrics

| Metric                   | What It Measures                       | Why It Matters                          |
| ------------------------ | -------------------------------------- | --------------------------------------- |
| **Weights Memory**       | Model parameters loaded to GPU         | Fixed cost - cannot be reduced          |
| **CUDA Graphs**          | Pre-compiled inference kernels         | Fixed cost after warmup                 |
| **KV Cache Available**   | Memory pool for attention cache        | Shared across all models (via kvcached) |
| **KV Cache Per Request** | Estimated cache per concurrent request | Scales with max_tokens × concurrency    |
| **Baseline Memory**      | Weights + CUDA Graphs                  | Minimum VRAM to load model              |

### Statistical Percentiles

Raw averages hide outliers. We report **P50/P90/P95/P99**:

- **P50 (median)**: Typical experience - 50% of requests are faster than this
- **P90**: Tail latency - 90% of requests are faster
- **P99**: Worst-case typical - only 1% are slower
- **P99** matters for SLAs - users remember the slow requests

### Testing Modes

**Isolated Mode (Sequential)**

- Runs scenarios one at a time
- Each model tested independently
- Clean metrics without interference
- Use for: Baseline profiling, model comparison

**Contention Mode (Parallel)**

- Runs all scenarios simultaneously
- Models compete for GPU resources
- Real-world multi-tenant behavior
- Use for: Capacity planning, stress testing

### Warmup Requests

First few requests are discarded because:

- CUDA kernels need compilation (cold start)
- KV cache is empty
- Memory allocation happens on first use

Default: 3 warmup requests before measurement begins.

---

## 3. Use Case Scenarios

### Scenario A: Baseline Profiling

**Goal:** Establish performance baseline for a single model.

**Setup:**

- Select one model instance
- Isolated mode
- Configure: 512 input tokens, 128 output tokens, concurrency 1
- Run 50 measured requests

**Output:** TTFT/TPS/E2E percentiles for this model under ideal conditions.

**Use this when:** Onboarding a new model, comparing model versions.

---

### Scenario B: KVCache A/B Testing

**Goal:** Quantify the performance impact of kvcached memory sharing.

**Setup:**

1. Run benchmark with kvcached **enabled**
2. Run identical benchmark with kvcached **disabled**
3. Compare metrics side-by-side

**Key Questions Answered:**

- Does shared KV cache add latency overhead?
- How much memory is saved?
- Is the tradeoff worth it?

**Output:** Comparative metrics showing kvcached impact on TTFT, TPS, and memory.

---

### Scenario C: Capacity Planning (Contention Testing)

**Goal:** Understand real-world performance under load.

**Setup:**

- Select 2-4 loaded models
- Contention mode (parallel execution)
- Configure realistic concurrency (e.g., 10 concurrent requests per model)
- Vary input/output token counts to match expected workload

**Key Questions Answered:**

- What throughput can we sustain with multiple models?
- How does contention affect tail latency?
- Where is the breaking point?

**Output:** Per-model metrics under contention, total system throughput.

---

### Scenario D: Memory Profiling

**Goal:** Capture baseline VRAM footprint for capacity planning.

**Setup:**

1. Load a model with desired `max_tokens` configuration
2. Navigate to Benchmark → Memory Profiles tab
3. Select the running model instance
4. Click "Capture Profile"

**What Gets Captured:**

- Model weights memory (from vLLM logs)
- CUDA graphs memory (from vLLM logs)
- KV cache available after load
- Estimated KV cache per request at configured max_tokens
- GPU context (name, total memory)

**Output:** Stored memory profile keyed by `model_path + max_tokens`.

**Use this when:** Before deploying new models, planning GPU capacity, comparing model memory efficiency.

---

### Scenario E: Pre-Load Warning

**Goal:** Warn before loading models that may not fit in available GPU memory.

**Flow:**

1. User opens Load Model dialog
2. Enters model path and max_tokens
3. System checks for existing memory profile
4. If profile exists and estimated memory > available GPU:
   - Show warning (danger/caution/info levels)
   - User can proceed anyway (warn-only, never block)

**Key Behavior:**

- Warnings are advisory, never blocking
- "No profile found" shows info-level notice
- Profile lookup is debounced (500ms) to avoid excessive API calls

---

## 4. Architecture Overview

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

| Existing System   | Integration                                           |
| ----------------- | ----------------------------------------------------- |
| **EventBus**      | Emit `benchmark_progress`, `benchmark_request` events |
| **ModelManager**  | Query running instances for model selection           |
| **MemoryMonitor** | Sample KVCache/GPU usage during benchmarks            |
| **vLLM API**      | Streaming chat completions for TTFT measurement       |

---

## 5. User Workflow

### Overview

The Benchmark page has two tabs:

- **Performance**: Configure and run inference benchmarks
- **Memory Profiles**: Capture and manage memory profiles for capacity planning

### Tab: Performance

#### Step 1: Access Benchmarking

Navigate to Model Benchmark page from sidebar → Performance tab. See:

- **Configuration Panel** (left): Set up new benchmark
- **History Panel** (right): Previous benchmark runs

#### Step 2: Configure Benchmark

**Model Selection**

- Checkboxes for each running model instance
- Select one (baseline), several (comparison), or all (stress test)
- Shows model name, path, current status

**Test Parameters**

- **Mode**: Toggle between Isolated and Contention
- **Input Tokens**: Slider 64-4096 (default: 512)
- **Output Tokens**: Slider 16-2048 (default: 128)
- **Concurrency**: 1-32 concurrent requests (default: 1)
- **Total Requests**: 10-500 measured requests (default: 50)
- **Warmup**: 0-10 warmup requests (default: 3)

**Advanced Options**

- **SLA Threshold**: ms threshold for goodput calculation (default: 5000)
- **KVCache Override**: Enable/Disable for A/B testing

#### Step 3: Run & Monitor

Click "Start Benchmark" to begin. UI transitions to progress view:

- **Phase Indicator**: Starting → Warmup → Running → Calculating → Complete
- **Progress Bar**: X/Y requests completed per scenario
- **Live Metrics**: Rolling average TTFT, TPS as requests complete
- **Cancel Button**: Abort benchmark (results up to that point preserved)

#### Step 4: Analyze Results

Upon completion, view comprehensive results:

**Summary Cards**

- Total duration, success rate, requests/second
- Per-model TTFT P50/P90/P99
- Per-model TPS P50/P90/P99

**Charts**

- Grouped bar chart: TTFT by model (P50/P90/P99)
- Grouped bar chart: TPS by model
- Goodput percentage per model

**Detail View**

- Per-scenario breakdown
- Individual request results (expandable)
- KVCache/GPU memory peak during test

#### Step 5: Export & Compare

- **Export**: Download results as CSV or JSON
- **Compare**: Select previous runs to overlay metrics
- **History**: Browse past benchmarks with filtering

### Tab: Memory Profiles

#### Step 1: Capture a Profile

1. Ensure you have a model loaded with desired `max_tokens` configuration
2. Navigate to Benchmark → Memory Profiles tab
3. In "Create Memory Profile" card:
   - Select running model from dropdown
   - Optionally customize profile name
   - Add comments (e.g., "GPU A100, no other models loaded")
4. Click "Capture Profile"
5. Profile is stored with `model_path + max_tokens` as unique key

#### Step 2: View Saved Profiles

Profiles table shows:

- **Model**: HuggingFace path or local path
- **Max Tokens**: Configuration when profiled
- **Fixed Cost**: `weights + CUDA graphs` (baseline memory)
- **Created**: When profile was captured
- **Actions**: View details, edit name/comments, delete

#### Step 3: Pre-Load Warnings (Automatic)

When loading a new model via Load Model dialog:

1. As you type model path and select max_tokens, system checks for matching profile
2. If profile exists and estimated memory > available GPU:
   - **Danger** (red): Model requires more than available memory
   - **Caution** (yellow): Memory is tight, may succeed
   - **Info** (blue): No profile found for this configuration
3. Warnings are advisory only - you can always proceed

---

## 6. Technical Design

### 6.1 Database Schema (SQLite)

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
  tpot_ms REAL,
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

  UNIQUE(model_path, max_tokens)
);

CREATE INDEX idx_memory_profiles_model_path ON memory_profiles(model_path);
```

### 6.2 API Endpoints

#### Performance Benchmarking

| Method | Endpoint                                     | Description                           |
| ------ | -------------------------------------------- | ------------------------------------- |
| POST   | `/api/benchmarks`                            | Create and start benchmark            |
| GET    | `/api/benchmarks`                            | List runs (paginated, filterable)     |
| GET    | `/api/benchmarks/:id`                        | Get run details + scenarios + metrics |
| GET    | `/api/benchmarks/:id/events`                 | SSE stream for real-time progress     |
| GET    | `/api/benchmarks/:id/scenarios/:sid/results` | Individual request results            |
| DELETE | `/api/benchmarks/:id`                        | Cancel running / delete completed     |
| POST   | `/api/benchmarks/:id/export`                 | Export as CSV/JSON                    |

#### Memory Profiling

| Method | Endpoint                        | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/api/memory/profiles`          | List all memory profiles             |
| GET    | `/api/memory/profiles/:id`      | Get profile by ID                    |
| GET    | `/api/memory/profiles/lookup`   | Find by model_path + max_tokens      |
| POST   | `/api/memory/profiles`          | Create from instance or manual entry |
| PUT    | `/api/memory/profiles/:id`      | Update name/comments                 |
| DELETE | `/api/memory/profiles/:id`      | Delete profile                       |
| POST   | `/api/memory/check-before-load` | Pre-load memory check with warnings  |

### 6.3 SSE Event Types

```typescript
// Progress updates during execution
interface BenchmarkProgressEvent {
  type: 'benchmark_progress'
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
  type: 'benchmark_request'
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

### 6.4 Key Files to Create/Modify

#### Performance Benchmarking

| File                                            | Action | Purpose             |
| ----------------------------------------------- | ------ | ------------------- |
| `packages/types/src/benchmark.ts`               | Create | Type definitions    |
| `packages/types/src/schemas/benchmark.ts`       | Create | TypeBox validation  |
| `apps/backend/src/stores/benchmark-store.ts`    | Create | SQLite persistence  |
| `apps/backend/src/services/benchmark-runner.ts` | Create | Execution engine    |
| `apps/backend/src/utils/prompt-generator.ts`    | Create | Token-sized prompts |
| `apps/backend/src/routes/benchmarks.ts`         | Create | API endpoints       |

#### Memory Profiling

| File                                                           | Action | Purpose                            |
| -------------------------------------------------------------- | ------ | ---------------------------------- |
| `apps/backend/src/stores/memory-profile-store.ts`              | Create | SQLite persistence for profiles    |
| `apps/backend/src/services/memory-profiler.ts`                 | Create | Profile creation & pre-load checks |
| `apps/backend/src/routes/memory-profiles.ts`                   | Create | Profile API endpoints              |
| `apps/frontend/src/components/benchmark/MemoryProfilesTab.tsx` | Create | Memory profiles tab                |
| `apps/frontend/src/components/benchmark/CreateProfileCard.tsx` | Create | Capture profile form               |
| `apps/frontend/src/components/benchmark/ProfilesTable.tsx`     | Create | Saved profiles table               |
| `apps/frontend/src/components/LoadModelDialog.tsx`             | Modify | Add pre-load warnings              |

#### Shared

| File                                         | Action | Purpose                                  |
| -------------------------------------------- | ------ | ---------------------------------------- |
| `apps/backend/src/server.ts`                 | Modify | Register all new routes                  |
| `apps/frontend/src/pages/ModelBenchmark.tsx` | Modify | Add tabs (Performance / Memory Profiles) |
| `apps/frontend/src/services/api.ts`          | Modify | API client methods                       |

---

## 7. Implementation Phases

### Phase 1: Foundation (Backend Core)

- Add `better-sqlite3` dependency
- Create benchmark types and schemas
- Implement shared SQLite database infrastructure
- Create BenchmarkStore and MemoryProfileStore
- Create basic API routes (CRUD for both features)

### Phase 2: Memory Profiling Backend

- Implement MemoryProfiler service
- Profile creation from running instances
- Pre-load check endpoint with warnings
- Profile lookup by model_path + max_tokens

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

- KVCache toggle for A/B testing
- Comparison view for multiple runs
- Error handling refinements
- UI polish

---

## 8. Design Decisions & Rationale

### Performance Benchmarking

| Decision                 | Rationale                                                |
| ------------------------ | -------------------------------------------------------- |
| SQLite over PostgreSQL   | Simpler deployment, no external deps, sufficient for PoC |
| Streaming for TTFT       | Only way to accurately measure first-token timing        |
| Warmup requests          | Avoids cold-start skew from CUDA compilation             |
| Store individual results | Enables accurate percentile calculation post-hoc         |
| Reuse EventBus           | Consistent with model loading progress pattern           |
| 4:1 char-to-token ratio  | Reasonable approximation for prompt generation           |

### Memory Profiling

| Decision                       | Rationale                                                          |
| ------------------------------ | ------------------------------------------------------------------ |
| Separate from benchmarking     | Different workflow, different metrics - cleaner separation         |
| Capture from running instance  | Memory metrics already parsed during load - no re-work             |
| Key by model_path + max_tokens | Same model at different token limits has different memory          |
| Warn-only pre-load             | User knows best - avoid blocking legitimate experiments            |
| Standard presets + custom      | Cover common cases (512, 1024, 2048, 4096) + allow experimentation |
| Shared SQLite database         | Same infrastructure as benchmarking - avoid multiple DBs           |

---

## References

- [NVIDIA LLM Benchmarking Guide](https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/)
- [BentoML LLM Inference Metrics](https://bentoml.com/llm/inference-optimization/llm-inference-metrics)
- [vLLM Benchmark Documentation](https://docs.vllm.ai/en/latest/contributing/benchmarks.html)
