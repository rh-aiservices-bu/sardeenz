# Research: Inference Simulator Backend

**Date**: 2026-05-16  
**Feature**: [spec.md](spec.md)

## R1: llm-d-inference-sim CLI Interface & Compatibility

**Decision**: The inference-sim binary is fully compatible with sardeenz's requirements. It implements all required endpoints and accepts equivalent CLI flags to vLLM.

**Key findings**:

- **Binary**: `llm-d-inference-sim` (statically-linked Go binary, latest release v0.8.2)
- **Required flags for sardeenz**:
  - `--model <model-path>` — model name (required)
  - `--port <N>` — HTTP port (default 8000)
  - `--served-model-name <name>` — model name exposed by API
  - `--max-model-len <N>` — context window size
  - `--startup-duration <duration>` — simulates loading time (e.g., `3s`)
  - `--mode random` — synthetic response generation
  - `--enable-sleep-mode` / `--no-enable-sleep-mode` — vLLM sleep mode compat
  - `--time-to-first-token <duration>` — latency simulation
  - `--inter-token-latency <duration>` — per-token delay
- **Endpoints implemented**: `/health`, `/health/ready`, `/v1/models`, `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/metrics`
- **Health check**: `/health` always returns 200; `/health/ready` returns 503 during `startup-duration`, then 200
- **Streaming**: Full SSE streaming support with `"stream": true`
- **Sleep mode**: Supports `/sleep`, `/wake_up`, `/is_sleeping` when `--enable-sleep-mode` + `VLLM_SERVER_DEV_MODE=1`
- **No `serve` subcommand**: Unlike vLLM (`vllm serve <model>`), inference-sim uses direct flags (`llm-d-inference-sim --model <model>`)
- **Ignored vLLM flags**: `--no-enable-prefix-caching`, `--enforce-eager`, `--enable-prefix-caching` are accepted but ignored
- **Environment variables**: `SIM_MODEL` (model name fallback), `VLLM_SERVER_DEV_MODE` (sleep mode)

**Rationale**: Direct compatibility means no adapter/wrapper layer is needed. The spawn call just needs different binary name and argument format.

**Alternatives considered**: 
- Writing a custom mock HTTP server in Node.js — rejected because inference-sim already handles streaming, latency simulation, health checks, and sleep mode correctly.

## R2: Argument Mapping (vLLM → inference-sim)

**Decision**: Map vLLM spawn arguments to inference-sim equivalents at launch time.

| vLLM argument | inference-sim equivalent | Notes |
|---------------|--------------------------|-------|
| `serve <model>` | `--model <model>` | No subcommand in inference-sim |
| `--port=N` | `--port N` | Same semantics |
| `--served-model-name=X` | `--served-model-name X` | Same semantics |
| `--max-model-len=N` | `--max-model-len N` | Same semantics |
| `--tensor-parallel-size=N` | (not applicable) | inference-sim ignores this |
| `--no-enable-prefix-caching` | (omit) | inference-sim ignores kvcached flags |
| `--enable-sleep-mode` | `--enable-sleep-mode` | Same flag name |
| `--disable-log-stats` | (omit) | Not needed |
| (none) | `--startup-duration 3s` | New: simulates loading time |
| (none) | `--time-to-first-token 50ms` | New: realistic latency |
| (none) | `--inter-token-latency 15ms` | New: per-token streaming delay |

**Rationale**: The mapping is simple enough to be a direct conditional in `launchModel()`. No argument translation framework needed.

## R3: Process Signal Handling

**Decision**: Use SIGTERM for inference-sim (graceful Go shutdown) instead of SIGKILL.

**Key findings**:
- vLLM uses SIGKILL because Python signal handlers delete shared kvcached IPC segments (`kvcached_mem_info`), which breaks other models sharing the same segment.
- inference-sim is a Go binary with no shared IPC segments. It handles SIGTERM cleanly (Go runtime catches it, runs deferred functions, exits).
- The existing `killProcessGracefully()` in `process.ts` (SIGTERM → SIGKILL fallback) is suitable for inference-sim.
- The `killProcessImmediate()` (SIGKILL only) should continue to be used for vLLM.

**Rationale**: Using SIGTERM is safer for the Go binary (clean shutdown, port release) and avoids potential issues with SIGKILL on Go processes.

## R4: Simulated GPU Memory Tracking Architecture

**Decision**: Create a lightweight in-memory GPU memory tracker (`SimGpuTracker`) that maintains per-GPU memory state.

