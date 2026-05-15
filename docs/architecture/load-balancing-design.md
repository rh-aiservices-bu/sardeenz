# Load Balancing Design: Heat-Aware Placement with Periodic Defragmentation

## Overview

This document describes the comprehensive design for Sardeenz's load balancing system. The system optimizes model placement across multiple GPUs by combining heat-based model scoring, multi-dimensional GPU pressure measurement, periodic defragmentation, and sleep/wake lifecycle management.

The design is intentionally incremental — it can be implemented in phases, starting with sleep/wake and adding migration and replication in subsequent iterations.

## Design Goals

1. **Maximize GPU utilization**: Consolidate models to minimize wasted VRAM and free up entire GPUs for large models
2. **Respect workload priority**: Hot (high-traffic, high-priority) models should be stable; cold models should absorb disruption
3. **Minimize disruption**: Bound the number of migrations per cycle; never move a model that's actively serving traffic at high volume
4. **React to pressure**: When KV cache or VRAM pressure is high, shed load by sleeping cold models
5. **Self-healing**: Fragmentation that accumulates over time is periodically corrected
6. **Observable**: Every decision is logged with its reasoning; operators can inspect and override

## Critical Constraint: Dual-Copy Migration

A migration is **not** an atomic move. You cannot unload a model from GPU A and then load it on GPU B — the model must remain available on the source GPU while the target copy is loading. This means:

1. **Load on target first, then unload from source.** During the transition window, two copies of the model exist simultaneously — one on each GPU.
2. **The solver must account for the transient VRAM cost.** When evaluating whether a migration is feasible, the target GPU must have enough free VRAM to hold the incoming model *in addition to everything already loaded there*. The source GPU does not gain any VRAM until the migration completes.
3. **Requests keep flowing to the source copy** during migration. The proxy only switches routing to the target once it reports `loaded`. This ensures zero downtime for the model.
4. **Multiple concurrent migrations compound the cost.** If two models are being migrated to the same GPU, the target must have room for both simultaneously. The migration budget and sequential execution order (see Executor) prevent this from spiraling.

This constraint permeates the design: every capacity check, every feasibility test, and every defrag plan must simulate the *transient* state where both copies exist, not just the *final* state after the source copy is unloaded.

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Controller API                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │   Metrics     │  │   Balancer    │  │   Executor    │ │
│  │  Collector    │──│   (Solver)    │──│  (Actuator)   │ │
│  └──────┬───────┘  └──────────────┘  └───────┬───────┘ │
│         │                                     │         │
│  ┌──────┴───────┐                    ┌───────┴───────┐ │
│  │  Signal       │                    │  Model        │ │
│  │  Aggregator   │                    │  Manager      │ │
│  └──────┬───────┘                    └───────┬───────┘ │
│         │                                     │         │
└─────────┼─────────────────────────────────────┼─────────┘
          │                                     │
   ┌──────┴───────┐                    ┌───────┴───────┐
   │  kvcached     │                    │  vLLM         │
   │  NVML         │                    │  Processes    │
   │  Proxy stats  │                    │               │
   └──────────────┘                    └───────────────┘
```

### Components

#### 1. Metrics Collector

Responsible for gathering raw signals from all sources at regular intervals.

**Inputs:**
- kvcached: KV cache usage per GPU (bytes used, bytes total, eviction rate)
- NVML: VRAM usage, GPU compute utilization, GPU temperature
- Proxy: Per-model request counts, latency percentiles, active connections
- Controller: Model load timestamps, VRAM footprints, configuration

**Output:** A `ClusterSnapshot` — a point-in-time view of all GPUs and all models with their metrics.

```typescript
interface ClusterSnapshot {
  timestamp: number;
  gpus: GpuSnapshot[];
  models: ModelSnapshot[];
}

interface GpuSnapshot {
  gpuId: number;
  vramTotal: number;
  vramUsed: number;
  kvCacheTotal: number;
  kvCacheUsed: number;
  computeUtilization: number;     // 0.0 - 1.0
  loadedModels: string[];         // model IDs
}

