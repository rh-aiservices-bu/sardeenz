# Implementation Plan: Inference Simulator Backend

**Branch**: `006-inference-sim-backend` | **Date**: 2026-05-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-inference-sim-backend/spec.md`

## Summary

Integrate `llm-d-inference-sim` (a Go binary) as an alternative inference backend to vLLM, enabling GPU-free multi-pod cluster testing. The implementation adds a backend abstraction layer toggled by `INFERENCE_BACKEND=inference-sim` that replaces vLLM subprocess spawning, NVML GPU queries, and kvcached memory monitoring with simulated equivalents — all while keeping the existing API surface, cluster features, and dashboard untouched.

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict mode), Node.js 22.x, ES2022 target  
**Primary Dependencies**: Fastify 5.1+, `@rh-ai-bu/ts-nvml` (GPU bindings), `better-sqlite3`  
**Storage**: SQLite for persistence, in-memory Maps for runtime state  
**Testing**: Vitest (unit + integration), 14 existing test files  
**Target Platform**: Linux server (also macOS for GPU-free dev)  
**Project Type**: npm workspace monorepo (`apps/backend`, `apps/frontend`, `packages/*`)  
**Performance Goals**: No performance regression on the vLLM code path; inference-sim mode has no latency targets  
**Constraints**: Zero changes to existing vLLM behavior when `INFERENCE_BACKEND` is unset; no frontend changes needed  
**Scale/Scope**: ~8 files modified, ~2 new files, ~500 lines added

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type Safety & Monorepo | PASS | All changes in `apps/backend` (TypeScript strict). No new packages needed — the abstraction fits within the existing backend. |
| II. Performance-First | PASS | The inference-sim code path is entirely separate from the vLLM hot path. No changes to proxy routing or request handling. When `INFERENCE_BACKEND=vllm` (default), no new code executes. |
| III. API-First Design | PASS | No API surface changes. The backend returns identical response shapes regardless of backend. inference-sim implements the same OpenAI-compatible API. |
| IV. Security by Design | PASS | No auth changes. inference-sim mode is dev-only. Inference auth (`INFERENCE_API_KEY`) works identically since it's enforced at the proxy level, not the backend level. |
| V. Container-Native | PASS | Environment-based configuration (`INFERENCE_BACKEND` env var). No container changes in this scope. |
| VI. Observability | PASS | Existing structured logging covers all code paths. GPU info logging will include "(simulated)" markers. |
| VII. Simplicity & Pragmatism | PASS | Direct conditional logic in existing files, not a plugin/strategy framework. Model memory estimation is a simple lookup table, not a machine learning model. |

**Gate result: PASS — no violations.**

## Project Structure

### Documentation (this feature)

```text
specs/006-inference-sim-backend/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
apps/backend/src/
├── config.ts                          # MODIFY: Add INFERENCE_BACKEND, SIM_* env vars
├── server.ts                          # MODIFY: Guard NVML init/shutdown with backend check
├── services/
│   ├── model-manager.ts               # MODIFY: Conditional spawn (vllm vs inference-sim),
│   │                                  #   skip EngineCore PID extraction, skip NVML memory
│   │                                  #   queries, use SIGTERM for inference-sim
│   ├── memory-monitor.ts              # MODIFY: Skip kvcached/NVML in inference-sim mode
│   └── gpu-selector.ts                # MODIFY: Use simulated GPU memory for capacity checks
├── utils/
│   ├── gpu-info.ts                    # MODIFY: Add simulated GPU detection and real-time status
│   └── sim-gpu-tracker.ts             # NEW: Simulated GPU memory tracker (per-GPU bookkeeping)
└── utils/
    └── model-memory-estimator.ts      # NEW: Estimate model VRAM from name/path

apps/backend/tests/
├── unit/
│   └── sim-gpu-tracker.test.ts        # NEW: Unit tests for GPU memory tracker
│   └── model-memory-estimator.test.ts # NEW: Unit tests for memory estimator
```

**Structure Decision**: All changes within `apps/backend`. No new packages or workspaces. Two new utility files for simulated GPU tracking and model memory estimation — these are small, focused modules that don't warrant their own package.

## API Contracts

No new API endpoints or schema changes. The feature is transparent to API consumers — all existing endpoints (`/api/models`, `/api/gpu/*`, `/api/memory/*`, `/v1/*`) return identical response shapes regardless of the inference backend. The inference-sim binary implements the same OpenAI-compatible API contract that vLLM does.

## Post-Design Constitution Re-Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type Safety & Monorepo | PASS | `SimGpuTracker` and `ModelMemoryEstimator` are fully typed. `Config.inferenceBackend` uses a union type `'vllm' \| 'inference-sim'`. No `any` types. |
| II. Performance-First | PASS | Design adds zero overhead to the vLLM path — all guards are simple `if (isInferenceSimMode())` checks that short-circuit immediately. SimGpuTracker uses in-memory Maps (O(1) lookups). |
| III. API-First Design | PASS | No API changes confirmed. All data flows through existing typed interfaces (`GpuInfo`, `GpuStatus`, `NvidiaSmiInfo`). |
| IV. Security by Design | PASS | No security surface changes. |
| V. Container-Native | PASS | 12-factor env var configuration. |
| VI. Observability | PASS | All simulated operations log with structured fields. GPU names include "(Simulated)" marker for easy identification. |
| VII. Simplicity & Pragmatism | PASS | Two small new files (~100 lines each). No abstractions, patterns, or frameworks. Direct conditionals in existing code. Memory estimation is a simple formula, not a complex algorithm. |

**Post-design gate result: PASS — no violations. No complexity tracking needed.**
