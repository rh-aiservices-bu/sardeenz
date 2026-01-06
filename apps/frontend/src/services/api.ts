import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type {
  LoadModelRequest,
  LoadModelResponse,
  UnloadModelResponse,
  ListModelsResponse,
  GetModelResponse,
  ModelHealthResponse,
  MemoryUsageResponse,
  SetMemoryLimitsRequest,
  SetMemoryLimitsResponse,
  GetInstanceLogsResponse,
  SettingsResponse,
  UpdateSettingsRequest,
  TestHfTokenResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  GpuAvailabilityResponse,
  MultiGpuMemoryUsageResponse,
  ListLocalModelsResponse,
  LocalModelsStatusResponse,
  AuthInfoResponse,
  LoginRequest,
  LoginResponse,
  CurrentUserResponse,
} from '@sardeenz/types'

// Memory Profile types for API responses
export interface MemoryProfileResponse {
  id: string
  profile_name: string
  model_path: string
  max_tokens: number
  total_gpu_memory_gib: number
  weights_memory_gib: number
  cuda_graphs_gib: number
  overhead_memory_gib: number
  kv_cache_available_gib: number
  kv_cache_per_request_mib?: number
  gpu_name?: string
  gpu_total_memory_gib?: number
  comments?: string
  created_by?: string
  created_at: string
  updated_at?: string
}

export interface ListMemoryProfilesResponse {
  profiles: MemoryProfileResponse[]
  total: number
}

export interface GetMemoryProfileResponse {
  profile: MemoryProfileResponse
}

export interface CreateMemoryProfileRequest {
  instance_id?: string
  profile_name?: string
  model_path?: string
  max_tokens?: number
  weights_memory_gib?: number
  cuda_graphs_gib?: number
  kv_cache_available_gib?: number
  kv_cache_per_request_mib?: number
  gpu_name?: string
  gpu_total_memory_gib?: number
  comments?: string
}

export interface UpdateMemoryProfileRequest {
  profile_name?: string
  comments?: string
}

export interface DeleteMemoryProfileResponse {
  status: 'success'
  id: string
  deleted_at: string
}

export interface MemoryCheckRequest {
  model_path: string
  max_tokens: number
  gpu_name: string
}

export interface MemoryCheckResponse {
  has_profile: boolean
  can_fit: boolean
  warning_level: 'danger' | 'caution' | 'info' | 'ok'
  message: string
  profile?: MemoryProfileResponse
  available_memory_gib?: number
  estimated_required_gib?: number
}

// Model Configuration types for API responses
export interface ModelConfigurationEntryResponse {
  id: string
  config_id: string
  model_path: string
  served_model_name?: string
  max_tokens: number
  source_type: 'huggingface' | 'local'
  extra_args?: string[]
  gpu_ids?: number[]
  tensor_parallel_size: number
  load_order: number
}

export interface SavedModelConfigurationResponse {
  id: string
  name: string
  description?: string
  model_count: number
  created_at: string
  updated_at?: string
  entries?: ModelConfigurationEntryResponse[]
}

export interface ListModelConfigurationsResponse {
  configurations: SavedModelConfigurationResponse[]
  total: number
}

export interface GetModelConfigurationResponse {
  configuration: SavedModelConfigurationResponse
}

export interface CreateModelConfigurationRequest {
  name: string
  description?: string
}

export interface UpdateModelConfigurationRequest {
  name?: string
  description?: string
}

export interface DeleteModelConfigurationResponse {
  status: 'success'
  id: string
  deleted_at: string
}

export interface LoadModelConfigurationResponse {
  status: 'started'
  configuration_id: string
  configuration_name: string
  message: string
}

// Benchmark types for API responses
export interface BenchmarkSummary {
  id: string
  name?: string
  status: string
  mode: string
  kvcached_enabled: boolean
  created_at: string
  started_at?: string
  completed_at?: string
  error_message?: string
  total_requests?: number
  successful_requests?: number
  failed_requests?: number
  duration_seconds?: number
}

