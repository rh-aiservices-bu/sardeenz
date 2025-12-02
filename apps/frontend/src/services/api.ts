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

  constructor() {
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

    this.client = axios.create({
      baseURL,
      timeout: 180000, // 3 minutes for model loading
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Add retry interceptor for connection errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
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
    const response = await this.client.get<ModelHealthResponse>(
      `/api/models/${encodedPath}/health`
    )
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
    const response = await this.client.post<SetMemoryLimitsResponse>(
      '/api/memory/limits',
      request
    )
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

  // Inference endpoints

  async sendChatCompletionViaProxy(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const response = await this.client.post<ChatCompletionResponse>(
      '/v1/chat/completions',
      request
    )
    return response.data
  }

  async sendChatCompletionDirect(
    port: number,
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    // Create a separate axios instance for direct model calls
    const directClient = axios.create({
      baseURL: `http://localhost:${port}`,
      timeout: 180000, // 3 minutes
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const response = await directClient.post<ChatCompletionResponse>(
      '/v1/chat/completions',
      request
    )
    return response.data
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

  async getBenchmark(id: string): Promise<{ benchmark: BenchmarkSummary & { scenarios: unknown[] } }> {
    const response = await this.client.get<{ benchmark: BenchmarkSummary & { scenarios: unknown[] } }>(
      `/api/benchmarks/${id}`
    )
    return response.data
  }

  async createBenchmark(data: CreateBenchmarkRequest): Promise<{ benchmark: BenchmarkSummary }> {
    const response = await this.client.post<{ benchmark: BenchmarkSummary }>('/api/benchmarks', data)
    return response.data
  }

  async deleteBenchmark(id: string): Promise<DeleteMemoryProfileResponse> {
    const response = await this.client.delete<DeleteMemoryProfileResponse>(`/api/benchmarks/${id}`)
    return response.data
  }

  async exportBenchmark(id: string, format: 'csv' | 'json' = 'csv', includeWarmup = false): Promise<Blob> {
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
}

export const apiClient = new ApiClient()
