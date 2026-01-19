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
  defaultMaxTokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000, default: 4096 })),
  estimatedMemoryGB: Type.Optional(Type.Number({ minimum: 0 })),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 10 })),
})

export const ModelInstanceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  modelPath: Type.String({ pattern: '^[\\w\\-\\.]+/[\\w\\-\\.]+$' }),
  status: ModelStatusSchema,
  port: Type.Integer({ minimum: 1024, maximum: 65535 }),
  processId: Type.Integer({ minimum: 1 }),
  maxTokens: Type.Integer({ minimum: 1, maximum: 1000000 }),
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

// Model source type schema
export const ModelSourceTypeSchema = Type.Union([
  Type.Literal('huggingface'),
  Type.Literal('local'),
])

// API request/response schemas
export const LoadModelRequestSchema = Type.Object({
  model_path: Type.String({ minLength: 1 }),
  max_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000, default: 4096 })),
  extra_args: Type.Optional(Type.Array(Type.String())),
  gpu_ids: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 15 }))),
  tensor_parallel_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
  source_type: Type.Optional(ModelSourceTypeSchema),
  served_model_name: Type.Optional(Type.String({ minLength: 1 })),
  enable_sleep_mode: Type.Optional(Type.Boolean()),
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

export const ModelMemoryMetricsDTOSchema = Type.Object({
  weights_memory_gib: Type.Number(),
  cuda_graph_memory_gib: Type.Number(),
  kv_cache_available_gib: Type.Number(),
  kv_cache_per_request_mib: Type.Number(),
  max_model_len: Type.Integer(),
})

export const ModelInstanceDTOSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  model_path: Type.String(),
  model_name: Type.String(),
  status: ModelStatusSchema,
  port: Type.Integer(),
  process_id: Type.Integer(),
  max_tokens: Type.Integer(),
  gpu_memory_utilization: Type.Number(),
  loaded_at: Type.String({ format: 'date-time' }),
  ready_at: Type.Optional(Type.String({ format: 'date-time' })),
  error_message: Type.Optional(Type.String()),
  memory_metrics: Type.Optional(ModelMemoryMetricsDTOSchema),
  has_chat_template: Type.Optional(Type.Boolean()),
  launch_command: Type.Optional(Type.String()),
  gpu_ids: Type.Array(Type.Integer()),
  tensor_parallel_size: Type.Integer(),
  kvcached_enabled: Type.Boolean(),
  sleep_mode_enabled: Type.Boolean(),
  sleep_level: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)])),
  slept_at: Type.Optional(Type.String({ format: 'date-time' })),
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

// vLLM Proxy API schemas

// Embedding request (OpenAI-compatible)
export const EmbeddingRequestSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  input: Type.Union([Type.String(), Type.Array(Type.String())]),
  encoding_format: Type.Optional(Type.Union([Type.Literal('float'), Type.Literal('base64')])),
  user: Type.Optional(Type.String()),
})

// Tokenize request (vLLM-specific)
export const TokenizeRequestSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  prompt: Type.Optional(Type.String()),
  add_special_tokens: Type.Optional(Type.Boolean()),
})

// Detokenize request (vLLM-specific)
export const DetokenizeRequestSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  tokens: Type.Array(Type.Integer()),
})

// Generic vLLM request with required model field (for pooling, classification, score, re-rank)
export const VLLMGenericRequestSchema = Type.Object(
  {
    model: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true }
)

// vLLM models list response (for aggregation)
export const VLLMModelSchema = Type.Object({
  id: Type.String(),
  object: Type.Literal('model'),
  created: Type.Integer(),
  owned_by: Type.String(),
  root: Type.Optional(Type.String()),
  parent: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  max_model_len: Type.Optional(Type.Integer()),
  permission: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }))),
})

export const VLLMModelsListResponseSchema = Type.Object({
  object: Type.Literal('list'),
  data: Type.Array(VLLMModelSchema),
})

// Multi-GPU schemas

export const ModelGpuMemorySchema = Type.Object({
  model_path: Type.String(),
  instance_id: Type.String(),
  display_name: Type.String(),
  gpu_memory_gb: Type.Number(),
  color: Type.String(),
  is_sleeping: Type.Optional(Type.Boolean()),
})

export const KVCacheMetricsSchema = Type.Object({
  total_gb: Type.Number(),
  prealloc_gb: Type.Number(),
  used_gb: Type.Number(),
  free_gb: Type.Number(),
})

export const PerGpuMetricsSchema = Type.Object({
  gpu_index: Type.Integer(),
  name: Type.String(),
  total_gb: Type.Number(),
  used_gb: Type.Number(),
  free_gb: Type.Number(),
  utilization_percent: Type.Number(),
  models: Type.Array(ModelGpuMemorySchema),
  kvcache: Type.Optional(KVCacheMetricsSchema),
})

export const MultiGpuMemoryUsageResponseSchema = Type.Object({
  gpus: Type.Array(PerGpuMetricsSchema),
  kvcache: KVCacheMetricsSchema,
  total_system_free_gb: Type.Number(),
})

