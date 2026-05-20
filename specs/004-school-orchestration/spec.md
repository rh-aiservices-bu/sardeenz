# Feature Specification: School of Sardeenz

**Feature Branch**: `feat/school-of-sardeenz`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "Multi-pod orchestration with centralized management, auto-discovery, leader election, and distributed proxy for Sardeenz clusters running in a single OpenShift/Kubernetes namespace"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Centralized Model Management Across Pods (Priority: P1)

As a platform admin, I deploy multiple Sardeenz pods in a single namespace (each with its own GPU). When I open the dashboard URL, I see all pods and all models loaded across the entire cluster in a single unified view. I can load or unload models on any pod from this one interface, without needing to know which pod hosts which model.

**Why this priority**: This is the core value proposition. Without centralized visibility and control, admins must open separate UIs for each pod, which doesn't scale and defeats the purpose of multi-pod deployment.

**Independent Test**: Can be tested by deploying 2+ Sardeenz pods, connecting to the dashboard, and verifying all pods and their models appear in one view. Loading/unloading a model on a remote pod from the central UI confirms the feature works.

**Acceptance Scenarios**:

1. **Given** 3 Sardeenz pods running in a namespace, **When** an admin opens the dashboard URL, **Then** all 3 pods are listed with their GPU status, loaded models, and available capacity.
2. **Given** the centralized dashboard is open, **When** an admin requests to load a model on Pod B, **Then** the model loads on Pod B and progress is shown in real-time on the dashboard.
3. **Given** a model is loaded on Pod C, **When** an admin unloads that model from the central dashboard, **Then** the model is unloaded on Pod C and the dashboard reflects the updated state.
4. **Given** a pod goes offline, **When** the admin views the dashboard, **Then** the offline pod is shown with a degraded/offline status indicator.

---

### User Story 2 - Distributed Inference Proxy (Priority: P1)

As an application developer, I send inference requests to a single OpenShift Service endpoint. Regardless of which Sardeenz pod receives my request, the proxy routes it to the correct pod where the requested model is actually loaded, transparently returning the response. When forwarding to a remote pod, the proxy connects directly to the model's listening port on that pod, bypassing the remote pod's proxy entirely to avoid an unnecessary hop.

**Why this priority**: Equal to P1 because without cross-pod routing, users would need to know which pod hosts which model, breaking the abstraction of a unified inference endpoint.

**Independent Test**: Can be tested by loading a model on one specific pod, then sending inference requests to the shared Service endpoint multiple times. Requests should succeed regardless of which pod the Service load-balancer initially routes them to.

**Acceptance Scenarios**:

1. **Given** Model A is loaded on Pod 1 only, **When** an inference request for Model A arrives at Pod 2 via the Service, **Then** Pod 2's proxy forwards the request to Pod 1 and returns the response to the caller.
2. **Given** Model A is loaded on Pods 1 and 3, **When** inference requests arrive, **Then** the proxy distributes requests across both pods hosting the model using round-robin.
3. **Given** a model is not loaded on any pod, **When** an inference request arrives for that model, **Then** the proxy returns an appropriate error indicating the model is not available.
4. **Given** Pod 1 hosts Model A and Pod 2 hosts Model B, **When** a burst of requests for both models arrives at any pod, **Then** each request is routed to the correct pod with minimal added latency.

---

### User Story 3 - Auto-Discovery of Pods (Priority: P2)

As a platform admin, I deploy Sardeenz pods without any manual cluster configuration. Pods automatically discover each other within the namespace, form a cluster, and elect a leader. I do not need to configure pod addresses, cluster membership, or leader assignment.

**Why this priority**: Auto-discovery removes operational burden and enables dynamic scaling (add/remove pods without reconfiguration). It's essential for production use but is an enabler for P1 stories rather than directly user-facing.

**Independent Test**: Can be tested by deploying pods one at a time and verifying each new pod appears in the cluster automatically. Removing a pod should be detected by remaining pods within a reasonable time.

**Acceptance Scenarios**:

1. **Given** no Sardeenz pods are running, **When** the first pod starts, **Then** it becomes the leader and serves the dashboard.
2. **Given** a leader pod is running, **When** a second pod starts in the same namespace, **Then** the second pod discovers the leader and registers itself within 30 seconds.
3. **Given** 3 pods are running, **When** the leader pod is terminated, **Then** a new leader is elected from the remaining pods within 30 seconds and the dashboard remains accessible.
4. **Given** a pod temporarily loses network connectivity, **When** connectivity is restored, **Then** the pod re-joins the cluster without manual intervention.

---

### User Story 4 - Seamless User Access (Priority: P2)

As an end user or admin, I access a single stable URL (via an OpenShift Route/Service) for both the dashboard and inference API. I do not need to know about the internal pod topology. If the pod serving the dashboard fails, I am automatically redirected to the new leader.

**Why this priority**: Provides the seamless UX that makes the multi-pod setup invisible to users. Depends on auto-discovery and leader election being in place.

**Independent Test**: Can be tested by accessing the dashboard through the Service URL, killing the leader pod, and verifying the dashboard becomes available again at the same URL after leader re-election.

**Acceptance Scenarios**:

1. **Given** a Sardeenz cluster is running, **When** a user accesses the Service URL, **Then** they are served the dashboard from the current leader pod.
2. **Given** the leader pod crashes, **When** a user refreshes the dashboard after leader re-election, **Then** the dashboard loads from the new leader with the current cluster state.
3. **Given** an inference API key is configured, **When** a user sends an authenticated request to the Service URL, **Then** the request is processed regardless of which pod receives it.

---

### User Story 5 - Cross-Pod Model Move (Priority: P2)

As a platform admin, I can move a model from one pod to another through the centralized dashboard. This extends the existing single-pod model move capability (moving a model between GPUs within one pod) to work across the entire cluster. When moving a model, I can choose any pod in the cluster as the destination, not just the pod where the model is currently loaded.

**Why this priority**: Model mobility across pods is important for capacity planning and load balancing across the cluster. It builds on the centralized management (P1) and extends an already existing single-pod feature to cluster scope.

**Independent Test**: Can be tested by loading a model on Pod A, initiating a move to Pod B from the dashboard, and verifying the model is unloaded from Pod A and loaded on Pod B with the routing table updated accordingly.

**Acceptance Scenarios**:

1. **Given** Model A is loaded on Pod 1, **When** an admin moves Model A to Pod 3 via the dashboard, **Then** Model A is loaded on Pod 3, unloaded from Pod 1, and inference requests are routed to Pod 3.
2. **Given** Model A is loaded on Pod 1, **When** an admin moves Model A to a different GPU on Pod 1, **Then** the existing single-pod move behavior is preserved.
3. **Given** Model A is loaded on Pod 1, **When** an admin attempts to move it to Pod 2 which has insufficient GPU memory, **Then** the system reports insufficient capacity on Pod 2 and the model remains on Pod 1.
4. **Given** a cross-pod model move is in progress, **When** an inference request arrives for that model, **Then** the request is served by the source pod until the move completes, then routed to the destination pod.

---

### User Story 6 - Declarative Model Presets with Scheduling (Priority: P3)

As a platform admin, I create a preset that is simply a list of models I want running, along with their requirements (GPU type constraints, configuration parameters). I do not specify where each model should be placed. When I apply the preset, the system examines the cluster's available resources and memory profiles, then automatically determines the best placement across pods. If not all models fit, the system loads what it can and reports which models couldn't be placed and why.

**Why this priority**: P3 because it builds on top of centralized management (P1), auto-discovery (P2), and memory profiles. It's the natural evolution toward fully declarative model deployment, but the cluster is usable without it (admins can place models manually).

**Independent Test**: Can be tested by creating a preset with 4 models, applying it to a cluster with 2 pods, and verifying models are distributed across pods based on available GPU resources. Removing a pod and re-applying should result in a different placement.

**Acceptance Scenarios**:

1. **Given** a preset with 3 models and a cluster with 2 pods, **When** an admin applies the preset, **Then** the system places each model on a pod with sufficient GPU resources using memory profiles to determine fit.
2. **Given** a preset with 5 models but the cluster only has capacity for 3, **When** the preset is applied, **Then** the system loads 3 models and reports the remaining 2 as unplaceable with the reason (e.g., "insufficient VRAM on any available GPU").
3. **Given** a preset specifying a model that requires an A100 GPU, **When** the cluster has both A100 and L4 pods, **Then** the scheduler places that model on an A100 pod.
4. **Given** an admin wants to maximize the number of models running, **When** they apply a preset with a "maximize models" strategy, **Then** the scheduler optimizes placement to fit as many models as possible across the cluster.
5. **Given** an admin wants to spread load evenly across pods, **When** they apply a preset with a "balanced" strategy, **Then** the scheduler distributes models across pods to equalize GPU utilization rather than packing pods to maximum density.
6. **Given** an admin wants to ensure adequate KV cache availability, **When** they apply a preset with a "minimum KV cache" constraint, **Then** the scheduler places models such that each GPU retains at least the specified amount of free VRAM for KV cache.

---

### User Story 7 - Single-Pod Backward Compatibility (Priority: P1)

As an existing Sardeenz user running a single pod, my deployment continues to work exactly as before with no additional configuration, no noticeable performance overhead, and no behavioral changes. Cluster features remain dormant until a second pod joins.

**Why this priority**: P1 because most users will start with a single pod. Introducing cluster machinery must not degrade or complicate the single-pod experience that already works today.

**Independent Test**: Can be tested by deploying a single Sardeenz pod with the new version and verifying all existing functionality (dashboard, model loading, inference proxy, benchmarks) works identically to the pre-cluster version.

**Acceptance Scenarios**:

1. **Given** a single Sardeenz pod is deployed, **When** no other pods are present, **Then** the pod operates identically to the current single-pod behavior with no cluster-related configuration required.
2. **Given** a single pod is running, **When** cluster features are not active, **Then** there is no measurable performance overhead from cluster machinery (leader election, heartbeats, discovery).
3. **Given** a single pod is running, **When** a second pod joins the namespace, **Then** cluster features activate automatically without requiring a restart of the first pod.

---

### Edge Cases

