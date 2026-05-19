# Tasks: Inference Simulator Backend

**Input**: Design documents from `/specs/006-inference-sim-backend/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: No test tasks included (not explicitly requested in spec). Unit tests for new utility modules are included as implementation tasks since they validate core logic.

**Organization**: Tasks grouped by user story. US3 (Transparent Backend Switching) comes first because it establishes the config layer that US1 and US2 depend on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Foundational (Config + New Utility Modules)

**Purpose**: Create the configuration layer and new utility modules that ALL user stories depend on. No existing behavior is changed in this phase.

- [X] T001 Add inference-sim configuration fields, validation, and `isInferenceSimMode()` helper to `apps/backend/src/config.ts`
  - Add to `Config` interface: `inferenceBackend`, `simGpuMemoryGB`, `simModelMemoryGB`, `simStartupDuration`, `inferenceSimBinary`
  - Add to `config` object: `getEnv('INFERENCE_BACKEND', 'vllm')` with validation (must be `'vllm'` or `'inference-sim'`)
  - Add `SIM_GPU_MEMORY_GB` (default 24), `SIM_MODEL_MEMORY_GB` (default 4), `SIM_STARTUP_DURATION` (default `'3s'`), `INFERENCE_SIM_BINARY` (default `'llm-d-inference-sim'`)
  - Export `isInferenceSimMode()` helper function
- [X] T002 [P] Create `ModelMemoryEstimator` in `apps/backend/src/utils/model-memory-estimator.ts`
  - Pure function: `estimateModelMemory(modelPath: string, defaultMemoryGB: number): ModelMemoryEstimate`
  - Regex `/(\d+(?:\.\d+)?)\s*[bB]\b/` to extract size from model name
  - ≤30B: `params * 2` GB (fp16); >30B: `params * 0.5 + 2` GB (4-bit quantized + overhead)
  - Fallback to `defaultMemoryGB` when no size indicator found
  - Return `{ modelPath, detectedSizeB, estimatedMemoryGB, source }` per data-model.md
- [X] T003 [P] Create `SimGpuTracker` singleton in `apps/backend/src/utils/sim-gpu-tracker.ts`
  - Per data-model.md: `initialize()`, `allocate()`, `deallocate()`, `getGpuInfo()`, `getNvidiaSmiInfo()`, `getAvailableMemoryMB()`, `reset()`
  - Per-GPU memory tracking with `Map<number, SimulatedGpu>` where SimulatedGpu has `{ index, name, totalMemoryMB, usedMemoryMB, models: Map<instanceId, memoryMB> }`
  - `getGpuInfo()` returns `GpuInfo[]` matching existing interface in gpu-info.ts
  - `getNvidiaSmiInfo()` returns `NvidiaSmiInfo` with simulated `GpuStatus[]` and `GpuProcess[]` for loaded models
  - `allocate()` throws if exceeding GPU capacity; `deallocate()` removes from all GPUs
- [X] T004 [P] Add unit tests for `ModelMemoryEstimator` in `apps/backend/tests/unit/model-memory-estimator.test.ts`
  - Test size detection: "7B" → 14 GB, "70B" → 37 GB, "1.5B" → 3 GB
  - Test fallback: "my-custom-model" → default memory
  - Test regex edge cases: "Llama-3.2-7B-Instruct", "qwen2.5-72b-instruct", model with no size
- [X] T005 [P] Add unit tests for `SimGpuTracker` in `apps/backend/tests/unit/sim-gpu-tracker.test.ts`
  - Test initialize creates correct number of GPUs with correct memory
  - Test allocate/deallocate updates memory correctly
  - Test allocate throws on capacity exceeded
  - Test deallocate cleans up from all GPUs
  - Test `getGpuInfo()` and `getNvidiaSmiInfo()` return correct shapes
  - Test `reset()` clears all state

**Checkpoint**: Config layer and utility modules ready. No existing behavior changed yet.

---

## Phase 2: User Story 3 — Transparent Backend Switching (Priority: P1)

**Goal**: Switch between vLLM and inference-sim using only `INFERENCE_BACKEND` env var. Default behavior (vLLM) is unchanged.

**Independent Test**: Start backend without `INFERENCE_BACKEND` → behaves identically to current. Set `INFERENCE_BACKEND=inference-sim` → starts without NVML errors and reports simulated GPU info. Set `INFERENCE_BACKEND=invalid` → fails with clear error.

- [X] T006 [US3] Modify `apps/backend/src/utils/gpu-info.ts` to delegate to SimGpuTracker in inference-sim mode
  - In `doDetectGpuInfo()`: if `isInferenceSimMode()`, return `simGpuTracker.getGpuInfo()` instead of NVML detection
  - In `getNvidiaSmiInfo()`: if `isInferenceSimMode()`, return `simGpuTracker.getNvidiaSmiInfo()` instead of NVML queries
  - Import `isInferenceSimMode` from config and `simGpuTracker` from sim-gpu-tracker
  - Existing NVML code paths must remain untouched for vLLM mode
- [X] T007 [US3] Guard NVML init/shutdown and initialize SimGpuTracker in `apps/backend/src/server.ts`
  - Wrap `initializeNvml()` call (line 263) in `if (!isInferenceSimMode())` guard
  - Wrap `shutdownNvml()` call (line 308) in `if (!isInferenceSimMode())` guard
  - When `isInferenceSimMode()`: call `simGpuTracker.initialize()` with GPU count from `config.virtualGpuCount` (minimum 1) and `config.simGpuMemoryGB`
  - Add startup validation: verify inference-sim binary exists via `which` or `execSync` and log clear error with install instructions if not found (FR-004)
  - Log mode at startup: `"Starting in inference-sim mode"` vs `"Starting with vLLM backend"`

**Checkpoint**: Backend starts cleanly in both modes. vLLM mode unchanged. inference-sim mode starts without GPU/NVML errors and reports simulated GPUs via `/api/gpu/info`.

---

## Phase 3: User Story 1 — GPU-Free Multi-Pod Development (Priority: P1) MVP

**Goal**: Load models using inference-sim binary, health check works, model reaches "running" status, inference requests return synthetic responses.

**Independent Test**: Start with `INFERENCE_BACKEND=inference-sim`. Load `meta-llama/Llama-3.2-7B-Instruct` via API. Verify model transitions to "running". Send chat completion request and receive synthetic response. Start 2 pods with `CLUSTER_PEERS` and verify cross-pod routing.

- [X] T008 [US1] Add inference-sim argument builder and conditional spawn in `apps/backend/src/services/model-manager.ts` `launchModel()`
  - Build separate argument array for inference-sim: `['--model', modelPath, '--port', String(port), '--served-model-name', effectiveModelName, '--max-model-len', String(maxTokens), '--startup-duration', config.simStartupDuration, '--time-to-first-token', '50ms', '--inter-token-latency', '15ms', '--mode', 'random']`
  - Add `--enable-sleep-mode` if `enableSleepMode` is true
  - Spawn: `spawn(isInferenceSimMode() ? config.inferenceSimBinary : 'vllm', args, ...)`
  - Environment for inference-sim: only `SARDEENZ_INSTANCE_ID` and optionally `VLLM_SERVER_DEV_MODE` (no CUDA, kvcached, or HF_TOKEN vars)
  - Set `instance.kvcachedEnabled = false` when inference-sim (FR-018)
  - Set `instance.ipcSegmentName = undefined` when inference-sim
  - Update `instance.launchCommand` to reflect inference-sim invocation
  - Update log messages: `'inference-sim stdout'` / `'inference-sim stderr'` instead of `'vLLM stdout'` / `'vLLM stderr'`
- [X] T009 [US1] Modify `apps/backend/src/services/model-manager.ts` `monitorModelStartup()` for inference-sim mode
  - After `waitForReady()` succeeds, if `isInferenceSimMode()`:
    - Skip `extractEngineCorePid()` — leave `instance.engineCorePid` as undefined (FR-016)
    - Skip NVML `getNvidiaSmiInfo()` memory queries and descendant PID scanning
    - Instead: estimate memory via `estimateModelMemory(modelPath, config.simModelMemoryGB)`, call `simGpuTracker.allocate(gpuIndex, instanceId, estimatedMemoryMB)` for each target GPU
    - Set `instance.gpuMemoryUtilization` from SimGpuTracker data
    - Set `instance.memoryBaselineByGpu` from allocation amounts
    - Skip `parseMemoryMetrics()` — set `instance.memoryMetrics` to simple estimated values or `undefined`
    - Set `instance.hasChatTemplate = true` and skip the test HTTP request (inference-sim always supports chat templates; see research.md §R8)
  - vLLM code path remains unchanged (all existing logic stays in an `else` block or behind `!isInferenceSimMode()` guard)
- [X] T010 [US1] Modify `apps/backend/src/services/model-manager.ts` `unloadModel()` for inference-sim mode
  - If `isInferenceSimMode()`: use `killProcessGracefully(proc)` (SIGTERM → SIGKILL fallback) instead of `killProcessImmediate(proc)` (FR-015)
  - Import `killProcessGracefully` from `../utils/process.js`
  - Skip `findProcessesByEnvMarker()` and `findVllmProcessesByPort()` cleanup — inference-sim is a single process, no EngineCore or worker children
  - Call `simGpuTracker.deallocate(instanceId)` to free simulated GPU memory
  - vLLM unload path (SIGKILL + process discovery) remains unchanged
- [X] T011 [US1] Modify `apps/backend/src/services/model-manager.ts` `handleProcessExit()` for inference-sim cleanup
  - When a model process exits unexpectedly in inference-sim mode: call `simGpuTracker.deallocate(instanceId)` to free simulated memory
  - Existing vLLM exit handling stays unchanged

**Checkpoint**: Models load via inference-sim, reach "running" status, serve synthetic responses, and unload cleanly. Multi-pod cluster routing works since cluster features are HTTP-level and unchanged.

---

## Phase 4: User Story 2 — Realistic GPU Memory Simulation (Priority: P1)

**Goal**: Simulated GPU memory is realistic enough for scheduler capacity checks. Dashboard GPU panels show correct utilization. Loading beyond capacity is rejected.

**Independent Test**: Start with `DEV_VIRTUAL_GPU_COUNT=2 SIM_GPU_MEMORY_GB=24`. Load two models of different sizes. Verify different memory per GPU in `/api/memory/usage/multi-gpu`. Load a third model exceeding capacity and verify rejection.

- [X] T012 [US2] Modify `apps/backend/src/services/memory-monitor.ts` to return simulated metrics in inference-sim mode
  - In the main memory-fetching method: if `isInferenceSimMode()`, skip `runKvcacheStats()` (Python script for /dev/shm IPC segments)
  - Skip NVML-based GPU memory queries — use `simGpuTracker.getNvidiaSmiInfo()` for GPU status data (already wired via gpu-info.ts T006)
  - Return `ResourceMetrics` / `MultiGpuMemoryUsageResponse` populated from SimGpuTracker data
  - Set kvcache-related fields to zero/empty (no kvcached in inference-sim mode)
  - vLLM memory monitoring path remains unchanged
- [X] T013 [US2] Ensure GPU selector capacity checks work with simulated data in `apps/backend/src/services/gpu-selector.ts`
  - The GPU selector uses `getNvidiaSmiInfo()` which already delegates to SimGpuTracker (T006)
  - Verify that `getAvailableGpus()` correctly filters out GPUs with insufficient memory
  - Adjust `SimGpuTracker.getNvidiaSmiInfo()` if the returned `GpuProcess[]` entries don't match the structure that gpu-selector's memory calculation expects (e.g., `usedGpuMemoryMiB` field format)
  - Acceptance: `availableMemory = totalMemory - usedByProcesses` rejects models that exceed remaining capacity on simulated GPUs

**Checkpoint**: Memory APIs return realistic simulated data. Scheduler rejects overloaded GPUs. Dashboard panels reflect correct utilization per simulated GPU.

---

## Phase 5: User Story 4 — Full Cluster Dashboard Testing (Priority: P2)

**Goal**: All dashboard features work correctly with simulated data across multiple pods.

**Independent Test**: Start 2 pods with `INFERENCE_BACKEND=inference-sim` and cluster peers. Open dashboard, verify cluster overview shows both pods. Load models, verify per-pod GPU panels, test model move between pods.

- [X] T014 [US4] Validate that no additional code changes are needed for dashboard testing
  - Verify `/api/gpu/info` returns simulated GPU data (from T006)
  - Verify `/api/memory/usage` and `/api/memory/usage/multi-gpu` return simulated memory (from T012)
  - Verify `/api/models` returns loaded models with correct memory fields (from T009)
  - Verify cluster endpoints (`/internal/cluster/*`) work identically (no changes needed — HTTP-level)
  - If any gaps found: create follow-up tasks. Otherwise, mark as validated.

**Checkpoint**: All 4 user stories functional. Full cluster workflow testable without GPUs.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, verification, cleanup

- [X] T015 [P] Update `apps/backend/.env.example` with new environment variables (`INFERENCE_BACKEND`, `SIM_GPU_MEMORY_GB`, `SIM_MODEL_MEMORY_GB`, `SIM_STARTUP_DURATION`, `INFERENCE_SIM_BINARY`)
- [X] T016 [P] Update `apps/backend/CLAUDE.md` environment variables table with new variables and descriptions
- [X] T017 Run TypeScript type-check (`npm run type-check -w apps/backend`) and ESLint (`npm run lint -w apps/backend`) and fix any errors
- [X] T018 Run existing unit tests (`npm run test -w apps/backend`) and verify no regressions
- [X] T019 Add integration test for inference-sim model lifecycle in `apps/backend/tests/integration/inference-sim-lifecycle.test.ts`
  - Test the full load → ready → unload cycle using the inference-sim binary (requires `llm-d-inference-sim` in PATH; skip with `describe.skipIf` if not available)
  - Spawn backend in inference-sim mode, POST `/api/models` to load a model, poll until status is "running", verify `/api/gpu/info` shows memory usage, DELETE the model, verify memory is freed
  - Validates FR-003, FR-006, FR-010, FR-015 end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies — start immediately
- **US3 (Phase 2)**: Depends on Phase 1 (needs config + SimGpuTracker + gpu-info changes)
- **US1 (Phase 3)**: Depends on Phase 2 (needs SimGpuTracker initialized and gpu-info wired)
- **US2 (Phase 4)**: Depends on Phase 3 (needs model loading to work for memory allocation)
- **US4 (Phase 5)**: Depends on Phases 3 + 4 (needs full pipeline working)
- **Polish (Phase 6)**: Depends on all previous phases

### User Story Dependencies

- **US3 (P1)**: Config + startup guards. No dependency on other stories. **Must complete first** because US1 and US2 need `isInferenceSimMode()` and SimGpuTracker initialization.
- **US1 (P1)**: Model spawning. Depends on US3 (needs config and simulated GPUs). Core MVP.
- **US2 (P1)**: Memory realism. Depends on US1 (needs models loading to validate memory tracking). Can be partially parallelized with US1 (T012 touches different file).
- **US4 (P2)**: Dashboard validation. Depends on US1 + US2. Likely zero code changes.

### Task-Level Dependencies

```
T001 ─────────────────────────────────────┐
T002 [P] ──── T004 [P] (test)            │
T003 [P] ──── T005 [P] (test)            │
                                          ▼
                                   T006, T007 (US3)
                                          │
                                          ▼
                              T008, T009, T010, T011 (US1)
                                          │
                                          ▼
                                   T012, T013 (US2)
                                          │
                                          ▼
                                     T014 (US4)
                                          │
                                          ▼
                       T015, T016, T017, T018, T019 (Polish)
```

### Parallel Opportunities

Within Phase 1:
- T002 and T003 can run in parallel (different files, only depend on T001)
- T004 depends on T002; T005 depends on T003 — but T004 and T005 can run in parallel with each other

Within Phase 2:
- T006 and T007 can run in parallel (different files: gpu-info.ts vs server.ts)

Within Phase 3:
- T008 and T009 are in the same file but different methods — execute sequentially
- T010 and T011 also in model-manager.ts — execute sequentially after T008/T009

Within Phase 6:
- T015 and T016 can run in parallel (different files)

---

## Parallel Example: Phase 1 (Foundational)

```
# After T001 (config) completes, launch all 4 tasks in parallel:
Task T002: "Create ModelMemoryEstimator in apps/backend/src/utils/model-memory-estimator.ts"
Task T003: "Create SimGpuTracker in apps/backend/src/utils/sim-gpu-tracker.ts"
Task T004: "Unit tests for ModelMemoryEstimator in apps/backend/tests/unit/model-memory-estimator.test.ts"
Task T005: "Unit tests for SimGpuTracker in apps/backend/tests/unit/sim-gpu-tracker.test.ts"
```

---

## Implementation Strategy

### MVP First (US3 + US1)

1. Complete Phase 1: Foundational (config + utilities)
2. Complete Phase 2: US3 (transparent switching — backend starts in inference-sim mode)
3. Complete Phase 3: US1 (model loading — full spawn/health/unload cycle works)
4. **STOP and VALIDATE**: Load a model via API, send inference request, unload model
5. This is a functional MVP — all core features work

### Incremental Delivery

1. Foundational → Config and utilities ready
2. Add US3 → Backend starts in both modes correctly
3. Add US1 → Models load and serve via inference-sim → **MVP ready**
4. Add US2 → Memory simulation is realistic → scheduler/capacity validated
5. Add US4 → Dashboard validated → **Feature complete**
6. Polish → Docs, lint, test pass

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US3 comes before US1 in implementation order despite both being P1, because US3 establishes the config/guard layer
- T014 (US4) is likely a validation-only task with zero code changes — the dashboard consumes APIs that are already wired
- All model-manager.ts tasks (T008-T011) modify the same file and must execute sequentially
- Existing test suite must remain green throughout — run T018 as a final verification
