# Data Model: Multi-Model Platform

**Feature**: 001-multi-model-platform
**Date**: 2025-11-08
**Purpose**: Define core entities, relationships, validation rules, and state transitions

---

## Entity Definitions

### 1. ModelConfiguration

Represents the immutable configuration for a Large Language Model that can be loaded into the system.

**Fields:**

| Field                         | Type       | Required | Description                                                             | Validation                                                  |
| ----------------------------- | ---------- | -------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `modelPath`                   | `string`   | ✅       | Hugging Face model identifier or path (e.g., "meta-llama/Llama-3.2-1B") | Must match pattern `^[\w\-\.]+/[\w\-\.]+$` or absolute path |
| `displayName`                 | `string`   | ❌       | Human-readable name for UI display                                      | Max 100 characters                                          |
| `description`                 | `string`   | ❌       | Optional description of model capabilities                              | Max 500 characters                                          |
| `defaultMaxTokens`            | `number`   | ❌       | Default max sequence length for this model                              | Min: 512, Max: 32768, Default: 4096                         |
| `defaultGpuMemoryUtilization` | `number`   | ❌       | Default GPU memory utilization (0.0-1.0)                                | Min: 0.1, Max: 0.95, Default: 0.9                           |
| `estimatedMemoryGB`           | `number`   | ❌       | Estimated GPU memory consumption in GB                                  | Min: 0, informational only                                  |
| `tags`                        | `string[]` | ❌       | Tags for categorization (e.g., "small", "chat", "code")                 | Max 10 tags, each max 50 chars                              |

**Relationships:**

- One ModelConfiguration → Many ModelInstances (1:N)

**Notes:**

- This is a **catalog entity** (metadata only, not runtime state)
- Could be stored in config file, database, or hardcoded for PoC
- Not required for Phase 1; models can be launched directly by path

---

### 2. ModelInstance

Represents a running vLLM instance serving a specific model.

**Fields:**

| Field                  | Type          | Required | Description                                             | Validation                                       |
| ---------------------- | ------------- | -------- | ------------------------------------------------------- | ------------------------------------------------ |
| `id`                   | `string`      | ✅       | Unique identifier for this instance                     | UUID v4 format                                   |
| `modelPath`            | `string`      | ✅       | Model identifier (same as ModelConfiguration.modelPath) | Must match pattern                               |
| `status`               | `ModelStatus` | ✅       | Current lifecycle status                                | Enum: `starting`, `active`, `stopping`, `failed` |
| `port`                 | `number`      | ✅       | TCP port where vLLM instance is listening               | Min: 1024, Max: 65535                            |
| `processId`            | `number`      | ✅       | OS process ID (PID)                                     | Positive integer                                 |
| `maxTokens`            | `number`      | ✅       | Max sequence length for this instance                   | Min: 512, Max: 32768                             |
| `gpuMemoryUtilization` | `number`      | ✅       | GPU memory utilization setting (0.0-1.0)                | Min: 0.1, Max: 0.95                              |
| `loadedAt`             | `Date`        | ✅       | Timestamp when model started loading                    | ISO 8601 datetime                                |
| `readyAt`              | `Date`        | ❌       | Timestamp when model became ready                       | ISO 8601 datetime, null if not ready             |
| `errorMessage`         | `string`      | ❌       | Error message if status is `failed`                     | Max 1000 characters                              |
| `ipcSegmentName`       | `string`      | ✅       | kvcached IPC segment name                               | Computed from modelPath                          |

**Relationships:**

- Many ModelInstances → One ModelConfiguration (N:1) - optional relationship
- One ModelInstance → Many InferenceRequests (1:N)
- One ModelInstance → One ResourceMetrics (1:1)

**State Transitions:**

