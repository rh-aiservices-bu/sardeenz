# LLM Benchmarking & Memory Profiling - Tasks

**Spec Location:** `specs/002-benchmarking/`

---

## Overview

Tasks are organized by implementation phase as defined in `plan.md`. Each task includes acceptance criteria and dependencies.

---

## Phase 1: Foundation (Backend Core)

### Task 1.1: Add Dependencies

**Description:** Add required npm packages to backend.

**Actions:**

- [ ] Add `better-sqlite3` to `apps/backend/package.json`
- [ ] Add `@types/better-sqlite3` as dev dependency
- [ ] Add `p-limit` for concurrency control
- [ ] Run `npm install`

**Acceptance:** Dependencies installed, TypeScript compiles without errors.

---

### Task 1.2: Create SQLite Infrastructure

**Description:** Set up SQLite database connection and migration system.

**Files to Create:**

- [ ] `apps/backend/src/db/connection.ts` - Singleton SQLite connection
- [ ] `apps/backend/src/db/migrate.ts` - Migration runner
- [ ] `apps/backend/src/db/migrations/001-benchmarks.sql` - Initial schema

**Implementation Notes:**

- SQLite file location: `data/sardeenz.db` (configurable via `SARDEENZ_DB_PATH`)
- Run migrations on startup
- Create `data/` directory if not exists

**Schema:** See `plan.md` Section 2.1 for complete schema.

**Acceptance:**

- Database file created on startup
- Tables created via migration
- Connection singleton works correctly

---

### Task 1.3: Create Type Definitions

**Description:** Define TypeScript types for benchmarks and memory profiles.

**Files to Create:**

- [ ] `packages/types/src/benchmark.ts`
- [ ] `packages/types/src/memory-profile.ts`
- [ ] `packages/types/src/schemas/benchmark.ts` (TypeBox)

**Types to Define:**

```typescript
// benchmark.ts
interface BenchmarkRun { id, name, status, mode, config, ... }
interface BenchmarkScenario { id, runId, instanceId, ... }
interface BenchmarkResult { id, scenarioId, ttftMs, tps, ... }
interface BenchmarkMetrics { ttft_p50, ttft_p90, tps_p50, ... }

// memory-profile.ts
interface MemoryProfile { id, modelPath, maxTokens, gpuName, ... }
interface MemoryCheckResult { canFit, warningLevel, message }
```

**Acceptance:** Types exported from `packages/types`, compiles cleanly.

---

### Task 1.4: Implement BenchmarkStore

**Description:** SQLite persistence layer for benchmark data.

**File:** `apps/backend/src/stores/benchmark-store.ts`

**Methods:**

- [ ] `createRun(config)` - Insert new benchmark run
- [ ] `getRun(id)` - Get run with scenarios and metrics
- [ ] `listRuns(options)` - Paginated list with filters
- [ ] `updateRunStatus(id, status)` - Update run status
- [ ] `createScenario(runId, config)` - Insert scenario
- [ ] `addResult(scenarioId, result)` - Insert individual result
- [ ] `saveMetrics(scenarioId, metrics)` - Save aggregated metrics
- [ ] `deleteRun(id)` - Delete run and cascaded data

**Acceptance:** All CRUD operations work, tests pass.

---

### Task 1.5: Implement MemoryProfileStore

**Description:** SQLite persistence layer for memory profiles.

**File:** `apps/backend/src/stores/memory-profile-store.ts`

**Methods:**

- [ ] `createProfile(profile)` - Insert new profile
- [ ] `getProfile(id)` - Get profile by ID
- [ ] `listProfiles()` - List all profiles
- [ ] `lookupProfile(modelPath, maxTokens, gpuName)` - Find by unique key
- [ ] `updateProfile(id, updates)` - Update name/comments
- [ ] `deleteProfile(id)` - Delete profile

**Acceptance:** All CRUD operations work, unique constraint enforced.

---

### Task 1.6: Create Basic API Routes

**Description:** Set up route handlers for both features.

**Files to Create:**

- [ ] `apps/backend/src/routes/benchmarks.ts`
- [ ] `apps/backend/src/routes/memory-profiles.ts`

**Modify:**

- [ ] `apps/backend/src/server.ts` - Register new routes

**Endpoints to Implement (Phase 1 - CRUD only):**

Benchmarks:

- [ ] `POST /api/benchmarks` - Create run (placeholder, no execution)
- [ ] `GET /api/benchmarks` - List runs
- [ ] `GET /api/benchmarks/:id` - Get run details
- [ ] `DELETE /api/benchmarks/:id` - Delete run

Memory Profiles:

- [ ] `GET /api/memory/profiles` - List profiles
- [ ] `GET /api/memory/profiles/:id` - Get profile
- [ ] `POST /api/memory/profiles` - Create profile
- [ ] `PUT /api/memory/profiles/:id` - Update profile
- [ ] `DELETE /api/memory/profiles/:id` - Delete profile

