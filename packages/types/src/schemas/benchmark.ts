/**
 * TypeBox Validation Schemas for Benchmarking & Memory Profiling
 */

import { Type, Static } from '@sinclair/typebox'
import { BenchmarkStatus, BenchmarkMode, ScenarioStatus } from '../benchmark.js'
import { MemoryWarningLevel } from '../memory-profile.js'

// Enum schemas
export const BenchmarkStatusSchema = Type.Enum(BenchmarkStatus)
export const BenchmarkModeSchema = Type.Enum(BenchmarkMode)
export const ScenarioStatusSchema = Type.Enum(ScenarioStatus)
export const MemoryWarningLevelSchema = Type.Enum(MemoryWarningLevel)

// Routing mode for benchmark requests
export const RoutingModeSchema = Type.Union([Type.Literal('direct'), Type.Literal('proxy')])

// =====================
// Benchmark Schemas
// =====================

export const BenchmarkScenarioConfigSchema = Type.Object({
  instanceId: Type.String({ format: 'uuid' }),
  routingMode: Type.Optional(RoutingModeSchema),
  inputTokens: Type.Integer({ minimum: 64, maximum: 16384, default: 512 }),
  outputTokens: Type.Integer({ minimum: 16, maximum: 32768, default: 128 }),
  concurrency: Type.Integer({ minimum: 1, maximum: 100, default: 1 }),
  totalRequests: Type.Integer({ minimum: 10, maximum: 5000, default: 50 }),
  warmupRequests: Type.Integer({ minimum: 0, maximum: 10, default: 3 }),
  slaThresholdMs: Type.Optional(Type.Number({ minimum: 100, maximum: 60000 })),
})

export const CreateBenchmarkRequestSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  mode: BenchmarkModeSchema,
  scenarios: Type.Array(BenchmarkScenarioConfigSchema, { minItems: 1, maxItems: 10 }),
})

export const BenchmarkScenarioSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  run_id: Type.String({ format: 'uuid' }),
  instance_id: Type.String({ format: 'uuid' }),
  routing_mode: RoutingModeSchema,
  model_path: Type.String(),
  model_name: Type.String(),
  input_tokens: Type.Integer(),
  output_tokens: Type.Integer(),
  concurrency: Type.Integer(),
  warmup_requests: Type.Integer(),
  total_requests: Type.Integer(),
  sla_threshold_ms: Type.Optional(Type.Number()),
  status: ScenarioStatusSchema,
  started_at: Type.Optional(Type.String({ format: 'date-time' })),
  completed_at: Type.Optional(Type.String({ format: 'date-time' })),
  error_message: Type.Optional(Type.String()),
})

export const BenchmarkResultSchema = Type.Object({
  id: Type.Integer(),
  scenario_id: Type.String({ format: 'uuid' }),
  request_sequence: Type.Integer(),
  is_warmup: Type.Boolean(),
  ttft_ms: Type.Optional(Type.Number()),
  total_latency_ms: Type.Number(),
  prompt_tokens: Type.Optional(Type.Integer()),
  completion_tokens: Type.Optional(Type.Integer()),
  tokens_per_second: Type.Optional(Type.Number()),
  success: Type.Boolean(),
  error_message: Type.Optional(Type.String()),
  http_status: Type.Optional(Type.Integer()),
  executed_at: Type.String({ format: 'date-time' }),
})

