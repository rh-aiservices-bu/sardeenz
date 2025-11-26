import type { ModelStatus } from './models.js'

// SSE Event Types for Real-Time Streaming

/** Event type discriminator for SSE events */
export type SSEEventType = 'log' | 'status' | 'memory' | 'progress' | 'error'

/** Base interface for all SSE events */
export interface SSEEventBase {
  /** Unique event ID for client deduplication */
  id: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Model instance this event relates to */
  instanceId: string
  /** Event type discriminator */
  eventType: SSEEventType
}

/** Log event - for vLLM process output */
export interface LogEvent extends SSEEventBase {
  eventType: 'log'
  data: {
    /** Output stream (stdout or stderr) */
    stream: 'stdout' | 'stderr'
    /** Log line content */
    content: string
    /** Optional sequence number for ordering */
    lineNumber?: number
  }
}

/** Status event - for model state transitions */
export interface StatusEvent extends SSEEventBase {
  eventType: 'status'
  data: {
    /** Previous model status (null if first status) */
    previousStatus: ModelStatus | null
    /** Current model status */
    currentStatus: ModelStatus
    /** Human-readable status message */
    message?: string
    /** Error message if status is 'failed' */
    errorMessage?: string
  }
}

/** Memory event - for GPU memory updates */
export interface MemoryEvent extends SSEEventBase {
  eventType: 'memory'
  data: {
    /** GPU memory used in GB */
    gpuMemoryUsedGB: number
    /** GPU memory limit in GB */
    gpuMemoryLimitGB: number
    /** GPU memory usage percentage */
    gpuMemoryUsagePercent: number
  }
}

/** Progress event - for load progress indicators */
export interface ProgressEvent extends SSEEventBase {
  eventType: 'progress'
  data: {
    /** Loading phase */
    phase: 'initializing' | 'downloading' | 'loading' | 'warming_up' | 'ready'
    /** Progress percentage (0-100) if known */
    progress?: number
    /** Human-readable progress message */
    message: string
  }
}

/** Error event - for system/connection errors */
export interface ErrorEvent extends SSEEventBase {
  eventType: 'error'
  data: {
    /** Error code */
    code: string
    /** Error message */
    message: string
    /** Whether the error is recoverable */
    recoverable: boolean
  }
}

/** Union type for all SSE events */
export type SSEEvent = LogEvent | StatusEvent | MemoryEvent | ProgressEvent | ErrorEvent

/** Client-side subscription filter options */
export interface SSESubscriptionOptions {
  /** Filter by event types (default: all) */
  eventTypes?: SSEEventType[]
  /** Resume from timestamp for reconnection */
  since?: string
  /** Whether to replay buffered logs on connect */
  replayLogs?: boolean
}
