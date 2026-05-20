// Core enums for status tracking

export enum ModelStatus {
  Starting = 'starting',
  Running = 'running',
  Sleeping = 'sleeping',
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
  Move = 'move',
}

// Memory metrics parsed from vLLM logs

/** Memory metrics parsed from vLLM logs after model loading */
export interface ModelMemoryMetrics {
  /** Total actual GPU memory consumed by the model process in GiB (from NVML) */
  totalGpuMemoryGiB: number
  /** Model weights memory in GiB */
  weightsMemoryGiB: number
  /** CUDA graph capture memory in GiB */
  cudaGraphMemoryGiB: number
  /** Overhead memory (total - weights - CUDA graphs) in GiB */
  overheadMemoryGiB: number
  /** @deprecated KV cache available - meaningless with kvcached, kept for backwards compat */
  kvCacheAvailableGiB: number
  /** KV cache memory per max-size request in MiB */
  kvCachePerRequestMiB: number
  /** Max model context length used for calculation */
  maxModelLen: number
}

// Entity interfaces

export interface ModelConfiguration {
  modelPath: string
  displayName?: string
  description?: string
  defaultMaxTokens?: number
  estimatedMemoryGB?: number
  tags?: string[]
}

export interface ModelInstance {
  id: string
  modelPath: string
  /** Model name used by vLLM for inference (from --served-model-name or defaults to modelPath) */
  modelName: string
  status: ModelStatus
  port: number
  /** Main vLLM API Server process ID */
  processId: number
  /** vLLM EngineCore process ID (consumes GPU VRAM, extracted from logs) */
  engineCorePid?: number
  maxTokens: number
  gpuMemoryUtilization: number
  loadedAt: Date
  readyAt?: Date
  errorMessage?: string
  ipcSegmentName: string
  /** Parsed memory metrics (populated after model becomes active) */
  memoryMetrics?: ModelMemoryMetrics
  /** Whether model supports chat templates (true) or needs manual wrapping (false) */
  hasChatTemplate?: boolean
  /** Full vLLM launch command for debugging/reproduction */
  launchCommand?: string
  /** GPU indices this model is running on (single GPU: [0], tensor parallel: [0,1]) */
  gpuIds: number[]
  /** Tensor parallel size (1 = single GPU, >1 = spanning multiple GPUs) */
  tensorParallelSize: number
  /** Whether kvcached is enabled for this instance (disabled for tensor parallel) */
  kvcachedEnabled: boolean
  /** Memory baseline per GPU in GB (captured when model becomes 'running', before any inference) */
  memoryBaselineByGpu: Record<number, number>
  /** Whether sleep mode is enabled for this instance (requires --enable-sleep-mode flag) */
  sleepModeEnabled: boolean
  /** Current sleep level if sleeping (1 = weights to CPU, 2 = discard all) */
  sleepLevel?: 1 | 2
  /** Timestamp when model went to sleep */
  sleptAt?: Date
  /** Whether this instance should receive inference traffic (false during move operations) */
  routable: boolean
  /** Pod ID when running in a cluster (hostname from StatefulSet) */
  podId?: string
}

/** Phase of a model move operation */
export type MoveOperationPhase =
  | 'validating'
  | 'spawning'
  | 'switching'
  | 'draining'
  | 'completing'
  | 'failed'
  | 'completed'

/** Tracks a model move operation (relocating a model to different GPU(s)) */
export interface MoveOperation {
  /** Unique identifier for this move operation */
  id: string
  /** Instance ID of the model being moved (source) */
  sourceInstanceId: string
  /** Instance ID of the newly spawned model on target GPU(s) */
  targetInstanceId: string
  /** Target GPU indices for the move */
  targetGpuIds: number[]
  /** Timeout in ms to wait for in-flight requests to drain */
  drainTimeoutMs: number
  /** Current phase of the move operation */
  phase: MoveOperationPhase
  /** When the move operation started */
  startedAt: Date
  /** Error message if phase is 'failed' */
  error?: string
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
