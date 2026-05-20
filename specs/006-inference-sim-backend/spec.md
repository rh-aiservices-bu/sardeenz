# Feature Specification: Inference Simulator Backend

**Feature Branch**: `006-inference-sim-backend`
**Created**: 2026-05-15
**Status**: Draft
**Input**: User description: "Integrate llm-d-inference-sim as an alternative inference backend for sardeenz, replacing vLLM subprocess management during local development and testing. Add a new INFERENCE_BACKEND config flag. When set to inference-sim, the backend spawns the llm-d-inference-sim Go binary instead of vllm, skips NVML/kvcached GPU interactions, and uses simulated GPU metrics. This enables testing the full multi-pod cluster orchestration on machines without GPUs or with a single GPU."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - GPU-Free Multi-Pod Development (Priority: P1)

As a developer with no GPU (or a single GPU), I want to test the full multi-pod cluster orchestration locally by running multiple Sardeenz pods that use a lightweight inference simulator instead of real vLLM. I set a single environment variable (`INFERENCE_BACKEND=inference-sim`), and the system spawns the simulator binary instead of vLLM, simulates GPU metrics, and lets me exercise the entire cluster workflow: leader election, peer discovery, model loading, cross-pod routing, and dashboard visualization.

**Why this priority**: This is the core value proposition. Without this, multi-pod cluster development requires multiple physical GPUs, which most developers don't have locally. It unblocks the entire 004-school-orchestration feature for local testing and CI.

**Independent Test**: Start 2 Sardeenz pods with `INFERENCE_BACKEND=inference-sim` and `CLUSTER_PEERS` on different ports. Load a model on Pod A from the dashboard. Send an inference request to Pod B. Verify the request is routed to Pod A and returns a response.

**Acceptance Scenarios**:

1. **Given** a developer machine with no GPU, **When** the backend starts with `INFERENCE_BACKEND=inference-sim`, **Then** the backend starts successfully without NVML errors and reports simulated GPU information.
2. **Given** the backend is running in inference-sim mode, **When** a user loads a model via the API or dashboard, **Then** the system spawns the inference-sim binary, waits for its health endpoint, and reports the model as "running" with simulated GPU memory usage.
3. **Given** a model is loaded in inference-sim mode, **When** the user sends a chat completion request, **Then** the system returns a synthetic response with realistic latency.
4. **Given** 2 pods running in inference-sim mode with cluster peers configured, **When** a model is loaded on Pod A and a request is sent to Pod B, **Then** Pod B routes the request to Pod A and returns the response.

---

### User Story 2 - Realistic GPU Memory Simulation (Priority: P1)

As a developer testing model scheduling and placement, I need the simulated GPU metrics to be realistic enough that the scheduler, dashboard GPU panels, and capacity checks work correctly. Each simulated GPU should report configurable total memory, and each loaded model should consume a realistic estimated amount of that memory based on model size.

**Why this priority**: Equal to P1 because memory-based scheduling is the core logic being tested. If simulated GPUs all report unlimited or identical memory, the scheduler cannot be meaningfully validated.

**Independent Test**: Start a pod in inference-sim mode with `DEV_VIRTUAL_GPU_COUNT=2` and `SIM_GPU_MEMORY_GB=24`. Load two models of different sizes. Verify the dashboard shows different memory utilization per GPU, and that loading a third model that exceeds remaining capacity is rejected by the scheduler.

**Acceptance Scenarios**:

1. **Given** a pod running in inference-sim mode with 2 virtual GPUs of 24 GB each, **When** a model with "7B" in its name is loaded, **Then** the system estimates approximately 4-5 GB of memory usage and the dashboard shows the corresponding utilization on the assigned GPU.
2. **Given** a pod with simulated GPUs nearly full, **When** a model load is requested that would exceed remaining capacity, **Then** the system reports insufficient GPU memory, just as it would with real hardware.
3. **Given** a model is unloaded in inference-sim mode, **When** the dashboard is refreshed, **Then** the freed simulated memory is reflected in the GPU panel.

---

### User Story 3 - Transparent Backend Switching (Priority: P1)

As a developer, I want to switch between real vLLM and the inference simulator using only an environment variable, with no code changes or configuration file edits. The default behavior must remain real vLLM so that production deployments are unaffected.

**Why this priority**: P1 because a complicated mode-switching mechanism would defeat the purpose. The value comes from being a single-variable toggle.