export const BenchmarkMetricsSchema = Type.Object({
  scenario_id: Type.String({ format: 'uuid' }),

  // TTFT metrics
  ttft_min: Type.Optional(Type.Number()),
  ttft_max: Type.Optional(Type.Number()),
  ttft_avg: Type.Optional(Type.Number()),
  ttft_p50: Type.Optional(Type.Number()),
  ttft_p90: Type.Optional(Type.Number()),
  ttft_p95: Type.Optional(Type.Number()),
  ttft_p99: Type.Optional(Type.Number()),

  // TPS metrics
  tps_min: Type.Optional(Type.Number()),
  tps_max: Type.Optional(Type.Number()),
  tps_avg: Type.Optional(Type.Number()),
  tps_p50: Type.Optional(Type.Number()),
  tps_p90: Type.Optional(Type.Number()),
  tps_p95: Type.Optional(Type.Number()),
  tps_p99: Type.Optional(Type.Number()),

  // E2E latency metrics
  e2e_min: Type.Optional(Type.Number()),
  e2e_max: Type.Optional(Type.Number()),
  e2e_avg: Type.Optional(Type.Number()),
  e2e_p50: Type.Optional(Type.Number()),
  e2e_p90: Type.Optional(Type.Number()),
  e2e_p95: Type.Optional(Type.Number()),
  e2e_p99: Type.Optional(Type.Number()),

  // Goodput
  goodput_count: Type.Optional(Type.Integer()),
  goodput_percent: Type.Optional(Type.Number()),
  sla_threshold_ms: Type.Optional(Type.Number()),

  // Memory metrics
  kvcache_used_avg_gb: Type.Optional(Type.Number()),
  kvcache_peak_gb: Type.Optional(Type.Number()),
  gpu_memory_peak_gb: Type.Optional(Type.Number()),

  // Request stats
  total_requests: Type.Integer(),
  successful_requests: Type.Integer(),
  failed_requests: Type.Integer(),
  requests_per_second: Type.Optional(Type.Number()),
  tokens_per_second_total: Type.Optional(Type.Number()),
})

export const BenchmarkRunSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.Optional(Type.String()),
  status: BenchmarkStatusSchema,
  mode: BenchmarkModeSchema,
  kvcached_enabled: Type.Boolean(),
  created_at: Type.String({ format: 'date-time' }),
  started_at: Type.Optional(Type.String({ format: 'date-time' })),
  completed_at: Type.Optional(Type.String({ format: 'date-time' })),
  error_message: Type.Optional(Type.String()),
  total_requests: Type.Optional(Type.Integer()),
  successful_requests: Type.Optional(Type.Integer()),
  failed_requests: Type.Optional(Type.Integer()),
  duration_seconds: Type.Optional(Type.Number()),
})

export const BenchmarkScenarioWithMetricsSchema = Type.Intersect([
  BenchmarkScenarioSchema,
  Type.Object({
    metrics: Type.Optional(BenchmarkMetricsSchema),
  }),
])

export const BenchmarkRunWithDetailsSchema = Type.Intersect([
  BenchmarkRunSchema,
  Type.Object({
    scenarios: Type.Array(BenchmarkScenarioWithMetricsSchema),
  }),
])

export const ListBenchmarksResponseSchema = Type.Object({
  benchmarks: Type.Array(BenchmarkRunSchema),
  total: Type.Integer(),
  page: Type.Integer(),
  limit: Type.Integer(),
})

export const GetBenchmarkResponseSchema = Type.Object({
  benchmark: BenchmarkRunWithDetailsSchema,
})

export const DeleteBenchmarkResponseSchema = Type.Object({
  status: Type.Literal('success'),
  id: Type.String({ format: 'uuid' }),
  deleted_at: Type.String({ format: 'date-time' }),
})

export const ExportBenchmarkRequestSchema = Type.Object({
  format: Type.Union([Type.Literal('csv'), Type.Literal('json')]),
})

export const ListBenchmarkResultsResponseSchema = Type.Object({
  results: Type.Array(BenchmarkResultSchema),
  total: Type.Integer(),
  page: Type.Integer(),
  limit: Type.Integer(),
})

// =====================
// Memory Profile Schemas
// =====================

export const MemoryProfileSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  profile_name: Type.String(),
  model_path: Type.String(),
  max_tokens: Type.Integer(),
  total_gpu_memory_gib: Type.Number(),
  weights_memory_gib: Type.Number(),
  cuda_graphs_gib: Type.Number(),
  overhead_memory_gib: Type.Number(),
  kv_cache_available_gib: Type.Number(),
  kv_cache_per_request_mib: Type.Optional(Type.Number()),
  gpu_name: Type.Optional(Type.String()),
  gpu_total_memory_gib: Type.Optional(Type.Number()),
  comments: Type.Optional(Type.String()),
  created_by: Type.Optional(Type.String()),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.Optional(Type.String({ format: 'date-time' })),
})

