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
