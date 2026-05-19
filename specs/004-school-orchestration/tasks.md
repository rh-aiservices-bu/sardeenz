# Tasks: School of Sardeenz

**Input**: Design documents from `/specs/004-school-orchestration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Integration and contract tests included in Phase 11 per constitution VII mandate.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## User Story Mapping

| Story | Title | Priority | Phase |
|---|---|---|---|
| US1 | Centralized Model Management Across Pods | P1 | 5 |
| US2 | Distributed Inference Proxy | P1 | 6 |
| US3 | Auto-Discovery of Pods | P2 (prerequisite for P1) | 3 |
| US4 | Seamless User Access | P2 | 7 |
| US5 | Cross-Pod Model Move | P2 | 8 |
| US6 | Declarative Model Presets with Scheduling | P3 | 9 |
| US7 | Single-Pod Backward Compatibility | P1 | 4 |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define shared types, install dependencies, and extend configuration for cluster support

- [x] T001 Install `@kubernetes/client-node` dependency in apps/backend via `npm install @kubernetes/client-node -w apps/backend`
- [x] T002 Define all cluster types (ClusterState, PeerInfo, PeerModelEntry, PeerGpuInfo, ClusterRoutingTable, RoutingEntry, HeartbeatMessage, HeartbeatAck, ClusterEvent, PlacementDecision, PlacementFailure) in packages/types/src/cluster.ts per data-model.md
- [x] T003 [P] Export cluster types from packages/types/src/index.ts and rebuild packages/types
- [x] T004 [P] Add podId field to ModelInstance type in packages/types/src/models.ts (or equivalent existing model type file)
- [x] T005 [P] Extend backend config with CLUSTER_PEERS, CLUSTER_SECRET, and CLUSTER_EXPECTED_PODS environment variables in apps/backend/src/config.ts per quickstart.md

**Checkpoint**: Shared types available, backend config supports cluster environment variables

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Implement HMAC-SHA256 signing and verification service (signRequest, verifyRequest using Node.js crypto, timingSafeEqual, 30s replay protection, dual-secret rotation support) in apps/backend/src/services/cluster-auth.ts per research.md Section 5
- [x] T007 Create Fastify onRequest hook plugin for HMAC verification on /internal/* routes in apps/backend/src/plugins/cluster-auth.ts (imports from cluster-auth.ts, requires T006)
- [x] T008 [P] Implement PeerStore (in-memory Map of PeerInfo, health state transitions: healthy→suspect→unavailable, add/remove/update peers) in apps/backend/src/stores/peer-store.ts per data-model.md PeerInfo entity
- [x] T009 [P] Implement ClusterRoutingStore (in-memory Map<modelName, RoutingEntry[]>, version counter, rebuild from peer model lists, weighted entries with local=2/remote=1) in apps/backend/src/stores/cluster-routing-store.ts per data-model.md ClusterRoutingTable entity
- [x] T010 Create skeleton /internal/* route file with cluster-auth plugin registration in apps/backend/src/routes/internal.ts
- [x] T011 [P] Create skeleton /api/cluster/* route file with JWT auth in apps/backend/src/routes/cluster.ts

**Checkpoint**: Foundation ready - auth, stores, and route skeletons in place. User story implementation can now begin.

---

## Phase 3: US3 - Auto-Discovery of Pods (Priority: P2, prerequisite for P1 stories)

**Goal**: Pods automatically discover each other, form a cluster, and elect a leader without manual configuration. Supports both Kubernetes (API watch) and static peer list (CLUSTER_PEERS env var).

**Independent Test**: Deploy 2+ Sardeenz pods (or use static peer list locally). Verify each new pod appears in the cluster automatically. Kill leader pod and verify re-election within 30s.

### Implementation for US3

- [x] T012 [US3] Define PeerDiscovery interface (onPeerAdded, onPeerRemoved, start, stop callbacks) and implement KubernetesPeerDiscovery using @kubernetes/client-node (loadFromCluster, watch pods with labelSelector=app=sardeenz, handle ADDED/MODIFIED/DELETED events) in apps/backend/src/services/peer-discovery.ts per research.md Section 1
- [x] T013 [US3] Implement StaticPeerDiscovery (parse CLUSTER_PEERS env var, periodic health check polling) in apps/backend/src/services/peer-discovery.ts
- [x] T014 [US3] Implement discovery mode detection: (1) K8s env detected → KubernetesPeerDiscovery, (2) CLUSTER_PEERS set → StaticPeerDiscovery, (3) neither → single-instance mode, in apps/backend/src/services/peer-discovery.ts
- [x] T015 [US3] Implement K8s Lease-based leader election (acquire/renew Lease via coordination.k8s.io/v1, resourceVersion for optimistic concurrency, term tracking) in apps/backend/src/services/leader-election.ts per research.md Section 2
- [x] T016 [US3] Implement heartbeat-based fallback leader election for non-K8s (bully algorithm: lowest podId wins, majority quorum requirement per research.md Section 4 quorum table) in apps/backend/src/services/leader-election.ts
- [x] T017 [US3] Implement heartbeat sender/receiver (5s interval with startup jitter, 2s HTTP timeout, send to all known peers, update PeerStore timestamps on receive) in apps/backend/src/services/heartbeat.ts per research.md Section 3
- [x] T018 [US3] Implement heartbeat failure detection reaper (5s timer, mark suspect after 1 miss, unavailable after 3 misses/15s, update PeerStore and ClusterRoutingStore on peer loss) in apps/backend/src/services/heartbeat.ts
- [x] T019 [US3] Implement ClusterManager service (orchestrates PeerDiscovery, LeaderElection, Heartbeat lifecycle; maintains ClusterState; exposes isClusterMode, isLeader, getClusterState) in apps/backend/src/services/cluster-manager.ts
- [x] T020 [US3] Implement POST /internal/heartbeat endpoint (receive heartbeat, update PeerStore, return HeartbeatAck with own term/role) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T021 [US3] Implement GET /internal/state endpoint (return full pod state: models, GPUs, routing table version) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T022 [US3] Implement POST /internal/cluster/event endpoint (receive immediate cluster events: model-loaded, model-unloaded, leader-elected, pod-joined, pod-left) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T023 [US3] Register ClusterManager as Fastify plugin in apps/backend/src/server.ts (initialize after existing services, graceful shutdown with AbortController)

**Checkpoint**: Pods discover each other, elect a leader, exchange heartbeats. Single-pod mode works with cluster machinery dormant.

---

## Phase 4: US7 - Single-Pod Backward Compatibility (Priority: P1)

**Goal**: A single-pod deployment operates identically to pre-cluster behavior with no configuration required and no measurable performance overhead. Cluster features activate automatically when a second pod joins.

**Independent Test**: Deploy a single Sardeenz pod with new version. Verify all existing functionality (dashboard, model loading, inference proxy, benchmarks) works identically. No cluster-related config needed.

### Implementation for US7

- [x] T024 [US7] Add cluster mode guards in ClusterManager: skip heartbeat timer, discovery polling, and leader election when no peers detected; auto-activate on first peer discovery event in apps/backend/src/services/cluster-manager.ts
- [x] T025 [US7] Ensure ClusterRoutingStore falls through to local-only routing when not in cluster mode (zero overhead path: if !isClusterMode, return local model directly) in apps/backend/src/stores/cluster-routing-store.ts
- [x] T026 [US7] Verify existing proxy behavior is unchanged in single-pod mode: no X-Sardeenz-Forwarded header injection, no undici.Pool creation, no cross-pod lookup in apps/backend/src/services/proxy-router.ts
- [x] T027 [US7] Ensure /api/cluster endpoints return graceful single-pod responses (e.g., GET /api/cluster returns isClusterMode: false, podCount: 1) in apps/backend/src/routes/cluster.ts
- [x] T027a [US7] Ensure proxy-router continues serving locally-loaded models when cluster mode is active but peers are unreachable (FR-012): if ClusterRoutingStore lookup fails for remote pods, fall back to local-only routing without error for local models in apps/backend/src/services/proxy-router.ts

**Checkpoint**: Single-pod deployment works identically to pre-cluster version. All existing tests pass.

---

## Phase 5: US1 - Centralized Model Management Across Pods (Priority: P1)

**Goal**: Admin opens one dashboard URL and sees all pods + models across the entire cluster. Can load/unload models on any pod from this single interface with real-time progress.

**Independent Test**: Deploy 2+ pods, connect to dashboard, verify all pods and models appear. Load a model on a remote pod from the central UI and confirm real-time progress.

### Implementation for US1 (Backend)

- [x] T028 [US1] Implement GET /api/cluster endpoint (return ClusterStatus: clusterId, podCount, healthyPodCount, leaderId, term, totalModelsLoaded, health) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T029 [US1] Implement GET /api/cluster/pods endpoint (return all pods with GPU details, loaded models, health status from PeerStore) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T030 [US1] Implement GET /api/cluster/pods/:podId/models endpoint in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T031 [US1] Implement POST /internal/models/load endpoint (receive remote load command from leader, invoke local ModelManager, return instanceId) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T032 [US1] Implement POST /internal/models/:id/unload endpoint (receive remote unload command from leader, invoke local ModelManager) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T033 [US1] Implement GET /internal/models/:id/events SSE relay endpoint (proxy local model events to leader for dashboard display) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T034 [US1] Implement POST /api/cluster/models/load endpoint (leader orchestrates: validate target pod, send /internal/models/load to follower, relay SSE progress) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T035 [US1] Implement POST /api/cluster/models/:id/unload endpoint (leader sends /internal/models/:id/unload to appropriate pod) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T036 [US1] Implement GET /api/cluster/models/:id/events endpoint (if model is local serve directly, if remote relay from follower's /internal/models/:id/events SSE) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T037 [US1] Extend model-manager.ts to emit ClusterEvents (model-loaded, model-unloaded) to all peers via POST /internal/cluster/event on successful load/unload in apps/backend/src/services/model-manager.ts

### Implementation for US1 (Frontend)

- [x] T038 [P] [US1] Add cluster API methods (getClusterStatus, getClusterPods, clusterLoadModel, clusterUnloadModel, clusterModelEvents) in apps/frontend/src/services/api.ts
- [x] T039 [P] [US1] Create useClusterStatus hook (poll GET /api/cluster every 10s, expose cluster state and isClusterMode flag) in apps/frontend/src/hooks/useClusterStatus.ts
- [x] T040 [US1] Create ClusterOverview component (pod health cards showing role, status, GPU utilization, model count per pod) in apps/frontend/src/components/ClusterOverview.tsx
- [x] T041 [P] [US1] Create PodSelector component (dropdown or radio to select target pod for model operations, shows pod GPU capacity) in apps/frontend/src/components/PodSelector.tsx
- [x] T042 [US1] Extend ModelManagement.tsx with multi-pod view: group models by pod, show pod headers with GPU info, conditional cluster UI when isClusterMode in apps/frontend/src/pages/ModelManagement.tsx
- [x] T043 [US1] Extend LoadModelDialog.tsx with PodSelector for choosing target pod (only shown in cluster mode) in apps/frontend/src/components/LoadModelDialog.tsx

**Checkpoint**: Admin can view all pods and models in one dashboard, load/unload models on any pod with real-time progress.

---

## Phase 6: US2 - Distributed Inference Proxy (Priority: P1)

**Goal**: Inference requests sent to any pod's endpoint are transparently routed to the correct pod where the model is loaded. Cross-pod forwarding goes directly to vLLM port (bypassing remote proxy).

**Independent Test**: Load a model on Pod A. Send inference requests to Pod B's address for that model. Verify requests succeed with <100ms routing overhead.

### Implementation for US2

- [x] T044 [US2] Implement undici.Pool management (create/destroy pools per remote pod, connection keep-alive, pool cleanup on peer removal) in apps/backend/src/services/proxy-router.ts per research.md Section 6
- [x] T045 [US2] Implement cross-pod request forwarding logic: lookup model in ClusterRoutingStore, forward to remote pod's vLLM port directly (FR-008 bypass), raw body forwarding without re-parsing in apps/backend/src/services/proxy-router.ts
- [x] T046 [US2] Add X-Sardeenz-Forwarded header for loop detection: inject on forward, reject requests already carrying this header in apps/backend/src/services/proxy-router.ts
- [x] T047 [US2] Implement streaming response relay for cross-pod forwarding (pipe SSE/chunked transfer from remote vLLM back to caller without buffering, handle mid-stream disconnection with error event) in apps/backend/src/services/proxy-router.ts
- [x] T048 [US2] Implement weighted round-robin model selection (local weight=2, remote weight=1) when model is loaded on multiple pods in apps/backend/src/services/proxy-router.ts per research.md Section 7
- [x] T049 [US2] Add per-pod circuit breaker (3 failures in 30s triggers 15s cooldown, error-driven routing entry invalidation) in apps/backend/src/services/proxy-router.ts per research.md Section 7
- [x] T050 [US2] Extend apps/backend/src/routes/proxy.ts to integrate cross-pod forwarding: check ClusterRoutingStore before returning 404, forward if model found on remote pod
- [x] T051 [US2] Implement GET /api/cluster/routing-table endpoint (return current routing table with version) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml

**Checkpoint**: Inference requests are transparently routed across pods. Model on any pod is accessible from any entry point.

---

## Phase 7: US4 - Seamless User Access (Priority: P2)

**Goal**: Users access a single stable URL for both dashboard and inference. Follower pods redirect dashboard requests to the leader. Leader failover is transparent.

**Independent Test**: Access dashboard through Service URL. Kill leader pod. Verify dashboard becomes available at same URL after re-election (<30s).

### Implementation for US4

- [x] T052 [US4] Implement follower → leader redirect: intercept dashboard/admin requests on follower pods, return 307 redirect to leader's address in apps/backend/src/routes/cluster.ts or a dedicated middleware
- [x] T053 [US4] Add leader address resolution for redirects: use ClusterManager.getLeaderAddress() to build redirect URL, handle case where leader is unknown (return 503) in apps/backend/src/routes/cluster.ts
- [x] T054 [US4] Handle frontend reconnection on leader change: detect leader change in useClusterStatus hook, show reconnection banner, auto-redirect to new leader in apps/frontend/src/hooks/useClusterStatus.ts

**Checkpoint**: Single URL works for all access. Leader failover is transparent to users.

---

## Phase 8: US5 - Cross-Pod Model Move (Priority: P2)

**Goal**: Admin can move a model from any pod to any other pod via the dashboard. Inference continues on source pod until move completes, then routes to destination.

**Independent Test**: Load model on Pod A. Initiate move to Pod B via dashboard. Verify model loads on Pod B, unloads from Pod A, and routing table updates correctly.

### Implementation for US5

- [x] T055 [US5] Extend model-mover.ts with cross-pod move logic: (1) load model on target pod via /internal/models/load, (2) wait for target ready, (3) drain active requests on source, (4) update routing table, (5) unload from source via /internal/models/:id/unload in apps/backend/src/services/model-mover.ts
- [x] T056 [US5] Implement POST /api/cluster/models/:id/move endpoint (validate target pod capacity, distinguish intra-pod vs cross-pod move, delegate to model-mover) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T057 [US5] Implement routing table continuity during cross-pod move: keep source routing entry active until target is ready, then atomically swap to destination in apps/backend/src/stores/cluster-routing-store.ts
- [x] T058 [US5] Extend MoveModelDialog.tsx with cross-pod destination selection: show PodSelector when in cluster mode, display target pod GPU capacity and availability in apps/frontend/src/components/MoveModelDialog.tsx

**Checkpoint**: Models can be moved between any pods. Inference continuity maintained during moves.

---

## Phase 9: US6 - Declarative Model Presets with Scheduling (Priority: P3)

**Goal**: Admin creates a preset (list of desired models + requirements), applies it, and the system automatically determines optimal placement across pods using memory profiles. Reports unplaceable models.

**Independent Test**: Create preset with 4 models. Apply to 2-pod cluster. Verify models distributed across pods based on GPU resources and memory profiles.

### Implementation for US6 (Backend)

- [x] T059 [US6] Add placement_strategy, min_kv_cache_mb, and version columns to model_configurations table AND gpu_type_constraint, min_vram_mb columns to model_configuration_entries table via SQLite migrations in apps/backend/src/stores/model-configuration-store.ts per data-model.md ModelPreset/ModelPresetEntry
- [x] T061 [P] [US6] Add gpu_type, gpu_vram_mb, and source_pod_id columns to memory profiles table via SQLite migration in apps/backend/src/stores/memory-profile-store.ts per data-model.md MemoryProfile
- [x] T062 [US6] Implement PodScheduler: placement algorithm that collects cluster GPU state + memory profiles, applies placement strategy (maximize-models or balanced), respects gpu_type_constraint and min_kv_cache_mb, returns PlacementDecision[] and PlacementFailure[] in apps/backend/src/services/pod-scheduler.ts per spec.md US6 acceptance scenarios
- [x] T063 [US6] Implement preset reconciliation logic: diff current cluster state against preset desired state, determine models to unload (not in preset) and models to load (missing), feed missing models to PodScheduler in apps/backend/src/services/pod-scheduler.ts
- [x] T064 [US6] Implement POST /api/cluster/presets/:id/apply endpoint (reconcile + schedule + execute, support dryRun flag, return PresetApplicationResult) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T065 [US6] Implement POST /internal/presets/sync endpoint (receive preset list from leader, upsert using version numbers for conflict resolution) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T066 [US6] Implement preset replication: on preset create/update, push to all peers via POST /internal/presets/sync in apps/backend/src/stores/model-configuration-store.ts
- [x] T067 [US6] Implement GET /internal/memory-profiles endpoint (return all local memory profiles for reconciliation) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T068 [US6] Implement POST /internal/memory-profiles endpoint (receive profiles from peers, upsert matching model+GPU) in apps/backend/src/routes/internal.ts per internal-api.yaml
- [x] T069 [US6] Implement POST /api/cluster/memory-profiles/reconcile endpoint (collect profiles from all pods, deduplicate, distribute unified set) in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T070 [US6] Implement GET /api/cluster/memory-profiles/export and POST /api/cluster/memory-profiles/import endpoints in apps/backend/src/routes/cluster.ts per cluster-admin-api.yaml
- [x] T071 [US6] Auto-push new memory profiles to all peers on profile creation (extend existing profiling flow to call POST /internal/memory-profiles on all peers) in apps/backend/src/stores/memory-profile-store.ts

### Implementation for US6 (Frontend)

- [x] T072 [US6] Create ApplyPresetDialog component with placement preview (dry-run first, show placement plan with pod/GPU assignments, highlight unplaceable models with reasons, confirm to execute) in apps/frontend/src/components/ApplyPresetDialog.tsx
- [x] T073 [US6] Add cluster preset API methods (applyPreset with dryRun, reconcileProfiles, exportProfiles, importProfiles) in apps/frontend/src/services/api.ts
- [x] T074 [US6] Extend preset creation/edit UI to include placement_strategy selector and min_kv_cache_mb input (only shown in cluster mode) in relevant preset form component

**Checkpoint**: Presets can be applied with automatic scheduling. Memory profiles sync across pods. Placement decisions are explainable.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T075 [P] Add comprehensive error handling for inter-pod communication failures (connection refused, timeout, HMAC rejection) with structured logging across all /internal/* callers
- [x] T076 [P] Add cluster health diagnostics logging: heartbeat send/receive, peer state transitions, leader election events, routing table changes
- [x] T077 Security hardening: validate CLUSTER_SECRET minimum length, audit HMAC implementation for timing attacks, ensure /internal/* routes are not exposed via external Service
- [x] T078 [P] Benchmark export/import: implement GET /api/benchmarks/export and POST /api/benchmarks/import for backup/restore per FR-032 in apps/backend/src/routes/cluster.ts
- [x] T079 Run quickstart.md verification steps (multi-pod local dev, cross-pod routing, leader failover, preset scheduling)
- [x] T080 Create Kubernetes manifest templates: StatefulSet (with GPU resource requests), headless Service (for direct pod addressing), RBAC Role + RoleBinding (pods get/list/watch, leases get/create/update/list/watch), and sample ConfigMap/Secret for CLUSTER_SECRET per research.md Sections 1-2 in deploy/kubernetes/

---

## Phase 11: Testing (Constitution VII Compliance)

**Purpose**: Integration and contract tests mandated by the project constitution (Principle VII: Simplicity & Pragmatism)

- [x] T081 [P] Contract tests for /internal/* endpoints (heartbeat, state, cluster/event, models/load, models/:id/unload, models/:id/events, memory-profiles, presets/sync) against internal-api.yaml schemas using Vitest
- [x] T082 [P] Contract tests for /api/cluster/* endpoints (cluster status, pods, models, load, unload, move, events, routing-table, presets/apply, memory-profiles/*) against cluster-admin-api.yaml schemas using Vitest
- [x] T083 Integration tests for cross-pod proxy routing: mock two-pod cluster, verify routing table lookup, cross-pod forwarding, streaming relay, loop detection (X-Sardeenz-Forwarded), circuit breaker behavior in apps/backend
- [x] T084 Integration tests for cluster model management: mock leader-follower topology, verify remote load/unload via /internal/* endpoints, SSE event relay, routing table updates on model state changes in apps/backend
- [x] T085 Integration tests for auto-discovery and leader election: verify K8s discovery mock, static peer list parsing, leader election with term tracking, heartbeat failure detection and peer state transitions in apps/backend
- [x] T086 Integration tests for single-pod backward compatibility: verify zero cluster overhead, no heartbeat/discovery timers, local-only routing, graceful /api/cluster responses when no peers present in apps/backend

**Checkpoint**: All mandatory integration and contract tests pass. Constitution VII compliance verified.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (needs cluster types) - BLOCKS all user stories
- **US3 (Phase 3)**: Depends on Phase 2 - BLOCKS US1, US2, US4, US5, US7 (cluster formation is prerequisite)
- **US7 (Phase 4)**: Depends on Phase 3 (needs ClusterManager to add guards to). **MUST complete before Phase 6** (both modify proxy-router.ts)
- **US1 (Phase 5)**: Depends on Phase 3 (needs cluster formation, heartbeats, peer store). **Note**: T051 (Phase 6, cluster.ts) must wait for US1's cluster.ts tasks (T028-T036) to complete — see Shared File Dependencies below.
- **US2 (Phase 6)**: Depends on Phase 3 + **Phase 4** (Phase 4 modifies proxy-router.ts which Phase 6 extends heavily)
- **US4 (Phase 7)**: Depends on Phase 3 (needs leader election) + Phase 5 (needs cluster admin routes)
- **US5 (Phase 8)**: Depends on Phase 5 (needs centralized management) + Phase 6 (needs routing table updates)
- **US6 (Phase 9)**: Depends on Phase 5 (needs centralized management) + Phase 8 (needs model move capability)
- **Polish (Phase 10)**: Depends on all desired user stories being complete
- **Testing (Phase 11)**: Depends on Phase 10 (all implementation complete). Contract tests (T081, T082) can start after Phase 5. Integration tests require respective phases complete.

### User Story Dependencies

- **US3 (Auto-Discovery)**: Can start after Phase 2 - No dependencies on other stories. **PREREQUISITE for US1, US2, US4, US7.**
- **US7 (Backward Compat)**: Can start after US3 - Validates that cluster machinery is dormant in single-pod mode. **Must complete before US2** (shared proxy-router.ts).
- **US1 (Centralized Mgmt)**: Can start after US3 + US7 - No dependency on US2.
- **US2 (Distributed Proxy)**: Can start after US3 + **US7**. **Can run in parallel with US1**, except T051 (cluster.ts) must wait for US1's T036.
- **US4 (Seamless Access)**: Can start after US3 + US1 - Needs leader redirect + cluster admin routes.
- **US5 (Cross-Pod Move)**: Can start after US1 + US2 - Needs both management and routing.
- **US6 (Declarative Presets)**: Can start after US5 - Needs model placement + move capabilities.

### Within Each User Story

- Backend routes before frontend components (frontend calls backend)
- Stores/services before routes (routes use stores)
- Core implementation before integration
- Story complete before moving to dependent stories

### Parallel Opportunities

- **Phase 1**: T003, T004, T005 can run in parallel (different files), all after T002
- **Phase 2**: T008, T009 can run in parallel (different files), both after T007; T010, T011 can run in parallel
- **Phase 3**: Mostly sequential (same-file chains). T021, T022 sequential after T020 (all internal.ts)
- **Phase 5**: T038, T039, T041 parallel (different frontend files); backend tasks are sequential (shared cluster.ts and internal.ts)
- **Phase 6**: T044-T049 are sequential (all proxy-router.ts); T051 after T050 (T051 writes to cluster.ts, must wait for US1 cluster.ts tasks)
- **Phase 9**: T059+T061 parallel (different store files); T067, T068 sequential (both internal.ts); T070 after T069 (both cluster.ts)
- **US1 backend and US2 backend can be developed in parallel** after Phase 4 completes, with the constraint that T051 (US2, cluster.ts) must wait for T036 (US1, last cluster.ts task). US1 frontend can also run in parallel with US2 backend.

### Shared File Dependencies

**IMPORTANT**: These files are modified across multiple phases. When phases run in parallel, tasks on the same file MUST be serialized:

| File | Tasks | Cross-Phase Constraint |
|------|-------|----------------------|
| `routes/cluster.ts` | T011, T027-T030, T034-T036, T051, T052-T053, T056, T064, T069-T070, T078 | T051 (Phase 6) blockedBy T036 (Phase 5) |
| `routes/internal.ts` | T010, T020-T022, T031-T033, T065, T067-T068 | Phases are sequential — no cross-phase conflict |
| `services/proxy-router.ts` | T026, T027a, T044-T049 | Phase 6 blockedBy Phase 4 (enforced above) |
| `stores/model-configuration-store.ts` | T059, T066 | Sequential within Phase 9 |

---

## Parallel Example: US1 + US2 After Phase 4

```text
# After Phase 4 (US7) is complete, launch US1 and US2 in parallel:
# Phase 4 must complete first because it modifies proxy-router.ts (T026, T027a)