**Acceptance:** Routes registered, basic CRUD works via curl/Postman.

---

## Phase 2: Memory Profiling Backend

### Task 2.1: Implement MemoryProfiler Service

**Description:** Service for creating profiles from running instances.

**File:** `apps/backend/src/services/memory-profiler.ts`

**Methods:**

- [ ] `captureProfile(instanceId, name?, comments?)` - Create profile from running instance
- [ ] `checkBeforeLoad(modelPath, maxTokens, gpuName)` - Pre-load memory check

**Implementation Notes:**

- Use existing `parseMemoryMetrics()` from `apps/backend/src/utils/memory-parser.ts`
- Get instance from `ModelManager`
- Extract GPU info from memory monitor

**Acceptance:** Can capture profile from running model, pre-load check returns warnings.

---

### Task 2.2: Add Profile Lookup Endpoint

**Description:** Endpoint for finding profile by model_path + max_tokens + gpu_name.

**File:** `apps/backend/src/routes/memory-profiles.ts`

**Endpoint:**

- [ ] `GET /api/memory/profiles/lookup?model_path=...&max_tokens=...&gpu_name=...`

**Acceptance:** Returns matching profile or 404.

---

### Task 2.3: Add Pre-Load Check Endpoint

**Description:** Endpoint for checking if model will fit before loading.

**File:** `apps/backend/src/routes/memory-profiles.ts`

**Endpoint:**

- [ ] `POST /api/memory/check-before-load`

**Request Body:**

```json
{
  "model_path": "HuggingFaceTB/SmolLM2-135M-Instruct",
  "max_tokens": 2048,
  "gpu_name": "NVIDIA GeForce RTX 3090"
}
```

**Response:**

```json
{
  "has_profile": true,
  "can_fit": false,
  "warning_level": "danger",
  "message": "Model requires ~8GB but only 6GB available",
  "profile": { ... }
}
```

**Warning Levels:** `danger` (red), `caution` (yellow), `info` (blue/no profile)

**Acceptance:** Returns appropriate warnings based on profile lookup.

---

## Phase 3: Performance Benchmarking Engine

### Task 3.1: Implement Prompt Generator

**Description:** Generate prompts with approximate token counts.

**File:** `apps/backend/src/utils/prompt-generator.ts`

**Methods:**

- [ ] `generatePrompt(targetTokens: number)` - Generate prompt text
- [ ] Uses 4:1 character-to-token ratio

**Implementation Notes:**

- Generate realistic-looking text (lorem ipsum or similar)
- Ensure consistent output for same token count

**Acceptance:** Generates prompts, ~4 chars per token.

---

### Task 3.2: Implement BenchmarkRunner Service

**Description:** Core execution engine for benchmarks.

**File:** `apps/backend/src/services/benchmark-runner.ts`

**Methods:**

- [ ] `startBenchmark(runId)` - Begin executing benchmark
- [ ] `cancelBenchmark(runId)` - Cancel running benchmark
- [ ] `executeScenario(scenario)` - Run single scenario
- [ ] `executeRequest(scenario, sequence)` - Execute single request with timing

**Implementation Notes:**

- Use `p-limit` for pool-based concurrency
- Stream responses to measure TTFT
- Emit SSE events via EventBus (`channel: 'benchmark'`)
- Calculate percentiles after all requests complete

**Phases:**

1. `starting` - Initialize
2. `warmup` - Run warmup requests (not recorded)
3. `running` - Execute measured requests
4. `calculating` - Compute percentiles
5. `completed` or `failed`

**Acceptance:** Can run benchmark, metrics calculated correctly.

---

### Task 3.3: Implement Streaming TTFT Measurement

**Description:** Accurate first-token timing via streaming responses.

**File:** Part of `benchmark-runner.ts`

**Implementation Notes:**

- Use streaming HTTP client (fetch with ReadableStream)
- Record timestamp of first chunk
- Calculate `ttft_ms = first_chunk_time - request_start_time`
- Calculate `tokens_per_second = completion_tokens / (total_time - ttft)`

**Acceptance:** TTFT measured within ~5ms accuracy.

---

### Task 3.4: Implement Percentile Calculation

**Description:** Calculate P50/P90/P95/P99 from results.

**File:** Part of `benchmark-runner.ts` or new utility

**Metrics to Calculate:**

- TTFT: min, max, avg, P50, P90, P95, P99
- TPS: min, max, avg, P50, P90, P95, P99
- E2E: min, max, avg, P50, P90, P95, P99
- Goodput: count and percent meeting SLA threshold

**Acceptance:** Percentiles calculated correctly, stored in benchmark_metrics.

---

### Task 3.5: SSE Progress Events