**Key findings**:
- The existing `gpu-info.ts` provides GPU info at two levels:
  1. **Cached startup info** (`detectGpuInfo()` → `GpuInfo[]`): GPU count, names, total memory. Called once at startup.
  2. **Real-time status** (`getNvidiaSmiInfo()` → `NvidiaSmiInfo`): Current memory usage, process list, utilization. Called on every dashboard refresh and memory API call.
- In inference-sim mode, both levels need simulated data:
  1. Startup: Create N simulated GPUs with configurable memory (e.g., 24 GB each)
  2. Real-time: Track memory allocation/deallocation as models are loaded/unloaded
- The `GpuSelector` in `gpu-selector.ts` uses `getNvidiaSmiInfo()` to determine GPU availability — simulated memory must flow through the same interface.
- The `memory-monitor.ts` uses `getNvidiaSmiInfo()` for the memory usage API — same interface.

**Architecture**:
```
SimGpuTracker (singleton, in-memory)
├── gpus: Map<number, { totalMB, usedMB, models: Map<instanceId, memoryMB> }>
├── allocate(gpuId, instanceId, memoryMB) → void
├── deallocate(instanceId) → void
├── getGpuStatus() → GpuStatus[]     (feeds into getNvidiaSmiInfo)
├── getProcesses() → GpuProcess[]    (feeds into getNvidiaSmiInfo)
└── getGpuInfo() → GpuInfo[]         (feeds into detectGpuInfo)
```

**Rationale**: A separate tracker module keeps the simulated state management isolated from the NVML code. The existing interfaces (`GpuInfo`, `GpuStatus`, `GpuProcess`, `NvidiaSmiInfo`) are reused exactly, so downstream code (GpuSelector, memory-monitor, GPU routes) works without changes.

**Alternatives considered**:
- Modifying `getNvidiaSmiInfo()` to return hardcoded values — rejected because memory must change dynamically as models load/unload.
- Creating a Strategy/Provider pattern — rejected per constitution VII (YAGNI). Direct conditional in `gpu-info.ts` is simpler.

## R5: Model Memory Estimation

**Decision**: Estimate model VRAM from size indicators in the model name/path using a simple lookup table.

**Estimation formula**: `memory_gb = params_billions * 2` (assumes fp16/bf16, which is 2 bytes per parameter)

| Size indicator | Estimated params (B) | Estimated memory (GB) |
|---------------|----------------------|----------------------|
| `1B` | 1 | 2 |
| `3B` | 3 | 6 |
| `7B` / `8B` | 7 / 8 | 14 / 16 |
| `13B` / `14B` | 13 / 14 | 26 / 28 |
| `32B` / `34B` | 32 / 34 | ~17 (quantized assumed) |
| `70B` / `72B` | 70 / 72 | ~37 (quantized assumed) |
| No indicator | — | `SIM_MODEL_MEMORY_GB` (default: 4 GB) |

**Regex pattern**: `/(\d+(?:\.\d+)?)\s*[bB]\b/` — matches "7B", "7b", "1.5B", etc. in model names like `meta-llama/Llama-3.2-7B-Instruct`.

**Refinements**:
- For models >30B, assume quantization (4-bit) since they wouldn't fit on a 24 GB simulated GPU at fp16: `memory_gb = params * 0.5 + 2` (4-bit + overhead)
- The `+2` accounts for KV cache and activation overhead
- Models 30B and under use fp16 estimate: `memory_gb = params * 2`

**Rationale**: The formula is deliberately simple. Production memory profiling handles accuracy; this just needs to be realistic enough that the scheduler makes reasonable placement decisions during testing.

## R6: Integration Points (File-by-File)

### `config.ts` — New environment variables

Add to `Config` interface and `config` object:
- `inferenceBackend: 'vllm' | 'inference-sim'` — from `INFERENCE_BACKEND` (default: `'vllm'`)
- `simGpuMemoryGB: number` — from `SIM_GPU_MEMORY_GB` (default: 24)
- `simModelMemoryGB: number` — from `SIM_MODEL_MEMORY_GB` (default: 4)
- `simStartupDuration: string` — from `SIM_STARTUP_DURATION` (default: `'3s'`)
- `inferenceSimBinary: string` — from `INFERENCE_SIM_BINARY` (default: `'llm-d-inference-sim'`)

Add validation: if `inferenceBackend` is not `'vllm'` or `'inference-sim'`, throw at startup.