interface ModelSnapshot {
  modelId: string;
  gpuId: number | null;           // null if sleeping
  vramFootprint: number;
  status: 'loaded' | 'sleeping' | 'loading' | 'migrating';
  requestRate: number;            // requests per second (rolling window)
  avgTTFT: number;                // average time-to-first-token (ms)
  lastRequestAt: number;          // timestamp of last request
  configuredPriority: number;     // operator-assigned priority (0-100)
}
```

**Collection interval:** Every 5 seconds (configurable via `BALANCER_METRICS_INTERVAL_MS`).

#### 2. Signal Aggregator

Transforms raw metrics into the two core scores used by the solver: **model heat** and **GPU pressure**.

##### Model Heat Score

Heat represents how "important" a model is right now. Higher heat = more costly to disrupt.

```
heat(model) = w_rate   * normalize(request_rate)
            + w_recent * normalize(recency)
            + w_prio   * normalize(configured_priority)
            + w_ttft   * normalize(1 / avg_ttft)
```

Where:
- `request_rate`: Requests per second over a rolling window (default: 5 minutes)
- `recency`: Inverse of time since last request, capped (e.g., `1 / min(idle_seconds, 3600)`)
- `configured_priority`: Operator-assigned priority (0-100) from model configuration
- `avg_ttft`: Average time-to-first-token — lower is better, so inverted

**Default weights:**

| Weight | Value | Rationale |
|--------|-------|-----------|
| `w_rate` | 0.40 | Traffic volume is the strongest signal of active use |
| `w_recent` | 0.25 | Recency catches models with bursty but important traffic |
| `w_prio` | 0.25 | Operator intent should be respected |
| `w_ttft` | 0.10 | Latency is an indirect signal; less reliable than direct traffic |

Weights are configurable and must sum to 1.0. The heat score is normalized to [0, 1].

##### GPU Pressure Score

Pressure represents how constrained a GPU is. Higher pressure = more urgent need for relief.

```
pressure(gpu) = w_kv   * normalize(kv_cache_usage)
              + w_vram * normalize(vram_usage)
              + w_comp * normalize(compute_utilization)
```

**Default weights:**

| Weight | Value | Rationale |
|--------|-------|-----------|
| `w_kv` | 0.50 | KV cache exhaustion causes immediate request failures |
| `w_vram` | 0.35 | VRAM exhaustion prevents loading new models |
| `w_comp` | 0.15 | Compute saturation degrades latency but doesn't cause failures |

The pressure score is normalized to [0, 1].

##### Watermarks

Pressure triggers actions at configurable thresholds:

| Watermark | Default | Action |
|-----------|---------|--------|
| `PRESSURE_LOW` | 0.30 | Consider waking sleeping models |
| `PRESSURE_HIGH` | 0.75 | Begin sleeping coldest models |
| `PRESSURE_CRITICAL` | 0.90 | Aggressively sleep/evict to prevent failures |

#### 3. Balancer (Solver)

The core decision engine. Runs on every tick and produces a `PlacementPlan` — a set of actions to move from the current state toward a better placement.

##### Decision Flow

```
on tick:
  snapshot = metrics_collector.snapshot()
  scored_models = score_all_models(snapshot)     # compute heat
  scored_gpus = score_all_gpus(snapshot)          # compute pressure

  # Phase 1: Pressure Relief (urgent, runs every tick)
  for gpu in scored_gpus where pressure > PRESSURE_HIGH:
    candidates = gpu.models.sort_by(heat, ascending)
    while gpu.pressure > PRESSURE_HIGH and candidates.not_empty():
      model = candidates.pop()
      if model.heat < HEAT_SLEEP_THRESHOLD:
        plan.add(Sleep(model))
      else:
        # find_migration_target checks that the target GPU can absorb
        # model.vramFootprint ON TOP of its current load (dual-copy cost).
        # The source GPU's VRAM is NOT freed until migration completes.
        target_gpu = find_migration_target(model, scored_gpus)
        if target_gpu:
          plan.add(Migrate(model, gpu, target_gpu))
          # Reserve the VRAM on the target in the working snapshot so
          # subsequent iterations in this tick see the transient cost.
          scored_gpus[target_gpu].vramUsed += model.vramFootprint

  # Phase 2: Wake Opportunities (runs every tick)
  for model in sleeping_models.sort_by(heat, descending):
    best_gpu = find_best_gpu_for(model, scored_gpus)
    if best_gpu and best_gpu.pressure + model.pressure_contribution < PRESSURE_HIGH:
      plan.add(Wake(model, best_gpu))

  # Phase 3: Defragmentation (runs every DEFRAG_INTERVAL)
  if time_since_last_defrag > DEFRAG_INTERVAL:
    ideal = compute_ideal_placement(scored_models, scored_gpus)
    migrations = diff(current_placement, ideal)
    migrations = migrations.filter(improvement > MIGRATION_THRESHOLD)
    # Order and validate migrations sequentially: each migration must be
    # feasible considering the dual-copy transient state. A migration is
    # only added to the plan if the target GPU can hold the incoming model
    # while the source GPU still has it loaded.
    validated = []
    for migration in migrations:
      if can_fit_transient(migration.model, migration.target_gpu, scored_gpus):
        validated.append(migration)
        scored_gpus[migration.target_gpu].vramUsed += migration.model.vramFootprint
        if len(validated) >= MIGRATION_BUDGET:
          break
    plan.add_all(validated)

  return plan
