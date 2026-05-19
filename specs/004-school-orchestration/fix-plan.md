# Fix Plan: 004-school-orchestration Pre-PR Issues

**Branch**: `004-school-orchestration`
**Created**: 2026-03-27
**Source**: Consolidated findings from 4 Opus review agents (completeness, architecture, security, performance)

This plan contains all issues identified during the pre-PR review, organized by priority. Each fix includes the exact file, line numbers, the problem, and the specific change needed. This document is self-contained — a new session can execute it without additional context.

---

## Priority 0 — Must Fix Before Merge

### FIX-01: Require CLUSTER_SECRET in cluster mode (Security Critical)

**Problem**: When `CLUSTER_SECRET` is not set (the default), the cluster-auth plugin at `apps/backend/src/plugins/cluster-auth.ts:16-19` silently skips authentication. All `/internal/*` endpoints become unauthenticated — any pod in the namespace can load models, inject heartbeats, or manipulate cluster state.

**Current code** (`apps/backend/src/config.ts:216-221`):
```typescript
if (isClusterMode && !config.clusterSecret) {
  console.warn('WARNING: Cluster mode active without CLUSTER_SECRET...')
}
```

**Fix**: Change the warning to an error that blocks startup when in cluster mode:
```typescript
if (isClusterMode && !config.clusterSecret) {
  throw new Error(
    'CLUSTER_SECRET is required in cluster mode. Inter-pod communication cannot be secured without it. ' +
    'Generate a secure value with: openssl rand -hex 32'
  )
}
```

**Files**: `apps/backend/src/config.ts:216-221`

**Cascading effect**: This fix also mitigates FIX-05 (SSRF via routing table poisoning), FIX-06 (peer address injection), and FIX-07 (open redirect) since those attacks require unauthenticated internal API access.

---

### FIX-02: Warn about AUTH_MODE=none for cluster deployments (Security Critical)

**Problem**: The default ConfigMap (`deploy/kubernetes/configmap.yaml:11`) ships `AUTH_MODE: "none"`, meaning the entire cluster admin API (`/api/cluster/*`) is unauthenticated. Any client with network access gets full admin control.

**Fix (two parts)**:

**Part A** — Change default ConfigMap to use `simple` auth:
```yaml
# deploy/kubernetes/configmap.yaml
data:
  AUTH_MODE: "simple"
  LOG_LEVEL: "info"
  ENABLE_KVCACHED: "true"
```

**Part B** — Add a startup warning in `apps/backend/src/config.ts` after `validateClusterConfig()`:
```typescript
if (isClusterMode && config.authMode === 'none') {
  console.warn(
    'WARNING: Cluster mode with AUTH_MODE=none. The cluster admin API (/api/cluster/*) is unauthenticated. ' +
    'Set AUTH_MODE to "simple" or "oauth" for production deployments.'
  )
}
```

**Files**: `deploy/kubernetes/configmap.yaml:11`, `apps/backend/src/config.ts` (inside `validateClusterConfig`)

---

### FIX-03: Make migration idempotent (Architecture Critical)