- What happens when all pods go offline simultaneously? The cluster is unavailable; upon restart, a new leader election occurs and state is rebuilt from each pod's local state.
- What happens when network partitions split the cluster? Pods on each side should detect the partition. To prevent split-brain, only the partition containing the majority of known peers should elect a leader. Minority partitions should mark themselves as degraded and stop serving the dashboard (but may continue serving local inference requests for already-loaded models).
- What happens when two pods start simultaneously and both try to become leader? The leader election protocol must handle race conditions and guarantee exactly one leader is elected.
- How does the system handle a pod with a stale cluster membership list? Periodic health checks and heartbeats should reconcile stale state. A pod that cannot reach the leader should attempt re-discovery.
- What happens when a model load is requested but no pod has sufficient GPU memory? The system should report insufficient capacity across the cluster, listing available memory per pod.
- What happens when an unauthorized request attempts to send management commands to a pod? The pod rejects the request. Only pods presenting the valid cluster secret can issue load/unload commands or exchange state.
- What happens when a streaming inference request is being proxied across pods and the source pod goes down mid-stream? The proxy should detect the broken connection and return an error to the caller rather than hanging indefinitely.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow multiple Sardeenz pods in a single namespace to automatically discover each other without manual configuration. When running outside Kubernetes, the system MUST support a static peer list via environment variable (e.g., `CLUSTER_PEERS=host1:3000,host2:3000`) as a fallback discovery mechanism.
- **FR-002**: System MUST elect a single leader pod that serves the centralized dashboard and coordinates cluster operations.
- **FR-003**: System MUST re-elect a new leader within 30 seconds if the current leader becomes unavailable.
- **FR-004**: The leader's dashboard MUST display all pods in the cluster, including their GPU details (type, VRAM capacity, current utilization), loaded models, and health. In heterogeneous clusters with different GPU types across pods, the dashboard MUST clearly show each pod's GPU configuration so admins can make informed placement decisions.
- **FR-005**: The leader MUST be able to send model load/unload commands to any pod in the cluster and relay real-time progress to the dashboard.
- **FR-006**: Each pod MUST run a proxy capable of routing inference requests to any other pod in the cluster where the target model is loaded.
- **FR-007**: The proxy MUST maintain an up-to-date routing table of which models are loaded on which pods.
- **FR-008**: The proxy MUST forward requests directly to the model's listening port on the target pod (bypassing the remote pod's proxy) to minimize routing hops, while preserving the OpenAI-compatible API contract.
- **FR-009**: System MUST support a single OpenShift Service/Route as the entry point for both dashboard and inference traffic.
- **FR-010**: System MUST handle pod joins and departures gracefully without requiring restart of other pods.
- **FR-011**: System MUST prevent split-brain scenarios during network partitions by requiring majority quorum for leader election.
- **FR-012**: Each pod MUST continue serving inference requests for locally-loaded models even if temporarily disconnected from the cluster.
- **FR-013**: System MUST expose cluster health status (number of pods, leader identity, connectivity) through the dashboard and an API endpoint.
- **FR-014**: System MUST support moving a model from any pod to any other pod in the cluster, extending the existing single-pod model move capability to cluster scope.
- **FR-015**: During a cross-pod model move, the system MUST continue serving inference requests for that model on the source pod until the move completes.
- **FR-016**: Pods MUST authenticate inter-pod communication (management commands, state synchronization) using a shared cluster secret. Unauthenticated requests from other pods MUST be rejected.
- **FR-017**: The proxy MUST support forwarding streaming responses (SSE/chunked transfer) across pods, relaying tokens in real-time from the remote model back to the caller without buffering the entire response.
- **FR-018**: A single-pod deployment MUST operate identically to the current pre-cluster behavior with no cluster-related configuration required and no measurable performance overhead.
- **FR-019**: Follower pods MUST redirect dashboard requests to the current leader pod. Followers MUST NOT serve their own dashboard UI.
- **FR-020**: Model configuration presets MUST be declarative: a list of desired models with their requirements (GPU type constraints, configuration parameters) and no explicit placement information. Presets MUST be replicated across all pods in the cluster so they survive leader failover.
- **FR-021**: When a preset is applied, the system MUST reconcile the cluster to match the preset's desired state: unload models not in the preset and load missing models. The preset represents the complete desired end state.
- **FR-022**: If a preset cannot be fully satisfied, the system MUST load as many models as possible and report which models could not be placed and why.
- **FR-023**: The scheduler MUST support a placement strategy to maximize the number of models loaded across the cluster.
- **FR-024**: The scheduler MUST support a placement constraint for minimum KV cache availability, ensuring each GPU retains at least a specified amount of free VRAM after model placement.
- **FR-025**: The scheduler MUST use memory profiles to determine how much VRAM each model requires on each GPU type, enabling informed placement decisions across heterogeneous GPU configurations.
- **FR-026**: Memory profiles MUST be stored on the pod where they were generated. Each profile MUST include the GPU configuration it was generated on (GPU type, VRAM capacity) since profiles are GPU-dependent.
- **FR-027**: When a new model is profiled on a pod, the resulting profile MUST be automatically pushed to all other pods in the cluster.
- **FR-028**: An admin MUST be able to manually push profiles from any pod to all other pods on demand.
- **FR-029**: Each pod MUST expose an endpoint to return all memory profiles it knows about, enabling the leader to query and collect profiles from the entire cluster.
- **FR-030**: The leader MUST provide a profile reconciliation function that collects profiles from all pods, deduplicates them (identifying equivalent profiles by model identity and GPU configuration), and distributes the unified set back to all pods.
- **FR-031**: The system MUST provide export/import functionality for memory profiles so an admin can back up and restore them if all cluster data is lost.
- **FR-032**: Benchmark results MUST be stored on the pod where they were run (typically the leader). The system MUST provide export/import functionality for benchmark data so an admin can back up results and restore them on a new leader if needed. Benchmarks MUST NOT be replicated automatically across pods.

### Key Entities