export interface ListBenchmarksResponse {
  benchmarks: BenchmarkSummary[]
  total: number
  page: number
  limit: number
}

export interface CreateBenchmarkRequest {
  name?: string
  mode: 'isolated' | 'contention'
  scenarios: Array<{
    instanceId: string
    inputTokens: number
    outputTokens: number
    concurrency: number
    totalRequests: number
    warmupRequests: number
    slaThresholdMs?: number
  }>
}

export interface BenchmarkResultsResponse {
  results: Array<{
    id: number
    scenario_id: string
    request_sequence: number
    is_warmup: boolean
    ttft_ms?: number
    total_latency_ms: number
    prompt_tokens?: number
    completion_tokens?: number
    tokens_per_second?: number
    success: boolean
    error_message?: string
    http_status?: number
    executed_at: string
  }>
  total: number
  page: number
  limit: number
}

// GPU info types (matching backend NvidiaSmiInfo)
export interface GpuStatus {
  index: number
  name: string
  persistenceMode: string
  busId: string
  displayActive: string
  eccErrors: string | null
  fan: string
  temperature: string
  performanceState: string
  powerUsage: string
  powerCap: string
  memoryUsed: string
  memoryTotal: string
  memoryUsedMB: number
  memoryTotalMB: number
  gpuUtilization: string
  computeMode: string
  migMode: string | null
}

export interface GpuProcess {
  gpu: number
  gi: string
  ci: string
  pid: number
  type: string
  processName: string
  gpuMemory: string
  gpuMemoryMB: number
}

export interface DriverInfo {
  nvidiaSmiVersion: string
  driverVersion: string
  cudaVersion: string
}

export interface NvidiaSmiInfo {
  timestamp: string
  driver: DriverInfo
  gpus: GpuStatus[]
  processes: GpuProcess[]
}

// Retry configuration
const INITIAL_DELAY_MS = 2000
const MAX_DELAY_MS = 15000
const MAX_RETRIES = 10 // With 15s cap, allows ~2 min of retries

const getBackoffDelay = (attempt: number) =>
  Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)

// Extended config type to track retry count
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number
}

/**
 * Error details with optional status code
 */
export interface ErrorDetails {
  statusCode?: number
  message: string
}

/**
 * Extract error details (status code + message) from various error types.
 * Handles axios errors with response data from vLLM/OpenAI format.
 */
