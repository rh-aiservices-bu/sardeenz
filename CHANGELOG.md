# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Multi-GPU Support

- Added intelligent GPU selection and tensor parallel support
- GPU Selector service (`apps/backend/src/services/gpu-selector.ts`) auto-selects GPUs with most free memory
- `GET /api/gpu/available` - Returns GPUs with availability info and recommendation
- `GET /api/memory/usage/multi-gpu` - Per-GPU memory breakdown for multi-GPU systems
- Models can span multiple GPUs via `tensor_parallel_size` parameter (KVCached disabled for tensor parallel)
- New fields in `LoadModelRequest`: `gpu_ids`, `tensor_parallel_size`
- New fields in `ModelInstanceDTO`: `gpu_ids`, `tensor_parallel_size`, `kvcached_enabled`

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