export const CreateMemoryProfileRequestSchema = Type.Object({
  // From running instance
  instance_id: Type.Optional(Type.String({ format: 'uuid' })),
  profile_name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  comments: Type.Optional(Type.String({ maxLength: 500 })),

  // For manual entry
  model_path: Type.Optional(Type.String()),
  max_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
  total_gpu_memory_gib: Type.Optional(Type.Number({ minimum: 0 })),
  weights_memory_gib: Type.Optional(Type.Number({ minimum: 0 })),
  cuda_graphs_gib: Type.Optional(Type.Number({ minimum: 0 })),
  overhead_memory_gib: Type.Optional(Type.Number({ minimum: 0 })),
  kv_cache_available_gib: Type.Optional(Type.Number({ minimum: 0 })),
  kv_cache_per_request_mib: Type.Optional(Type.Number({ minimum: 0 })),
  gpu_name: Type.Optional(Type.String()),
  gpu_total_memory_gib: Type.Optional(Type.Number({ minimum: 0 })),
})

export const UpdateMemoryProfileRequestSchema = Type.Object({
  profile_name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  comments: Type.Optional(Type.String({ maxLength: 500 })),
})

export const ListMemoryProfilesResponseSchema = Type.Object({
  profiles: Type.Array(MemoryProfileSchema),
  total: Type.Integer(),
})

export const GetMemoryProfileResponseSchema = Type.Object({
  profile: MemoryProfileSchema,
})

export const DeleteMemoryProfileResponseSchema = Type.Object({
  status: Type.Literal('success'),
  id: Type.String({ format: 'uuid' }),
  deleted_at: Type.String({ format: 'date-time' }),
})

export const MemoryCheckRequestSchema = Type.Object({
  model_path: Type.String({ minLength: 1 }),
  max_tokens: Type.Integer({ minimum: 1, maximum: 1000000 }),
  gpu_name: Type.String({ minLength: 1 }),
})

export const MemoryCheckResponseSchema = Type.Object({
  has_profile: Type.Boolean(),
  can_fit: Type.Boolean(),
  warning_level: MemoryWarningLevelSchema,
  message: Type.String(),
  profile: Type.Optional(MemoryProfileSchema),
  available_memory_gib: Type.Optional(Type.Number()),
  estimated_required_gib: Type.Optional(Type.Number()),
})

export const LookupMemoryProfileQuerySchema = Type.Object({
  model_path: Type.String({ minLength: 1 }),
  max_tokens: Type.Integer({ minimum: 1, maximum: 1000000 }),
  gpu_name: Type.String({ minLength: 1 }),
})

// =====================
// Type Exports
// =====================

export type CreateBenchmarkRequestType = Static<typeof CreateBenchmarkRequestSchema>
export type BenchmarkScenarioConfigType = Static<typeof BenchmarkScenarioConfigSchema>
export type BenchmarkRunType = Static<typeof BenchmarkRunSchema>
export type BenchmarkScenarioType = Static<typeof BenchmarkScenarioSchema>
export type BenchmarkResultType = Static<typeof BenchmarkResultSchema>
export type BenchmarkMetricsType = Static<typeof BenchmarkMetricsSchema>
export type BenchmarkRunWithDetailsType = Static<typeof BenchmarkRunWithDetailsSchema>
export type ListBenchmarksResponseType = Static<typeof ListBenchmarksResponseSchema>
export type GetBenchmarkResponseType = Static<typeof GetBenchmarkResponseSchema>
export type ExportBenchmarkRequestType = Static<typeof ExportBenchmarkRequestSchema>
export type ListBenchmarkResultsResponseType = Static<typeof ListBenchmarkResultsResponseSchema>

export type MemoryProfileType = Static<typeof MemoryProfileSchema>
export type CreateMemoryProfileRequestType = Static<typeof CreateMemoryProfileRequestSchema>
export type UpdateMemoryProfileRequestType = Static<typeof UpdateMemoryProfileRequestSchema>
export type ListMemoryProfilesResponseType = Static<typeof ListMemoryProfilesResponseSchema>
export type GetMemoryProfileResponseType = Static<typeof GetMemoryProfileResponseSchema>
export type MemoryCheckRequestType = Static<typeof MemoryCheckRequestSchema>
export type MemoryCheckResponseType = Static<typeof MemoryCheckResponseSchema>
export type LookupMemoryProfileQueryType = Static<typeof LookupMemoryProfileQuerySchema>
