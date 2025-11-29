import type { ModelStatus } from './models.js'

// Controller API Request/Response types

export interface LoadModelRequest {
  model_path: string
  max_tokens?: number
  extra_args?: string[] // Additional vLLM CLI arguments
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
  weights_memory_gib: number
  cuda_graph_memory_gib: number
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
}

export interface MemoryUsageResponse {
  kvcache: KVCacheMetrics
  gpu: GpuMetrics
  models: ModelGpuMemory[]
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
