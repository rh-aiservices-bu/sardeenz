# Model Move Feature - Implementation Plan

## Overview

This feature enables moving a model from one GPU to another to rebalance memory consumption. The implementation uses a blue-green deployment pattern: spawn a new instance on the target GPU, wait for it to be ready, update routing, gracefully drain the source, then unload it.

---

## Design Decisions Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Model name | Same served-model-name | Transparent to clients |
| GPU topology | Same tensor parallelism only | Simplifies implementation |
| Memory check | Require sufficient upfront | Fail early, predictable |
| In-flight handling | Graceful drain with configurable timeout | Zero request failures for well-behaved clients |
| Failure handling | Automatic rollback | Keep source running if target fails |
| Sleeping models | Allowed | Source stays sleeping, target loads fresh |
| Progress reporting | SSE stream | Consistent with model load UX |
| Presets | Unchanged by move | Presets are point-in-time snapshots |
| Trigger | Manual API, designed for future automation | Start simple, extensible |
| Streaming tracking | Ownership transfer pattern | Accurate connection count during drain |
| Audio requests | Full proxyRouter integration | Consistent connection tracking |
| Cancel semantics | Force parameter (default graceful) | User choice: revert vs force complete |
| Concurrent moves | Limit to 1 system-wide | Prevent memory spikes and confusion |

### UI Decisions

| Aspect | Decision |
|--------|----------|
| Entry points | Menu item + drag-and-drop on cards |
| Modal content | Target GPU selector with memory stats, drain timeout input |
| GPU selection | Explicit multi-GPU selection for tensor parallel (via menu) |
| Invalid GPUs | Disabled with insufficient memory indicator |
| Progress display | Inline in model card (status: "Moving: GPU0 → GPU2") |
| Dual instances during move | Hidden - single card shows move progress |
| Drag-drop scope | Single-GPU models only, desktop only |
| Drag feedback | Highlight valid targets, dim invalid ones |
| On drop | Open confirmation modal with pre-filled target |
| GPU Memory Panel | No drag-drop (too complex with Nivo charts) |

---

## Architecture Context

### Model Lifecycle (from exploration)

Models go through states: `starting` → `running` → `stopping` (or `failed`, `sleeping`)

Key files:
- `apps/backend/src/services/model-manager.ts` - Model lifecycle management
- `apps/backend/src/stores/model-store.ts` - In-memory model instance storage
- `apps/backend/src/services/proxy-router.ts` - Request routing and load balancing
- `apps/backend/src/services/gpu-selector.ts` - GPU selection logic

### Model Instance Structure

```typescript
interface ModelInstance {
  id: string                    // UUID
  modelPath: string             // HuggingFace path
  modelName: string             // served-model-name
  status: ModelStatus           // starting|running|sleeping|stopping|failed
  port: number                  // vLLM API port
  processId: number             // Main process PID
  engineCorePid?: number        // GPU memory consumer PID
  gpuIds: number[]              // Assigned GPUs
  tensorParallelSize: number    // For multi-GPU
  maxTokens: number
  gpuMemoryUtilization: number
  kvcachedEnabled: boolean
  sleepModeEnabled: boolean
  // ... other fields
}
```

### Routing Architecture

- `modelStore.getRunningByName(modelName)` returns all running instances
- Round-robin load balancing when multiple instances exist
- Routing table updates are atomic (JavaScript single-threaded)
- No request queuing - direct passthrough to vLLM

### kvcached Integration

- IPC segments are per-GPU (e.g., `kvcached_vllm_GPU0`)
- No state migration needed between instances
- Must use SIGKILL (not SIGTERM) to preserve shared IPC for other models

---

## Move Operation Phases

```
1. VALIDATING   - Check target GPU memory availability
2. SPAWNING     - Load model on target GPU (reuse launchModel)
3. SWITCHING    - Update routing table (both instances briefly share name)
4. DRAINING     - Wait for source connections to complete (or timeout)
5. COMPLETING   - Unload source instance, done
```

Error at any phase → automatic rollback (keep source, cleanup target if spawned)

---

## Backend Implementation

### 1. New Type Definitions

**File: `packages/types/src/models.ts`**

Add new status for models being moved:

```typescript
// Add to ModelStatus enum or as separate tracking
interface MoveOperation {
  id: string                    // Move operation UUID
  sourceInstanceId: string
  targetInstanceId: string      // Created during SPAWNING phase
  targetGpuIds: number[]
  drainTimeoutMs: number
  phase: 'validating' | 'spawning' | 'switching' | 'draining' | 'completing' | 'failed' | 'completed'
  startedAt: Date
  error?: string
}
```