```

##### Defragmentation Algorithm

The defrag phase uses a modified First Fit Decreasing (FFD) algorithm:

1. **Sort models by VRAM footprint** (descending)
2. **Sort GPUs by current free VRAM** (ascending — tightest fit first)
3. **For each model**, place it on the first GPU where it fits, preferring GPUs that already have co-located models with similar traffic patterns (locality bonus)
4. **Compute the diff** between ideal and current placement
5. **Filter migrations** where the improvement (reduction in total pressure) exceeds `MIGRATION_THRESHOLD`
6. **Validate migration feasibility** accounting for dual-copy transient cost: each migration in the sequence must be feasible given the VRAM already reserved by earlier migrations in the same plan (see the sequential validation loop in Phase 3 of the Decision Flow)
7. **Cap at `MIGRATION_BUDGET`** migrations per defrag cycle

**Migration ordering matters.** Because each migration temporarily consumes VRAM on the target without freeing VRAM on the source, the order in which migrations are executed affects feasibility. The defrag planner evaluates migrations sequentially and only commits a migration to the plan if the transient state is viable. In some cases, reordering migrations (e.g., moving a small model first to create headroom) unlocks a larger migration that would otherwise be infeasible.

**Locality bonus**: When two models are frequently accessed together (e.g., a base model and its fine-tune), co-locating them avoids unnecessary cross-GPU routing. This is measured by request correlation over time.

##### Migration Target Selection

When a model needs to move (pressure relief or defrag), the target GPU is selected by:

```
score(model, target_gpu) = capacity_fit     * 0.5   # does it fit with headroom?
                         + pressure_balance * 0.3   # does it equalize pressure?
                         + locality_bonus  * 0.2   # are related models here?
```

**Dual-copy feasibility check:** A migration is only proposed if the target GPU can absorb the model's full VRAM footprint *on top of its current load* — because during the transition, both copies exist simultaneously. The `capacity_fit` component evaluates `target_gpu.vramFree >= model.vramFootprint` (not `vramFree` after the source is released — the source is not released until the target is confirmed loaded).

Concretely, if GPU B has 4 GB free and the model requires 5 GB, the migration is **not feasible** even if GPU A (the source) would release 5 GB afterward. The system must find a target that can hold the dual copy, or first free space on the target via sleeps/evictions before attempting the migration.

A migration is only proposed if the target GPU's projected pressure — including the transient dual-copy cost — stays below `PRESSURE_HIGH`.

##### Replication Logic

Replication is triggered when:
1. A model's heat score exceeds `HEAT_REPLICATE_THRESHOLD` (very high traffic)
2. Its GPU's compute utilization exceeds `COMPUTE_REPLICATE_THRESHOLD`
3. At least one other GPU has sufficient VRAM headroom for a second copy

Replicated models are tracked as a replica set. The proxy distributes traffic across replicas using round-robin or least-connections routing.

De-replication occurs when the replica set's combined heat drops below the threshold for a sustained period (`REPLICATE_COOLDOWN`).

#### 4. Executor (Actuator)

Translates the `PlacementPlan` into concrete API calls against the existing Model Manager.

##### Action Types

```typescript
type PlacementAction =
  | { type: 'sleep'; modelId: string }
  | { type: 'wake'; modelId: string; targetGpu: number }
  | { type: 'migrate'; modelId: string; fromGpu: number; toGpu: number }
  | { type: 'replicate'; modelId: string; targetGpu: number }
  | { type: 'dereplicate'; modelId: string; replicaGpu: number }
  | { type: 'evict'; modelId: string };
