# Research: School of Sardeenz (004)

**Date**: 2026-03-27
**Status**: Complete

## 1. Pod Discovery Mechanism

### Decision: Kubernetes API via `@kubernetes/client-node` with static peer list fallback

### Rationale
- **Real-time updates**: Watch API delivers instant ADDED/MODIFIED/DELETED events vs DNS TTL caching (CoreDNS default 30s), which is unacceptable for the 15-second failure detection window.
- **Rich metadata**: Returns pod name, IP, labels, readiness, phase, annotations vs DNS returning only IP addresses.
- **Filtering**: `labelSelector` narrows to exactly sardeenz pods.
- **Non-K8s fallback**: Easy to conditionally skip when not in cluster; DNS has no equivalent outside K8s.

### Alternatives Considered
- **DNS-based discovery (headless service)**: Rejected. DNS caching at multiple layers serves stale data; unsuitable when detecting pod departures within seconds. Also returns only IPs, no metadata.
- **mDNS/broadcast**: Rejected. Not suitable for Kubernetes pod networks.

### Implementation Pattern
- `kc.loadFromCluster()` for in-cluster auth (reads mounted ServiceAccount token)
- Read namespace from `/var/run/secrets/kubernetes.io/serviceaccount/namespace`
- `listNamespacedPod()` with `labelSelector=app=sardeenz` for initial snapshot
- `watch.watch('/api/v1/namespaces/{ns}/pods', ...)` for ongoing changes
- RBAC: Role with `pods` get/list/watch permissions

### Fallback: Static Peer List
- Environment variable: `CLUSTER_PEERS=host1:3000,host2:3000`
- Detection priority: (1) K8s env detected → API discovery, (2) `CLUSTER_PEERS` set → static list, (3) neither → single-instance mode
- Interface abstraction: `PeerDiscovery` interface with `KubernetesPeerDiscovery` and `StaticPeerDiscovery` implementations

---

## 2. Leader Election

### Decision: Kubernetes Lease-based election with heartbeat-based fallback for non-K8s

### Rationale
- **Lease objects use K8s optimistic concurrency control** (`resourceVersion`). Only one concurrent update succeeds, guaranteeing single-leader semantics without implementing a consensus protocol.
- **No peer-to-peer networking needed** for election itself. All coordination through K8s API server.
- **Kubernetes-native observability**: `kubectl get lease` shows current leader.
- **Battle-tested**: kube-controller-manager and kube-scheduler use the same mechanism.

### Alternatives Considered
- **`@codedependant/kubernetes-leader-election`**: Evaluated (~1,184 weekly downloads, uses `coordination.k8s.io/v1` Lease objects). Useful behavior: auto-assumes leadership outside K8s. However, low adoption. Recommendation: implement Lease election directly against `@kubernetes/client-node` (~200 lines of core logic) for full control.
- **Raft consensus libraries (`liferaft`, `skiff`)**: Rejected. K8s Lease already provides single-leader via etcd Raft underneath. Full consensus protocol is overkill for up to 8 pods with heartbeat-based approach.
- **Custom heartbeat-only election**: Used only for non-K8s fallback. Simple "lowest pod ID wins" tiebreaker (Bully algorithm variant) combined with term/quorum mechanism.

### Additional RBAC
```yaml
- apiGroups: ["coordination.k8s.io"]
  resources: ["leases"]
  verbs: ["get", "create", "update", "list", "watch"]
```

---

## 3. Heartbeat & State Synchronization

### Decision: HTTP-based heartbeats over Fastify's existing server, every 5 seconds

### Rationale
- Reuses existing HTTP infrastructure (no additional protocol/port needed)
- Fastify already handles connection management, auth hooks, logging
- Payload includes compact state digest; full sync triggered only on drift detection