**File: `packages/types/src/api.ts`**

Add API request/response types:

```typescript
interface MoveModelRequest {
  instanceId: string            // Source instance to move
  targetGpuIds: number[]        // Target GPU(s)
  drainTimeoutMs?: number       // Default: 60000 (60s)
}

interface MoveModelResponse {
  moveId: string                // Operation ID for SSE tracking
  sourceInstanceId: string
  targetGpuIds: number[]
}

// SSE event types
interface MoveProgressEvent {
  moveId: string
  phase: MoveOperation['phase']
  message: string
  progress?: number             // 0-100 for spawning phase
  error?: string
}
```

### 2. Connection Tracking Per Instance

**File: `apps/backend/src/stores/metrics-store.ts`**

Currently tracks connections per model path. Need per-instance tracking:

```typescript
// Add new map
private instanceConnections: Map<string, number> = new Map()

// Add methods
updateInstanceConnections(instanceId: string, delta: number): void
getInstanceConnections(instanceId: string): number
hasActiveConnections(instanceId: string): boolean
clearInstanceConnections(instanceId: string): void
```

**File: `apps/backend/src/services/proxy-router.ts`**

Update to track connections by instance ID with streaming awareness:

**Problem:** For streaming requests, `routeRequest()` returns the raw Response, and the finally block runs immediately - but streaming continues via `pipeStreamToReply()`. This would cause premature connection decrement.

**Solution:** Return `onStreamComplete` callback for streaming requests:

```typescript
interface RouteRequestResult {
  requestId: string
  response?: unknown | Response
  statusCode: number
  instanceId?: string
  startTime?: number
  onStreamComplete?: () => void  // NEW: caller must invoke when stream ends
}

async routeRequest(options): Promise<RouteRequestResult> {
  try {
    metricsStore.updateConnections(modelPath, 1)
    metricsStore.updateInstanceConnections(instance.id, 1)

    if (streaming) {
      // Create cleanup callback for caller to invoke
      const onStreamComplete = () => {
        metricsStore.updateConnections(modelPath, -1)
        metricsStore.updateInstanceConnections(instance.id, -1)
      }
      return { ..., onStreamComplete }
    }
    // Non-streaming: decrement in finally as before
  } finally {
    if (!streaming) {
      metricsStore.updateConnections(modelPath, -1)
      metricsStore.updateInstanceConnections(instance.id, -1)
    }
  }
}
```

**File: `apps/backend/src/routes/proxy.ts`**

Update `pipeStreamToReply()` to invoke the cleanup callback:

```typescript
async function pipeStreamToReply(
  reply: FastifyReply,
  response: Response,
  modelPath: string,
  startTime: number,
  logger: Logger,
  onStreamComplete?: () => void  // NEW parameter
): Promise<void> {
  try {
    // ... existing streaming logic ...
  } finally {
    // ... existing cleanup ...
    if (onStreamComplete) {
      onStreamComplete()  // Decrement connection count now
    }
  }
}
```

### 2b. Audio Route Integration

**Problem:** Audio endpoints (`/v1/audio/*`) bypass `proxyRouter.routeRequest()` entirely, selecting instances directly via `modelStore.getRunningByName()`. This means audio requests aren't tracked for draining.

**File: `apps/backend/src/services/proxy-router.ts`**

Add new method for audio routing:

```typescript
selectInstanceForAudio(modelName: string): {
  instance: ModelInstance
  releaseConnection: () => void
} {
  const instances = modelStore.getRunningByName(modelName)
  // ... validation ...

  const instance = this.loadBalancer.selectInstance(instances)

  metricsStore.updateConnections(modelName, 1)
  metricsStore.updateInstanceConnections(instance.id, 1)

  const releaseConnection = () => {
    metricsStore.updateConnections(modelName, -1)
    metricsStore.updateInstanceConnections(instance.id, -1)
  }

  return { instance, releaseConnection }
}
```

**File: `apps/backend/src/routes/proxy.ts`**

Refactor `handleAudioProxyRequest()` to use `proxyRouter.selectInstanceForAudio()`:

```typescript
async function handleAudioProxyRequest(..., proxyRouter: ProxyRouter) {
  let releaseConnection: (() => void) | undefined

  try {
    const { instance, releaseConnection: release } = proxyRouter.selectInstanceForAudio(model)
    releaseConnection = release

    // ... existing audio forwarding logic ...
  } finally {
    if (releaseConnection) {
      releaseConnection()
    }
  }
}
```

### 3. Move Operation Store

**File: `apps/backend/src/stores/move-store.ts` (new)**

Includes concurrent move limiting (max 1 system-wide):

```typescript
class MoveStore {
  private operations: Map<string, MoveOperation> = new Map()
  private activeMove: string | null = null  // Lock for concurrent moves

  // Concurrency control
  tryAcquireLock(moveId: string): boolean {
    if (this.activeMove !== null) return false
    this.activeMove = moveId
    return true
  }
  releaseLock(moveId: string): void
  isMoveInProgress(): boolean
  getActiveMoveId(): string | null

  // CRUD - create() throws if another move in progress
  create(op: MoveOperation): void {
    if (!this.tryAcquireLock(op.id)) {
      throw new Error('Another move operation is already in progress')
    }
    this.operations.set(op.id, op)
  }
  get(moveId: string): MoveOperation | undefined
  update(moveId: string, updates: Partial<MoveOperation>): void
  complete(moveId: string, status: 'completed' | 'failed', error?: string): void {
    // Updates operation and releases lock
  }

  // Lookup
  getBySourceInstance(instanceId: string): MoveOperation | undefined
  getByTargetInstance(instanceId: string): MoveOperation | undefined

  // Maintenance
  pruneCompletedOperations(): void  // Keep last 10 completed
}
```

### 4. Move Model Service

**File: `apps/backend/src/services/model-mover.ts` (new)**

```typescript
class ModelMover {
  constructor(
    private modelManager: ModelManager,
    private modelStore: ModelStore,
    private moveStore: MoveStore,
    private metricsStore: MetricsStore,
    private eventBus: EventBus,
    private gpuSelector: GpuSelector
  ) {}

  async moveModel(request: MoveModelRequest): Promise<MoveModelResponse> {
    // 1. Validate source exists and is running or sleeping
    // 2. Validate not already being moved
    // 3. Validate target GPUs different from source
    // 4. Validate tensor parallelism matches
    // 5. Check target GPU memory (pre-flight)
    // 6. Create move operation record
    // 7. Start async move process
    // 8. Return move ID for SSE tracking
  }

  private async executeMoveAsync(moveId: string): Promise<void> {
    // Phase: SPAWNING
    // - Copy config from source instance
    // - Call modelManager.launchModel with target GPUs
    // - Wait for 'running' status
    // - On failure: emit failed event, cleanup, rollback

    // Phase: SWITCHING
    // - Target is now in routing table (same modelName)
    // - Remove source from routing table (but don't unload yet)
    // - This is atomic: modelStore.setRoutable(sourceId, false)

    // Phase: DRAINING
    // - Poll metricsStore.getInstanceConnections(sourceId)
    // - Wait until 0, or timeout
    // - Emit progress events

    // Phase: COMPLETING
    // - Call modelManager.unloadModel(sourceId)
    // - Update move operation as completed
    // - Emit completed event
  }

  async cancelMove(moveId: string, force: boolean = false): Promise<void> {
    // If in VALIDATING: simply abort
    // If in SPAWNING: kill target, keep source
    // If in SWITCHING/DRAINING:
    //   - force=false (graceful): revert to source (make source routable again, unload target)
    //   - force=true: force complete (unload source immediately, warn about dropped connections)
    // If in COMPLETING: too late to cancel
    // If completed/failed: no-op
  }

  private async revertToSource(moveId: string, op: MoveOperation): Promise<void> {
    // Make source routable again
    modelStore.setRoutable(op.sourceInstanceId, true)
    // Unload target
    await modelManager.unloadModel(op.targetInstanceId)
    moveStore.complete(moveId, 'failed', 'Cancelled by user - reverted to source')
  }

  private async forceCompleteDrain(moveId: string, op: MoveOperation): Promise<void> {
    const activeConnections = metricsStore.getInstanceConnections(op.sourceInstanceId)
    if (activeConnections > 0) {
      logger.warn({ moveId, activeConnections }, 'Force completing - connections will be dropped')
    }
    await modelManager.unloadModel(op.sourceInstanceId)
    moveStore.complete(moveId, 'completed', 'Force completed')
  }
}
```

### 5. Model Store Updates