# Stream 1 (US1 - Centralized Management):
Task: T028-T030 "cluster.ts endpoints (sequential, same file)"
Task: T031-T033 "internal.ts endpoints (sequential, same file)"
Task: T034-T036 "cluster.ts endpoints continued (sequential, same file)"
Task: T037 "model-manager.ts cluster events"
  ... then frontend tasks T038-T043 (can overlap with Stream 2)

# Stream 2 (US2 - Distributed Proxy):
Task: T044-T049 "proxy-router.ts cross-pod routing (sequential, same file)"
Task: T050 "proxy.ts integration"
Task: T051 "cluster.ts routing-table endpoint" ← MUST wait for T036 (Stream 1)
```

---

## Implementation Strategy

### MVP First (US3 + US7 + US1 + US2)

1. Complete Phase 1: Setup (types, config, dependencies)
2. Complete Phase 2: Foundational (auth, stores, route skeletons)
3. Complete Phase 3: US3 - Auto-Discovery (pods find each other, elect leader)
4. Complete Phase 4: US7 - Verify single-pod backward compatibility
5. Complete Phase 5: US1 - Centralized Management (dashboard shows all pods)
6. Complete Phase 6: US2 - Distributed Proxy (inference routing works cross-pod)
7. **STOP and VALIDATE**: Test with 2-3 pods, verify core cluster functionality

### Incremental Delivery

1. Setup + Foundational + US3 + US7 → Cluster formation works, single-pod unaffected
2. Add US1 → Admin can manage all pods from one dashboard (MVP!)
3. Add US2 → Inference works transparently across pods (Core complete!)
4. Add US4 → Seamless user access with auto-redirect
5. Add US5 → Cross-pod model moves
6. Add US6 → Declarative presets with automatic scheduling (Full feature!)
7. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies. If two tasks share a target file, they MUST NOT be marked [P] regardless of logical independence.
- [Story] label maps task to specific user story for traceability
- US3 is P2 in spec but is the prerequisite for all P1 stories - must be implemented first
- US7 has no dedicated implementation tasks beyond guards/validation - it's validated by ensuring US3 handles single-pod gracefully
- All inter-pod communication uses HMAC-SHA256 auth (CLUSTER_SECRET)
- Max 8 pods per cluster (hard cap, SC-006)
- Performance target: <100ms routing overhead for cross-pod inference (SC-002)
- Leader re-election target: <30s (SC-004)