**Problem**: `apps/backend/src/db/migrations/006-cluster-schema-extensions.sql` uses `ALTER TABLE ... ADD COLUMN` which crashes if run twice (SQLite doesn't support `IF NOT EXISTS` for ALTER TABLE). The `INSERT INTO schema_migrations` also fails on re-run.

**Current code**:
```sql
ALTER TABLE model_configurations ADD COLUMN placement_strategy TEXT;
-- ... more ALTERs
INSERT INTO schema_migrations (version) VALUES (6);
```

**Fix**: The migration runner in the backend likely handles idempotency at the application level. Check how previous migrations are structured. If the runner checks `schema_migrations` before running, the `INSERT` needs to be `INSERT OR IGNORE`. If the runner doesn't guard, wrap the SQL:

```sql
-- Migration 006: Cluster schema extensions for School of Sardeenz (004)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Guard: skip if already applied
-- Note: SQLite doesn't support ALTER TABLE ... IF NOT EXISTS for columns.
-- The application-level migration runner must check schema_migrations
-- before executing. This INSERT OR IGNORE ensures re-runs don't fail.

ALTER TABLE model_configurations ADD COLUMN placement_strategy TEXT;
ALTER TABLE model_configurations ADD COLUMN min_kv_cache_mb INTEGER;
ALTER TABLE model_configurations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE model_configuration_entries ADD COLUMN gpu_type_constraint TEXT;
ALTER TABLE model_configuration_entries ADD COLUMN min_vram_mb INTEGER;

ALTER TABLE memory_profiles ADD COLUMN gpu_type TEXT;
ALTER TABLE memory_profiles ADD COLUMN gpu_vram_mb INTEGER;
ALTER TABLE memory_profiles ADD COLUMN source_pod_id TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (6);
```

**Additionally**: Check the migration runner code (likely in `apps/backend/src/db/`) to confirm it checks `schema_migrations` before running a migration. If it does, the `ALTER TABLE` statements are safe (they only run once). If it doesn't, the ALTERs need to be wrapped in application-level try/catch. Search for how migrations 001-005 handle this.

**Files**: `apps/backend/src/db/migrations/006-cluster-schema-extensions.sql`, potentially the migration runner

---

### FIX-04: Verify/fix cross-pod connection pooling (Performance P0)

**Problem**: `apps/backend/src/services/proxy-router.ts` uses `@ts-expect-error` to pass `http.Agent` to native `fetch()` at lines 444, 619. Node.js 22's native `fetch()` is backed by `undici` and does NOT use `http.Agent`. The `PodPoolManager` (lines 94-130) creates `http.Agent` instances that are likely ignored, meaning every cross-pod request opens a new TCP connection. This threatens the <100ms routing overhead target.

The project's own research doc (`specs/004-school-orchestration/research.md:148`) recommended `undici.Pool` as "the proper Node 22 approach."

**Fix**: Replace `http.Agent` with `undici.Pool` in `PodPoolManager`:

```typescript
import { Pool } from 'undici'

class PodPoolManager {
  private pools: Map<string, Pool> = new Map()

  getOrCreate(podId: string, baseUrl: string): Pool {
    let pool = this.pools.get(podId)
    if (!pool) {
      pool = new Pool(baseUrl, {
        connections: 64,
        pipelining: 1,
        keepAliveTimeout: 120_000,
      })
      this.pools.set(podId, pool)
    }
    return pool
  }

  async destroyPool(podId: string): Promise<void> {
    const pool = this.pools.get(podId)
    if (pool) {
      await pool.close()
      this.pools.delete(podId)
    }
  }

  async destroyAll(): Promise<void> {
    for (const [podId, pool] of this.pools) {
      await pool.close()
      this.pools.delete(podId)
    }
  }
}
```

Then update `forwardToRemotePod` (line 589+) to use `pool.request()` instead of `fetch()`:

```typescript
const pool = this.podPools.getOrCreate(podId, `http://${podAddress}:${vllmPort}`)
const { statusCode, headers, body } = await pool.request({
  path: endpoint,
  method,
  headers: {
    'Content-Type': 'application/json',
    [FORWARDED_HEADER]: 'true',
  },
  body: JSON.stringify(body),
})
```

**Note**: The existing local vLLM `fetch()` calls (lines 440-446, 520-536) can remain using `fetch()` with the `@ts-expect-error` hack since they're localhost connections where pooling matters less. Focus the `undici.Pool` change on the cross-pod `forwardToRemotePod` method. If a full refactor is preferred, switch all fetch calls to undici, but that's a larger change.

**Alternative minimal fix**: If switching to `undici.Pool` is too invasive, verify whether the `@ts-expect-error` hack actually works by adding a test log. If it does work (some Node builds do pass it through), document it. If it doesn't, the minimal fix is to use `undici.request()` just in `forwardToRemotePod`.

**Files**: `apps/backend/src/services/proxy-router.ts:94-130` (PodPoolManager), `apps/backend/src/services/proxy-router.ts:589-680` (forwardToRemotePod)

---

### FIX-05: Atomic routing table rebuild (Performance P0)

**Problem**: `apps/backend/src/stores/cluster-routing-store.ts:32` calls `this.entries.clear()` before rebuilding, leaving a window where the routing table is empty. Any proxy request arriving during rebuild gets no routes and returns a 404.

**Current code** (line 29-55):
```typescript
rebuildFromPeers(peers: PeerInfo[]): void {
  this.entries.clear()  // ← BUG: table is empty until rebuild completes
  for (const peer of peers) { ... }
}
```

**Fix**: Build the new table in a local variable, then swap atomically:

```typescript
rebuildFromPeers(peers: PeerInfo[]): void {
  const prevVersion = this.version
  const prevModelCount = this.entries.size

  // Build new table without clearing the current one
  const newEntries = new Map<string, RoutingEntry[]>()

  for (const peer of peers) {
    if (peer.status === 'unavailable') continue

    for (const model of peer.models) {
      if (model.status !== 'running') continue

      const entry: RoutingEntry = {
        podId: peer.podId,
        podAddress: peer.address,
        vllmPort: model.port,
        weight: peer.podId === this.localPodId ? 2 : 1,
        lastVerified: Date.now(),
      }

      let modelEntries = newEntries.get(model.modelName)
      if (!modelEntries) {
        modelEntries = []
        newEntries.set(model.modelName, modelEntries)
      }
      modelEntries.push(entry)
    }
  }

  // Atomic swap
  this.entries = newEntries
  this.version++

  this.logger?.info(
    { prevVersion, newVersion: this.version, prevModelCount, newModelCount: this.entries.size,
      peerCount: peers.filter((p) => p.status !== 'unavailable').length },
    'Routing table rebuilt from peers'
  )
}
```

**Files**: `apps/backend/src/stores/cluster-routing-store.ts:29-68`

---

### FIX-06: Validate peer addresses in leader-redirect (Security High)

**Problem**: `apps/backend/src/plugins/leader-redirect.ts:59` has a comment saying "Validate leaderAddress is a known peer to prevent open redirect attacks" but no validation is implemented. The `leaderAddress` comes from `clusterManager.getLeaderAddress()` which is populated from heartbeats/peer store.

**Fix**: Add peer validation before redirecting:

```typescript
// After line 49: const leaderAddress = clusterManager.getLeaderAddress()
if (!leaderAddress) { ... }

// Add validation: ensure leaderAddress belongs to a known peer
const peerStore = (await import('../stores/peer-store.js')).peerStore
const knownPeers = peerStore.getAllPeers()
const isKnownPeer = knownPeers.some(
  (p) => leaderAddress === `${p.address}:${p.port}` || leaderAddress === p.address
)
if (!isKnownPeer) {
  fastify.log.warn({ leaderAddress }, 'Leader address not found in known peers, refusing redirect')
  return reply.code(503).send({
    error: 'Service Unavailable',
    message: 'Leader address could not be verified. Please try again later.',
  })
}
```

**Better approach**: Import `peerStore` at the top of the file (not dynamic import) and use it in the hook. The import should be:
```typescript
import { peerStore } from '../stores/peer-store.js'
```

**Files**: `apps/backend/src/plugins/leader-redirect.ts:49-71`

---

## Priority 1 — Should Fix Before Merge

### FIX-07: Fix error handling via string matching in cluster routes

**Problem**: `apps/backend/src/routes/cluster.ts:541-549` catches errors from `model-mover.ts` and routes them by checking `message.includes('not found')`, `message.includes('Cannot move')`, etc. This is fragile — the model-mover already throws typed errors.

**Fix**: Check if `model-mover.ts` exports error classes (e.g., `NotFoundError`, `BadRequestError`). If so, use `instanceof`:

```typescript
} catch (err) {
  if (err instanceof NotFoundError) {
    return reply.code(404).send({ error: err.message })
  }
  if (err instanceof BadRequestError || err instanceof ConflictError) {
    return reply.code(400).send({ error: err.message })
  }
  fastify.log.error({ err, instanceId }, 'Cluster move failed')
  return reply.code(500).send({ error: (err as Error).message })
}
```

If error classes don't exist yet, create them in `model-mover.ts` and use them there.

**Files**: `apps/backend/src/routes/cluster.ts:540-550`, potentially `apps/backend/src/services/model-mover.ts`

---

### FIX-08: Fix useClusterStatus re-render loop

**Problem**: `apps/frontend/src/hooks/useClusterStatus.ts:64` has `[options]` in the `useCallback` dependency array. The `options` object is recreated on every parent render (unless the caller memoizes it), causing the callback reference to change, which restarts the polling interval on every render.

**Fix**: Use a ref for the callback:

```typescript
export function useClusterStatus(options?: UseClusterStatusOptions): UseClusterStatusReturn {
  const [clusterStatus, setClusterStatus] = useState<ClusterStatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<number | null>(null)
  const previousLeaderIdRef = useRef<string | null>(null)
  const redirectTimeoutRef = useRef<number | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options  // Always keep ref up to date

  const fetchStatus = useCallback(async () => {
    try {
      const status = await apiClient.getClusterStatus()
      setClusterStatus(status)
      setError(null)

      if (
        previousLeaderIdRef.current !== null &&
        status.leaderId !== previousLeaderIdRef.current &&
        status.isClusterMode
      ) {
        optionsRef.current?.onLeaderChange?.(status.leaderId, status.leaderAddress)

        if (status.leaderAddress && redirectTimeoutRef.current === null) {
          redirectTimeoutRef.current = window.setTimeout(() => {
            const newUrl = `http://${status.leaderAddress}`
            window.location.href = newUrl
          }, REDIRECT_DELAY_MS)
        }
      }

      previousLeaderIdRef.current = status.leaderId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cluster status')
    } finally {
      setIsLoading(false)
    }
  }, [])  // ← No dependencies — stable reference

  // ... rest unchanged
}
```

**Files**: `apps/frontend/src/hooks/useClusterStatus.ts:25-88`

---

### FIX-09: Validate redirect URL in useClusterStatus

**Problem**: `apps/frontend/src/hooks/useClusterStatus.ts:51` constructs `window.location.href = \`http://${status.leaderAddress}\`` from API response data. If the API response is compromised (via routing table poisoning or man-in-the-middle), this becomes an open redirect.

