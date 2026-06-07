# Architecture Briefing & Context Hand-off: Sardeenz × Highlander

This document serves as a comprehensive architectural briefing and context specification for a next-generation, high-density GPU workload orchestration platform. It synthesizes multiple design iterations, technical trade-offs, and critical architectural pivots made during a deep-dive engineering review, followed by an independent technical review that identified gaps, risks, and a phased delivery approach.

The primary objective of this architecture is to solve the **GPU Multi-Tenancy and Overcommitment Problem** — allowing an enterprise cluster to host and serve vastly more GPU-accelerated workloads (LLMs, diffusion models, predictive models) than physical GPUs available — without the operational footprint, latency overhead, and resource rigidity of traditional frameworks like KServe, Knative, and Istio.

> **Scope clarification:** This is not a refactor of the existing Sardeenz TypeScript codebase. It is a **new platform** where Sardeenz v1 serves as the validated prototype. The current codebase proved the viability of L7 VRAM scheduling, sleep/wake orchestration, multi-pod clustering, and OpenAI-compatible proxying. This specification defines the production-grade successor.

## 1. Executive Summary & Core Paradigm Shift

Traditional enterprise AI platforms suffer from severe infrastructure underutilization due to a fundamental mismatch between the Kubernetes scheduler and GPU workload runtime profiles:

- **Rigid GPU Allocation:** Once a Pod requests an NVIDIA GPU at the Layer 3 infrastructure tier, that hardware block and its VRAM are structurally locked to that specific Pod lifecycle. Even if the underlying engine puts a model into a deep sleep and clears VRAM, the Kubernetes scheduler cannot visibility-map or reclaim that free memory for other workloads.

- **Heavyweight Cold Starts:** Scaling a model from zero using standard patterns forces the cluster through the entire container lifecycle loop (Pod scheduling, image pulling, CUDA initialization, and CUDA graph capture), leading to unacceptable cold-start delays. In practice, deploying to a fresh node means pulling a 15GB+ container image with zero cache, adding 10-15 minutes before any model can even begin loading.

- **Engine Version Rigidity:** Testing a different inference engine version (e.g., a vLLM release that supports a new GPU architecture) requires a full container image rebuild and redeployment cycle. Each attempt costs ~15 minutes of wait time, making rapid iteration on engine compatibility impractical.

### The Pivotal Choice: A Software-Defined VRAM Controller

To bypass these constraints, we have chosen to decouple the orchestration and software lifecycle entirely from Kubernetes-level scheduling.

Instead of dynamically provisioning container workloads, entire GPU blocks are permanently allocated to monolithic, persistent Sardeenz worker processes from the start. Sardeenz moves the scheduling responsibility up to **Layer 7** (the application/process tier), acting as an intentional, software-defined application-level VRAM multiplexer. Kubernetes sees static, warm container topologies; Sardeenz sees a fluid canvas of VRAM that can be packed, dynamic-LoRA swapped, paged, or put to sleep on the fly.

## 2. Component Architecture & System Boundaries

The system is split into four strictly decoupled, specialized boundaries to enforce maximum stability, blast radius isolation, and resource budgeting.

### 2.1 The Stateless Routing Proxy Layer

**Role:** Intercepts incoming OpenAI-compatible traffic, reads headers, inspects the local routing map, and routes payloads to the optimal warm worker node.

**Technology Orientation:** Built as a multi-threaded **Rust** (`axum` / `tokio`) service, designed for performance from the start. This choice provides deterministic low-memory usage, safe multi-threaded compute (such as prompt tokenization), and eliminates potential latency variability under thousands of concurrent Server-Sent Event (SSE) streams. The proxy is on the critical path of every inference request and is the component most likely to face scale pressure first.

**Scope boundary:** The Rust proxy is strictly a stateless routing and connection management layer. All state (model registry, VRAM budgets, eviction decisions) lives in the control plane. The proxy consumes a read-only routing map and forwards requests. Cluster-aware logic (peer forwarding, circuit breaking, weighted round-robin) is in scope. Business logic is not.

