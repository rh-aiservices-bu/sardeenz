import type { ErrorResponse } from '@sardeenz/types'

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public type: string = 'internal_error',
    public code?: string
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON(): ErrorResponse {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
      },
    }
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 404, 'not_found', code)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 409, 'conflict', code)
    this.name = 'ConflictError'
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 400, 'bad_request', code)
    this.name = 'BadRequestError'
  }
}

/** Details about a model loaded on a GPU */
export interface LoadedModelInfo {
  instanceId: string
  modelName: string
  memoryGb: number
}

/** Per-GPU memory breakdown for error responses */
export interface GpuMemoryDetail {
  index: number
  name: string
  totalGb: number
  freeGb: number
  requiredGb: number
  shortfallGb: number
  loadedModels: LoadedModelInfo[]
}

/** Source model memory composition */
export interface SourceModelDetail {
  instanceId: string
  modelName: string
  weightsGb?: number
  cudaGraphsGb?: number
  overheadGb?: number
  totalGb: number
}

/** Structured details for GPU memory errors */
export interface GpuMemoryErrorDetails {
  gpus: GpuMemoryDetail[]
  sourceModel?: SourceModelDetail
}

export class InsufficientMemoryError extends BadRequestError {
  constructor(
    message: string,
    public details: GpuMemoryErrorDetails
  ) {
    super(message, 'INSUFFICIENT_GPU_MEMORY')
    this.name = 'InsufficientMemoryError'
  }

  toJSON(): ErrorResponse {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
        details: this.details,
      },
    }
  }
}

export class InternalError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 500, 'internal_error', code)
    this.name = 'InternalError'
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 503, 'service_unavailable', code)
    this.name = 'ServiceUnavailableError'
  }
}

export class BadGatewayError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 502, 'bad_gateway', code)
    this.name = 'BadGatewayError'
  }
}

export class InsufficientResourcesError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 507, 'insufficient_resources', code)
    this.name = 'InsufficientResourcesError'
  }
}