export const GpuInfoSchema = Type.Object({
  index: Type.Integer(),
  name: Type.String(),
  memory_total_mb: Type.Integer(),
  memory_used_mb: Type.Integer(),
  memory_free_mb: Type.Integer(),
  utilization_percent: Type.Number(),
  models_loaded: Type.Integer(),
  recommended: Type.Boolean(),
})

export const GpuRecommendationSchema = Type.Object({
  gpu_id: Type.Integer(),
  free_memory_gb: Type.Number(),
  reason: Type.String(),
})

export const GpuAvailabilityResponseSchema = Type.Object({
  gpus: Type.Array(GpuInfoSchema),
  recommendation: GpuRecommendationSchema,
})

// Settings schemas
export const HfTokenSourceSchema = Type.Union([
  Type.Literal('env'),
  Type.Literal('runtime'),
  Type.Null(),
])

export const SettingsResponseSchema = Type.Object({
  hf_token: Type.Union([Type.String(), Type.Null()]),
  hf_token_source: HfTokenSourceSchema,
})

export const UpdateSettingsRequestSchema = Type.Object({
  hf_token: Type.Optional(Type.String({ minLength: 1 })),
})

export const TestHfTokenRequestSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
})

export const TestHfTokenResponseSchema = Type.Object({
  valid: Type.Boolean(),
  username: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
})

// Local models schemas
export const LocalModelInfoSchema = Type.Object({
  name: Type.String(),
  path: Type.String(),
  modified_at: Type.Optional(Type.String({ format: 'date-time' })),
  has_config: Type.Boolean(),
})

export const ListLocalModelsResponseSchema = Type.Object({
  models: Type.Array(LocalModelInfoSchema),
  total: Type.Integer(),
  base_path: Type.String(),
})

export const LocalModelsStatusResponseSchema = Type.Object({
  enabled: Type.Boolean(),
  path: Type.Optional(Type.String()),
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
export type SettingsResponseType = Static<typeof SettingsResponseSchema>
export type UpdateSettingsRequestType = Static<typeof UpdateSettingsRequestSchema>
export type TestHfTokenRequestType = Static<typeof TestHfTokenRequestSchema>
export type TestHfTokenResponseType = Static<typeof TestHfTokenResponseSchema>
export type MultiGpuMemoryUsageResponseType = Static<typeof MultiGpuMemoryUsageResponseSchema>
export type GpuAvailabilityResponseType = Static<typeof GpuAvailabilityResponseSchema>
export type PerGpuMetricsType = Static<typeof PerGpuMetricsSchema>
export type GpuInfoType = Static<typeof GpuInfoSchema>
export type GpuRecommendationType = Static<typeof GpuRecommendationSchema>
export type ModelSourceTypeType = Static<typeof ModelSourceTypeSchema>
export type LocalModelInfoType = Static<typeof LocalModelInfoSchema>
export type ListLocalModelsResponseType = Static<typeof ListLocalModelsResponseSchema>
export type LocalModelsStatusResponseType = Static<typeof LocalModelsStatusResponseSchema>
export type EmbeddingRequest = Static<typeof EmbeddingRequestSchema>
export type TokenizeRequest = Static<typeof TokenizeRequestSchema>
export type DetokenizeRequest = Static<typeof DetokenizeRequestSchema>
export type VLLMGenericRequest = Static<typeof VLLMGenericRequestSchema>
export type VLLMModel = Static<typeof VLLMModelSchema>
export type VLLMModelsListResponse = Static<typeof VLLMModelsListResponseSchema>

// Sleep Mode schemas
export const SleepLevelSchema = Type.Union([Type.Literal(1), Type.Literal(2)])

export const SleepModelRequestSchema = Type.Object({
  level: Type.Optional(SleepLevelSchema),
})

export const SleepModelResponseSchema = Type.Object({
  status: Type.Literal('success'),
  instance_id: Type.String({ format: 'uuid' }),
  model_path: Type.String(),
  sleep_level: SleepLevelSchema,
  slept_at: Type.String({ format: 'date-time' }),
})

export const WakeModelRequestSchema = Type.Object({
  tags: Type.Optional(Type.Union([Type.Literal('weights'), Type.Literal('kv_cache')])),
})

export const WakeModelResponseSchema = Type.Object({
  status: Type.Literal('success'),
  instance_id: Type.String({ format: 'uuid' }),
  model_path: Type.String(),
  woke_at: Type.String({ format: 'date-time' }),
})

export const SleepStatusResponseSchema = Type.Object({
  instance_id: Type.String({ format: 'uuid' }),
  is_sleeping: Type.Boolean(),
  sleep_level: Type.Optional(SleepLevelSchema),
})

export type SleepModelRequestType = Static<typeof SleepModelRequestSchema>
export type SleepModelResponseType = Static<typeof SleepModelResponseSchema>
export type WakeModelRequestType = Static<typeof WakeModelRequestSchema>
export type WakeModelResponseType = Static<typeof WakeModelResponseSchema>
export type SleepStatusResponseType = Static<typeof SleepStatusResponseSchema>