```

##### Execution Ordering

Actions are executed in a specific order to avoid resource conflicts:

1. **Sleeps** first — free up VRAM before trying to place anything (including creating headroom on migration targets)
2. **Evictions** — additional space if needed
3. **Migrations** — sequentially, one at a time (see below)
4. **Wakes** — load sleeping models onto GPUs with newly available space
5. **Replications** — last, as they consume additional VRAM

##### Migration Execution Sequence

Each migration follows a strict load-then-unload protocol to ensure zero downtime:

```
migrate(model, source_gpu, target_gpu):
  1. Set model.status = 'migrating'
  2. Load model on target_gpu                    # VRAM now consumed on BOTH GPUs
     - Proxy continues routing to source_gpu copy during this phase
  3. Wait for target copy to report 'loaded'
  4. Switch proxy routing to target_gpu           # traffic now hits the new copy
  5. Drain in-flight requests on source_gpu       # wait for active requests to complete
  6. Unload model from source_gpu                 # source VRAM is finally freed
  7. Set model.status = 'loaded', model.gpuId = target_gpu
```

Migrations are executed **one at a time**, never in parallel. This bounds the transient VRAM overhead to at most one extra model copy across the entire cluster at any given moment. The migration budget (`MIGRATION_BUDGET`) limits how many sequential migrations occur per defrag cycle, not how many run concurrently (which is always one).

##### Failure Handling

- If a migration fails at step 2 (target load fails), the source copy is still running — **no rollback needed**. The model stays on the source GPU as if nothing happened.
- If a migration fails at step 4-5 (routing switch or drain), the target copy is unloaded and the source copy continues serving. The model reverts to `loaded` on the source GPU.
- Failed actions are logged and excluded from the next tick's planning (cooldown period)
- The executor maintains a `migration_in_progress` lock per model to prevent concurrent actions on the same model

#### 5. Wake-on-Request (Proxy Integration)

When the proxy receives a request for a sleeping model:

1. The proxy checks the model registry and finds the model in `sleeping` state
2. It sends a load request to the Controller API for the sleeping model
3. While waiting for the model to load:
   - If the request is a streaming chat completion, the proxy sends an initial SSE chunk: `data: {"choices":[{"delta":{"content":"Please wait, the model is waking up"}}]}`
   - Every 5 seconds, it sends a keep-alive chunk: `data: {"choices":[{"delta":{"content":"."}}]}`
   - For non-streaming requests, the proxy holds the connection with appropriate timeout headers
4. Once the model is loaded, the original request is forwarded normally
5. The final response chunk is sent as a regular completion

This pattern is proven in the HTTP Add-on for KEDA interceptor proxy implementation.

## Configuration

All parameters are configurable via environment variables and/or the Controller API.

### Balancer Configuration

| Parameter | Env Var | Default | Description |
|-----------|---------|---------|-------------|
| Metrics interval | `BALANCER_METRICS_INTERVAL_MS` | `5000` | How often to collect metrics (ms) |
| Tick interval | `BALANCER_TICK_INTERVAL_MS` | `10000` | How often to run the balancer loop (ms) |
| Defrag interval | `BALANCER_DEFRAG_INTERVAL_MS` | `300000` | How often to run defragmentation (ms, default 5 min) |
| Migration budget | `BALANCER_MIGRATION_BUDGET` | `2` | Max migrations per defrag cycle |
| Migration threshold | `BALANCER_MIGRATION_THRESHOLD` | `0.15` | Min pressure improvement to justify a migration |
| Enabled | `BALANCER_ENABLED` | `false` | Master switch for the balancer |
| Dry run | `BALANCER_DRY_RUN` | `true` | Log decisions without executing them |

### Heat Configuration

| Parameter | Env Var | Default | Description |
|-----------|---------|---------|-------------|
| Rate weight | `HEAT_WEIGHT_RATE` | `0.40` | Weight for request rate in heat score |
| Recency weight | `HEAT_WEIGHT_RECENCY` | `0.25` | Weight for recency in heat score |
| Priority weight | `HEAT_WEIGHT_PRIORITY` | `0.25` | Weight for configured priority in heat score |
| TTFT weight | `HEAT_WEIGHT_TTFT` | `0.10` | Weight for latency in heat score |
| Sleep threshold | `HEAT_SLEEP_THRESHOLD` | `0.10` | Models below this heat can be slept |
| Replicate threshold | `HEAT_REPLICATE_THRESHOLD` | `0.85` | Models above this heat are replication candidates |
| Idle timeout | `HEAT_IDLE_TIMEOUT_S` | `300` | Seconds of no traffic before a model's heat drops to minimum |
| Rolling window | `HEAT_ROLLING_WINDOW_S` | `300` | Window size for request rate calculation |

### Pressure Configuration

| Parameter | Env Var | Default | Description |
|-----------|---------|---------|-------------|
| KV cache weight | `PRESSURE_WEIGHT_KV` | `0.50` | Weight for KV cache in pressure score |
| VRAM weight | `PRESSURE_WEIGHT_VRAM` | `0.35` | Weight for VRAM in pressure score |
| Compute weight | `PRESSURE_WEIGHT_COMPUTE` | `0.15` | Weight for compute utilization in pressure score |
| Low watermark | `PRESSURE_LOW` | `0.30` | Below this, consider waking sleeping models |
| High watermark | `PRESSURE_HIGH` | `0.75` | Above this, begin sleeping cold models |
| Critical watermark | `PRESSURE_CRITICAL` | `0.90` | Above this, aggressive pressure relief |

## Model Lifecycle States

The balancer introduces two new model states to the existing lifecycle:

```
                    ┌────────────────────────────────┐
                    │                                │
                    ▼                                │
 ┌────────┐   ┌────────┐   ┌──────────┐            │
 │ Pending │──▶│ Loading │──▶│  Loaded  │────────────┤
 └────────┘   └────────┘   └──────────┘            │
                    ▲            │  ▲                │
                    │            │  │                ▼
                    │            │  │         ┌─────────────┐
                    │            │  └─────────│  Migrating  │
                    │            │            │ (dual-copy: │
                    │            │            │  src + tgt) │
                    │            ▼            └─────────────┘
                    │       ┌──────────┐
                    └───────│ Sleeping │
                   (wake)   └──────────┘
                                 │
                                 ▼
                            ┌──────────┐
                            │ Evicted  │
                            └──────────┘

