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
} from '@sardeenz/types'

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
    const response = await this.client.get('/health')
    return response.data
  }
}

export const apiClient = new ApiClient()
