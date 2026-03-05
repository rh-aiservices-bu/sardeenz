# Changelog

All notable changes to this project will be documented in this file.

## [0.6.0] - 2026-03-05

### vLLM 0.14.1 Upgrade

- **vLLM upgraded to 0.14.1**: Updated base container image to `quay.io/vllm/vllm-cuda:0.14.1_rhai0`, bringing broader model support and improved inference performance
- **kvcached upgraded to 0.1.4**: Updated kvcached to match vLLM 0.14.1 compatibility

## [0.5.0] - 2026-01-20

### Blue-Green Model Migration

- **Model move between GPUs**: New blue-green deployment pattern for zero-downtime model migration
  - Load model on target GPU before unloading from source
  - Automatic traffic switchover via proxy router
  - Rollback capability if target load fails
  - New `POST /api/models/:instanceId/move` endpoint with target GPU selection
- **Move progress tracking**: Real-time SSE events for migration status
  - States: pending, loading-target, switching, unloading-source, completed, failed, rolled-back
  - Progress percentage and phase descriptions
- **Move history**: Persistent storage of migration operations with timestamps and outcomes
- **Frontend move dialog**: New `MoveModelDialog` component with GPU selection and progress visualization
- **Operations indicator**: Header component showing active operations across the platform

### NVML Library Integration

- **Direct NVML bindings**: Replaced nvidia-smi subprocess calls with Python NVML library
  - Faster GPU queries with lower overhead
  - More reliable process-to-GPU memory mapping
  - Better error handling for GPU unavailability
- **Enhanced GPU info service**: Refactored `gpu-info.ts` for NVML-based queries
- **Improved unit tests**: Expanded test coverage for GPU information utilities

### Documentation

- Updated RBAC roles documentation

## [0.4.0] - 2026-01-18

### Chatbot Playground

- **New Chatbot Playground page**: Full-featured inference testing UI replacing the old InferenceTests page
  - Workspace-based layout with resizable panes for multi-model comparison
  - Model sidebar with GPU-grouped organization and quick model selection
  - Session tabs for managing multiple chat sessions per model
  - Layout selector: single pane, side-by-side, or 2x2 grid layouts
  - Real-time streaming responses with token-by-token display

### Kubernetes RBAC Authorization

- **Kubernetes-native authorization**: New auth integration using Kubernetes SubjectAccessReview API
  - `K8S_API_URL` environment variable for Kubernetes API endpoint
  - Role determination via Kubernetes RBAC (sardeenz-admin, sardeenz-admin-readonly resources)
  - ServiceAccount-based authentication for pod deployments
  - New deployment manifests: `deployment/rbac.yaml`, `deployment/serviceaccount.yaml`

### Model Management UI Overhaul

- **Table-based model view**: New `ModelTable` component for compact model listing
  - Sortable columns: model name, status, GPU assignment, memory usage
  - Inline actions: view logs, sleep/wake, unload
  - GPU grouping with collapsible sections via `GpuGroupSection` component
- **View mode toggle**: Switch between card and table layouts via `ModelToolbar`
- **Compact model cards**: New `ModelCardCompact` component for denser layouts

### Sleep Mode Enhancements

- **Per-model benchmark parameters**: Each benchmark scenario now supports independent configuration
  - Configurable: `totalRequests`, `warmupRequests`, `concurrency`, `inputTokens`, `outputTokens`, `slaThresholdMs`
- **Token validation for benchmarks**: API validates that `inputTokens + outputTokens` does not exceed model's `max_tokens`

### Changed

- **KVCache calculation formula**: Now dynamically calculates `KVCache Total = GPU Free + Prealloc + Used` for accurate real-time metrics
- **Conditional KVCache display**: KVCache metrics hidden when no models loaded (fixes stale preallocation display)

### Fixed

- Memory overhead calculation now uses actual GPU memory from NVML
- KVCache metrics no longer show stale values when models are unloaded
- Pinned kvcached version at 0.1.3 for stability

## [0.3.0] - 2026-01-10

### Per-GPU KVCache Metrics

- **Per-GPU IPC segments**: Each GPU (or GPU-pair for tensor-parallel models) now gets its own IPC segment
  - Single GPU: `kvcached_vllm_GPU0`, `kvcached_vllm_GPU1`, etc.
  - Tensor-parallel: `kvcached_vllm_GPU0_GPU1` for models spanning multiple GPUs
  - Replaces the old global `kvcached_mem_info` segment
- **Memory baseline tracking**: Model memory footprint is now captured when loading completes (before any inference)
  - New `memoryBaselineByGpu: Record<number, number>` field on ModelInstance
  - Provides accurate idle memory measurement per GPU
- **Accurate KVCache total calculation**: KVCache Total is now calculated dynamically
  - Formula: `GPU Total - Model Baselines - Other Processes`
  - Fixes stale total_size from IPC segment that was set at initialization and never updated