**Independent Test**: Start the backend without `INFERENCE_BACKEND` set and verify it uses real vLLM (default). Set `INFERENCE_BACKEND=inference-sim` and verify it uses the simulator. Confirm no other configuration changes are needed.

**Acceptance Scenarios**:

1. **Given** no `INFERENCE_BACKEND` variable is set, **When** the backend starts, **Then** it behaves identically to today: spawns vLLM, uses NVML, reads kvcached segments.
2. **Given** `INFERENCE_BACKEND=inference-sim` is set, **When** the backend starts, **Then** it skips NVML initialization, uses simulated GPU info, and spawns inference-sim binaries for model loads.
3. **Given** `INFERENCE_BACKEND=inference-sim` is set but the `llm-d-inference-sim` binary is not in PATH, **When** the backend starts, **Then** it logs a clear error message explaining how to install the binary and fails gracefully.

---

### User Story 4 - Full Cluster Dashboard Testing (Priority: P2)

As a developer testing the cluster dashboard, I want the GPU memory panels, pod overview, and model management UI to all work correctly with simulated data, so I can develop and test frontend features without real GPUs.

**Why this priority**: P2 because the dashboard UI already works with data from backend APIs. As long as the APIs return realistic data (which is covered by US1 and US2), the dashboard works. However, specific edge cases around memory visualization and per-pod panels need validation.

**Independent Test**: Start 2 pods in inference-sim mode. Open the cluster dashboard. Load models on both pods. Verify that each pod shows its own GPU memory panel with correct utilization, the cluster overview shows all pods, and model operations (load/unload/move) work through the UI.

**Acceptance Scenarios**:

1. **Given** 2 pods running in inference-sim mode, **When** the dashboard is opened, **Then** the cluster overview shows both pods with simulated GPU information.
2. **Given** models are loaded on different pods, **When** a model is moved from Pod A to Pod B via the dashboard, **Then** the move completes and the dashboard reflects the updated placement.

---

### Edge Cases

- What happens if `INFERENCE_BACKEND` is set to an invalid value? The system should fail at startup with a clear error listing valid options (`vllm`, `inference-sim`).
- What happens if inference-sim mode is used with `ENABLE_KVCACHED=true`? kvcached features should be disabled with a single INFO-level log at startup (e.g., "kvcached disabled: not supported in inference-sim mode") since there are no real GPU memory segments to share.
- What happens if `DEV_VIRTUAL_GPU_COUNT=0` in inference-sim mode? The system should create 1 simulated GPU by default (since there are no real GPUs to detect).
- What happens if the inference-sim process crashes? The existing process exit handling should work identically — the model status changes to "failed" and the process is cleaned up.
- What happens if a model name doesn't contain a recognizable size indicator (e.g., "my-custom-model")? The system should use a configurable default memory estimate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a configurable inference backend via `INFERENCE_BACKEND` environment variable with two valid values: `vllm` (default) and `inference-sim`.
- **FR-002**: When `INFERENCE_BACKEND=vllm` (or unset), the system MUST behave identically to the current implementation with no code path changes.
- **FR-003**: When `INFERENCE_BACKEND=inference-sim`, the system MUST spawn the `llm-d-inference-sim` binary instead of `vllm` when loading a model, mapping model parameters to the simulator's equivalent flags.
- **FR-004**: The system MUST validate that the inference-sim binary is available in PATH at startup when `INFERENCE_BACKEND=inference-sim` is set, and fail with a clear error message including installation instructions if not found.
- **FR-005**: When in inference-sim mode, the system MUST skip NVML initialization and all GPU hardware interactions (NVML queries, kvcached IPC segment reads).
- **FR-006**: When in inference-sim mode, the system MUST provide simulated GPU information that is structurally identical to real NVML output, including GPU name, memory total, memory used, and process list.
- **FR-007**: The simulated GPU memory total MUST be configurable via `SIM_GPU_MEMORY_GB` environment variable (default: 24 GB).
- **FR-008**: The system MUST estimate model memory consumption based on model name/path when in inference-sim mode, using size indicators in the model name (e.g., "7B", "13B", "70B") to calculate approximate VRAM usage.
- **FR-009**: A default model memory estimate MUST be configurable via `SIM_MODEL_MEMORY_GB` environment variable for models without recognizable size indicators.
- **FR-010**: When in inference-sim mode, simulated GPU memory usage MUST be tracked per GPU and updated when models are loaded or unloaded, so that scheduler capacity checks and dashboard GPU panels reflect accurate simulated state.
- **FR-011**: When in inference-sim mode and `DEV_VIRTUAL_GPU_COUNT` is set, the system MUST create the specified number of simulated GPUs, each with independent memory tracking.
- **FR-012**: When in inference-sim mode and `DEV_VIRTUAL_GPU_COUNT` is not set (or set to 0), the system MUST create 1 simulated GPU by default.
- **FR-013**: All cluster features (peer discovery, heartbeat, leader election, cross-pod routing, proxy) MUST work identically regardless of the inference backend, since they operate at the HTTP level.
- **FR-014**: The model health check (polling `/health` endpoint) MUST work without changes, since inference-sim implements the same health endpoint as vLLM.
- **FR-015**: When in inference-sim mode, model unload MUST use SIGTERM (graceful shutdown) instead of SIGKILL, since inference-sim is a Go binary that handles signals cleanly.
- **FR-016**: When in inference-sim mode, the system MUST skip EngineCore PID extraction, NVML GPU memory queries, and kvcached memory metrics parsing during the post-ready model monitoring phase.
- **FR-017**: When in inference-sim mode, the startup duration of the inference-sim process MUST be configurable via `SIM_STARTUP_DURATION` environment variable (default: `3s`) to simulate model loading time. The value is passed through to the inference-sim binary and must use Go duration format (e.g., `3s`, `500ms`, `1m`).
- **FR-018**: When in inference-sim mode, `kvcachedEnabled` MUST be set to `false` on all model instances, regardless of the `ENABLE_KVCACHED` config value.
- **FR-019**: The inference-sim binary path MUST be configurable via `INFERENCE_SIM_BINARY` environment variable (default: `llm-d-inference-sim`) to support custom installation locations.

