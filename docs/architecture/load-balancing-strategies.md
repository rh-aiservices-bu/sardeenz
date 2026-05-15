# Load Balancing Strategies for Multi-GPU Model Management

## Context

When Sardeenz manages many GPUs with many models loaded, the system needs an intelligent mechanism to optimize model placement across GPUs. Unlike Kubernetes — which schedules pods once and never moves them — Sardeenz can dynamically load, unload, and migrate models at runtime. This opens the door to active placement optimization that reacts to real-time conditions.

This document surveys the available strategies, their trade-offs, and their applicability to Sardeenz's specific constraints.

## Terminology

| Term | Definition |
|------|-----------|
| **Placement** | The mapping of models to GPUs at a given point in time |
| **Migration** | Unloading a model from one GPU and reloading it on another |
| **Sleep** | Unloading a model from VRAM while keeping it in a "warm" list for fast reload |
| **Wake** | Reloading a previously slept model, typically triggered by an incoming request |
| **Heat** | A measure of how actively a model is being used (request rate, recency, priority) |
| **Pressure** | A measure of how constrained a GPU's resources are (VRAM, KV cache, compute) |
| **Bin** | A GPU, viewed as a container with finite capacity |
| **Item** | A model, viewed as an object with a known resource footprint |
| **Thrashing** | Excessive migration activity that degrades overall system performance |

## Input Signals

Any strategy needs to consume real-time signals to make decisions. The following are available or obtainable in Sardeenz:

| Signal | Source | Granularity | Notes |
|--------|--------|-------------|-------|
| KV cache usage (%) | kvcached | Per-GPU, real-time | Primary memory pressure indicator |
| VRAM usage (bytes) | NVML / nvidia-smi | Per-GPU, real-time | Total memory pressure, including non-KV allocations |
| Request rate | Proxy (router) | Per-model, real-time | Count of requests per time window |
| Queue depth | vLLM engine | Per-model, real-time | Pending requests waiting for processing |
| Time-to-first-token (TTFT) | Proxy / vLLM | Per-request | Latency indicator; rising TTFT suggests contention |
| Idle time | Controller | Per-model | Duration since last request; candidate for sleep |
| GPU compute utilization (%) | NVML | Per-GPU, real-time | Compute saturation indicator |
| Model VRAM footprint | Profiler / config | Per-model, static | Known at load time; used for capacity planning |

## Available Actions

Actions are listed from lightest (least disruptive) to heaviest:

### 1. Sleep (Unload Idle Model)

Unload a model from VRAM but keep it in a "warm" list so it can be reloaded on demand.

- **Cost**: Near-zero (just an unload API call)
- **Latency impact**: Only affects the slept model — next request triggers a wake (reload)
- **Wake-on-request**: The proxy intercepts requests for slept models, triggers a load, and streams placeholder chunks ("Please wait, model is waking up..." then "." every few seconds) until the model is ready. This pattern is proven in the HTTP Add-on for KEDA interceptor proxy.

### 2. Rebalance / Migrate

Move a model from one GPU to another to improve overall placement.

- **Cost**: Moderate to high — migration is a **load-then-unload** operation, not an atomic move. The model must be loaded on the target GPU *before* being unloaded from the source, meaning **two copies exist simultaneously** during the transition. The target GPU must have enough free VRAM to hold the incoming model on top of its current load.
- **Latency impact**: Zero for the migrating model — requests continue to be served by the source GPU copy until the target copy is fully loaded and the proxy switches routing. Other models are unaffected.
- **When to use**: A GPU is under high pressure while another has enough free VRAM to absorb the dual-copy transient cost
- **Critical constraint**: Every capacity check for migration feasibility must account for this transient dual-copy state. A model requiring 5 GB of VRAM needs 5 GB free on the target GPU *in addition to* the 5 GB it still occupies on the source GPU until the migration completes.

### 3. Replicate

Load a second copy of a hot model on an additional GPU to spread traffic.

- **Cost**: High (doubles VRAM usage for that model)
- **Latency impact**: Positive — reduces per-instance load
- **When to use**: A single model is a throughput bottleneck and VRAM is available elsewhere

### 4. Evict

Hard-unload a model with no plan to reload it automatically. Frees maximum space.