- **Per-GPU KVCache metrics in API**: `/api/memory/usage/multi-gpu` now returns per-GPU `kvcache` metrics
  - Each GPU shows its own `total_gb`, `used_gb`, `prealloc_gb`, `free_gb`
  - Used/Prealloc values still read from IPC segments
  - For tensor-parallel models, usage is split evenly across participating GPUs
- **Automatic IPC naming**: `KVCACHED_IPC_NAME` environment variable is set automatically based on GPU assignment

### Bug Fixes

- **Benchmark SSE auth**: Fixed authentication for benchmark SSE events by passing token via query parameter

### Build Infrastructure

- **Makefile for container builds**: Added Makefile with `build` and `push` targets for podman/docker container operations
- **Containerfile rename**: Renamed `docker/Dockerfile.unified` to `docker/Containerfile` following OCI conventions
- **kvcached from source**: Container now builds kvcached from source for latest features

## [0.2.1] - 2026-01-08

### Robust Model Unload

- **Environment variable process tracking**: Added `SARDEENZ_INSTANCE_ID` env marker to vLLM processes for reliable cleanup even when child processes re-parent to init
- **Process discovery utilities**: New `findProcessesByEnvMarker()` finds processes by inherited environment variable via `/proc/<pid>/environ`
- **Fallback port-based discovery**: `findVllmProcessesByPort()` as fallback for older instances without env markers
- **Explicit EngineCore cleanup**: Kills EngineCore process and all marked descendants on unload, preventing orphaned tensor parallelism workers
- **ModelManager singleton pattern**: Route handlers now share the same process tracking state

### UI Enhancements

- **Unload All button**: New "Unload All" button with confirmation modal in Model Management page for batch model cleanup
- **Unload All SSE events**: Real-time progress events for bulk unload operations

### Auth Improvements

- **JWT query parameter fallback**: Auth plugin now accepts JWT token via query param for SSE clients that cannot set headers

## [0.2.0] - 2026-01-08

### ✨ Authentication System

- **Dual-auth model** separating admin dashboard from inference API authentication
- **Admin auth modes**: Three modes via `AUTH_MODE` environment variable:
  - `none`: No authentication (development/trusted environments)
  - `simple`: Username/password with JWT tokens
  - `oauth`: OAuth 2.0 / OpenID Connect (production-ready)
- **Inference auth**: Optional `INFERENCE_API_KEY` for OpenAI-compatible endpoints (`/v1/*`)
- **OAuth 2.0 support**: Full OpenID Connect flow with automatic token refresh
- **Login page**: Clean PatternFly-based login UI with OAuth provider buttons
- **Protected routes**: `ProtectedRoute` component for frontend route guards
- **AuthContext**: React context with `isAuthenticated`, `user`, `canWrite` helpers
- **JWT handling**: Secure token storage, automatic refresh, logout functionality

### 🔒 Security Hardening

- **Role-Based Access Control (RBAC)**: Two roles `admin` (full access) and `admin-readonly` (read-only)
- **Backend authorization**: `fastify.requireRole()` hooks on all API routes
- **OAuth group mapping**: `sardeenz-admins` → `admin`, `sardeenz-admins-readonly` → `admin-readonly`
- **Access denied page**: Clear messaging for users without required permissions
- **HuggingFace token masking**: Read-only users see masked placeholder instead of real token
- **Write action guards**: Buttons disabled with tooltips for read-only users across all components

### 📝 Deployment & Documentation

- **Reorganized Kubernetes manifests**: Renamed `k8s/` → `deployment/` for clarity
- **Enhanced configmap.yaml**: Auth environment variables with detailed comments
- **New secret.yaml**: Template for sensitive auth configuration (JWT secrets, OAuth credentials)
- **Updated deployment docs**: Comprehensive auth configuration guide
- **API guide updates**: Authentication examples for all endpoints

### 🎨 UI Enhancements

- **GitHub project branding**: Star and fork icons with links to repository
- **User dropdown**: Displays current username and role label
- **Theme-aware icons**: SVG icons with light/dark mode variants

### Model Configuration Management

- Added persistent model configuration storage with SQLite
- CRUD API endpoints: `/api/configurations/*` for saving, loading, listing, and deleting presets
- Save/Load configuration dialogs in frontend (`SaveConfigurationDialog`, `LoadConfigurationDialog`)
- Captures model path, served model name, GPU assignment, tensor parallel size, max tokens, and extra args
- Load order preserved for sequential restoration

### Sequential Model Loading

- Added `launchModelAndWait()` method for synchronous model loading during configuration restore
- Union-Find conflict detection groups models sharing ANY GPU (tensor parallelism support)
- Models in the same conflict group load sequentially to prevent vLLM memory calculation conflicts
- Models on disjoint GPUs load in parallel for faster configuration restoration