```
┌─────────┐
│ starting│──┐
└─────────┘  │
             │ Health check succeeds
             ▼
         ┌────────┐
         │ active │
         └────────┘
             │
             │ Unload requested
             ▼
         ┌──────────┐
         │ stopping │
         └──────────┘
             │
             │ Process exits
             ▼
         (deleted)

         ┌─────────┐
         │ starting│
         └─────────┘
             │
             │ Health check fails or process crashes
             ▼
         ┌────────┐
         │ failed │
         └────────┘
```

**Validation Rules:**

- `status === 'active'` → `readyAt` MUST be set
- `status === 'failed'` → `errorMessage` MUST be set
- `port` MUST be unique across all active instances
- `processId` MUST correspond to a running OS process (validated via process check)

---

### 3. InferenceRequest

Represents a single inference request routed through the proxy to a model instance.

**Fields:**

| Field          | Type            | Required | Description                                                       | Validation                                          |
| -------------- | --------------- | -------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| `id`           | `string`        | ✅       | Unique request identifier                                         | UUID v4 format                                      |
| `modelPath`    | `string`        | ✅       | Target model identifier                                           | Must match running ModelInstance.modelPath          |
| `endpoint`     | `string`        | ✅       | Target endpoint (e.g., "/v1/completions", "/v1/chat/completions") | Must start with "/"                                 |
| `method`       | `string`        | ✅       | HTTP method                                                       | Enum: `POST`                                        |
| `requestBody`  | `object`        | ✅       | Request payload sent to vLLM                                      | Valid JSON object                                   |
| `streaming`    | `boolean`       | ✅       | Whether request is streaming                                      | Boolean                                             |
| `receivedAt`   | `Date`          | ✅       | Timestamp when request was received by proxy                      | ISO 8601 datetime                                   |
| `forwardedAt`  | `Date`          | ❌       | Timestamp when request was forwarded to vLLM                      | ISO 8601 datetime                                   |
| `completedAt`  | `Date`          | ❌       | Timestamp when response was fully sent                            | ISO 8601 datetime                                   |
| `status`       | `RequestStatus` | ✅       | Request status                                                    | Enum: `pending`, `forwarded`, `completed`, `failed` |
| `statusCode`   | `number`        | ❌       | HTTP status code from vLLM response                               | 100-599                                             |
| `errorMessage` | `string`        | ❌       | Error message if request failed                                   | Max 1000 characters                                 |
| `durationMs`   | `number`        | ❌       | Total request duration in milliseconds                            | Computed: completedAt - receivedAt                  |

**Relationships:**

- Many InferenceRequests → One ModelInstance (N:1)

**State Transitions:**

```
┌─────────┐
│ pending │
└─────────┘
     │
     │ Forwarded to vLLM instance
     ▼
┌───────────┐
│ forwarded │
└───────────┘
     │
     ├─ Response received successfully ──▶ ┌───────────┐
     │                                      │ completed │
     │                                      └───────────┘
     │
     └─ Error occurred ──▶ ┌────────┐
                           │ failed │
                           └────────┘
```

**Validation Rules:**

- `status === 'completed'` → `statusCode` and `completedAt` MUST be set
- `status === 'failed'` → `errorMessage` MUST be set
- `durationMs` SHOULD be < 30000 (30 seconds) for non-streaming requests
- Streaming requests may have longer durations

**Notes:**

- For PoC, this entity may only exist in memory (not persisted)
- Used primarily for metrics and observability
- Consider retention policy (e.g., keep last 1000 requests per model)

---

### 4. ResourceMetrics

Represents real-time resource consumption metrics for a model instance.

**Fields:**

