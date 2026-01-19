import type { ModelStatus } from './models.js'

// Controller API Request/Response types

/** Model source type - HuggingFace ID or local path */
export type ModelSourceType = 'huggingface' | 'local'

export interface LoadModelRequest {
  model_path: string
  max_tokens?: number
  extra_args?: string[] // Additional vLLM CLI arguments
  gpu_ids?: number[] // Optional explicit GPU selection (auto-selects if not provided)
  tensor_parallel_size?: number // For large models spanning multiple GPUs (default: 1)
  source_type?: ModelSourceType // Model source type (default: 'huggingface')
  served_model_name?: string // Name for vLLM --served-model-name (default: model_path)
  enable_sleep_mode?: boolean // Enable vLLM sleep mode for GPU memory offloading
}

export interface LoadModelResponse {
  status: 'success'
  model: string
  port: number
  loaded_at: string
  instance_id: string
}

export interface UnloadModelResponse {
  status: 'success'
  model: string
  unloaded_at: string
}

export interface ListModelsResponse {
  models: ModelInstanceDTO[]
  total: number
}

/** Memory metrics in API response (snake_case) */
export interface ModelMemoryMetricsDTO {
  /** Total actual GPU memory consumed by the model process in GiB (from nvidia-smi) */
  total_gpu_memory_gib: number
  weights_memory_gib: number
  cuda_graph_memory_gib: number
  /** Overhead memory (total - weights - CUDA graphs) in GiB */
  overhead_memory_gib: number
  /** @deprecated KV cache available - meaningless with kvcached, kept for backwards compat */
  kv_cache_available_gib: number
  kv_cache_per_request_mib: number
  max_model_len: number
}

export interface ModelInstanceDTO {
  id: string
  model_path: string
  /** Model name used by vLLM for inference (from --served-model-name or defaults to model_path) */
  model_name: string
  status: ModelStatus
  port: number
  process_id: number
  max_tokens: number
  gpu_memory_utilization: number
  loaded_at: string
  ready_at?: string
  error_message?: string
  memory_metrics?: ModelMemoryMetricsDTO
  has_chat_template?: boolean
  launch_command?: string // Full vLLM command for debugging/reproduction
  gpu_ids: number[] // GPU indices this model is running on
  tensor_parallel_size: number // 1 = single GPU, >1 = spanning multiple GPUs
  kvcached_enabled: boolean // Whether kvcached is enabled (false for tensor parallel)
  memory_baseline_by_gpu?: Record<number, number> // Memory baseline per GPU in GB
  sleep_mode_enabled: boolean // Whether sleep mode is enabled for this instance
  sleep_level?: 1 | 2 // Current sleep level if sleeping
  slept_at?: string // ISO timestamp when model went to sleep
  routable?: boolean // Whether this instance is available for routing (false during move operations)
}

export interface GetModelResponse {
  model: ModelInstanceDTO
}

export interface ModelHealthResponse {
  status: 'healthy' | 'unhealthy'
  model: string
  port: number
  uptime_seconds: number
}

/** KVCache memory pool metrics (shared across all models) */
export interface KVCacheMetrics {
  total_gb: number // Total KVCache pool size
  prealloc_gb: number // Pre-allocated but not yet used
  used_gb: number // Currently used by active requests
  free_gb: number // Available for new allocations
}

/** GPU memory metrics from nvidia-smi */
export interface GpuMetrics {
  total_gb: number
  used_gb: number // Total used by all processes
  free_gb: number
  utilization_percent: number
}

/** Per-model GPU memory breakdown */
export interface ModelGpuMemory {
  model_path: string
  instance_id: string // Unique instance identifier
  display_name: string // Short name for legend, unique per instance (e.g., "Llama-3.2-1B", "Llama-3.2-1B (2)")
  gpu_memory_gb: number // Model's GPU footprint (weights + CUDA graphs)
  color: string // Assigned color for visualization
  is_sleeping?: boolean // Whether model is currently sleeping
}

export interface MemoryUsageResponse {
  kvcache: KVCacheMetrics
  gpu: GpuMetrics
  models: ModelGpuMemory[]
}

// Multi-GPU support types

/** Per-GPU metrics with model breakdown for multi-GPU systems */
export interface PerGpuMetrics {
  gpu_index: number
  name: string
  total_gb: number
  used_gb: number
  free_gb: number
  utilization_percent: number
  models: ModelGpuMemory[]
  kvcache?: KVCacheMetrics // Per-GPU KVCache metrics (undefined if no KVCache segment exists)
}

/** Multi-GPU memory usage response */
export interface MultiGpuMemoryUsageResponse {
  gpus: PerGpuMetrics[]
  kvcache: KVCacheMetrics
  total_system_free_gb: number
  /** Whether virtual GPU mode is enabled (all vGPUs share same physical memory) */
  is_virtual_gpu_mode: boolean
}

/** Individual GPU info for availability response */
export interface GpuInfo {
  index: number
  name: string
  memory_total_mb: number
  memory_used_mb: number
  memory_free_mb: number
  utilization_percent: number
  models_loaded: number
  recommended: boolean
}

/** GPU recommendation for auto-selection */
export interface GpuRecommendation {
  gpu_id: number
  free_memory_gb: number
  reason: string
}

/** Available GPUs with selection recommendation */
export interface GpuAvailabilityResponse {
  gpus: GpuInfo[]
  recommendation: GpuRecommendation
}

/** Legacy model memory usage (for backward compatibility) */
export interface ModelMemoryUsage {
  model_path: string
  gpu_memory_used_gb: number
  gpu_memory_limit_gb: number
  gpu_memory_usage_percent: number
}