### Design
- **Endpoint**: `POST /internal/heartbeat` on each pod
- **Interval**: 5 seconds with startup jitter (random 0-500ms offset)
- **Failure detection**: `Map<podId, lastHeartbeatTimestamp>`, reaper timer every 5s, pod marked unavailable after 15s (3 missed)
- **HTTP timeout**: 2 seconds per heartbeat call (well under 5s interval)
- **State sync**: Routing table version counter in heartbeat payload (`clusterVersion`). Version mismatch triggers full state sync via `GET /internal/state`
- **Cleanup**: `AbortController` for clean cancellation on shutdown

### Heartbeat Payload
```typescript
{
  podId: string           // Pod hostname
  role: 'leader' | 'follower'
  term: number            // Monotonically increasing leadership term
  timestamp: number       // Unix ms
  models: Array<{ instanceId, modelPath, modelName, port, status, gpuIds, tensorParallelSize }>
  gpus: Array<{ gpuId, name, totalVramMB, usedVramMB, temperature, utilization }>
  clusterVersion: number  // Routing table version for drift detection
}
// HMAC-SHA256 signature is sent in X-Cluster-Signature header (see Section 5)
```

---

## 4. Split-Brain Prevention

### Decision: Majority quorum requirement with term numbers

### Rationale
- Simple, well-understood mechanism sufficient for up to 8 pods
- K8s Lease already prevents split-brain at infrastructure level; quorum is for leader self-validation and non-K8s fallback

### Quorum Table

| Cluster Size | Quorum | Tolerate Failures |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 3 | 2 |
| 6 | 4 | 2 |
| 7 | 4 | 3 |
| 8 | 5 | 3 |

### Key Mechanisms
1. **Term numbers**: Every leadership period gets a monotonically increasing term. Messages with older terms are rejected.
2. **Leader quorum maintenance**: Leader must receive heartbeat responses from `quorum - 1` peers. If not, leader steps down.
3. **Follower command rejection**: Followers reject commands from pods with stale terms.
4. **Cluster size**: Derive from K8s Deployment replica count or `CLUSTER_EXPECTED_PODS` env var.

---

## 5. Cluster Secret Authentication

### Decision: HMAC-SHA256 with Node.js built-in `crypto` module

### Rationale
- Node.js `crypto` has everything needed; no npm dependency for 10 lines of code
- HMAC-SHA256 is well-understood, performant, and sufficient for inter-pod auth within a trusted network

### Design
- **Shared secret**: Distributed via Kubernetes Secret as `CLUSTER_SECRET` env var
- **Signing**: `HMAC-SHA256(secret, method + path + timestamp + body)` → `X-Cluster-Signature` header
- **Verification**: `crypto.timingSafeEqual()` (constant-time comparison), reject if timestamp > 30 seconds old (replay protection)
- **Implementation**: Fastify `onRequest` hook on `/internal/*` routes only
- **Rotation**: Support two active secrets simultaneously during rotation (check against both, sign with new)

---

## 6. Distributed Proxy Architecture

### Decision: HTTP-level proxy using `undici.Pool` per remote pod, forwarding directly to vLLM port

### Rationale
- **HTTP-level (not TCP)**: Must inspect request body to determine target model/pod. Also need `X-Sardeenz-Forwarded` header for loop prevention.
- **`undici.Pool`**: Node 22's `fetch()` uses undici internally but doesn't expose connection pool control. Direct `undici.Pool` gives explicit control over connections, pipelining, streaming.
- **Direct to vLLM port (FR-008)**: Bypasses remote pod's Fastify proxy, eliminating an entire HTTP hop (parse, route lookup, re-serialize).

### Alternatives Considered
- **TCP passthrough**: Rejected. Cannot inspect request body for routing decisions. Cannot add loop-prevention headers.
- **Node.js `fetch()` + `http.Agent`**: Rejected. Current codebase uses `@ts-expect-error` hack to pass agent to `fetch()`. `undici.Pool` is the proper Node 22 approach.
- **Full service mesh (Istio, Linkerd)**: Rejected. Over-engineered for 8-pod cap. Adds operational complexity.