export function extractErrorDetails(error: unknown): ErrorDetails {
  if (axios.isAxiosError(error)) {
    const statusCode = error.response?.status
    const data = error.response?.data

    let message = error.message
    if (data) {
      // vLLM/OpenAI error format: { error: { message: "..." } }
      if (typeof data.error?.message === 'string') {
        message = data.error.message
      } else if (typeof data.message === 'string') {
        // Alternative format: { message: "..." }
        message = data.message
      } else if (typeof data === 'object') {
        // Fallback: stringify the data if it's an object
        message = JSON.stringify(data)
      }
    }

    // Clean up vLLM artifacts (sometimes appends Python's "None" to messages)
    message = message.replace(/\s+None\s*$/, '').trim()

    return { statusCode, message }
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return { message: 'Unknown error' }
}

/**
 * Extract a meaningful error message from various error types.
 * @deprecated Use extractErrorDetails() for status code support
 */
export function extractErrorMessage(error: unknown): string {
  return extractErrorDetails(error).message
}

class ApiClient {
  private client: AxiosInstance
  private authToken: string | null = null
  private inferenceApiKey: string | null = null

  constructor() {
    const baseURL = import.meta.env.VITE_API_BASE_URL || ''

    this.client = axios.create({
      baseURL,
      timeout: 180000, // 3 minutes for model loading
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Add request interceptor to include auth token
    // Uses inference API key for inference routes, JWT for admin routes
    this.client.interceptors.request.use((config) => {
      const url = config.url || ''
      const isInferenceRoute =
        url.startsWith('/v1/') ||
        url.startsWith('/tokenize') ||
        url.startsWith('/detokenize') ||
        url.startsWith('/pooling') ||
        url.startsWith('/classification') ||
        url.startsWith('/score') ||
        url.startsWith('/re-rank') ||
        url.startsWith('/api/direct/')

      if (isInferenceRoute && this.inferenceApiKey) {
        // Use inference API key for inference routes
        config.headers.Authorization = `Bearer ${this.inferenceApiKey}`
      } else if (this.authToken) {
        // Use JWT for admin routes
        config.headers.Authorization = `Bearer ${this.authToken}`
      }
      return config
    })

    // Add response interceptor for connection errors and 401 handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        // Handle 401 Unauthorized - emit event for AuthContext
        if (error.response?.status === 401) {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'))
        }

        const config = error.config as RetryableRequestConfig | undefined
        if (!config) return Promise.reject(error)

        // Only retry on connection errors (not HTTP errors)
        const isConnectionError =
          !error.response &&
          (error.code === 'ECONNREFUSED' ||
            error.code === 'ERR_NETWORK' ||
            error.message.includes('Network Error'))

        if (!isConnectionError) return Promise.reject(error)

        // Track retry count
        const retryCount = config.__retryCount || 0
        if (retryCount >= MAX_RETRIES) return Promise.reject(error)

        config.__retryCount = retryCount + 1

        // Exponential backoff with cap: 2s, 4s, 8s, 15s, 15s...
        const delay = getBackoffDelay(retryCount)
        await new Promise((resolve) => setTimeout(resolve, delay))

        return this.client.request(config)
      }
    )
  }

  // Auth token management
  setAuthToken(token: string | null): void {
    this.authToken = token
  }

  getAuthToken(): string | null {
    return this.authToken
  }

  // Inference API key management (separate from admin JWT auth)
  setInferenceApiKey(key: string | null): void {
    this.inferenceApiKey = key
  }

  getInferenceApiKey(): string | null {
    return this.inferenceApiKey
  }

  // Authentication endpoints

  async getAuthInfo(): Promise<AuthInfoResponse> {
    const response = await this.client.get<AuthInfoResponse>('/api/auth/info')
    return response.data
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/login', credentials)
    return response.data
  }

  async logout(): Promise<void> {
    await this.client.post('/api/auth/logout')
    this.authToken = null
  }

  async getCurrentUser(): Promise<CurrentUserResponse> {
    const response = await this.client.get<CurrentUserResponse>('/api/auth/me')
    return response.data
  }

  // Model management endpoints

  async loadModel(request: LoadModelRequest): Promise<LoadModelResponse> {
    const response = await this.client.post<LoadModelResponse>('/api/models/load', request)
    return response.data
  }

  async unloadModel(modelPath: string): Promise<UnloadModelResponse> {
    const encodedPath = encodeURIComponent(modelPath)
    const response = await this.client.delete<UnloadModelResponse>(`/api/models/${encodedPath}`)
    return response.data
  }

  async unloadModelByInstanceId(instanceId: string): Promise<UnloadModelResponse> {
    const response = await this.client.delete<UnloadModelResponse>(
      `/api/models/instances/${instanceId}`
    )
    return response.data
  }

  async listModels(): Promise<ListModelsResponse> {
    const response = await this.client.get<ListModelsResponse>('/api/models')
    return response.data
  }

  async getModel(modelPath: string): Promise<GetModelResponse> {
    const encodedPath = encodeURIComponent(modelPath)
    const response = await this.client.get<GetModelResponse>(`/api/models/${encodedPath}`)
    return response.data
  }

  async getModelHealth(modelPath: string): Promise<ModelHealthResponse> {
    const encodedPath = encodeURIComponent(modelPath)
    const response = await this.client.get<ModelHealthResponse>(`/api/models/${encodedPath}/health`)
    return response.data
  }

  async getInstanceLogs(instanceId: string): Promise<GetInstanceLogsResponse> {
    const response = await this.client.get<GetInstanceLogsResponse>(
      `/api/models/instances/${instanceId}/logs`
    )
    return response.data
  }

  // Memory management endpoints

  async getMemoryUsage(): Promise<MemoryUsageResponse> {
    const response = await this.client.get<MemoryUsageResponse>('/api/memory/usage')
    return response.data
  }

  async setMemoryLimits(request: SetMemoryLimitsRequest): Promise<SetMemoryLimitsResponse> {
    const response = await this.client.post<SetMemoryLimitsResponse>('/api/memory/limits', request)
    return response.data
  }

  // Health check

  async healthCheck(): Promise<{ status: string }> {
    const response = await this.client.get('/api/health')
    return response.data
  }

  // GPU info

  async getGpuInfo(): Promise<NvidiaSmiInfo> {
    const response = await this.client.get<NvidiaSmiInfo>('/api/gpu/info')
    return response.data
  }

  async getAvailableGpus(): Promise<GpuAvailabilityResponse> {
    const response = await this.client.get<GpuAvailabilityResponse>('/api/gpu/available')
    return response.data
  }

  async getMultiGpuMemoryUsage(): Promise<MultiGpuMemoryUsageResponse> {
    const response = await this.client.get<MultiGpuMemoryUsageResponse>(
      '/api/memory/usage/multi-gpu'
    )
    return response.data
  }

  // Settings endpoints

  async getSettings(): Promise<SettingsResponse> {
    const response = await this.client.get<SettingsResponse>('/api/settings')
    return response.data
  }

  async updateSettings(request: UpdateSettingsRequest): Promise<SettingsResponse> {
    const response = await this.client.put<SettingsResponse>('/api/settings', request)
    return response.data
  }

  async testHfToken(token: string): Promise<TestHfTokenResponse> {
    const response = await this.client.post<TestHfTokenResponse>('/api/settings/hf-token/test', {
      token,
    })
    return response.data
  }

  // Local models endpoints

  async getLocalModelsStatus(): Promise<LocalModelsStatusResponse> {
    const response = await this.client.get<LocalModelsStatusResponse>('/api/local-models/status')
    return response.data
  }

  async listLocalModels(subpath?: string): Promise<ListLocalModelsResponse> {
    const params = subpath ? `?subpath=${encodeURIComponent(subpath)}` : ''
    const response = await this.client.get<ListLocalModelsResponse>(`/api/local-models${params}`)
    return response.data
  }

  // Inference endpoints

  async sendChatCompletionViaProxy(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const response = await this.client.post<ChatCompletionResponse>('/v1/chat/completions', request)
    return response.data
  }

  async sendChatCompletionDirect(
    port: number,
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    // Use backend's direct proxy endpoint (works in deployment)
    const response = await this.client.post<ChatCompletionResponse>(
      `/api/direct/${port}/v1/chat/completions`,
      request
    )
    return response.data
  }

  /**
   * Send streaming chat completion via proxy.
   * Uses fetch + ReadableStream for SSE parsing (axios doesn't support streaming).
   *
   * @param request - Chat completion request (stream flag added automatically)
   * @param onChunk - Callback for each token chunk
   * @param onComplete - Callback when stream completes with full text and token count
   * @param onError - Callback for errors
   * @returns AbortController for stream cancellation
   */
  async sendStreamingChatCompletionViaProxy(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
    onComplete: (fullText: string, tokenCount: number) => void,
    onError: (error: ErrorDetails) => void
  ): Promise<AbortController> {
    const abortController = new AbortController()
    const fullText: string[] = []
    let completionTokens = 0

    try {
      const baseURL = import.meta.env.VITE_API_BASE_URL || ''
      // Build headers - include inference API key if available
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (this.inferenceApiKey) {
        headers['Authorization'] = `Bearer ${this.inferenceApiKey}`
      }
      const response = await fetch(`${baseURL}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: { message: response.statusText },
        }))
        onError({
          statusCode: response.status,
          message: errorData.error?.message || response.statusText,
        })
        return abortController
      }

      if (!response.body) {
        onError({ message: 'No response body' })
        return abortController
      }

      // Process SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue

          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()

            if (data === '[DONE]') {
              onComplete(fullText.join(''), completionTokens)
              return abortController
            }

            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk
              const content = chunk.choices[0]?.delta?.content

              if (content) {
                fullText.push(content)
                onChunk(content)
              }

              // Extract token usage from final chunk (when stream_options.include_usage is true)
              if (chunk.usage) {
                completionTokens = chunk.usage.completion_tokens
              }
              // Note: Don't return early on finish_reason - usage chunk comes after it
            } catch (err) {
              console.warn('Failed to parse SSE chunk:', data, err)
            }
          }
        }
      }

      onComplete(fullText.join(''), completionTokens)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled - not an error
        return abortController
      }
      onError(extractErrorDetails(err))
    }

    return abortController
  }

  /**
   * Send streaming chat completion directly to port.
   * Uses fetch + ReadableStream for SSE parsing (axios doesn't support streaming).
   *
   * @param port - Model port number
   * @param request - Chat completion request (stream flag added automatically)
   * @param onChunk - Callback for each token chunk
   * @param onComplete - Callback when stream completes with full text and token count
   * @param onError - Callback for errors
   * @returns AbortController for stream cancellation
   */
  async sendStreamingChatCompletionDirect(
    port: number,
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
    onComplete: (fullText: string, tokenCount: number) => void,
    onError: (error: ErrorDetails) => void
  ): Promise<AbortController> {
    const abortController = new AbortController()
    const fullText: string[] = []
    let completionTokens = 0

    try {
      const baseURL = import.meta.env.VITE_API_BASE_URL || ''
      // Build headers - include inference API key if available
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (this.inferenceApiKey) {
        headers['Authorization'] = `Bearer ${this.inferenceApiKey}`
      }
      const response = await fetch(`${baseURL}/api/direct/${port}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: { message: response.statusText },
        }))
        onError({
          statusCode: response.status,
          message: errorData.error?.message || response.statusText,
        })
        return abortController
      }

      if (!response.body) {
        onError({ message: 'No response body' })
        return abortController
      }

      // Process SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue

          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()

            if (data === '[DONE]') {
              onComplete(fullText.join(''), completionTokens)
              return abortController
            }

            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk
              const content = chunk.choices[0]?.delta?.content

              if (content) {
                fullText.push(content)
                onChunk(content)
              }

              // Extract token usage from final chunk (when stream_options.include_usage is true)
              if (chunk.usage) {
                completionTokens = chunk.usage.completion_tokens
              }
              // Note: Don't return early on finish_reason - usage chunk comes after it
            } catch (err) {
              console.warn('Failed to parse SSE chunk:', data, err)
            }
          }
        }
      }

      onComplete(fullText.join(''), completionTokens)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled - not an error
        return abortController
      }
      onError(extractErrorDetails(err))
    }

    return abortController
  }

  // Memory profile endpoints

  async listMemoryProfiles(): Promise<ListMemoryProfilesResponse> {
    const response = await this.client.get<ListMemoryProfilesResponse>('/api/memory/profiles')
    return response.data
  }

  async getMemoryProfile(id: string): Promise<GetMemoryProfileResponse> {
    const response = await this.client.get<GetMemoryProfileResponse>(`/api/memory/profiles/${id}`)
    return response.data
  }

  async createMemoryProfile(data: CreateMemoryProfileRequest): Promise<GetMemoryProfileResponse> {
    const response = await this.client.post<GetMemoryProfileResponse>('/api/memory/profiles', data)
    return response.data
  }

  async updateMemoryProfile(
    id: string,
    data: UpdateMemoryProfileRequest
  ): Promise<GetMemoryProfileResponse> {
    const response = await this.client.put<GetMemoryProfileResponse>(
      `/api/memory/profiles/${id}`,
      data
    )
    return response.data
  }

  async deleteMemoryProfile(id: string): Promise<DeleteMemoryProfileResponse> {
    const response = await this.client.delete<DeleteMemoryProfileResponse>(
      `/api/memory/profiles/${id}`
    )
    return response.data
  }

  async checkBeforeLoad(data: MemoryCheckRequest): Promise<MemoryCheckResponse> {
    const response = await this.client.post<MemoryCheckResponse>(
      '/api/memory/check-before-load',
      data
    )
    return response.data
  }

  // Benchmark endpoints

  async listBenchmarks(options?: {
    page?: number
    limit?: number
    status?: string
  }): Promise<ListBenchmarksResponse> {
    const params = new URLSearchParams()
    if (options?.page) params.set('page', options.page.toString())
    if (options?.limit) params.set('limit', options.limit.toString())
    if (options?.status) params.set('status', options.status)

    const response = await this.client.get<ListBenchmarksResponse>(
      `/api/benchmarks${params.toString() ? '?' + params.toString() : ''}`
    )
    return response.data
  }

  async getBenchmark(
    id: string
  ): Promise<{ benchmark: BenchmarkSummary & { scenarios: unknown[] } }> {
    const response = await this.client.get<{
      benchmark: BenchmarkSummary & { scenarios: unknown[] }
    }>(`/api/benchmarks/${id}`)
    return response.data
  }

  async createBenchmark(data: CreateBenchmarkRequest): Promise<{ benchmark: BenchmarkSummary }> {
    const response = await this.client.post<{ benchmark: BenchmarkSummary }>(
      '/api/benchmarks',
      data
    )
    return response.data
  }

  async deleteBenchmark(id: string): Promise<DeleteMemoryProfileResponse> {
    const response = await this.client.delete<DeleteMemoryProfileResponse>(`/api/benchmarks/${id}`)
    return response.data
  }

  async exportBenchmark(
    id: string,
    format: 'csv' | 'json' = 'csv',
    includeWarmup = false
  ): Promise<Blob> {
    const response = await this.client.post(
      `/api/benchmarks/${id}/export`,
      { format, include_warmup: includeWarmup },
      { responseType: 'blob' }
    )
    return response.data
  }

  async getBenchmarkResults(
    benchmarkId: string,
    scenarioId: string,
    options?: { page?: number; limit?: number }
  ): Promise<BenchmarkResultsResponse> {
    const params = new URLSearchParams()
    if (options?.page) params.set('page', options.page.toString())
    if (options?.limit) params.set('limit', options.limit.toString())

    const response = await this.client.get<BenchmarkResultsResponse>(
      `/api/benchmarks/${benchmarkId}/scenarios/${scenarioId}/results${params.toString() ? '?' + params.toString() : ''}`
    )
    return response.data
  }

  // Model Configuration endpoints

  async listConfigurations(): Promise<ListModelConfigurationsResponse> {
    const response = await this.client.get<ListModelConfigurationsResponse>('/api/configurations')
    return response.data
  }

  async getConfiguration(id: string): Promise<GetModelConfigurationResponse> {
    const response = await this.client.get<GetModelConfigurationResponse>(
      `/api/configurations/${id}`
    )
    return response.data
  }

  async saveConfiguration(
    data: CreateModelConfigurationRequest
  ): Promise<GetModelConfigurationResponse> {
    const response = await this.client.post<GetModelConfigurationResponse>(
      '/api/configurations',
      data
    )
    return response.data
  }

  async updateConfiguration(
    id: string,
    data: UpdateModelConfigurationRequest
  ): Promise<GetModelConfigurationResponse> {
    const response = await this.client.put<GetModelConfigurationResponse>(
      `/api/configurations/${id}`,
      data
    )
    return response.data
  }

  async deleteConfiguration(id: string): Promise<DeleteModelConfigurationResponse> {
    const response = await this.client.delete<DeleteModelConfigurationResponse>(
      `/api/configurations/${id}`
    )
    return response.data
  }

  async loadConfiguration(id: string): Promise<LoadModelConfigurationResponse> {
    const response = await this.client.post<LoadModelConfigurationResponse>(
      `/api/configurations/${id}/load`
    )
    return response.data
  }
}

export const apiClient = new ApiClient()