- **Cluster**: A group of Sardeenz pods in the same namespace that have discovered each other. Has a single leader and zero or more follower pods.
- **Pod/Node**: A single Sardeenz instance with its own GPU(s), vLLM processes, and local proxy. Each pod has identity, health status, and a list of loaded models.
- **Leader**: The elected pod responsible for serving the dashboard and coordinating cluster-wide operations (model load/unload). Any pod can become leader through election.
- **Routing Table**: A shared data structure mapping model identifiers to the pod(s) where they are currently loaded. Kept in sync across all pods.
- **Heartbeat**: Periodic signal sent between pods every 5 seconds to confirm liveness and exchange state updates (loaded models, GPU utilization). A pod is considered unavailable after 3 missed heartbeats (15 seconds).
- **Cluster Secret**: A shared credential used to authenticate inter-pod communication. All pods in the cluster must present this secret when exchanging management commands or state updates.
- **Model Set (Preset)**: A declarative list of desired models with their requirements (GPU type constraints, configuration parameters) but no explicit placement. Acts as the input to the scheduler. Replicated across all pods.
- **Placement Strategy**: A scheduling policy that guides how models are distributed across the cluster (e.g., maximize model count, ensure minimum KV cache headroom).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can manage models across all pods in the cluster from a single dashboard without opening any additional UIs.
- **SC-002**: Inference requests sent to the shared Service endpoint are routed to the correct pod and model with less than 100ms of added routing latency (excluding network transit).
- **SC-003**: A new pod joining the cluster is discovered and visible in the dashboard within 30 seconds of becoming ready.
- **SC-004**: Leader re-election completes within 30 seconds of leader failure, and the dashboard becomes available again at the same URL.
- **SC-005**: The system operates with zero manual cluster configuration — deploying pods in the same namespace is sufficient to form a cluster.
- **SC-006**: The system supports up to 8 pods in a single cluster without degradation of management or routing capabilities. 8 pods is a hard cap to keep scheduling and future auto-balancing complexity manageable.
- **SC-007**: During a network partition, pods in the minority partition do not serve stale dashboard state (split-brain prevention).

## Assumptions

- All Sardeenz pods run in the same Kubernetes/OpenShift namespace and can communicate over the pod network. In non-Kubernetes environments (local dev, Docker Compose), pods communicate over the local network using a static peer list.
- In Kubernetes, pods use the Kubernetes API (via service account) or DNS-based discovery (headless service) to find each other. Outside Kubernetes, discovery falls back to the `CLUSTER_PEERS` environment variable.
- Each pod has a unique, stable identity (e.g., from a StatefulSet or pod hostname).
- The existing single-pod Sardeenz architecture (Controller API, Proxy, Dashboard) remains intact; this feature extends it with cluster awareness.
- Authentication settings (AUTH_MODE, INFERENCE_API_KEY) are shared across all pods via common configuration (ConfigMap/Secret).
- GPU resources are dedicated per pod (no GPU sharing between pods).
- Mixed Sardeenz versions across pods during rolling upgrades should work gracefully. The inter-pod communication protocol should remain backward-compatible across versions. If a breaking protocol change is unavoidable, it constitutes a breaking migration and should be rare.

## Clarifications

### Session 2026-03-27

- Q: What should happen when a user connects to a follower pod's dashboard directly? → A: Follower pods redirect dashboard requests to the leader pod.
- Q: How should the proxy distribute requests when the same model is on multiple pods? → A: Round-robin across pods hosting the model.
- Q: How frequently should heartbeats be sent between pods? → A: Every 5 seconds; pod unavailable after 3 missed (15s).
- Q: Should functional requirements be renumbered sequentially? → A: Yes, renumbered FR-001 through FR-032.
- Q: When applying a preset, should models not in the preset be unloaded? → A: Yes, reconcile to match preset exactly (unload extras, load missing).

## Scope Boundaries

### In Scope
- All user stories, requirements, and success criteria defined above.

### Out of Scope
- **Centralized logging/observability**: Logs remain per-pod. Centralized log aggregation will be handled by external infrastructure (e.g., OpenShift logging stack) in a future initiative, not by Sardeenz itself.
- **Graceful degradation during leader election**: During the leader election window (up to 30 seconds), the dashboard may be unresponsive. Inference routing continues to work for locally-loaded models, but management operations may fail until a new leader is elected. This is an accepted tradeoff.
- **Clusters larger than 8 pods**: The system enforces a maximum of 8 pods per cluster. This keeps placement scheduling tractable and leaves room for future auto-balancing features (e.g., detecting a pod under pressure and automatically redistributing models).
- **Automatic load balancing**: Detecting overloaded pods and automatically moving models between pods is a future enhancement that builds on this foundation. This spec covers manual and preset-driven placement only.