- **Cost**: Low mechanically, high in terms of availability
- **Latency impact**: Model becomes completely unavailable until manually reloaded
- **When to use**: Last resort when sleep is insufficient and no migration target exists

---

## Strategy 1: Reactive Controller Loop

A periodic tick (e.g., every 5-10 seconds) in the backend reads metrics, applies threshold-based rules, and issues load/unload commands.

### How It Works

```
every N seconds:
  for each GPU:
    if kv_cache_usage > HIGH_WATERMARK:
      find coldest model on this GPU
      sleep(model)
    if kv_cache_usage < LOW_WATERMARK and sleeping_models_exist:
      wake(highest_priority_sleeping_model)
```

### Pros

- **Simple to implement**: Minimal state, straightforward rules
- **Easy to reason about**: Behavior is predictable and debuggable
- **Low overhead**: One metrics read + decision per tick
- **Safe**: Threshold-based rules are conservative by default

### Cons

- **Reactive only**: Cannot anticipate demand spikes; always lags behind by at least one tick interval
- **No cross-GPU awareness**: Each GPU is evaluated independently; misses global optimization opportunities
- **No consolidation**: Never moves models between GPUs, so fragmentation accumulates over time — the same Kubernetes problem
- **Crude prioritization**: "coldest model" is a single-dimensional heuristic

### Best For

Minimal viable implementation; systems with few GPUs where fragmentation is unlikely.

---

## Strategy 2: Event-Driven with Thresholds

The proxy emits events on every request arrival. The controller reacts immediately when KV cache crosses a watermark or queue depth exceeds a threshold.

### How It Works

```
on request_received(model):
  model.heat += 1
  gpu = model.gpu
  if gpu.kv_cache_usage > HIGH_WATERMARK:
    trigger_pressure_relief(gpu)

on pressure_relief(gpu):
  coldest = gpu.models.sort_by(heat).first()
  sleep(coldest)
```

### Pros

- **More responsive**: Reacts within milliseconds of a threshold breach, not at the next tick
- **Natural backpressure**: Heavy traffic directly triggers management actions
- **Fine-grained**: Per-request granularity enables precise heat tracking

### Cons

- **Complex state management**: Event-driven systems are harder to debug than periodic loops
- **Thundering herd risk**: A burst of requests can trigger multiple simultaneous actions
- **Still no cross-GPU optimization**: Pressure relief is local to the affected GPU
- **Higher overhead**: Event processing on every request adds to the hot path

### Best For

Latency-sensitive deployments where seconds of reaction time matter.

---

## Strategy 3: Bin Packing with Item Migration

The classic combinatorial optimization problem: GPUs are bins with capacity, models are items with known sizes, and the goal is to minimize the number of bins used (or maximize free contiguous space).

### How It Works

Periodically compute an optimal placement using a bin-packing algorithm, diff against current placement, and execute the minimum set of migrations to reach the target state.

The key theoretical result (Epstein & Levin, 2006) is that allowing O(1) migrations per insertion achieves asymptotically optimal packing — meaning you only need to move 1-2 existing models when placing a new one.

### Pros

- **Provably good packing**: Minimizes wasted VRAM across the cluster
- **Consolidation-aware**: Actively moves models to create room for larger ones — solves the Kubernetes fragmentation problem
- **Well-studied**: Extensive literature on approximation algorithms and bounds

### Cons

- **Single-dimensional**: Classic bin packing only considers one resource (VRAM); doesn't account for KV cache pressure, compute, or traffic patterns
- **Ignores workload dynamics**: Treats models as static items; doesn't consider that a cold model costs less to move than a hot one
- **Does not model dual-copy migration cost**: Classic bin packing assumes items can be moved atomically between bins. In reality, migration requires the model to be loaded on the target GPU while still occupying the source GPU (dual-copy transient state). The algorithm must verify that the target GPU has free VRAM for the incoming model *on top of its current load*, not just in the final state. This significantly constrains which migrations are actually feasible.
- **Recomputation overhead**: Solving the packing problem from scratch each tick can be expensive for large clusters

### Best For

Environments where VRAM fragmentation is the primary bottleneck and models have relatively uniform access patterns. Requires an additional feasibility layer to validate that migrations are achievable given the dual-copy constraint.