Add helper: `isInferenceSimMode()` — returns `config.inferenceBackend === 'inference-sim'`.

### `server.ts` — NVML initialization guard

- Wrap `initializeNvml()` and `shutdownNvml()` in `if (!isInferenceSimMode())` guards
- When in inference-sim mode, initialize `SimGpuTracker` instead
- `detectGpuInfo()` already handles the virtual GPU path; extend it for inference-sim mode
- Add startup validation: check binary exists in PATH via `which` command

### `gpu-info.ts` — Simulated GPU info

- In `doDetectGpuInfo()`: if inference-sim mode, return `simGpuTracker.getGpuInfo()` instead of NVML
- In `getNvidiaSmiInfo()`: if inference-sim mode, return `simGpuTracker.getNvidiaSmiInfo()` instead of NVML
- `initializeNvml()` / `shutdownNvml()`: no-op when inference-sim mode (guarded in server.ts)

### `model-manager.ts` — Conditional spawning

In `launchModel()`:
1. **Binary selection**: `spawn(isInferenceSimMode() ? config.inferenceSimBinary : 'vllm', args, ...)`
2. **Argument building**: Separate arg construction for vLLM vs inference-sim (no `serve` subcommand, different flag format, add `--startup-duration`, `--time-to-first-token`, `--inter-token-latency`)
3. **Environment**: Skip `CUDA_VISIBLE_DEVICES`, `ENABLE_KVCACHED`, `KVCACHED_AUTOPATCH`, `KVCACHED_IPC_NAME` for inference-sim
4. **Instance record**: Set `kvcachedEnabled: false` for inference-sim (FR-018)

In `monitorModelStartup()`:
1. **Skip EngineCore PID extraction** (FR-016): inference-sim has no EngineCore
2. **Skip NVML memory queries**: Use `simGpuTracker.allocate()` instead with estimated memory
3. **Skip log-based memory metrics parsing**: Set reasonable defaults

In `unloadModel()`:
1. **Signal**: Use `killProcessGracefully()` (SIGTERM) instead of `killProcessImmediate()` (SIGKILL) for inference-sim (FR-015)
2. **Skip port-based vLLM process discovery**: Not needed for inference-sim
3. **Deallocate simulated memory**: Call `simGpuTracker.deallocate(instanceId)`

### `memory-monitor.ts` — Skip hardware monitoring

- Skip `runKvcacheStats()` (Python script for /dev/shm IPC segments) in inference-sim mode
- Skip NVML-based memory queries — use `simGpuTracker` data instead
- Return simulated `ResourceMetrics` with data from the tracker

### `gpu-selector.ts` — Simulated capacity checks

- The GPU selector already uses `getNvidiaSmiInfo()` to determine available memory
- Since `getNvidiaSmiInfo()` will return simulated data in inference-sim mode, the selector should work without changes
- The selector may need a small adjustment: it currently checks NVML process lists to find GPU memory usage. In inference-sim mode, the simulated process list needs to include fake entries for loaded models.

## R7: Health Check Compatibility

**Decision**: No changes needed to health check polling.

**Key findings**:
- sardeenz polls `http://localhost:{port}/health` every 2 seconds during model startup (in `waitForReady()`)
- inference-sim's `/health` endpoint returns 200 immediately; `/health/ready` returns 503 during `--startup-duration`, then 200
- The `waitForReady()` function currently polls `/health` (not `/health/ready`), so it will see 200 immediately regardless of `--startup-duration`
- **Recommendation**: Change `waitForReady()` to poll `/health/ready` instead of `/health` when in inference-sim mode, so the startup-duration simulation works correctly. Alternatively, always use `/health/ready` since vLLM also supports it.

**Rationale**: Using `/health/ready` provides a more realistic simulation of model loading time, which is important for testing the SSE progress events and dashboard loading indicators.

## R8: Chat Template Detection

**Decision**: Skip chat template detection for inference-sim models. Always set `hasChatTemplate: true`.

**Key findings**:
- After model ready, `monitorModelStartup()` sends a test chat completion request to detect if the model supports chat templates
- inference-sim always accepts chat completion requests (it returns synthetic responses), so the test will always pass
- Setting `hasChatTemplate: true` unconditionally is correct for inference-sim

**Rationale**: No code change needed — the existing test will pass naturally. But we can skip the test entirely to avoid unnecessary HTTP requests during simulation.