export interface SetMemoryLimitsRequest {
  model_path: string
  limit_gb: number
}

export interface SetMemoryLimitsResponse {
  status: 'success'
  model: string
  new_limit_gb: number
}

// Proxy API Request/Response types (OpenAI-compatible)

export interface CompletionRequest {
  model: string
  prompt: string | string[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  logprobs?: number
  echo?: boolean
  stop?: string | string[]
  presence_penalty?: number
  frequency_penalty?: number
  best_of?: number
  user?: string
}

export interface CompletionResponse {
  id: string
  object: 'text_completion'
  created: number
  model: string
  choices: CompletionChoice[]
  usage?: UsageInfo
}

export interface CompletionChoice {
  text: string
  index: number
  logprobs?: number[] | null
  finish_reason: 'stop' | 'length' | 'content_filter' | null
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stop?: string | string[]
  presence_penalty?: number
  frequency_penalty?: number
  user?: string
  chat_template?: string // Optional custom chat template (requires --trust-request-chat-template flag)
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
}

export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: ChatCompletionChoice[]
  usage?: UsageInfo
}

export interface ChatCompletionChoice {
  index: number
  message: ChatMessage
  finish_reason: 'stop' | 'length' | 'content_filter' | null
}

export interface UsageInfo {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// Streaming response types (OpenAI-compatible SSE format)

/** Delta content in streaming chunk */
export interface ChatCompletionDelta {
  role?: 'assistant' | 'user' | 'system'
  content?: string
}

/** Single streaming chunk choice */
export interface ChatCompletionStreamChoice {
  index: number
  delta: ChatCompletionDelta
  finish_reason: 'stop' | 'length' | 'content_filter' | null
}

/** Streaming chunk response */
export interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: ChatCompletionStreamChoice[]
  /** Usage info included in final chunk when stream_options.include_usage is true */
  usage?: UsageInfo
}

// Instance-specific responses

export interface ListInstancesResponse {
  instances: ModelInstanceDTO[]
  total: number
}

export interface UnloadInstanceResponse {
  status: 'success'
  instance_id: string
  model_path: string
  unloaded_at: string
}

export interface GetInstanceLogsResponse {
  instance_id: string
  logs: string
  line_count: number
}

// Error responses

export interface ErrorResponse {
  error: {
    message: string
    type: string
    code?: string
  }
}

// Settings API types

export interface SettingsResponse {
  hf_token: string | null // Masked token (last 4 chars) or null
  hf_token_source: 'env' | 'runtime' | null // Where token originated
}

export interface UpdateSettingsRequest {
  hf_token?: string // Full token when updating
}

export interface TestHfTokenRequest {
  token: string
}

export interface TestHfTokenResponse {
  valid: boolean
  username?: string // HF username if valid
  error?: string // Error message if invalid
}

// Local Models API types

/** Information about a local model available in the configured directory */
export interface LocalModelInfo {
  /** Model directory name */
  name: string
  /** Full path to model directory */
  path: string
  /** Last modified timestamp */
  modified_at?: string
  /** Whether config.json exists (indicates valid HF model) */
  has_config: boolean
}

/** Response for listing local models */
export interface ListLocalModelsResponse {
  models: LocalModelInfo[]
  total: number
  base_path: string
}

/** Response for local models feature status */
export interface LocalModelsStatusResponse {
  enabled: boolean
  path?: string
}

// Sleep Mode API types

/** Request to put a model to sleep */
export interface SleepModelRequest {
  /** Sleep level: 1 = offload weights to CPU, 2 = discard weights and KV cache */
  level?: 1 | 2
}

/** Response after putting a model to sleep */
export interface SleepModelResponse {
  status: 'success'
  instance_id: string
  model_path: string
  sleep_level: 1 | 2
  slept_at: string
}

/** Request to wake a sleeping model */
export interface WakeModelRequest {
  /** Optional tags for selective wake (vLLM-specific) */
  tags?: 'weights' | 'kv_cache'
}

/** Response after waking a model */
export interface WakeModelResponse {
  status: 'success'
  instance_id: string
  model_path: string
  woke_at: string
}

/** Response for checking sleep status */
export interface SleepStatusResponse {
  instance_id: string
  is_sleeping: boolean
  sleep_level?: 1 | 2
}

// Move Model API types

/** Request to move a model to different GPU(s) */
export interface MoveModelRequest {
  /** Target GPU indices for the move */
  target_gpu_ids: number[]
  /** Timeout in ms to wait for in-flight requests to drain (default: 60000) */
  drain_timeout_ms?: number
}

/** Response after initiating a model move operation */
export interface MoveModelResponse {
  /** Unique identifier for tracking this move operation */
  move_id: string
  /** Instance ID of the model being moved */
  source_instance_id: string
  /** Target GPU indices for the move */
  target_gpu_ids: number[]
}

/** Phase of a model move operation (API representation) */
export type MoveOperationPhaseDTO =
  | 'validating'
  | 'spawning'
  | 'switching'
  | 'draining'
  | 'completing'
  | 'failed'
  | 'completed'

/** SSE progress event during model move operation */
export interface MoveProgressEvent {
  /** Move operation identifier */
  move_id: string
  /** Current phase of the move operation */
  phase: MoveOperationPhaseDTO
  /** Human-readable progress message */
  message: string
  /** Progress percentage (0-100), primarily used during spawning phase */
  progress?: number
  /** Error message if phase is 'failed' */
  error?: string
}