---

## Strategy 4: First Fit Decreasing with Periodic Defragmentation

A pragmatic variant of bin packing: use First Fit Decreasing (FFD) for initial placement, and periodically run a "defrag" pass that consolidates small models onto fewer GPUs.

### How It Works

```
on model_load_request(model):
  sort available GPUs by free_vram ascending (tightest fit)
  place model on first GPU with sufficient space

every DEFRAG_INTERVAL:
  compute ideal_placement = FFD(all_loaded_models, all_gpus)
  diff = compare(current_placement, ideal_placement)
  execute migrations in diff (up to MIGRATION_BUDGET per tick)
```

### Pros

- **Good practical packing**: FFD is within 11/9 * OPT + 6/9 of optimal (proven bound)
- **Consolidation via defrag**: Periodically recovers from fragmentation without continuous churn
- **Simple implementation**: FFD is a sort + greedy loop; defrag is a diff + bounded migration
- **Migration budget prevents thrashing**: Limits disruption per cycle

### Cons

- **Still single-dimensional**: Doesn't account for heat, KV cache, or compute
- **Defrag must account for dual-copy cost**: The defrag pass computes an ideal placement, but the migration path from current to ideal must be validated step by step — each migration temporarily doubles the model's VRAM footprint across the cluster. A naive diff between current and ideal placement may produce a migration sequence that is infeasible because intermediate steps exceed GPU capacity. Migration ordering matters: sometimes a small model must be moved first to create headroom for a larger one.
- **Static model sizes assumed**: Doesn't account for variable KV cache growth under load
- **No priority awareness**: Treats all models equally regardless of traffic or business importance

### Best For

A solid baseline when combined with a heat/priority layer (see Strategy 6). The defrag algorithm must include a sequential feasibility check that simulates the transient dual-copy state for each migration in the plan.

---

## Strategy 5: Vector Bin Packing (Multi-Resource)

Extends bin packing to multiple dimensions: each GPU is a vector of capacities (VRAM, KV cache headroom, compute), and each model is a vector of demands.

### How It Works

This is the approach used by Google's Borg scheduler. The scoring function for placing a model on a GPU becomes a weighted sum (or dot product) across resource dimensions:

```
score(model, gpu) = w1 * vram_fit(model, gpu)
                  + w2 * kv_cache_fit(model, gpu)
                  + w3 * compute_fit(model, gpu)
```

The model is placed on (or migrated to) the GPU with the best score.

### Pros

- **Multi-resource awareness**: Balances VRAM, KV cache, and compute simultaneously
- **Configurable weights**: Operators can tune priorities (e.g., prioritize KV cache headroom over compute balance)
- **Proven at scale**: Used in production by Borg, Autopilot, and similar systems
- **Composable**: Easy to add new dimensions (e.g., network bandwidth, power budget)

### Cons

- **Weight tuning is hard**: Finding the right balance between dimensions requires experimentation
- **Interactions between dimensions**: Resources are not independent (e.g., more models = more VRAM + more KV cache + more compute), which can make scoring misleading
- **Doesn't inherently consider migration cost**: Still needs a separate mechanism to avoid thrashing
- **More complex implementation**: Requires continuous multi-dimensional metrics collection

### Best For

Multi-GPU clusters where different GPUs have different characteristics (e.g., mixed A100/H100) or where multiple resources are simultaneously constrained.

---

## Strategy 6: Heat-Aware Placement with Periodic Defragmentation (Recommended)

Combines the strengths of FFD, vector bin packing, and heat scoring into a practical system. Each model gets a heat score based on traffic; each GPU gets a pressure score based on resource utilization. The optimizer minimizes total pressure weighted by heat, with a migration budget to prevent thrashing.

### How It Works

See the companion design document: [Load Balancing Design](./load-balancing-design.md)

### Pros

- **Holistic**: Considers VRAM, KV cache, compute, traffic, and business priority simultaneously
- **Consolidation-aware**: Actively defragments to solve the Kubernetes problem
- **Thrash-resistant**: Migration budget + improvement threshold prevent unnecessary churn
- **Sleep/wake integrated**: Naturally sleeps cold models and wakes them on demand
- **Incrementally adoptable**: Can start with sleep/wake only, then add migration, then replication