| Field                   | Type     | Required | Description                                | Validation                             |
| ----------------------- | -------- | -------- | ------------------------------------------ | -------------------------------------- |
| `modelPath`             | `string` | ✅       | Model identifier                           | Foreign key to ModelInstance.modelPath |
| `gpuMemoryUsedGB`       | `number` | ✅       | Current GPU memory used by this model (GB) | Min: 0                                 |
| `gpuMemoryLimitGB`      | `number` | ✅       | GPU memory limit set for this model (GB)   | Min: 0                                 |
| `gpuMemoryUsagePercent` | `number` | ✅       | Percentage of limit used                   | Computed: (used / limit) \* 100        |
| `cpuPercent`            | `number` | ❌       | CPU usage percentage                       | 0-100 (per core, may exceed 100)       |
| `systemMemoryUsedMB`    | `number` | ❌       | System RAM used (MB)                       | Min: 0                                 |
| `activeConnections`     | `number` | ✅       | Number of active HTTP connections          | Min: 0                                 |
| `totalRequests`         | `number` | ✅       | Total requests served since launch         | Min: 0                                 |
| `successfulRequests`    | `number` | ✅       | Successful requests (2xx status codes)     | Min: 0                                 |
| `failedRequests`        | `number` | ✅       | Failed requests (4xx, 5xx status codes)    | Min: 0                                 |
| `avgResponseTimeMs`     | `number` | ❌       | Average response time in milliseconds      | Min: 0                                 |
| `p95ResponseTimeMs`     | `number` | ❌       | 95th percentile response time (ms)         | Min: 0                                 |
| `lastUpdated`           | `Date`   | ✅       | Timestamp when metrics were last updated   | ISO 8601 datetime                      |

**Relationships:**

- One ResourceMetrics → One ModelInstance (1:1)

**Validation Rules:**

- `gpuMemoryUsagePercent` MUST equal `(gpuMemoryUsedGB / gpuMemoryLimitGB) * 100`
- `totalRequests` MUST equal `successfulRequests + failedRequests`
- `lastUpdated` SHOULD be recent (within last 30 seconds) for active models

**Data Sources:**

- `gpuMemory*` fields: Retrieved from `kvctl list --json` command
- `activeConnections`, `totalRequests`, etc.: Tracked by backend proxy service
- `avgResponseTimeMs`, `p95ResponseTimeMs`: Computed from InferenceRequest history

**Notes:**

- Metrics are **ephemeral** (not persisted to database for PoC)
- Refreshed every 5-10 seconds by metrics collector
- Exposed via `/api/memory/usage` and `/api/models/{modelPath}/metrics` endpoints

---

### 5. ControllerOperation

Represents an administrative operation (load, unload, restart) performed on the system.

**Fields:**

| Field             | Type              | Required | Description                        | Validation                                 |
| ----------------- | ----------------- | -------- | ---------------------------------- | ------------------------------------------ |
| `id`              | `string`          | ✅       | Unique operation identifier        | UUID v4 format                             |
| `operationType`   | `string`          | ✅       | Type of operation                  | Enum: `load`, `unload`, `restart`          |
| `modelPath`       | `string`          | ✅       | Target model identifier            | Must be valid model path                   |
| `initiatedBy`     | `string`          | ✅       | Username or system identifier      | Max 100 characters                         |
| `initiatedAt`     | `Date`            | ✅       | Timestamp when operation started   | ISO 8601 datetime                          |
| `completedAt`     | `Date`            | ❌       | Timestamp when operation completed | ISO 8601 datetime                          |
| `status`          | `OperationStatus` | ✅       | Operation status                   | Enum: `in_progress`, `completed`, `failed` |
| `errorMessage`    | `string`          | ❌       | Error message if operation failed  | Max 1000 characters                        |
| `durationSeconds` | `number`          | ❌       | Total operation duration           | Computed: completedAt - initiatedAt        |
| `parameters`      | `object`          | ❌       | Operation-specific parameters      | JSON object                                |

**Relationships:**

- Independent entity (no foreign keys)
- Linked to ModelInstance via `modelPath` (soft reference)

**State Transitions:**

```
┌─────────────┐
│ in_progress │
└─────────────┘
     │
     ├─ Operation succeeds ──▶ ┌───────────┐
     │                          │ completed │
     │                          └───────────┘
     │
     └─ Operation fails ──▶ ┌────────┐
                            │ failed │
                            └────────┘
```