**Connection Parking:** If a model is in a `SLEEPING` or `UNLOADED` state, the proxy holds the client HTTP connection open while firing a non-blocking wake-up trigger to the control plane. It retains the raw prompt payload in-memory and seamlessly transitions to the real engine stream the moment the model is reported as `READY`.

> **[OPEN DESIGN PROBLEM] Structured Output Compatibility**
>
> The original design proposed streaming OpenAI-compliant placeholder chunks (`delta.content` with status text) to keep connections alive during wake-up. However, this approach **corrupts structured output responses.** When clients use `response_format: { type: "json_object" }`, function calling, or tool use, the accumulated `delta.content` from all chunks is expected to form valid JSON. Injected status text ("Model waking up...") prepended to the real response breaks client-side parsing.
>
> **Approaches to explore:**
> - **Distinct role signaling:** Use `choices[0].delta.role: "system"` or a non-standard role for parking chunks, which clients may not concatenate into the final assistant content. Requires validation against major SDKs (Python `openai`, JS `openai`, LangChain, LiteLLM).
> - **Delayed stream start:** Don't begin the SSE stream until the model is ready. Rely on TCP keepalive and generous timeouts. Simpler, but the client sees a long hang with no feedback.
> - **Header-based signaling:** Return `X-Sardeenz-Model-State: waking` on the initial response. Smart clients can show a spinner; standard clients just wait for the stream to begin.
> - **Whitespace-only heartbeats:** Send SSE comments (`: heartbeat\n\n`) or empty data lines that keep the connection alive without injecting content into the response. SSE spec allows comment lines that clients must ignore.
>
> This must be prototyped against real SDKs before the proxy design is finalized.

### 2.2 The Sardeenz Control Plane

**Role:** Manages the global infrastructure topology map, monitors node availability, calculates VRAM budgets, and executes model eviction/activation strategies.

**Workload Deployment:** Deployed as an independent workload detached from the model runners. If built with embedded consensus/state tracking (e.g., embedded Raft or localized state sync), it runs as a StatefulSet using ordinal-based leader tracking. If offloaded to the Kubernetes API (via Custom Resource Definitions and Leases) or an external highly available cache, it runs as a stateless Deployment.

**Memory Management Loop:** The control plane coordinates directly with the persistent worker nodes. It tracks model metrics and uses an eviction algorithm (initially **Least Recently Used**) to orchestrate engine-native sleep and wake APIs. When memory is constrained, it triggers:

- **Level-1 sleep:** Paging weights from VRAM to Host System RAM via ultra-fast PCIe DMA transfers
- **Level-2 sleep:** Deep unload, freeing VRAM for incoming requests

> **Note on eviction strategy:** LRU is the initial implementation. The eviction interface should be designed as **pluggable** from the start, so future strategies (priority tiers, model pinning, cost-weighted eviction, eviction protection for A/B test candidates) can be swapped in without replumbing. Priority-based eviction and model pinning ("always hot" models) are expected requirements for production use cases where not all models have equal criticality.

### 2.3 Ephemeral Process Execution (The Highlander Integration)

**Role:** Dynamically mounts and executes specific AI engine versions inside the stationary worker pods on demand, bypassing container image boundaries.

**Technology Orientation:** Merging **Project Highlander** into the Sardeenz worker node blueprint. Highlander leverages High-Performance Computing (HPC) software management paradigms (EasyBuild and Lmod environment modules) over shared network storage.

**Motivation:** The primary driver is **eliminating container image pull as a cold-start bottleneck** when scaling to new nodes, and **enabling rapid engine version iteration** without redeployment. Secondary benefits include canary/A-B testing between engine versions against live traffic, and hot CVE patching without service interruption.

**Process-Level Isolation:** Worker container images are reduced to bare Linux/CUDA driver stubs (eliminating 15GB+ images containing PyTorch, triton, and individual vLLM versions). When the control plane signals a worker to wake up or initialize a specific model requiring vLLM v0.7.2, the worker process invokes a native `module load vllm/0.7.2`.