### Cons

- **Most complex to implement**: Multiple interacting subsystems (scoring, solving, executing, monitoring)
- **Tuning surface**: Several parameters (weights, thresholds, budgets) need calibration
- **Observability requirement**: Needs comprehensive metrics collection to function well
- **Migration cost is real**: Even with budgets, migrations cause brief model unavailability

### Best For

The target state for Sardeenz: a system managing multiple GPUs with diverse models, varying traffic patterns, and the need for efficient resource utilization.

---

## Strategy 7: Constraint Satisfaction / Integer Linear Programming (ILP)

Formulates placement as a mathematical optimization problem and uses a solver to find provably optimal solutions.

### How It Works

```
minimize: total_migrations + λ * total_pressure
subject to:
  # Final-state capacity constraints
  ∀ gpu: sum(model_vram) ≤ gpu_vram_capacity
  ∀ gpu: sum(model_kv_estimate) ≤ gpu_kv_capacity
  ∀ model: placed_on_exactly_one_gpu (or zero if sleeping)
  migration_count ≤ BUDGET

  # Dual-copy transient constraints (critical):
  # For each migration step t in the ordered sequence:
  #   target_gpu_vram_at_step_t + migrating_model_vram ≤ gpu_vram_capacity
  # Because the model is loaded on the target BEFORE being unloaded
  # from the source, the target must absorb the full model footprint
  # on top of everything already there at that step.
```

The dual-copy transient constraint is what makes the ILP formulation significantly harder than standard bin packing. It introduces ordering dependencies between migrations: migration B may only be feasible *after* migration A completes and frees source VRAM. This turns the problem into a sequencing + assignment problem, which may require additional binary variables for migration ordering.

Solvers like HiGHS (MIT-licensed, JavaScript bindings available) can solve instances with <16 GPUs and <100 models in milliseconds.

### Pros

- **Provably optimal**: Finds the mathematically best placement given the constraints
- **Flexible constraints**: Easy to add new requirements (e.g., "model A must not share a GPU with model B", "model C must be on GPU 0")
- **Migration-cost-aware**: Migration cost is directly in the objective function
- **Exact**: No heuristic approximation; the solution is guaranteed optimal

### Cons

- **Scalability ceiling**: ILP is NP-hard; solving time grows exponentially with problem size (though practical for Sardeenz's expected scale of <16 GPUs)
- **Solver dependency**: Requires an external solver library (HiGHS, GLPK, or similar)
- **Model formulation complexity**: Translating real-world constraints into linear constraints requires expertise
- **Brittleness**: Small changes in input can cause large changes in output (solver instability), leading to unnecessary migrations without dampening

### Best For

Smaller clusters (<16 GPUs) where optimality matters and the engineering team is comfortable with mathematical optimization. Could be used as the solver backend for Strategy 6.

---

## Comparison Matrix

| Criterion | Reactive Loop | Event-Driven | Bin Packing | FFD + Defrag | Vector Packing | Heat-Aware (Rec.) | ILP |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Implementation complexity | Low | Medium | Medium | Medium | High | High | High |
| Cross-GPU optimization | No | No | Yes | Yes | Yes | Yes | Yes |
| Multi-resource awareness | No | No | No | No | Yes | Yes | Yes |
| Traffic/heat awareness | No | Partial | No | No | No | Yes | Yes |
| Consolidation (defrag) | No | No | Yes | Yes | Yes | Yes | Yes |
| Thrash resistance | N/A | Low | Low | Medium | Low | High | Medium |
| Scalability | High | High | Medium | High | High | High | Low |
| Optimality guarantee | None | None | Bounded | Bounded | Heuristic | Heuristic | Exact |
| Incremental adoptability | High | Medium | Low | Medium | Low | High | Low |

## Recommendation

**Strategy 6 (Heat-Aware Placement with Periodic Defragmentation)** is the recommended approach for Sardeenz. It provides the best balance of intelligence, practicality, and incremental adoptability. The detailed design is in the companion document: [Load Balancing Design](./load-balancing-design.md).

For future consideration, Strategy 7 (ILP) could serve as a drop-in replacement for the heuristic solver in Strategy 6, providing optimal solutions for clusters that remain small enough for exact solving.