**File: `packages/types/src/models.ts`**

Add `routable` field directly to `ModelInstance` (avoids separate Set with sync issues):

```typescript
interface ModelInstance {
  // ... existing fields ...

  /**
   * Whether this instance is available for routing.
   * Set to false during move operations to drain connections.
   * Defaults to true when status becomes 'running'.
   */
  routable: boolean
}
```

**File: `apps/backend/src/stores/model-store.ts`**

Add routing control methods:

```typescript
setRoutable(instanceId: string, routable: boolean): boolean {
  const instance = this.instances.get(instanceId)
  if (!instance) return false
  instance.routable = routable
  return true
}

isRoutable(instanceId: string): boolean {
  const instance = this.instances.get(instanceId)
  return instance?.routable !== false
}

// Update getRunningByName to check routable field:
getRunningByName(modelName: string): ModelInstance[] {
  return this.getAllByName(modelName)
    .filter((i) => i.status === 'running' && i.routable !== false)
}
```

**File: `apps/backend/src/services/model-manager.ts`**

Set `routable: true` when model reaches 'running' status (in `monitorModelStartup()`):

```typescript
// After instance.status = 'running':
instance.routable = true
modelStore.set(instance)
```

### 6. API Endpoint

**File: `apps/backend/src/routes/models.ts`**

```typescript
// POST /api/models/:instanceId/move
fastify.post<{
  Params: { instanceId: string }
  Body: { targetGpuIds: number[]; drainTimeoutMs?: number }
}>('/api/models/:instanceId/move', async (request, reply) => {
  const { instanceId } = request.params
  const { targetGpuIds, drainTimeoutMs } = request.body

  const result = await modelMover.moveModel({
    instanceId,
    targetGpuIds,
    drainTimeoutMs: drainTimeoutMs ?? 60000
  })

  return reply.code(202).send(result)
})

// GET /api/models/moves/:moveId/events (SSE)
fastify.get<{ Params: { moveId: string } }>(
  '/api/models/moves/:moveId/events',
  async (request, reply) => {
    // Similar to existing model load SSE pattern
    // Stream MoveProgressEvent updates
  }
)

// DELETE /api/models/moves/:moveId?force=true (cancel)
fastify.delete<{
  Params: { moveId: string }
  Querystring: { force?: boolean }
}>(
  '/api/models/moves/:moveId',
  async (request, reply) => {
    const force = request.query.force === true || request.query.force === 'true'
    await modelMover.cancelMove(request.params.moveId, force)
    return reply.code(204).send()
  }
)
```

### 7. Memory Pre-flight Check

**File: `apps/backend/src/services/gpu-selector.ts`**

Add method to check if GPU has sufficient memory:

```typescript
async checkMemoryAvailability(
  gpuIds: number[],
  requiredMemoryGb: number
): Promise<{ available: boolean; freeMemoryGb: number; message?: string }>
```

Use source instance's `memoryBaselineByGpu` as estimate for required memory.

---

## Frontend Implementation

### 1. API Client Updates

**File: `apps/frontend/src/services/api.ts`**

```typescript
interface MoveModelRequest {
  targetGpuIds: number[]
  drainTimeoutMs?: number
}

interface MoveModelResponse {
  moveId: string
  sourceInstanceId: string
  targetGpuIds: number[]
}

// Add methods
async moveModel(instanceId: string, request: MoveModelRequest): Promise<MoveModelResponse>
subscribeMoveEvents(moveId: string, onEvent: (event: MoveProgressEvent) => void): () => void
async cancelMove(moveId: string, force?: boolean): Promise<void>
```

### 2. Move Model Modal Component

**File: `apps/frontend/src/components/MoveModelDialog.tsx` (new)**

Props:
```typescript
interface MoveModelDialogProps {
  isOpen: boolean
  onClose: () => void
  model: ModelInstanceDTO
  preselectedGpuIds?: number[]  // From drag-drop
  gpuMemoryData: MultiGpuMemoryUsageResponse
  onMoveStarted: (moveId: string) => void
}
```

UI Elements:
- Title: "Move Model: {modelName}"
- Current GPU display (read-only)
- Target GPU selector (checkboxes for tensor parallel, radio for single)
  - Show free memory per GPU
  - Disable GPUs with insufficient memory
  - Disable current GPU(s)
- Drain timeout input (number field, default 60s)
- Estimated memory requirement display
- Move / Cancel buttons