**Fix**: Validate that `leaderAddress` looks like an internal address before redirecting:

```typescript
if (status.leaderAddress && redirectTimeoutRef.current === null) {
  // Validate leader address is a plausible internal address
  const addr = status.leaderAddress
  const isInternal = /^[\w.-]+:\d+$/.test(addr) && !addr.includes('//') && !addr.includes('@')
  if (isInternal) {
    redirectTimeoutRef.current = window.setTimeout(() => {
      window.location.href = `http://${addr}`
    }, REDIRECT_DELAY_MS)
  }
}
```

**Files**: `apps/frontend/src/hooks/useClusterStatus.ts:49-54`

---

### FIX-10: Wire getGpus() to return actual GPU data

**Problem**: `apps/backend/src/services/cluster-manager.ts:157-161` returns an empty array from `getGpus()`. This means heartbeat GPU data is always empty, so the dashboard can't show GPU utilization per pod (FR-004), and the scheduler can't use real-time GPU availability for placement (FR-025).

**Current code**:
```typescript
getGpus(): PeerGpuInfo[] {
  // GPU info will be populated by the GPU monitoring system
  // Return empty for now; will be wired when GPU info service is integrated
  return []
}
```

**Fix**: The backend already has GPU info endpoints (`/api/gpu/info`). Wire the existing GPU info service into `ClusterManager`:

1. Check what service/function provides GPU info (look at `apps/backend/src/routes/gpu.ts` for imports)
2. Import it in `cluster-manager.ts`
3. Return actual GPU data from `getGpus()`:

```typescript
getGpus(): PeerGpuInfo[] {
  const gpuInfo = getGpuInfo()  // or however the existing GPU service exposes data
  return gpuInfo.map(gpu => ({
    gpuId: gpu.id,
    gpuType: gpu.name,
    vramTotalMb: gpu.memoryTotal,
    vramUsedMb: gpu.memoryUsed,
    vramFreeMb: gpu.memoryFree,
    utilization: gpu.utilization,
  }))
}
```

**Research needed**: Read `apps/backend/src/routes/gpu.ts` to find the GPU info function.

**Files**: `apps/backend/src/services/cluster-manager.ts:157-161`, `apps/backend/src/routes/gpu.ts` (for reference)

---

### FIX-11: Extract signed-fetch utility

**Problem**: HMAC request signing is duplicated in 3 places:
- `apps/backend/src/routes/cluster.ts:26-34` — `buildSignedHeaders()`
- `apps/backend/src/services/model-mover.ts:672-693` — `signedFetch()`
- `apps/backend/src/services/heartbeat.ts:116-124` — inline HMAC header construction

**Fix**: Extract to a shared utility in `apps/backend/src/services/cluster-auth.ts` (which already has `signRequest` and `verifyRequest`):

```typescript
// Add to apps/backend/src/services/cluster-auth.ts:

export function buildSignedHeaders(method: string, path: string, body: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.clusterSecret) {
    const { signature, timestamp } = signRequest(method, path, body, config.clusterSecret)
    headers['x-cluster-signature'] = signature
    headers['x-cluster-timestamp'] = String(timestamp)
  }
  return headers
}

export async function signedFetch(url: string, method: string, body?: string, timeoutMs = 10_000): Promise<Response> {
  const path = new URL(url).pathname
  const bodyStr = body ?? ''
  const headers = buildSignedHeaders(method, path, bodyStr)
  return fetch(url, {
    method,
    headers,
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
}
```

Then update all 3 files to import from `cluster-auth.ts`.

**Files**: `apps/backend/src/services/cluster-auth.ts`, `apps/backend/src/routes/cluster.ts:26-34`, `apps/backend/src/services/model-mover.ts:672-693`, `apps/backend/src/services/heartbeat.ts:116-124`

---

### FIX-12: Add startup probe to StatefulSet

**Problem**: `deploy/kubernetes/statefulset.yaml` has `livenessProbe` with `initialDelaySeconds: 30`, but vLLM model loading can take 30+ minutes. The liveness probe may kill pods during initial model loading.

**Fix**: Add a startup probe with a generous timeout:

```yaml
startupProbe:
  httpGet:
    path: /api/health/live
    port: 3000
  failureThreshold: 120
  periodSeconds: 15
  # Allows up to 30 minutes for startup (120 × 15s)
```

**Files**: `deploy/kubernetes/statefulset.yaml`

---

### FIX-13: Fix StaticPeerDiscovery unauthenticated health checks

**Problem**: `apps/backend/src/services/peer-discovery.ts:194` calls `/internal/ping` without HMAC auth headers. When `CLUSTER_SECRET` is set (which is now required per FIX-01), all health checks will get 401 and all peers will be marked unavailable.

**Fix**: Use signed fetch for health checks:

```typescript
import { buildSignedHeaders } from './cluster-auth.js'

// In pollPeers(), replace the fetch call:
const headers = buildSignedHeaders('GET', '/internal/ping', '')
const response = await fetch(`http://${host}:${port}/internal/ping`, {
  signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
  headers,
})
```

**Note**: This depends on FIX-11 (extract signed-fetch utility). If FIX-11 is done first, use `buildSignedHeaders` from `cluster-auth.ts`. Otherwise, inline the signing logic.

**Files**: `apps/backend/src/services/peer-discovery.ts:194`

---

### FIX-14: Debounce routing table rebuilds from heartbeats

**Problem**: `apps/backend/src/services/heartbeat.ts:176-181` triggers a full routing table rebuild on every heartbeat with version drift. With 8 pods heartbeating every 5s, model loading/unloading can cause 7 rebuilds every 5s.

**Fix**: Add a debounce mechanism:

```typescript
// Add to HeartbeatService class:
private rebuildTimeout: ReturnType<typeof setTimeout> | null = null
private static readonly REBUILD_DEBOUNCE_MS = 500

private scheduleRebuild(): void {
  if (this.rebuildTimeout) return  // Already scheduled
  this.rebuildTimeout = setTimeout(() => {
    this.rebuildTimeout = null
    clusterRoutingStore.rebuildFromPeers(peerStore.getAllPeers())
  }, HeartbeatService.REBUILD_DEBOUNCE_MS)
}

// In processHeartbeat, replace direct rebuild:
if (message.clusterVersion !== localVersion) {
  this.scheduleRebuild()  // ← debounced
}
```

Also clean up the timeout in `stop()`:
```typescript
if (this.rebuildTimeout) {
  clearTimeout(this.rebuildTimeout)
  this.rebuildTimeout = null
}
```

**Files**: `apps/backend/src/services/heartbeat.ts:176-181` and the class definition

---

## Priority 2 — Should Fix Soon (Non-blocking)

### FIX-15: Peer address validation in internal routes

**Problem**: `apps/backend/src/routes/internal.ts:170-186` — the `pod-joined` cluster event stores `address` from the event payload without validating it. Could allow injection of arbitrary addresses.

**Fix**: Validate that address is an RFC1918/RFC4193 private IP or a valid K8s pod hostname:

```typescript
case 'pod-joined': {
  const { podId, address, port } = event.payload as { podId: string; address: string; port: number }
  if (podId && !peerStore.getPeer(podId)) {
    // Validate address is a plausible internal address
    if (address && !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|[\w-]+\.)/.test(address)) {
      fastify.log.warn({ podId, address }, 'Rejected pod-joined with suspicious address')
      break
    }
    peerStore.addPeer({ ... })
  }
  break
}
```

**Files**: `apps/backend/src/routes/internal.ts:170-186`

---

### FIX-16: Fix heartbeat adding peers with empty address

**Problem**: `apps/backend/src/services/heartbeat.ts:162-164` adds new peers discovered via heartbeat with `address: ''`. This empty address flows into routing table entries and `fetch()` calls.

**Fix**: Extract the source address from the request. In the heartbeat route handler (`internal.ts`), pass the request's remote address to `processHeartbeat`:

```typescript
// In internal.ts heartbeat route handler, pass source IP:
const result = heartbeatService.processHeartbeat(request.body, request.ip)

// In heartbeat.ts processHeartbeat, use sourceIp as fallback:
peerStore.addPeer({
  podId: message.podId,
  address: sourceIp || '',  // Use request source IP instead of empty string
  port: config.port,
  ...
})
```

**Files**: `apps/backend/src/services/heartbeat.ts:160-174`, `apps/backend/src/routes/internal.ts` (heartbeat route)

---

### FIX-17: Pre-compute weighted round-robin index

**Problem**: `apps/backend/src/services/proxy-router.ts:141-155` creates a new `weighted[]` array on every request.

**Fix**: Cache the weighted list, invalidate when routing table version changes:

```typescript
class WeightedRoundRobin {
  private counters: Map<string, number> = new Map()
  private cachedWeighted: Map<string, { entries: RoutingEntry[]; version: number }> = new Map()

  select(modelName: string, entries: RoutingEntry[], tableVersion: number): RoutingEntry {
    if (entries.length === 1) return entries[0]

    let cached = this.cachedWeighted.get(modelName)
    if (!cached || cached.version !== tableVersion) {
      const weighted: RoutingEntry[] = []
      for (const entry of entries) {
        for (let i = 0; i < entry.weight; i++) {
          weighted.push(entry)
        }
      }
      cached = { entries: weighted, version: tableVersion }
      this.cachedWeighted.set(modelName, cached)
    }

    const idx = this.counters.get(modelName) ?? 0
    const selected = cached.entries[idx % cached.entries.length]
    this.counters.set(modelName, (idx + 1) % cached.entries.length)
    return selected
  }
}
```

**Files**: `apps/backend/src/services/proxy-router.ts:134-165`

---

### FIX-18: Add security context to StatefulSet

**Problem**: No `securityContext` in `deploy/kubernetes/statefulset.yaml`. Missing `runAsNonRoot`, `allowPrivilegeEscalation: false`.

**Fix**: Add to the container spec (note: GPU workloads may need `privileged` for NVIDIA, so test this):

```yaml
securityContext:
  allowPrivilegeEscalation: false
  # runAsNonRoot: true  # Uncomment if image supports non-root
  # readOnlyRootFilesystem: true  # Uncomment if venv can be pre-built
```

**Files**: `deploy/kubernetes/statefulset.yaml`

---

### FIX-19: Add pod anti-affinity to StatefulSet

**Problem**: No `topologySpreadConstraints` or `podAntiAffinity` — all pods could schedule on the same node, defeating the purpose of multi-pod HA.

**Fix**: Add preferred anti-affinity:

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
              - key: app
                operator: In
                values:
                  - sardeenz
          topologyKey: kubernetes.io/hostname
```

**Files**: `deploy/kubernetes/statefulset.yaml`

---

### FIX-20: Fix unsafe type assertions in leader-election

**Problem**: `apps/backend/src/services/leader-election.ts` uses `new Date(renewTime as unknown as string).getTime()` (triple-cast) at lines ~107, 122, 164. This is fragile.

**Fix**: Use the K8s client library's proper API, or parse more safely:

```typescript
// Replace: new Date(renewTime as unknown as string).getTime()
// With: new Date(String(renewTime)).getTime()
// Or if renewTime is already a Date: renewTime.getTime()
```

**Files**: `apps/backend/src/services/leader-election.ts:107,122,164` (approximate lines)

---

### FIX-21: Enforce 8-pod cluster cap

**Problem**: Spec (SC-006) defines 8 pods as a "hard cap" but no code validates this.

**Fix**: Add a check in `cluster-manager.ts` when handling new peers:

```typescript
private handlePeerAdded(peer: DiscoveredPeer): void {
  const MAX_CLUSTER_SIZE = 8
  if (peerStore.count() >= MAX_CLUSTER_SIZE) {
    this.logger.warn(
      { podId: peer.podId, currentSize: peerStore.count(), max: MAX_CLUSTER_SIZE },
      'Rejecting peer: cluster at maximum capacity'
    )
    return
  }
  // ... existing logic
}
```

**Files**: `apps/backend/src/services/cluster-manager.ts` (handlePeerAdded method)

---

## Priority 3 — Nice to Have (Post-Merge)

### FIX-22: Split cluster.ts route file

The file is ~800+ lines with 15+ route handlers. Split into sub-modules:
- `routes/cluster/status.ts` — GET /api/cluster, GET /api/cluster/pods
- `routes/cluster/models.ts` — load, unload, move, events
- `routes/cluster/presets.ts` — apply, sync
- `routes/cluster/profiles.ts` — memory profiles reconcile, export, import
- `routes/cluster/benchmarks.ts` — export, import
- `routes/cluster/index.ts` — re-exports/registers all sub-routes

### FIX-23: Use TypeBox schemas in cluster/internal routes

Currently uses raw JSON Schema objects. Switch to TypeBox `Type.*` for consistency with existing routes and better TypeScript inference.

### FIX-24: Add rate limiting to internal endpoints

Add Fastify rate-limiter plugin scoped to `/internal/*` routes (e.g., 100 req/s per source IP for heartbeats).

### FIX-25: Remove logger from ClusterRoutingStore

Stores in this project don't log (see `model-store.ts`, `peer-store.ts`). Remove `setLogger()` and the nullable logger pattern from `cluster-routing-store.ts`.

### FIX-26: Fix empty body inconsistency

`apps/backend/src/routes/cluster.ts:436-437` sends `body: ''` for POST unload requests. Should send `'{}'` for POST bodies to ensure HMAC calculation is consistent with what the receiver verifies.

---

## Execution Checklist

```
Priority 0 (Must fix):
[ ] FIX-01: Require CLUSTER_SECRET in cluster mode
[ ] FIX-02: Change default AUTH_MODE + add warning
[ ] FIX-03: Make migration idempotent
[ ] FIX-04: Fix cross-pod connection pooling (verify or switch to undici.Pool)
[ ] FIX-05: Atomic routing table rebuild
[ ] FIX-06: Validate peer addresses in leader-redirect

Priority 1 (Should fix):
[ ] FIX-07: Fix error handling string matching → instanceof
[ ] FIX-08: Fix useClusterStatus re-render loop
[ ] FIX-09: Validate redirect URL in useClusterStatus
[ ] FIX-10: Wire getGpus() to return actual GPU data
[ ] FIX-11: Extract signed-fetch utility
[ ] FIX-12: Add startup probe to StatefulSet
[ ] FIX-13: Fix StaticPeerDiscovery unauthenticated health checks
[ ] FIX-14: Debounce routing table rebuilds

Priority 2 (Should fix soon):
[ ] FIX-15: Peer address validation in internal routes
[ ] FIX-16: Fix heartbeat adding peers with empty address
[ ] FIX-17: Pre-compute weighted round-robin index
[ ] FIX-18: Add security context to StatefulSet
[ ] FIX-19: Add pod anti-affinity to StatefulSet
[ ] FIX-20: Fix unsafe type assertions in leader-election
[ ] FIX-21: Enforce 8-pod cluster cap

Priority 3 (Post-merge):
[ ] FIX-22: Split cluster.ts route file
[ ] FIX-23: Use TypeBox schemas
[ ] FIX-24: Add rate limiting to internal endpoints
[ ] FIX-25: Remove logger from ClusterRoutingStore
[ ] FIX-26: Fix empty body inconsistency
```

## Dependencies Between Fixes

```
FIX-01 (require CLUSTER_SECRET) ← FIX-13 (static discovery auth) depends on this
FIX-11 (extract signed-fetch) ← FIX-13 (uses buildSignedHeaders)
FIX-04 (undici.Pool) ← standalone, but test with FIX-05 (routing table rebuild)
FIX-08 (useClusterStatus) ← FIX-09 (redirect validation) can be done together
```

## Test Updates Needed

After applying fixes, update tests:
- `apps/backend/tests/unit/cluster-management.test.ts` — update for atomic rebuild (FIX-05), debounce (FIX-14)
- `apps/backend/tests/unit/cluster-routes.test.ts` — update for error class handling (FIX-07)
- `apps/backend/tests/unit/discovery-election.test.ts` — update for signed health checks (FIX-13)
- Add new test: config validation rejects missing CLUSTER_SECRET in cluster mode (FIX-01)
- Add new test: routing table rebuild is atomic (FIX-05)