### Performance Optimization Strategy
1. **Bypass remote proxy**: Forward to `http://pod-b:5001/v1/...` not `http://pod-b:3000/v1/...`
2. **Raw body forwarding**: Capture raw request body before Fastify JSON parsing, forward as-is
3. **Zero-copy streaming**: Pipe raw bytes via `undici.stream()`, no decode/re-encode
4. **Skip body parsing**: Register cross-pod forwarding plugin with raw content type parser

### Estimated Latency Budget
- Routing table lookup: <1ms
- undici connection acquisition (keep-alive): <1ms
- Network transit (same datacenter): 0.1-1ms
- Total: ~2-5ms (well within 100ms target)

---

## 7. Routing Table Design

### Decision: In-memory Map synced via heartbeats + immediate events, eventual consistency

### Rationale
- Heartbeats already carry model lists per pod (no additional sync mechanism)
- 8-pod cap with ~10-20 models each means trivially small payloads
- Eventual consistency window (up to 5 seconds) is acceptable for inference routing

### Data Structure
```typescript
// Per-pod: Map<modelName, Array<{ podId, podAddress, vllmPort, lastSeen }>>
ClusterRoutingTable extends Map<string, PodModelEntry[]>
```

### Consistency Strategy
- **Heartbeat sync**: Each heartbeat carries full model list for that pod (crumble-and-rebuild, not deltas)
- **Eager invalidation**: On model load/unload, send immediate event to all known peers (near-instant convergence for deliberate operations)
- **Error-driven invalidation**: On forwarding failure (connection error or 404), remove stale routing entry immediately
- **Local preference**: Weighted round-robin with 2x weight for local instances to avoid unnecessary network hops

### Failure Handling
- **Per-pod circuit breaker**: 3 failures in 30s triggers 15s cooldown
- **Mid-stream failure**: Write SSE error event to client stream + close. No retry for streaming.
- **Non-streaming retry**: 1 retry on connection error, failover to next pod if model on multiple pods

---

## 8. Existing Architecture Integration Points

### Backend Components to Extend
| Component | File | Change Required |
|---|---|---|
| `ProxyRouter` | `proxy-router.ts` | Add cross-pod routing, `undici.Pool` management, cluster routing table |
| `ModelManager` | `model-manager.ts` | Emit model load/unload events to cluster peers |
| `ModelMover` | `model-mover.ts` | Add cross-pod move (load on remote, drain local, unload local) |
| `ModelStore` | `model-store.ts` | Add pod-awareness or create separate `ClusterRoutingStore` |
| `EventBus` | `event-bus.ts` | Relay SSE events from remote pods to dashboard clients |
| `ModelConfigurationStore` | `model-configuration-store.ts` | Add preset replication, declarative scheduler |
| `server.ts` | `server.ts` | Register `/internal/*` routes, cluster manager plugin |

### Frontend Components to Extend
| Component | File | Change Required |
|---|---|---|
| `ModelManagement` | `ModelManagement.tsx` | Multi-pod view, pod selector, cross-pod operations |
| `LoadModelDialog` | `LoadModelDialog.tsx` | Pod/GPU target selection across cluster |
| `MoveModelDialog` | `MoveModelDialog.tsx` | Cross-pod destination selection |
| `GpuInfo` | `GpuInfo.tsx` | Multi-pod GPU views |
| `api.ts` | `api.ts` | Cluster API endpoints, pod-aware operations |

### New Components Needed
- **Backend**: `ClusterManager` (discovery, election, heartbeat orchestration), `ClusterRoutingStore`, `PodScheduler` (preset placement), `/internal/*` routes, `PeerDiscovery` interface + implementations
- **Frontend**: `ClusterOverview` (pod health/status), pod-aware model placement UI, cluster settings