Validation:
- Target must be different from source
- Target GPU count must match tensor parallelism
- Target must have sufficient free memory

### 3. Drag-and-Drop Implementation

**File: `apps/frontend/src/components/ModelCardCompact.tsx`**

Add drag source capability:

```typescript
import { useDraggable } from '@dnd-kit/core'

// In component:
const isDraggable = model.gpu_ids.length === 1 && model.status === 'running'

const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
  id: model.id,
  disabled: !isDraggable,
  data: { model }
})
```

Visual changes when dragging:
- Reduced opacity
- "Dragging" cursor

**File: `apps/frontend/src/components/GpuGroupSection.tsx`**

Add drop target capability:

```typescript
import { useDroppable } from '@dnd-kit/core'

const { setNodeRef, isOver, active } = useDroppable({
  id: `gpu-group-${gpuKey}`,
  data: { gpuIds: parseGpuKey(gpuKey) }
})

// Determine if this is a valid drop target
const draggedModel = active?.data?.current?.model
const isValidTarget = draggedModel && !draggedModel.gpu_ids.includes(gpuIndex) && hasEnoughMemory
```

Visual changes:
- Valid target when dragging: green border highlight
- Invalid target: dimmed, no-drop cursor
- Hovering valid target: stronger highlight

**File: `apps/frontend/src/pages/ModelManagement.tsx`**

Add DnD context:

```typescript
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core'

// Wrap content in DndContext
<DndContext
  collisionDetection={pointerWithin}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
>
  {/* GPU groups */}
  <DragOverlay>
    {activeDragModel && <ModelCardCompact model={activeDragModel} isDragOverlay />}
  </DragOverlay>
</DndContext>

// Handle drop
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  if (!over) return

  const model = active.data.current?.model
  const targetGpuIds = over.data.current?.gpuIds

  if (model && targetGpuIds) {
    // Open move dialog with preselected target
    setMoveDialogModel(model)
    setPreselectedGpuIds(targetGpuIds)
    setIsMoveDialogOpen(true)
  }
}
```

### 4. Model Card Move Status Display

**File: `apps/frontend/src/components/ModelCardCompact.tsx`**

When model is being moved (tracked via parent state or context):

```typescript
// If this model is source of active move operation
if (activeMoveOperation?.sourceInstanceId === model.id) {
  return (
    <Card className="model-card-moving">
      {/* Show move progress instead of normal content */}
      <CardBody>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <Spinner size="md" />
          <FlexItem>
            Moving to GPU {activeMoveOperation.targetGpuIds.join(', ')}...
          </FlexItem>
        </Flex>
        <ProgressBar value={activeMoveOperation.progress} />
        <Text>Phase: {activeMoveOperation.phase}</Text>
      </CardBody>
    </Card>
  )
}
```

### 5. Menu Item Addition

**File: `apps/frontend/src/components/ModelCardCompact.tsx`**

Add to kebab menu:

```typescript
<DropdownItem
  key="move"
  onClick={() => onMoveClick?.(model)}
  isDisabled={model.status !== 'running' && model.status !== 'sleeping'}
>
  Move to different GPU
</DropdownItem>
```

### 6. Package Dependencies

**File: `apps/frontend/package.json`**

Add:
```json
{
  "dependencies": {
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/utilities": "^3.2.2"
  }
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/backend/src/stores/move-store.ts` | Track active move operations |
| `apps/backend/src/services/model-mover.ts` | Move orchestration logic |
| `apps/frontend/src/components/MoveModelDialog.tsx` | Move confirmation modal |

## Files to Modify

### Backend
| File | Changes |
|------|---------|
| `packages/types/src/models.ts` | Add `routable` field to ModelInstance, add MoveOperation interface |
| `packages/types/src/api.ts` | Add move request/response types |
| `apps/backend/src/stores/model-store.ts` | Add `setRoutable()`, `isRoutable()`, update `getRunningByName()` filter |
| `apps/backend/src/stores/metrics-store.ts` | Add per-instance connection tracking (`instanceConnections` Map) |
| `apps/backend/src/services/proxy-router.ts` | Add `onStreamComplete` callback for streaming, add `selectInstanceForAudio()` method |
| `apps/backend/src/services/model-manager.ts` | Set `routable: true` when model reaches 'running' status |
| `apps/backend/src/services/gpu-selector.ts` | Add memory availability check |
| `apps/backend/src/routes/proxy.ts` | Update `pipeStreamToReply()` to invoke callback, refactor `handleAudioProxyRequest()` |
| `apps/backend/src/routes/models.ts` | Add move endpoints |
| `apps/backend/src/index.ts` | Wire up ModelMover service |

