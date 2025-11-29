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
}

// Memory metrics parsed from vLLM logs

/** Memory metrics parsed from vLLM logs after model loading */
export interface ModelMemoryMetrics {
  /** Total actual GPU memory consumed by the model process in GiB (from nvidia-smi) */
  totalGpuMemoryGiB: number
  /** Model weights memory in GiB */
  weightsMemoryGiB: number
  /** CUDA graph capture memory in GiB */
  cudaGraphMemoryGiB: number
  /** Overhead memory (total - weights - CUDA graphs) in GiB */
  overheadMemoryGiB: number
  /** @deprecated KV cache available - meaningless with KVCached, kept for backwards compat */
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