### Key Entities

- **Inference Backend**: The engine used to serve model inference requests. Either real vLLM (GPU-based) or llm-d-inference-sim (CPU-based simulator).
- **Simulated GPU**: A virtual GPU entity with configurable total memory that tracks memory usage from loaded models. Has no physical hardware counterpart.
- **Model Memory Estimate**: An approximate VRAM footprint derived from the model name/path, used to simulate realistic memory consumption in inference-sim mode.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can start a fully functional multi-pod cluster on a machine with no GPU using only `INFERENCE_BACKEND=inference-sim` and standard cluster environment variables.
- **SC-002**: Models can be loaded, queried, moved, and unloaded through the dashboard and API in inference-sim mode with the same user experience as real vLLM (except response content is synthetic).
- **SC-003**: The GPU memory panels in the dashboard show realistic simulated utilization that changes as models are loaded and unloaded.
- **SC-004**: The scheduler correctly rejects model loads that would exceed simulated GPU capacity, validating placement logic without real hardware.
- **SC-005**: Switching between vLLM and inference-sim requires changing only the `INFERENCE_BACKEND` environment variable — no other configuration or code changes.
- **SC-006**: Starting the backend with default settings (no `INFERENCE_BACKEND` set) results in identical behavior to the current implementation.

## Assumptions

- The `llm-d-inference-sim` binary is pre-installed in PATH by the developer. The system does not manage binary installation or updates.
- The inference-sim binary is compatible with the OpenAI-compatible API contract that sardeenz expects (specifically: `/health`, `/v1/models`, `/v1/chat/completions`, `/v1/completions`).
- Model memory estimation from model names is approximate and acceptable for testing. Production memory profiling remains the accurate mechanism.
- The inference-sim binary is a single-file executable with no additional dependencies (it's a statically-linked Go binary).
- Developers using inference-sim mode understand that responses are synthetic and do not reflect real model behavior.

## Scope Boundaries

### In Scope
- Backend config and model manager changes to support inference-sim as a subprocess
- Simulated GPU info and memory tracking (replacing NVML)
- Simulated memory monitor metrics (replacing kvcached segment reads)
- NVML initialization guards
- Documentation and quickstart updates

### Out of Scope
- **Frontend changes**: The dashboard consumes backend APIs; no frontend code changes are needed since the APIs return the same data structure.
- **Production deployment with inference-sim**: This is a development/testing tool only. Production always uses real vLLM.
- **Automatic binary installation**: The binary must be pre-installed. No download scripts or package manager integration.
- **Real tokenization or inference quality**: The simulator returns synthetic responses. Testing actual model behavior requires real vLLM.
- **Container image with inference-sim bundled**: A future enhancement may add the binary to the dev container image, but is not part of this spec.
- **CI integration**: Adding inference-sim to CI pipelines is a natural follow-up but not in scope here.