Migration detail (Migrating state internals):
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │ Loading on   │───▶│ Switch proxy │───▶│ Drain & un-  │──▶ Loaded
  │ target GPU   │    │ routing to   │    │ load source  │    (on target)
  │ (src serves) │    │ target       │    │ GPU copy     │
  └──────────────┘    └──────────────┘    └──────────────┘
        ▲                                        │
        │          VRAM on both GPUs              │
        └────────────────────────────────────────-┘
```

| State | Description | VRAM Allocated | Routable |
|-------|-------------|:--------------:|:--------:|
| `pending` | Waiting to be loaded | No | No |
| `loading` | Model weights being loaded into VRAM | Partial | No |
| `loaded` | Fully loaded and serving requests | Yes (1 GPU) | Yes |
| `sleeping` | Unloaded from VRAM, in warm list | No | Via wake-on-request |
| `migrating` | Being moved: loaded on **both** source and target GPUs simultaneously | Yes (**2 GPUs**) | Yes (source GPU until target is ready) |
| `evicted` | Hard-removed, no automatic reload | No | No |

**Note on `migrating`:** This is the only state where a model consumes VRAM on two GPUs at once. The model remains fully routable via its source GPU copy throughout. The dual-copy cost is the reason migrations are executed sequentially and subject to strict feasibility checks.

## Observability

### Metrics (Prometheus-compatible)

```
# Balancer activity
sardeenz_balancer_ticks_total                    # Total balancer ticks executed
sardeenz_balancer_actions_total{type}            # Actions taken by type (sleep/wake/migrate/replicate/evict)
sardeenz_balancer_actions_failed_total{type}     # Failed actions by type
sardeenz_balancer_tick_duration_ms               # Time spent in each balancer tick