**Validation Rules:**

- `status === 'completed'` → `completedAt` MUST be set
- `status === 'failed'` → `errorMessage` MUST be set
- `durationSeconds` MUST be < 300 (5 minutes) for load operations
- `durationSeconds` MUST be < 60 (1 minute) for unload operations

**Use Cases:**

- Audit logging for administrative actions
- Tracking operation failures for debugging
- Success criteria validation (e.g., "models load within 60 seconds")

**Notes:**

- May be persisted to database or log file
- Consider retention policy (e.g., keep last 100 operations)

---

## Entity Relationships Diagram

```
┌─────────────────────┐
│ ModelConfiguration  │
│ (Optional Catalog)  │
└──────────┬──────────┘
           │
           │ 1:N
           ▼
┌─────────────────────┐         ┌─────────────────────┐
│   ModelInstance     │────1:1──│  ResourceMetrics    │
│  (Runtime State)    │         │   (Real-time)       │
└──────────┬──────────┘         └─────────────────────┘
           │
           │ 1:N
           ▼
┌─────────────────────┐
│  InferenceRequest   │
│  (Request Logs)     │
└─────────────────────┘

┌─────────────────────┐
│ ControllerOperation │
│   (Audit Logs)      │
└─────────────────────┘
        │ soft reference (modelPath)
        └──────────────────────────────┐
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │   ModelInstance     │
                            └─────────────────────┘
```

---

## Type Definitions (TypeScript)

```typescript
// packages/types/src/models.ts

export enum ModelStatus {
  Starting = 'starting',
  Active = 'active',
  Stopping = 'stopping',
  Failed = 'failed',
}

export enum RequestStatus {
  Pending = 'pending',
  Forwarded = 'forwarded',
  Completed = 'completed',
  Failed = 'failed',
}

export enum OperationStatus {
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
}

export enum OperationType {
  Load = 'load',
  Unload = 'unload',
  Restart = 'restart',
}

export interface ModelConfiguration {
  modelPath: string
  displayName?: string
  description?: string
  defaultMaxTokens?: number
  defaultGpuMemoryUtilization?: number
  estimatedMemoryGB?: number
  tags?: string[]
}

export interface ModelInstance {
  id: string
  modelPath: string
  status: ModelStatus
  port: number
  processId: number
  maxTokens: number
  gpuMemoryUtilization: number
  loadedAt: Date
  readyAt?: Date
  errorMessage?: string
  ipcSegmentName: string
}

export interface InferenceRequest {
  id: string
  modelPath: string
  endpoint: string
  method: 'POST'
  requestBody: Record<string, unknown>
  streaming: boolean
  receivedAt: Date
  forwardedAt?: Date
  completedAt?: Date
  status: RequestStatus
  statusCode?: number
  errorMessage?: string
  durationMs?: number
}

export interface ResourceMetrics {
  modelPath: string
  gpuMemoryUsedGB: number
  gpuMemoryLimitGB: number
  gpuMemoryUsagePercent: number
  cpuPercent?: number
  systemMemoryUsedMB?: number
  activeConnections: number
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  avgResponseTimeMs?: number
  p95ResponseTimeMs?: number
  lastUpdated: Date
}

export interface ControllerOperation {
  id: string
  operationType: OperationType
  modelPath: string
  initiatedBy: string
  initiatedAt: Date
  completedAt?: Date
  status: OperationStatus
  errorMessage?: string
  durationSeconds?: number
  parameters?: Record<string, unknown>
}
```

---

## Storage Strategy (PoC Phase)

### In-Memory Storage (Phase 1)

**Entities stored in memory:**

- `ModelInstance`: Stored in `Map<string, ModelInstance>` keyed by `modelPath`
- `ResourceMetrics`: Stored in `Map<string, ResourceMetrics>` keyed by `modelPath`
- `InferenceRequest`: Circular buffer (last 1000 requests per model)
- `ControllerOperation`: Circular buffer (last 100 operations)