**Description:** Emit real-time progress via EventBus.

**File:** Part of `benchmark-runner.ts`

**Events to Emit:**

- [ ] `{ channel: 'benchmark', type: 'progress', data: { phase, currentRequest, ... } }`
- [ ] `{ channel: 'benchmark', type: 'request', data: { ttftMs, tps, ... } }`

**Implementation Notes:**

- Extend EventBus to support benchmark channel
- Add SSE endpoint: `GET /api/benchmarks/:id/events`

**Acceptance:** Frontend receives real-time updates during benchmark.

---

### Task 3.6: Complete Benchmark Routes

**Description:** Finish remaining benchmark API endpoints.

**Endpoints:**

- [ ] `POST /api/benchmarks` - Create AND start benchmark
- [ ] `GET /api/benchmarks/:id/events` - SSE stream
- [ ] `GET /api/benchmarks/:id/scenarios/:sid/results` - Paginated results
- [ ] `POST /api/benchmarks/:id/export` - Export as CSV/JSON

**Acceptance:** All endpoints working, tested via curl.

---

## Phase 4: Frontend - Tabbed Interface

### Task 4.1: Update ModelBenchmark Page with Tabs

**Description:** Add Performance / Memory Profiles tabs.

**File:** `apps/frontend/src/pages/ModelBenchmark.tsx`

**Implementation:**

- [ ] Add PatternFly Tabs component
- [ ] Tab 1: Performance (existing/new content)
- [ ] Tab 2: Memory Profiles (new component)

**Acceptance:** Tabs render, switch correctly.

---

### Task 4.2: Create MemoryProfilesTab Component

**Description:** Tab content for memory profiles.

**File:** `apps/frontend/src/components/benchmark/MemoryProfilesTab.tsx`

**Layout:**

- CreateProfileCard (top)
- ProfilesTable (below)

**Acceptance:** Tab displays with both sub-components.

---

### Task 4.3: Create CreateProfileCard Component

**Description:** Form to capture memory profile from running model.

**File:** `apps/frontend/src/components/benchmark/CreateProfileCard.tsx`

**Fields:**

- [ ] Running model dropdown (from ModelManager)
- [ ] Profile name (optional, auto-generated default)
- [ ] Comments (optional textarea)
- [ ] "Capture Profile" button

**Implementation Notes:**

- Fetch running instances from `/api/models`
- POST to `/api/memory/profiles` on submit

**Acceptance:** Can capture profile from running model.

---

### Task 4.4: Create ProfilesTable Component

**Description:** Display saved memory profiles.

**File:** `apps/frontend/src/components/benchmark/ProfilesTable.tsx`

**Columns:**

- Model path
- Max Tokens
- GPU
- Fixed Cost (weights + CUDA graphs)
- Created date
- Actions (view, edit, delete)

**Implementation Notes:**

- Sortable columns
- PatternFly Table component
- Delete confirmation modal

**Acceptance:** Profiles displayed, sortable, deletable.

---

### Task 4.5: Add API Client Methods

**Description:** Add memory profile API methods to frontend client.

**File:** `apps/frontend/src/services/api.ts`

**Methods:**

- [ ] `listMemoryProfiles()`
- [ ] `getMemoryProfile(id)`
- [ ] `createMemoryProfile(data)`
- [ ] `updateMemoryProfile(id, data)`
- [ ] `deleteMemoryProfile(id)`
- [ ] `checkBeforeLoad(data)`

**Acceptance:** All methods work, handle errors correctly.

---

## Phase 5: Frontend - Pre-Load Warnings

### Task 5.1: Modify LoadModelDialog

**Description:** Add pre-load memory warnings.

**File:** `apps/frontend/src/components/LoadModelDialog.tsx`

**Changes:**

- [ ] Add debounced call to `/api/memory/check-before-load` (500ms)
- [ ] Display PatternFly Alert based on warning level
- [ ] Show "No profile found" info message gracefully
- [ ] Allow user to proceed regardless of warning

**Warning Levels:**

- `danger` (red Alert) - Model likely won't fit
- `caution` (yellow Alert) - Memory is tight
- `info` (blue Alert) - No profile found

**Acceptance:** Warnings display correctly, don't block loading.

---

## Phase 6: Frontend - Performance Benchmarking

### Task 6.1: Create BenchmarkConfigForm

**Description:** Form to configure benchmark parameters.

**File:** `apps/frontend/src/components/benchmark/BenchmarkConfigForm.tsx`

**Fields:**

- [ ] Model selection (checkboxes for running instances)
- [ ] Mode toggle (Isolated / Contention)
- [ ] Input tokens slider (64-4096, shows "~X tokens")
- [ ] Output tokens slider (16-2048, shows "~X tokens")
- [ ] Concurrency slider (1-32)
- [ ] Total requests slider (10-500)
- [ ] Warmup requests slider (0-10)
- [ ] Run name (optional)
- [ ] SLA threshold (advanced, default 5000ms)

