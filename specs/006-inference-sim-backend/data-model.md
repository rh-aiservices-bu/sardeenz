# Data Model: Inference Simulator Backend

**Date**: 2026-05-16  
**Feature**: [spec.md](spec.md)

## Entities

### SimulatedGpu

Represents a virtual GPU with tracked memory state. No physical hardware counterpart.

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | GPU index (0-based) |
| `name` | `string` | Display name, e.g., `"Simulated GPU (24 GB)"` |
| `totalMemoryMB` | `number` | Total memory in MiB (from `SIM_GPU_MEMORY_GB`) |
| `usedMemoryMB` | `number` | Currently allocated memory in MiB |
| `models` | `Map<string, number>` | Instance ID → allocated memory in MiB |

**Lifecycle**: Created at startup, lives in memory for the duration of the process. Not persisted.

**State transitions**: None — memory is updated via `allocate()`/`deallocate()` calls.

### ModelMemoryEstimate

Ephemeral computation result — not stored as a persistent entity.

| Field | Type | Description |
|-------|------|-------------|
| `modelPath` | `string` | Original model path/name |
| `detectedSizeB` | `number \| null` | Detected parameter count in billions (e.g., 7 for "7B") |
| `estimatedMemoryGB` | `number` | Estimated GPU memory in GB |
| `source` | `'name-detection' \| 'default'` | How the estimate was derived |

## Modified Entities

### Config (existing — `apps/backend/src/config.ts`)

New fields added to the `Config` interface:

| Field | Type | Default | Env var | Description |
|-------|------|---------|---------|-------------|
| `inferenceBackend` | `'vllm' \| 'inference-sim'` | `'vllm'` | `INFERENCE_BACKEND` | Which inference engine to use |
| `simGpuMemoryGB` | `number` | `24` | `SIM_GPU_MEMORY_GB` | Total memory per simulated GPU |
| `simModelMemoryGB` | `number` | `4` | `SIM_MODEL_MEMORY_GB` | Default model memory when size unknown |
| `simStartupDuration` | `string` | `'3s'` | `SIM_STARTUP_DURATION` | Simulated model loading time |
| `inferenceSimBinary` | `string` | `'llm-d-inference-sim'` | `INFERENCE_SIM_BINARY` | Path to inference-sim binary |

### ModelInstance (existing — `@sardeenz/types`)

No schema changes. Behavioral differences in inference-sim mode:

| Field | vLLM behavior | inference-sim behavior |
|-------|---------------|----------------------|
| `kvcachedEnabled` | Based on config | Always `false` |
| `engineCorePid` | Extracted from logs | Always `undefined` |
| `gpuMemoryUtilization` | From NVML process query | From SimGpuTracker estimate |
| `memoryMetrics` | Parsed from vLLM logs | Simple estimated values |
| `memoryBaselineByGpu` | From NVML per-GPU query | From SimGpuTracker allocation |
| `hasChatTemplate` | Tested via HTTP | Always `true` |

## New Modules

### SimGpuTracker (`apps/backend/src/utils/sim-gpu-tracker.ts`)

Singleton module managing simulated GPU state.

**Public API**:

```typescript
interface SimGpuTracker {
  initialize(gpuCount: number, memoryPerGpuGB: number): void
  allocate(gpuIndex: number, instanceId: string, memoryMB: number): void
  deallocate(instanceId: string): void
  getGpuInfo(): GpuInfo[]
  getNvidiaSmiInfo(): NvidiaSmiInfo
  getAvailableMemoryMB(gpuIndex: number): number
  reset(): void  // For testing
}
```

**Invariants**:
- `usedMemoryMB` for any GPU never exceeds `totalMemoryMB`
- `allocate()` throws if allocation would exceed capacity
- `deallocate()` removes memory from ALL GPUs where the instance was tracked
- After `deallocate()`, the instance ID no longer appears in any GPU's models map

### ModelMemoryEstimator (`apps/backend/src/utils/model-memory-estimator.ts`)

Pure function module — no state.

**Public API**:

```typescript
function estimateModelMemory(modelPath: string, defaultMemoryGB: number): ModelMemoryEstimate
```

**Estimation rules**:
1. Extract size indicator via regex: `/(\d+(?:\.\d+)?)\s*[bB]\b/`
2. If found and ≤30B: `memory_gb = params * 2` (fp16)
3. If found and >30B: `memory_gb = params * 0.5 + 2` (4-bit quantized + overhead)
4. If not found: use `defaultMemoryGB` parameter

## Relationships

```
Config
  └── inferenceBackend ──► controls which code path runs

SimGpuTracker (only active when inferenceBackend === 'inference-sim')
  ├── feeds → gpu-info.ts (detectGpuInfo, getNvidiaSmiInfo)
  ├── feeds → gpu-selector.ts (capacity checks via getNvidiaSmiInfo)
  ├── feeds → memory-monitor.ts (memory usage API)
  ├── updated by → model-manager.ts (allocate on load, deallocate on unload)
  └── uses → ModelMemoryEstimator (to determine allocation size)

ModelManager
  ├── reads → Config.inferenceBackend (to choose binary + args)
  ├── calls → SimGpuTracker.allocate() (on model ready, inference-sim only)
  ├── calls → SimGpuTracker.deallocate() (on model unload, inference-sim only)
  └── spawns → inference-sim binary OR vllm binary
```
