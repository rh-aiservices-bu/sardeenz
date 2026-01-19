# LLM Benchmarking & Memory Profiling - Specification

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

## 2. User Stories

### Performance Benchmarking

| Role              | User Story                                                                                                                       | Acceptance Criteria                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| ML Engineer       | As an ML Engineer, I want to measure baseline performance of a model so that I can establish a reference point before production | TTFT/TPS/E2E percentiles displayed for isolated single-model test           |
| ML Engineer       | As an ML Engineer, I want to compare two models side-by-side so that I can choose the best one for my use case                   | Comparison view showing metrics for multiple models in same benchmark run   |
| Platform Operator | As a Platform Operator, I want to test performance under concurrent load so that I can validate capacity planning                | Contention mode runs multiple models in parallel, reports per-model metrics |
| Platform Operator | As a Platform Operator, I want to measure kvcached impact so that I can quantify the performance/memory tradeoff                 | Compare historical runs with/without KVCache using comparison view          |
| Decision Maker    | As a Decision Maker, I want to export benchmark results so that I can include them in reports                                    | Export to CSV/JSON with all metrics and configuration                       |

### Memory Profiling

| Role              | User Story                                                                                                          | Acceptance Criteria                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ML Engineer       | As an ML Engineer, I want to capture memory profile of a running model so that I know its exact VRAM footprint      | Profile shows weights, CUDA graphs, KV cache breakdown                           |
| Platform Operator | As a Platform Operator, I want to be warned before loading a model that won't fit so that I can avoid OOM failures  | Pre-load warning appears when estimated memory exceeds available GPU             |
| Platform Operator | As a Platform Operator, I want to see memory profiles for different max_tokens settings so that I can plan capacity | Profile keyed by model_path + max_tokens + gpu_name, multiple profiles per model |
| Decision Maker    | As a Decision Maker, I want to compare memory requirements across models so that I can optimize GPU costs           | Profiles table with sortable columns for memory metrics                          |

---

## 3. Terminology

### Performance Metrics

| Metric                         | What It Measures                             | Why It Matters                                               |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------ |
| **TTFT** (Time to First Token) | Latency from request to first response token | User-perceived responsiveness; critical for streaming UX     |
| **TPS** (Tokens Per Second)    | Token generation throughput                  | Raw model speed; higher = faster completions                 |
| **E2E Latency**                | Total request-to-completion time             | Overall response time; combines TTFT + generation            |
| **Goodput**                    | % of requests meeting SLA threshold          | Production reliability; what % of requests are "fast enough" |

_Note: TPOT (Time Per Output Token) can be calculated as `1000 / TPS` if needed for latency analysis._

**Goodput Calculation:**

- A request is "good" if `total_latency_ms < sla_threshold_ms`
- `goodput_percent = (good_requests / total_requests) * 100`

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

## 4. Use Cases

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

### Scenario B: KVCache Comparison (Historical)

**Goal:** Compare performance with/without kvcached memory sharing.

**Setup:**

1. Run benchmark suite with kvcached **enabled** at system level
2. Reconfigure system with kvcached **disabled**
3. Run identical benchmark suite
4. Use **Compare Runs** feature to overlay results

**Key Behavior:**

- No in-benchmark toggle - comparison is across historical runs
- Comparison view overlays metrics from multiple saved runs
- Give runs descriptive names (e.g., "KVCache ON", "KVCache OFF") for easy identification

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

**Output:** Stored memory profile keyed by `model_path + max_tokens + gpu_name`.

**Use this when:** Before deploying new models, planning GPU capacity, comparing model memory efficiency.

**Multi-GPU Note:** Memory profiles are captured per-GPU. When loading a model, the system checks profiles matching the target GPU. If no matching profile exists for that GPU, a warning is shown.

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
- **Input Tokens**: Slider 64-4096, displays "~512 tokens" (approximate)
- **Output Tokens**: Slider 16-2048, displays "~128 tokens" (approximate)
- **Concurrency**: 1-32 concurrent requests (default: 1)
- **Total Requests**: 10-500 measured requests (default: 50)
- **Warmup**: 0-10 warmup requests (default: 3)

_Note: Token counts are approximate using 4:1 character-to-token ratio. Actual tokens depend on model tokenizer._

**Advanced Options**

- **Run Name**: Optional label for this benchmark run (helps with comparison)
- **SLA Threshold**: ms threshold for goodput calculation (default: 5000)

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

**Comparison View Details:**

- Select 2-4 historical runs to compare
- Overlay bar charts show same metrics side-by-side
- Table view shows delta (% change) between runs
- Filter: same model, same config, or all runs

### Tab: Memory Profiles

#### Step 1: Capture a Profile

1. Ensure you have a model loaded with desired `max_tokens` configuration
2. Navigate to Benchmark → Memory Profiles tab
3. In "Create Memory Profile" card:
   - Select running model from dropdown
   - Optionally customize profile name
   - Add comments (e.g., "GPU A100, no other models loaded")
4. Click "Capture Profile"
5. Profile is stored with `model_path + max_tokens + gpu_name` as unique key

#### Step 2: View Saved Profiles

Profiles table shows:

- **Model**: HuggingFace path or local path
- **Max Tokens**: Configuration when profiled
- **GPU**: GPU name where profile was captured
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

## 6. Product Decisions

| Decision                                            | Rationale                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| Two-tab interface (Performance / Memory)            | Different workflows, different audiences - cleaner separation               |
| Warn-only pre-load                                  | User knows best - avoid blocking legitimate experiments                     |
| Standard presets + custom tokens                    | Cover common cases (512, 1024, 2048, 4096) + allow experimentation          |
| Profile keyed by model_path + max_tokens + gpu_name | Same model at different token limits or GPUs has different memory footprint |
| Warmup requests                                     | Avoids cold-start skew from CUDA compilation                                |
| P50/P90/P95/P99 percentiles                         | Captures distribution, not just averages; P99 matters for SLAs              |
| Isolated vs Contention modes                        | Different use cases: baseline profiling vs capacity planning                |

---

## References

- [NVIDIA LLM Benchmarking Guide](https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/)
- [BentoML LLM Inference Metrics](https://bentoml.com/llm/inference-optimization/llm-inference-metrics)
- [vLLM Benchmark Documentation](https://docs.vllm.ai/en/latest/contributing/benchmarks.html)
