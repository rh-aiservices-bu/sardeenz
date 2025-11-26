// Core enums for status tracking

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