**Acceptance:** Form renders, submits valid config.

---

### Task 6.2: Create BenchmarkProgress Component

**Description:** Real-time progress display during benchmark.

**File:** `apps/frontend/src/components/benchmark/BenchmarkProgress.tsx`

**Display:**

- [ ] Phase indicator (Starting → Warmup → Running → ...)
- [ ] Progress bar (X/Y requests)
- [ ] Live rolling average (TTFT, TPS)
- [ ] Cancel button

**Implementation Notes:**

- Subscribe to SSE endpoint
- Calculate rolling average from last 10 requests (client-side)
- Handle reconnection for long benchmarks

**Acceptance:** Shows real-time progress, cancel works.

---

### Task 6.3: Create BenchmarkResultsPanel

**Description:** Display benchmark results with charts.

**File:** `apps/frontend/src/components/benchmark/BenchmarkResultsPanel.tsx`

**Display:**

- [ ] Summary cards (duration, success rate, requests/sec)
- [ ] TTFT chart (grouped bar: P50/P90/P99 per model)
- [ ] TPS chart (grouped bar per model)
- [ ] Goodput chart (percentage per model)

**Implementation Notes:**

- Use Nivo charts (already in codebase)
- Fetch results from `/api/benchmarks/:id`

**Acceptance:** Results display with charts after benchmark completes.

---

### Task 6.4: Create BenchmarkHistoryTable

**Description:** List of past benchmark runs.

**File:** `apps/frontend/src/components/benchmark/BenchmarkHistoryTable.tsx`

**Columns:**

- Run name
- Status
- Mode
- Models (count)
- Created date
- Duration
- Actions (view, compare, delete)

**Features:**

- [ ] Pagination
- [ ] Status filter
- [ ] Click to view details

**Acceptance:** History displays, can navigate to past runs.

---

### Task 6.5: Add Benchmark API Client Methods

**Description:** Add benchmark API methods to frontend client.

**File:** `apps/frontend/src/services/api.ts`

**Methods:**

- [ ] `createBenchmark(config)` - POST /api/benchmarks
- [ ] `listBenchmarks(options)` - GET /api/benchmarks
- [ ] `getBenchmark(id)` - GET /api/benchmarks/:id
- [ ] `deleteBenchmark(id)` - DELETE /api/benchmarks/:id
- [ ] `exportBenchmark(id, format)` - POST /api/benchmarks/:id/export
- [ ] `subscribeToBenchmark(id)` - SSE subscription

**Acceptance:** All methods work correctly.

---

## Phase 7: Polish & Integration

### Task 7.1: Comparison View

**Description:** Compare multiple benchmark runs side-by-side.

**Implementation:**

- [ ] Add "Compare" checkbox to history table
- [ ] Compare button (2-4 runs selected)
- [ ] Overlay charts showing same metrics
- [ ] Table with delta (% change) between runs

**Acceptance:** Can select runs and see comparison overlay.

---

### Task 7.2: Export Functionality

**Description:** Download benchmark results as CSV/JSON.

**Implementation:**

- [ ] Export button on results panel
- [ ] Format selection (CSV/JSON)
- [ ] Trigger file download

**CSV Format:** One row per request
**JSON Format:** Nested structure (run → scenarios → results)

**Acceptance:** Files download correctly with proper data.

---

### Task 7.3: Error Handling Refinements

**Description:** Handle edge cases gracefully.

**Scenarios:**

- [ ] Model goes down mid-benchmark
- [ ] Network timeout on request
- [ ] User cancels during warmup
- [ ] SQLite write failure

**Acceptance:** Errors handled gracefully, user informed.

---

### Task 7.4: UI Polish

**Description:** Final UI improvements.

**Items:**

- [ ] Loading states for all async operations
- [ ] Empty states for tables
- [ ] Tooltips for complex metrics
- [ ] Mobile responsiveness (if applicable)
- [ ] Accessibility review

**Acceptance:** UI polished, no rough edges.

---

## Summary

| Phase                             | Tasks        | Status      |
| --------------------------------- | ------------ | ----------- |
| Phase 1: Foundation               | 6 tasks      | Not Started |
| Phase 2: Memory Profiling Backend | 3 tasks      | Not Started |
| Phase 3: Benchmarking Engine      | 6 tasks      | Not Started |
| Phase 4: Frontend Tabs            | 5 tasks      | Not Started |
| Phase 5: Pre-Load Warnings        | 1 task       | Not Started |
| Phase 6: Frontend Performance     | 5 tasks      | Not Started |
| Phase 7: Polish                   | 4 tasks      | Not Started |
| **Total**                         | **30 tasks** |             |
