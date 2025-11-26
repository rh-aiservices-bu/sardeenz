import { Type, Static } from '@sinclair/typebox'
import { ModelStatus, RequestStatus, OperationStatus, OperationType } from './models.js'

// Enum schemas
export const ModelStatusSchema = Type.Enum(ModelStatus)
export const RequestStatusSchema = Type.Enum(RequestStatus)
export const OperationStatusSchema = Type.Enum(OperationStatus)
export const OperationTypeSchema = Type.Enum(OperationType)

// Entity schemas
export const ModelConfigurationSchema = Type.Object({
  modelPath: Type.String({ pattern: '^[\\w\\-\\.]+/[\\w\\-\\.]+$' }),
  displayName: Type.Optional(Type.String({ maxLength: 100 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  defaultMaxTokens: Type.Optional(Type.Integer({ minimum: 512, maximum: 32768, default: 4096 })),
  estimatedMemoryGB: Type.Optional(Type.Number({ minimum: 0 })),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 10 })),
})

export const ModelInstanceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  modelPath: Type.String({ pattern: '^[\\w\\-\\.]+/[\\w\\-\\.]+$' }),
  status: ModelStatusSchema,
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

// API request/response schemas
export const LoadModelRequestSchema = Type.Object({
  model_path: Type.String({ minLength: 1 }),
  max_tokens: Type.Optional(Type.Integer({ minimum: 512, maximum: 32768, default: 4096 })),
})

export const LoadModelResponseSchema = Type.Object({
  status: Type.Literal('success'),
  model: Type.String(),
  port: Type.Integer(),
  loaded_at: Type.String({ format: 'date-time' }),
  instance_id: Type.String({ format: 'uuid' }),
})

export const UnloadModelResponseSchema = Type.Object({
  status: Type.Literal('success'),
  model: Type.String(),
  unloaded_at: Type.String({ format: 'date-time' }),
})

export const ModelInstanceDTOSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  model_path: Type.String(),
  status: ModelStatusSchema,
  port: Type.Integer(),
  process_id: Type.Integer(),
  max_tokens: Type.Integer(),
  gpu_memory_utilization: Type.Number(),
  loaded_at: Type.String({ format: 'date-time' }),
  ready_at: Type.Optional(Type.String({ format: 'date-time' })),
  error_message: Type.Optional(Type.String()),
})

export const ListModelsResponseSchema = Type.Object({
  models: Type.Array(ModelInstanceDTOSchema),
  total: Type.Integer(),
})

export const GetModelResponseSchema = Type.Object({
  model: ModelInstanceDTOSchema,
})

export const ListInstancesResponseSchema = Type.Object({
  instances: Type.Array(ModelInstanceDTOSchema),
  total: Type.Integer(),
})

export const UnloadInstanceResponseSchema = Type.Object({
  status: Type.Literal('success'),
  instance_id: Type.String({ format: 'uuid' }),
  model_path: Type.String(),
  unloaded_at: Type.String({ format: 'date-time' }),
})

export const ModelHealthResponseSchema = Type.Object({
  status: Type.Union([Type.Literal('healthy'), Type.Literal('unhealthy')]),
  model: Type.String(),
  port: Type.Integer(),
  uptime_seconds: Type.Number({ minimum: 0 }),
})

export const SetMemoryLimitsRequestSchema = Type.Object({
  model_path: Type.String(),
  limit_gb: Type.Number({ minimum: 0.1 }),
})

export const SetMemoryLimitsResponseSchema = Type.Object({
  status: Type.Literal('success'),
  model: Type.String(),
  new_limit_gb: Type.Number(),
})

// Proxy API schemas (OpenAI-compatible)
export const CompletionRequestSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  prompt: Type.Union([Type.String(), Type.Array(Type.String())]),
  max_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 32768 })),
  temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
  top_p: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  n: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  stream: Type.Optional(Type.Boolean()),
  logprobs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
  echo: Type.Optional(Type.Boolean()),
  stop: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  presence_penalty: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })),
  frequency_penalty: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })),
  best_of: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  user: Type.Optional(Type.String()),
})

export const ChatMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant')]),
  content: Type.String(),
  name: Type.Optional(Type.String()),
})

export const ChatCompletionRequestSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  messages: Type.Array(ChatMessageSchema, { minItems: 1 }),
  max_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 32768 })),
  temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
  top_p: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  n: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  stream: Type.Optional(Type.Boolean()),
  stop: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  presence_penalty: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })),
  frequency_penalty: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })),
  user: Type.Optional(Type.String()),
})

export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    message: Type.String(),
    type: Type.String(),
    code: Type.Optional(Type.String()),
  }),
})

// Type exports for TypeScript inference
export type LoadModelRequestType = Static<typeof LoadModelRequestSchema>
export type LoadModelResponseType = Static<typeof LoadModelResponseSchema>
export type UnloadModelResponseType = Static<typeof UnloadModelResponseSchema>
export type ModelInstanceDTOType = Static<typeof ModelInstanceDTOSchema>
export type ListModelsResponseType = Static<typeof ListModelsResponseSchema>
export type GetModelResponseType = Static<typeof GetModelResponseSchema>
export type ModelHealthResponseType = Static<typeof ModelHealthResponseSchema>
export type SetMemoryLimitsRequestType = Static<typeof SetMemoryLimitsRequestSchema>
export type SetMemoryLimitsResponseType = Static<typeof SetMemoryLimitsResponseSchema>
export type CompletionRequestType = Static<typeof CompletionRequestSchema>
export type ChatCompletionRequestType = Static<typeof ChatCompletionRequestSchema>
export type ErrorResponseType = Static<typeof ErrorResponseSchema>
export type ListInstancesResponseType = Static<typeof ListInstancesResponseSchema>
export type UnloadInstanceResponseType = Static<typeof UnloadInstanceResponseSchema>