**Zero-Downtime Hot Upgrades:** Engine upgrades no longer require rolling infrastructure redeployments. A new engine version module can be spawned as a parallel process inside the exact same warm container footprint. The Sardeenz proxy shifts new traffic to the new process, while the old process drains its streaming connections and gracefully exits via `module unload`. This enables:

- **Canary deployments:** Route a percentage of traffic to the new engine version while monitoring metrics
- **A/B testing:** Run two engine versions side-by-side to compare performance, quality, or compatibility
- **Hot CVE patching:** Deploy a security fix without any traffic interruption

### 2.4 The Engine Plugin Interface

**Role:** Abstracts engine-specific behavior behind a common contract, enabling Sardeenz to orchestrate workloads beyond vLLM.

**Motivation:** Sardeenz v1 is tightly coupled to vLLM — process spawn commands, `/health` polling conventions, log parsing for progress extraction, sleep/wake API calls, and kvcached IPC integration are all vLLM-specific. The new platform must support multiple engine types: vLLM (LLM inference), Triton (general model serving), diffusion pipelines, predictive model runtimes, and future engines.

> **[TO BE DEFINED] Engine Contract**
>
> Each engine plugin must provide:
> - **Health check interface:** How to determine readiness (HTTP endpoint, process signal, etc.)
> - **Memory reporting:** How the engine reports current VRAM consumption
> - **Sleep/wake support:** Whether the engine supports memory offload, and the API to trigger it (optional — not all engines will support this)
> - **Lifecycle signals:** How to gracefully start, stop, and drain the engine process
> - **Log format / progress reporting:** How to extract loading progress and error information
> - **Supported optimizations:** Which platform features the engine can leverage (e.g., kvcached for KV cache sharing, tensor parallelism for multi-GPU)
>
> The current vLLM integration in Sardeenz v1 serves as the reference implementation for this contract. Extracting it into a formal interface is a prerequisite for multi-engine support.

**kvcached Integration:** kvcached (GPU memory sharing via IPC) survives as an **optional optimization layer** that engine plugins can leverage. It is not a platform-level concern — engines declare support for it, and the control plane enables it when available. Not all engines or workload types will support or benefit from kvcached.

### 2.5 Highlander Integration Model

The Highlander runtime modules and the Sardeenz orchestrator live in **separate repositories** with a clear integration boundary.