# Model scores
sardeenz_model_heat{model_id}                    # Current heat score per model
sardeenz_model_idle_seconds{model_id}            # Seconds since last request

# GPU scores
sardeenz_gpu_pressure{gpu_id}                    # Current pressure score per GPU
sardeenz_gpu_kv_cache_ratio{gpu_id}              # KV cache usage ratio
sardeenz_gpu_vram_ratio{gpu_id}                  # VRAM usage ratio

# Placement quality
sardeenz_placement_fragmentation_ratio           # Fragmented VRAM / total VRAM
sardeenz_sleeping_models_total                   # Number of models currently sleeping
sardeenz_migrations_total                        # Total migrations performed
```

### Event Log

Every balancer decision is logged as a structured event:

```json
{
  "timestamp": "2025-01-15T10:30:05Z",
  "tick": 12345,
  "phase": "pressure_relief",
  "action": "sleep",
  "model_id": "meta-llama/Llama-3.1-8B",
  "reason": "GPU 0 pressure 0.82 > HIGH (0.75); model heat 0.05 < SLEEP_THRESHOLD (0.10)",
  "gpu_pressure_before": 0.82,
  "gpu_pressure_after_estimate": 0.61,
  "model_heat": 0.05,
  "model_idle_seconds": 1847
}
```

### Dashboard Integration

The admin dashboard should display:

- **GPU cards**: Pressure gauge (green/yellow/red based on watermarks), loaded models with heat indicators
- **Model list**: Current state (loaded/sleeping/migrating), heat score bar, GPU assignment
- **Balancer log**: Scrollable timeline of recent actions with reasoning
- **Placement map**: Visual representation of model-to-GPU mapping with VRAM usage bars
- **Controls**: Enable/disable balancer, trigger manual defrag, adjust watermarks, override model priority

## API Extensions

### New Endpoints

```
GET  /api/balancer/status          # Balancer state, last tick info, configuration
POST /api/balancer/enable          # Enable the balancer
POST /api/balancer/disable         # Disable the balancer
POST /api/balancer/defrag          # Trigger an immediate defrag cycle
GET  /api/balancer/plan            # Preview what the balancer would do (dry run)
GET  /api/balancer/history         # Recent action history