**Rationale:**

- Fast access for runtime operations
- No database dependency for PoC
- Simplified deployment
- Acceptable data loss on restart (stateless principle from constitution)

### Future Persistence (Post-PoC)

**Candidates for persistence:**

- `ModelConfiguration`: Config file or database (permanent catalog)
- `ControllerOperation`: Database for audit trail
- `InferenceRequest`: Time-series database for analytics (optional)
- `ResourceMetrics`: Time-series database for historical trends (optional)

---

## Validation Schemas (TypeBox)

```typescript
// packages/types/src/validation.ts
import { Type, Static } from '@sinclair/typebox'

export const ModelConfigurationSchema = Type.Object({
  modelPath: Type.String({ pattern: '^[\\w\\-\\.]+/[\\w\\-\\.]+$' }),
  displayName: Type.Optional(Type.String({ maxLength: 100 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  defaultMaxTokens: Type.Optional(Type.Integer({ minimum: 512, maximum: 32768, default: 4096 })),
  defaultGpuMemoryUtilization: Type.Optional(
    Type.Number({ minimum: 0.1, maximum: 0.95, default: 0.9 })
  ),
  estimatedMemoryGB: Type.Optional(Type.Number({ minimum: 0 })),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 10 })),
})

export const ModelInstanceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  modelPath: Type.String({ pattern: '^[\\w\\-\\.]+/[\\w\\-\\.]+$' }),
  status: Type.Enum(ModelStatus),
  port: Type.Integer({ minimum: 1024, maximum: 65535 }),
  processId: Type.Integer({ minimum: 1 }),
  maxTokens: Type.Integer({ minimum: 512, maximum: 32768 }),
  gpuMemoryUtilization: Type.Number({ minimum: 0.1, maximum: 0.95 }),
  loadedAt: Type.String({ format: 'date-time' }),
  readyAt: Type.Optional(Type.String({ format: 'date-time' })),
  errorMessage: Type.Optional(Type.String({ maxLength: 1000 })),
  ipcSegmentName: Type.String(),
})

export const ResourceMetricsSchema = Type.Object({
  modelPath: Type.String(),
  gpuMemoryUsedGB: Type.Number({ minimum: 0 }),
  gpuMemoryLimitGB: Type.Number({ minimum: 0 }),
  gpuMemoryUsagePercent: Type.Number({ minimum: 0, maximum: 100 }),
  cpuPercent: Type.Optional(Type.Number({ minimum: 0 })),
  systemMemoryUsedMB: Type.Optional(Type.Number({ minimum: 0 })),
  activeConnections: Type.Integer({ minimum: 0 }),
  totalRequests: Type.Integer({ minimum: 0 }),
  successfulRequests: Type.Integer({ minimum: 0 }),
  failedRequests: Type.Integer({ minimum: 0 }),
  avgResponseTimeMs: Type.Optional(Type.Number({ minimum: 0 })),
  p95ResponseTimeMs: Type.Optional(Type.Number({ minimum: 0 })),
  lastUpdated: Type.String({ format: 'date-time' }),
})
```

---

## Summary

**Core Entities:**

1. **ModelConfiguration** (optional catalog) - Model metadata
2. **ModelInstance** (runtime) - Running vLLM processes
3. **InferenceRequest** (logs) - Request tracking for metrics
4. **ResourceMetrics** (real-time) - GPU/CPU/memory usage
5. **ControllerOperation** (audit) - Administrative actions

**Key Relationships:**

- ModelConfiguration → ModelInstance (1:N)
- ModelInstance → InferenceRequest (1:N)
- ModelInstance → ResourceMetrics (1:1)

**Storage:**

- Phase 1: In-memory (Map data structures)
- Future: Config file + optional database for persistence

**Validation:**

- TypeBox schemas for compile-time and runtime validation
- State machine enforcement for status transitions
- Business rule validation (e.g., unique ports, valid process IDs)