**Highlander repo** ([ODH Highlander](https://odh-highlander.github.io/)) owns the EasyBuild configurations (easyconfigs) that define how to package AI runtimes — vLLM, PyTorch, Triton, kvcached, etc. — into Lmod modules. These are built offline via EasyBuild and deployed to the shared CephFS application modules mount. Easyconfigs have their own lifecycle: adding support for vLLM 0.20.0 is a Highlander change, not a Sardeenz change.

**Sardeenz repo** consumes those modules at runtime via `module load`/`module unload`. It does not need the easyconfigs at build or runtime.

```
Highlander repo              CephFS (ROX mount)           Sardeenz control plane
                                                          
easyconfigs/                  /modules/                    engine plugin (vLLM)
  vllm-0.19.1.eb  →build→      vllm/0.19.1/               → module load vllm/0.19.1
  vllm-0.20.0.eb  →build→      vllm/0.20.0/               → module load vllm/0.20.0
  triton-2.3.eb   →build→      triton/2.3/                 → module load triton/2.3
  kvcached-0.1.5.eb →build→    kvcached/0.1.5/             → module load kvcached/0.1.5
```

**Capability discovery:** Engine capabilities (sleep/wake API, health endpoint path, memory reporting, kvcached support) are defined in the **Sardeenz engine plugin**, not in the Lmod modulefile. The plugin knows "vLLM supports sleep/wake via `/sleep` and `/wakeup`, reports health at `/health`, and supports kvcached when `ENABLE_KVCACHED=true`." The module version is just a parameter that selects which binary gets loaded. This avoids coupling Sardeenz's runtime behavior to Lmod metadata parsing and keeps the integration simple: Highlander provides the runtimes, Sardeenz knows how to drive them.

## 3. Data and Storage Architecture

To minimize model loading times and eliminate container image pull as the primary cold-start bottleneck, the architecture shifts engine runtimes and model weights to a shared high-speed data fabric.

### 3.1 Unified Network Storage File System (CephFS / ODF)

The cluster operates over a high-performance **CephFS / OpenShift Data Foundation (ODF)** backend, backed by NVMe or NVMe-over-TCP distributed nodes across a high-speed unified network fabric (25GbE / 100GbE). Storage is split cleanly into two profiles:

| Profile | Access Mode | Purpose |
|---|---|---|
| **Model Weights Mount** | Read-Write Many (RWX) | Stores raw, immutable model weights (strictly `.safetensors` to allow efficient file mapping and protect against Python execution exploits). Multiple workers stream from this shared filesystem concurrently. |
| **Application Modules Mount** | Read-Only Many (ROX) | Stores the compiled Highlander environment modules (Lmod/EasyBuild application libraries). |

> **Honest assessment of network-loaded model weights:**
>
> Loading model weights over network storage is bounded by network bandwidth. Expected load times for the raw data transfer alone (before CUDA initialization and graph capture):
>
> | Model Size | 25 GbE (~3 GB/s) | 100 GbE (~12 GB/s) |
> |---|---|---|
> | 1B (~2 GB fp16) | < 1s | < 1s |
> | 7B (~14 GB fp16) | ~5s | ~1s |
> | 70B (~140 GB fp16) | ~47s | ~12s |
>
> For small-to-medium models on a fast fabric, this is competitive with local NVMe. For large models (70B+), the network transfer adds meaningful latency. **Local NVMe caching is not eliminated as a possibility** — it is an optimization that can be layered in for specific deployment profiles where large model cold-start latency is critical. The architecture should not preclude it.

## 4. Crucial Implementation Guardrails

When refining or writing code for this architecture, the following low-level engineering constraints must be strictly adhered to.

### 4.1 Python Metadata Storm Mitigation

Because Python runtimes execute thousands of small recursive directory lookups during initialization and module imports, streaming Python environments over a network file system like CephFS can cause an intense **metadata storm** on the Ceph Metadata Servers (MDS).

> **Requirement:** The Highlander storage implementation must utilize aggressive client directory caching, or flatten the runtime module directory trees into single file descriptors using optimized loopback images (such as `squashfs` or `erofs`) inside the module path structures.

### 4.2 Compiler and Environment Path Isolation

When multiple independent engine processes or model instances run concurrently inside the same Highlander worker container namespace, their runtime compiler layers (like Triton) and weight validation checks will attempt to write temporary artifacts to default user paths.

> **Requirement:** The Sardeenz worker layout must explicitly override and isolate environment variables — specifically `HF_HOME`, `XDG_CACHE_HOME`, and `TRITON_CACHE_DIR` — pointing them to independent, node-local `emptyDir` volumes or in-memory targets unique to each executing process instance. This prevents concurrent file-locking corruption.

### 4.3 Thundering Herd Prevention

If a sudden burst of requests hits the proxy layer for the same sleeping model simultaneously, uncoordinated execution would pass multiple independent wake-up signals to the control plane, thrashing the VRAM budget allocation engine.

> **Requirement:** The proxy layer must implement localized request deduplication (e.g., an in-memory token/mutex bucket system per `ModelID`). The first request triggers the control plane `TriggerModelLoad` event and locks the state; subsequent matching requests are instantly placed directly into the connection parking holding pattern without touching the control plane API.

### 4.4 Structured Output Safety

Client-side SDKs (e.g., official Python/JS OpenAI libraries) employ rigid JSON parsers and concatenate all `delta.content` values into a single response string. Any content injected by the proxy during connection parking will be prepended to the actual model response.

> **Requirement:** The connection parking mechanism must not inject any data into the `delta.content` field of the response stream. The solution to this constraint is tracked as an open design problem (see Section 2.1).

## 5. Repository Structure & Cross-Language Contracts

The platform lives in a **new repository**, separate from the Sardeenz v1 codebase. The v1 repo remains intact as a living reference for cherry-picking UI components and implementation patterns. This document (`docs/refactor/refactor-brief.md`) moves to the new repo's `docs/` as the founding design document.

Within the new repo, the project is organized as a **monorepo** with clear directory boundaries per component. This keeps cross-cutting changes atomic (a contract change is one commit, not three coordinated PRs), gives AI-assisted development full project visibility, and allows easy extraction of components later if needed (e.g., if parts merge into llm-d).

```
sardeenz/
├── proxy/                  # Rust (axum/tokio) — cargo workspace root
├── control-plane/          # TypeScript (Fastify)
├── dashboard/              # TypeScript (React + PatternFly 6, Vite)
├── packages/
│   ├── contracts/          # OpenAPI specs (single source of truth)
│   ├── types/              # Generated TypeScript types from OpenAPI
│   └── utils/              # Shared TypeScript utilities
├── plugins/
│   └── vllm/               # First engine plugin (reference implementation)
├── deployment/             # K8s manifests, Containerfiles
├── docs/
├── Makefile                # Build, dev, test across all components
└── package.json            # npm workspaces for TypeScript components
```

### 5.1 Cross-Language Type Safety via OpenAPI

The Rust proxy and TypeScript control plane share type definitions through **OpenAPI specifications** maintained in `packages/contracts/`. This is the single source of truth for all inter-component communication schemas.

**Code generation pipeline:**

| Target | Tooling | Output |
|---|---|---|
| **Rust proxy** | `openapi-generator` or `utoipa` (compile-time) | Rust structs + (de)serialization for routing map, health status, proxy ↔ control plane API |
| **TypeScript control plane** | `openapi-typescript` | TypeScript types for the control plane API surface |
| **TypeScript dashboard** | `openapi-typescript` | TypeScript types + fetch client for dashboard ↔ control plane communication |

**Contracts cover:**

- **Proxy ↔ Control Plane:** Routing map schema (model → endpoint mappings, model states, sleep levels), wake-up trigger API, health/metrics reporting
- **Dashboard ↔ Control Plane:** Model lifecycle operations, VRAM budget views, engine module management, cluster state, real-time event streams (SSE)
- **Engine Plugin Contract:** Health check, memory reporting, lifecycle signals, capability declaration (defined in Phase 0, expressed as OpenAPI schemas)

**Workflow:** Edit the OpenAPI spec in `packages/contracts/` → run code generation → both Rust and TypeScript components get updated types. A CI check ensures generated code is never out of sync with the spec.

## 6. Delivery Phases

This platform is delivered in phases, each independently valuable and validatable. Dependencies between phases are explicitly marked. Target: end of August 2026.

### Phase 0: Engine Plugin Interface Design

**Scope:** Define the engine abstraction contract based on the current vLLM integration in Sardeenz v1. This is a design exercise — specification documents and interface types, not runtime code.

**Deliverable:** A formal engine plugin specification that defines health checking, memory reporting, lifecycle management, sleep/wake support, log/progress extraction, and optional optimization declaration (kvcached, tensor parallelism).

**Why first:** Every subsequent phase depends on this boundary. The Rust proxy needs to know what the engine reports. The control plane needs to know what levers it can pull. Highlander needs to know what to wire up when loading a module.

### Phase 1: Rust Proxy with Connection Parking

**Scope:** The stateless routing proxy — request routing, weighted round-robin, cluster forwarding, circuit breaking, connection parking for sleeping models, thundering herd dedup.

**Dependency:** Requires a resolved approach for the structured output compatibility problem (Section 2.1).

**Deliverable:** A standalone Rust binary that consumes a routing map from the control plane and proxies OpenAI-compatible traffic to engine instances. Can be validated against the existing Sardeenz v1 TypeScript control plane.

**Why second:** Most self-contained component. Can be developed and load-tested independently. Highest immediate value for performance-critical deployments.

### Phase 2: Control Plane Sleep/Wake Orchestration

**Scope:** VRAM budget tracking, LRU eviction engine (behind a pluggable interface), sleep/wake coordination with engine plugins, model lifecycle state machine.

**Dependency:** Phase 0 (engine contract). Can be prototyped against the existing Sardeenz v1 TypeScript codebase before Highlander exists.

**Deliverable:** A control plane that can dynamically sleep, wake, and evict models based on VRAM pressure and incoming request patterns.

### Phase 3: Admin Dashboard (Fresh Build)

**Scope:** New React + PatternFly 6 frontend built from a clean scaffold, designed around the new platform's domain model. Individual UI components proven in Sardeenz v1 (GPU memory visualization, model loading progress, cluster topology) are ported as needed — the application shell, routing, data-fetching layer, and auth flow are built new.

**Rationale:** The v1 frontend is tightly coupled to a single-instance Fastify backend that serves both API and static assets. The new platform has a fundamentally different communication architecture (Rust proxy, separate control plane, Highlander workers), different state model (sleep levels, engine plugin types, VRAM budgets, module versions, canary traffic splits), and different auth topology. Retrofitting these changes into the existing app costs more than a fresh build and produces a worse result. Six months of customer demos have validated which UI patterns work — those are carried forward; the plumbing is not.

**Approach:**
- Clean Vite + React + PatternFly 6 scaffold
- Navigation and page structure designed for the new domain model from day one
- Data layer built for the new API surface (control plane endpoints, proxy health/metrics, Highlander module state)
- Cherry-pick proven v1 components: GPU cards, model status panels, memory visualizations, benchmark views
- Preserve the UX simplicity that customers responded well to — straightforward model management that doesn't require Kubernetes/YAML expertise

**Dependency:** Phase 2 (control plane API surface must be stable enough to build against).

**Deliverable:** A production-ready admin dashboard that covers model lifecycle, VRAM budgeting, engine module management, cluster overview, and real-time monitoring.

### Phase 4: Highlander Runtime Integration

**Scope:** Lmod/EasyBuild integration in worker containers, CephFS mount architecture, module load/unload IPC from control plane, squashfs/erofs packaging for metadata storm mitigation.

**Dependency:** Phase 0 (engine contract), CephFS/ODF infrastructure availability (external dependency).

**Deliverable:** Slim worker containers that dynamically compose engine runtimes from shared network storage, supporting multiple engine versions and types simultaneously.

**Reference:** [ODH Highlander](https://odh-highlander.github.io/) — the HPC-style module management system this phase integrates.

## 7. Open Questions & Future Work

| Item | Status | Notes |
|---|---|---|
| Connection parking and structured output compatibility | **Open design problem** | Must be resolved before Phase 1 proxy design is finalized. Prototype against Python/JS OpenAI SDKs. |
| Eviction priority tiers and model pinning | **Future work** | LRU is sufficient initially. Interface should be pluggable. |
| Multi-accelerator support (AMD, Intel) | **Future work** | Highlander's module system is accelerator-agnostic in principle, but CUDA-specific assumptions exist throughout. |
| Local NVMe caching for large models | **Future work** | Not precluded by the architecture. Worth evaluating for 70B+ models on 25GbE fabrics. |
| Admission control and backpressure | **Not yet addressed** | What happens when the cluster is at full VRAM capacity and LRU eviction itself takes 30+ seconds? Queue depth limits, timeout policies, and rejection strategies need definition. |
| kvcached generalization | **Future work** | Currently vLLM-specific. If other engines can benefit from shared KV caches, the IPC interface may need abstraction. |