### Frontend
| File | Changes |
|------|---------|
| `apps/frontend/package.json` | Add @dnd-kit dependencies |
| `apps/frontend/src/services/api.ts` | Add move API methods |
| `apps/frontend/src/pages/ModelManagement.tsx` | Add DndContext, move state |
| `apps/frontend/src/components/ModelCardCompact.tsx` | Add draggable, menu item, move status |
| `apps/frontend/src/components/GpuGroupSection.tsx` | Add droppable |
| `apps/frontend/src/components/index.ts` | Export MoveModelDialog |

---

## Testing Plan

### Backend Unit Tests

1. **MoveStore**: CRUD operations, lookup by source/target instance
2. **ModelMover**:
   - Validation: source exists, not already moving, valid target GPUs
   - Memory pre-flight check
   - Phase transitions
   - Rollback on spawn failure
   - Drain timeout behavior
3. **MetricsStore**: Per-instance connection tracking
4. **ModelStore**: Routable flag behavior

### Backend Integration Tests

1. Move running model to different GPU
2. Move sleeping model
3. Move with active connections (drain behavior)
4. Move with drain timeout exceeded
5. Cancel move during spawning phase
6. Cancel move during draining phase (graceful - revert to source)
7. Cancel move during draining phase with force=true (force complete)
8. Move failure (target GPU OOM)
9. Concurrent move attempts on same model (should reject)
10. Concurrent move attempts on different models (should reject - 1 system-wide limit)
11. Streaming request tracking during drain (verify stream completes before unload)
12. Audio request tracking during drain

### Frontend Tests

1. **MoveModelDialog**:
   - Renders with correct GPU options
   - Disables insufficient memory GPUs
   - Validates tensor parallelism match
   - Submits correct request
2. **Drag-and-drop**:
   - Single-GPU models are draggable
   - Multi-GPU models are not draggable
   - Valid drop targets highlight
   - Invalid targets are dimmed
   - Drop opens modal with preselected target
3. **Move progress display**:
   - Shows progress during move
   - Updates on SSE events
   - Handles completion
   - Handles failure

### E2E Verification

1. Load two models on GPU 0
2. Verify both appear in GPU 0 section
3. Start inference request to model A (keep it running)
4. Initiate move of model A to GPU 1
5. Verify:
   - Progress shown in UI
   - Inference request completes successfully
   - Model A now appears in GPU 1 section
   - GPU 0 memory freed
   - New requests to model A succeed (routed to GPU 1)

---

## Implementation Order

### Phase 1: Backend Foundation
1. Add type definitions (`packages/types`)
2. Create MoveStore
3. Add per-instance connection tracking to MetricsStore
4. Update proxy-router to track instance connections
5. Add routable flag to ModelStore
6. Add memory check to GpuSelector

### Phase 2: Backend Move Service
1. Create ModelMover service
2. Implement move validation
3. Implement async move execution
4. Implement drain logic with timeout
5. Implement rollback logic
6. Add API endpoints

### Phase 3: Frontend Modal
1. Add API client methods
2. Create MoveModelDialog component
3. Add menu item to ModelCardCompact
4. Wire up in ModelManagement page
5. Add move progress display

### Phase 4: Frontend Drag-and-Drop
1. Add @dnd-kit dependencies
2. Make ModelCardCompact draggable
3. Make GpuGroupSection droppable
4. Add DndContext to ModelManagement
5. Add visual feedback (highlights, overlays)
6. Connect drop to modal

### Phase 5: Testing & Polish
1. Write unit tests
2. Write integration tests
3. Manual E2E testing
4. Fix edge cases
5. Polish UI animations/transitions

---

## Open Questions / Future Enhancements

1. **Automated rebalancing**: Could add a "Rebalance" button that suggests optimal GPU assignments based on memory usage patterns.

2. **Move history**: Track completed moves for debugging/auditing.

3. **Batch moves**: Move multiple models at once as part of a rebalancing operation.

4. **GPU Memory Panel drag**: Deferred due to Nivo chart complexity. Could revisit with custom visualization.

5. **Touch support**: Currently desktop-only. Could add long-press-to-drag for tablets.

6. **Preset updates**: Currently presets unchanged. Could offer "Update preset with new GPU assignments" option.
