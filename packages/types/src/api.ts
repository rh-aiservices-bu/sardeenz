import type { ModelStatus } from './models.js'

// Controller API Request/Response types

export interface LoadModelRequest {
  model_path: string
  max_tokens?: number
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

export interface ModelInstanceDTO {
  id: string
  model_path: string
  status: ModelStatus
  port: number
  process_id: number
  max_tokens: number
  gpu_memory_utilization: number
  loaded_at: string
  ready_at?: string
  error_message?: string
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

export interface MemoryUsageResponse {
  gpu_total_gb: number
  gpu_used_gb: number
  gpu_free_gb: number
  models: ModelMemoryUsage[]
}

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