### SSE Streaming Fixes

- Added anti-buffering headers for OpenShift Routes (`X-Accel-Buffering: no`)
- Fixed SSE streaming behind reverse proxies that buffer responses
- Improved benchmark progress feedback with better event structure

### UI Improvements

- Added sardine favicon using bot-avatar design
- Refreshed project logo assets (SVG, PNG)

### Multi-GPU Support

- Added intelligent GPU selection and tensor parallel support
- GPU Selector service (`apps/backend/src/services/gpu-selector.ts`) auto-selects GPUs with most free memory
- `GET /api/gpu/available` - Returns GPUs with availability info and recommendation
- `GET /api/memory/usage/multi-gpu` - Per-GPU memory breakdown for multi-GPU systems
- Models can span multiple GPUs via `tensor_parallel_size` parameter (kvcached disabled for tensor parallel)
- New fields in `LoadModelRequest`: `gpu_ids`, `tensor_parallel_size`
- New fields in `ModelInstanceDTO`: `gpu_ids`, `tensor_parallel_size`, `kvcached_enabled`
- Model Cards now display which GPU(s) each model is loaded on
- Shows "GPU 0" for single-GPU or "GPU 0, GPU 1 (tensor parallel)" for multi-GPU

### Simplified Container Architecture

- Removed NGINX, unified single-process container
- Fastify now serves frontend static files directly (no NGINX proxy)
- Single port (3000) for Controller API, Inference Proxy, and Frontend
- Simplified `docker/entrypoint.sh` - just starts Node.js
- Deleted `docker/nginx.conf`

### Direct Proxy

- Added port-based proxy for testing (`/api/direct/:port/*`)
- Bypasses model routing layer, forwards directly to vLLM instance port
- Useful for debugging and performance testing

### Benchmarking System (spec: 002-benchmarking)

- Added LLM benchmarking system with performance metrics
- Benchmark API: `/api/benchmarks/*` for creating/running benchmarks, viewing results
- Metrics: TTFT (time to first token), TPS (tokens/second), E2E latency with percentiles (p50/p90/p95/p99)
- Two execution modes: `isolated` (sequential) and `contention` (parallel stress testing)
- Real-time progress via SSE events during benchmark execution
- SQLite persistence for benchmark history and results

### Memory Profiling (spec: 002-benchmarking)

- Added memory profiling for capacity planning
- Memory Profile API: `/api/memory/profiles/*` for storing/retrieving model memory footprints
- Pre-load memory check: `/api/memory/profiles/check` to predict if model will fit
- Captures weights, CUDA graphs, overhead, and KV cache metrics per model/GPU configuration

### Database Layer (spec: 002-benchmarking)

- Added SQLite database layer with migrations
- `apps/backend/src/db/` - Connection handling, migration runner
- Automatic migration on startup
- Stores: `benchmark-store.ts`, `memory-profile-store.ts`

### GPU Memory Visualization (spec: 001-multi-model-platform)

- Fixed GPU memory visualization for duplicate model instances
- Added `instance_id` field to `/api/memory/usage` response for unique identification
- Display names now include suffix for duplicates: "SmolLM2-135M", "SmolLM2-135M (2)", etc.
- Colors are now derived from instance ID (not model path) for distinct per-instance colors
- Fixed chart animation/flickering caused by key collisions when same model loaded multiple times

### GPU Memory Tracking (spec: 001-multi-model-platform)

- Fixed GPU memory tracking by extracting vLLM EngineCore PID from logs
- vLLM spawns API Server (no GPU) and EngineCore (allocates VRAM) as separate processes
- New `engineCorePid` field in `ModelInstance` stores the GPU-using process PID
- Memory monitor now uses EngineCore PID for accurate per-model GPU breakdown

### Memory Chart Panel (spec: 001-multi-model-platform)

- Added GPU/KVCache memory visualization panel on Model Management page using Nivo charts
- Two stacked horizontal bars: KVCache (shared pool) and GPU (per-model breakdown)
- Configurable refresh interval (None, 5s, 15s, 30s, 1m)
- Color-coded per-model memory segments with tooltips

### Memory Metrics (spec: 001-multi-model-platform)

- Enhanced `/api/memory/usage` endpoint with KVCache metrics and per-model GPU breakdown
- Added memory metrics parsing from vLLM logs (weights, CUDA graphs, KV cache) with frontend modal display

### Async Model Loading (spec: 001-multi-model-platform)

- Implemented async model loading with SSE event streaming
- Process log buffer for capturing vLLM output
- Intelligent error parsing from vLLM logs

### Initial Setup (spec: 001-multi-model-platform)

- TypeScript 5.7+ (strict mode) with Node.js 22.x (backend), ES2022 target
- In-memory storage for PoC phase (Map data structures)