GET  /api/models/:id/heat          # Current heat score and components
POST /api/models/:id/priority      # Set operator priority override
POST /api/models/:id/pin           # Pin model to current GPU (exempt from migration)
POST /api/models/:id/sleep         # Manually sleep a model
POST /api/models/:id/wake          # Manually wake a model
```

### Model Configuration Extension

Model presets gain new fields for balancer integration:

```json
{
  "modelId": "meta-llama/Llama-3.1-8B",
  "gpuId": 0,
  "priority": 80,
  "pinned": false,
  "autoSleep": true,
  "autoSleepIdleTimeout": 600,
  "minReplicas": 1,
  "maxReplicas": 3
}
```

## Implementation Phases

The system is designed for incremental delivery:

### Phase 1: Metrics Collection and Scoring

- Implement `MetricsCollector` with kvcached, NVML, and proxy signal sources
- Implement `SignalAggregator` with heat and pressure scoring
- Add metrics to the dashboard (GPU pressure gauges, model heat indicators)
- Add `/api/balancer/status` endpoint (read-only)
- **No automated actions** — observation only

**Deliverable:** Operators can see heat/pressure scores and understand placement quality.

### Phase 2: Sleep/Wake Lifecycle

- Add `sleeping` state to model lifecycle
- Implement pressure-relief sleep logic (Phase 1 of the solver)
- Implement wake-on-request in the proxy (placeholder chunks pattern)
- Add manual sleep/wake API endpoints
- Add `/api/balancer/enable` with `BALANCER_DRY_RUN=true` default

**Deliverable:** Models automatically sleep when idle; wake on demand with user feedback.

### Phase 3: Migration and Defragmentation

- Implement dual-copy migration execution: load on target, switch proxy routing, drain in-flight requests, unload source (with rollback if target load fails)
- Implement FFD-based defragmentation algorithm with sequential feasibility validation (each migration checked against the transient dual-copy state, not just the final state)
- Add `migrating` state to model lifecycle (model loaded on two GPUs simultaneously)
- Add migration budget and threshold controls
- Add `/api/balancer/defrag` for manual trigger
- Add placement map to dashboard showing transient dual-copy state during migrations

**Deliverable:** Automatic consolidation of models to free up GPUs for large models, with zero-downtime migrations.

### Phase 4: Replication

- Implement replica set management
- Extend proxy with replica-aware routing (round-robin / least-connections)
- Add `minReplicas` / `maxReplicas` configuration
- Add de-replication with cooldown

**Deliverable:** Hot models automatically scale across GPUs for throughput.

### Phase 5: Advanced Optimization (Future)

- Replace FFD heuristic with ILP solver (HiGHS) for smaller clusters
- Predictive heat scoring using traffic pattern analysis
- Cross-cluster placement (multiple nodes with multiple GPUs each)
- Integration with external orchestrators (KEDA, Kubernetes HPA)

## Edge Cases and Safety

### Thundering Herd

If many sleeping models receive simultaneous wake requests, the system could overload GPUs. Mitigation:
- Wake requests are queued and processed serially per GPU
- A `MAX_CONCURRENT_WAKES` limit prevents resource exhaustion
- The proxy buffers requests during wake, so clients don't retry

### Oscillation / Thrashing

A model could be repeatedly slept and woken if its traffic is bursty. Mitigation:
- Sleep cooldown: a model that was woken cannot be slept again for `SLEEP_COOLDOWN_S` (default: 300s)
- Migration cooldown: a model that was migrated cannot be migrated again for `MIGRATION_COOLDOWN_S` (default: 600s)
- Hysteresis: sleep triggers at `PRESSURE_HIGH` but wake only happens below `PRESSURE_LOW`

### Partial Failure

Because migration uses a load-then-unload protocol, failure modes are inherently safe:
- **Target load fails** (e.g., target GPU out of memory): No action needed — the source copy was never touched and continues serving traffic. The model reverts to `loaded` status on the source GPU.
- **Target loads but proxy switch fails**: The target copy is unloaded and the source copy continues serving. No traffic is lost.
- **Source unload fails after successful switch**: The target copy is already serving traffic. The dangling source copy is retried for unload on the next tick. This wastes VRAM temporarily but does not affect correctness.
- In all cases, the failed action is logged with the error, the target GPU is marked as "unreliable" for a cooldown period, and the balancer continues with remaining actions in the plan.

### GPU Failure

If a GPU becomes unresponsive:
- All models on that GPU are marked as `evicted`
- The balancer attempts to redistribute them to remaining GPUs (subject to capacity)
- An alert is raised for operator attention

### Operator Override

Operators can always override the balancer:
- **Pin** a model to a GPU (exempt from migration and sleep)
- **Manually sleep/wake** a model regardless of heat score
- **Disable** the balancer entirely
- **Dry run** mode to preview actions without executing them

## Relationship to External Systems

### kvcached

The balancer reads KV cache metrics from kvcached but does not directly manage KV cache eviction. kvcached's own eviction policy remains in effect; the balancer's role is to reduce pressure *before* kvcached needs to evict.

### vLLM

The balancer interacts with vLLM exclusively through the existing Model Manager (load/unload API). It does not modify vLLM's internal scheduling or batching behavior.

### Kubernetes / KEDA

The balancer operates *within* a single Sardeenz instance (one or more GPUs on one node). For cross-node scaling, integration with Kubernetes HPA or KEDA would be a separate concern (Phase 5). The wake-on-request pattern is directly inspired by and compatible with the KEDA HTTP Add-on interceptor proxy.
