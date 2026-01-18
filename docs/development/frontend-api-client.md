# Frontend API Client Guide

This guide explains how the frontend integrates with the Controller API for model management and monitoring.

## Table of Contents

- [Overview](#overview)
- [API Client Setup](#api-client-setup)
- [Authentication Integration](#authentication-integration)
- [API Modules](#api-modules)
- [Custom Hooks](#custom-hooks)
- [Error Handling](#error-handling)
- [TypeScript Types](#typescript-types)
- [Usage Examples](#usage-examples)
- [Testing with MSW](#testing-with-msw)

## Overview

The frontend communicates with the **Controller API** (`http://localhost:3000/api/v1`) to:

- Load and unload model instances
- Query model status and configuration
- Retrieve resource metrics (GPU memory, request counts)
- Access operation audit trail

**Key Requirements:**

- OAuth 2.0 authentication with JWT bearer tokens
- Role-based access control (admin, admin-readonly)
- Automatic token refresh
- Graceful error handling
- TypeScript types from `packages/types`

## API Client Setup

### Directory Structure

```
src/api/
├── client.ts          # Axios instance with interceptors
├── models.ts          # Model lifecycle endpoints
├── metrics.ts         # Metrics endpoints
├── types.ts           # API response types (imports from @sardeenz/types)
└── index.ts           # Re-export all APIs
```

### Base Client Configuration

**`src/api/client.ts`**:

```tsx
import axios, { AxiosInstance, AxiosError } from 'axios'

// Token storage (in-memory only for security)
let jwtToken: string | null = null

export const setToken = (token: string) => {
  jwtToken = token
}

export const getToken = (): string | null => jwtToken

export const clearToken = () => {
  jwtToken = null
}

// Create axios instance
export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: Add JWT to all requests
apiClient.interceptors.request.use(
  (config) => {
    const token = getToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor: Handle auth errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired or invalid - redirect to login
      clearToken()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

### Environment Variables

**`.env`** (development):

```bash
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

**`.env.production`**:

```bash
VITE_API_BASE_URL=/api/v1
```

## Authentication Integration

### OAuth 2.0 Flow

The frontend delegates OAuth authentication to the backend:

```
┌─────────┐                ┌──────────┐                ┌──────────┐
│ Browser │                │ Frontend │                │ Backend  │
└────┬────┘                └────┬─────┘                └────┬─────┘
     │                          │                           │
     │  1. Navigate to /        │                           │
     ├─────────────────────────>│                           │
     │                          │                           │
     │  2. No token? Redirect   │                           │
     │     to /auth/login       │                           │
     │<─────────────────────────┤                           │
     │                          │                           │
     │  3. GET /auth/login      │                           │
     ├──────────────────────────┼──────────────────────────>│
     │                          │                           │
     │  4. 302 to IdP           │                           │
     │<──────────────────────────────────────────────────────┤
     │                          │                           │
     │  5. User authenticates   │                           │
     │     at IdP               │                           │
     │                          │                           │
     │  6. Callback with code   │                           │
     ├──────────────────────────┼──────────────────────────>│
     │                          │                           │
     │  7. Backend exchanges    │                           │
     │     code → JWT           │                           │
     │                          │                           │
     │  8. Redirect to / with   │                           │
     │     JWT in memory        │                           │
     │<──────────────────────────────────────────────────────┤
```

### AuthContext Implementation

**`src/context/AuthContext.tsx`**:

```tsx
import React, { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'
import { setToken, clearToken } from '../api/client'

interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'admin-readonly'
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  loading: boolean
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if user is already authenticated
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await axios.get('/auth/me')
      setUser(response.data.user)
      setToken(response.data.token)
    } catch (error) {
      setUser(null)
      clearToken()
    } finally {
      setLoading(false)
    }
  }

  const login = () => {
    window.location.href = '/auth/login'
  }

  const logout = async () => {
    try {
      await axios.post('/auth/logout')
    } finally {
      setUser(null)
      clearToken()
      window.location.href = '/login'
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
```

## API Modules

### Models API

**`src/api/models.ts`**:

```tsx
import { apiClient } from './client'
import { ModelInstance } from '@sardeenz/types'

export interface LoadModelRequest {
  modelPath: string
  displayName: string
  gpuMemoryLimit: number // GB
  port?: number // Optional, auto-assign if not provided
}

export interface LoadModelResponse {
  id: string
  modelPath: string
  displayName: string
  status: 'starting' | 'active' | 'stopping' | 'failed'
  port: number
  gpuMemoryLimit: number
  createdAt: string
}

export interface ModelListResponse {
  models: ModelInstance[]
  total: number
}

export const modelsApi = {
  /**
   * List all model instances
   */
  list: () => apiClient.get<ModelListResponse>('/models'),

  /**
   * Get a specific model instance by ID
   */
  get: (id: string) => apiClient.get<ModelInstance>(`/models/${id}`),

  /**
   * Load a new model instance
   * Requires 'admin' role
   */
  load: (request: LoadModelRequest) => apiClient.post<LoadModelResponse>('/models/load', request),

  /**
   * Unload a running model instance
   * Requires 'admin' role
   */
  unload: (id: string) => apiClient.post(`/models/${id}/unload`),

  /**
   * Get current status of a model instance
   */
  status: (id: string) => apiClient.get<ModelInstance>(`/models/${id}/status`),

  /**
   * Get logs for a model instance
   */
  logs: (id: string, lines = 100) =>
    apiClient.get<{ logs: string[] }>(`/models/${id}/logs`, {
      params: { lines },
    }),
}
```

### Metrics API

**`src/api/metrics.ts`**:

```tsx
import { apiClient } from './client'

export interface ResourceMetrics {
  modelId: string
  timestamp: string
  gpuMemoryUsed: number // GB
  requestCount: number
  activeConnections: number
  avgResponseTime: number // ms
  p95ResponseTime: number // ms
}

export interface SystemMetrics {
  timestamp: string
  totalGpuMemory: number // GB
  usedGpuMemory: number // GB
  freeGpuMemory: number // GB
  gpuUtilization: number // 0-100
  models: Array<{
    id: string
    name: string
    memoryUsed: number
  }>
}

export const metricsApi = {
  /**
   * Get metrics for a specific model
   */
  getModelMetrics: (id: string) => apiClient.get<ResourceMetrics>(`/metrics/models/${id}`),

  /**
   * Get system-wide metrics
   */
  getSystemMetrics: () => apiClient.get<SystemMetrics>('/metrics/system'),

  /**
   * Get metrics for all models
   */
  getAllMetrics: () => apiClient.get<ResourceMetrics[]>('/metrics'),

  /**
   * Get time-series metrics for a model
   * @param id Model instance ID
   * @param duration Duration in seconds (default: 300 = 5 minutes)
   * @param interval Data point interval in seconds (default: 5)
   */
  getTimeSeries: (id: string, duration = 300, interval = 5) =>
    apiClient.get<ResourceMetrics[]>(`/metrics/models/${id}/timeseries`, {
      params: { duration, interval },
    }),
}
```

### Index Re-exports

**`src/api/index.ts`**:

```tsx
export * from './client'
export * from './models'
export * from './metrics'
export * from './types'
```

## Custom Hooks

### useModels Hook

**`src/hooks/useModels.ts`**:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { modelsApi } from '../api/models'
import { ModelInstance } from '@sardeenz/types'

interface UseModelsResult {
  models: ModelInstance[]
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook for fetching and managing model instances with automatic polling
 * @param refreshInterval Polling interval in ms (default: 5000 = 5 seconds)
 * @param enabled Enable/disable automatic polling (default: true)
 */
export function useModels(refreshInterval = 5000, enabled = true): UseModelsResult {
  const [models, setModels] = useState<ModelInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchModels = useCallback(async () => {
    try {
      const response = await modelsApi.list()
      setModels(response.data.models)
      setError(null)
    } catch (err) {
      console.error('Error fetching models:', err)
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    fetchModels()
    const interval = setInterval(fetchModels, refreshInterval)

    return () => clearInterval(interval)
  }, [fetchModels, refreshInterval, enabled])

  return { models, loading, error, refetch: fetchModels }
}
```

### useModelDetails Hook

**`src/hooks/useModelDetails.ts`**:

```tsx
import { useState, useEffect } from 'react'
import { modelsApi } from '../api/models'
import { ModelInstance } from '@sardeenz/types'

interface UseModelDetailsResult {
  model: ModelInstance | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook for fetching details of a specific model instance
 * @param id Model instance ID
 * @param refreshInterval Polling interval in ms (default: 5000)
 */
export function useModelDetails(id: string, refreshInterval = 5000): UseModelDetailsResult {
  const [model, setModel] = useState<ModelInstance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchModel = async () => {
    try {
      const response = await modelsApi.get(id)
      setModel(response.data)
      setError(null)
    } catch (err) {
      console.error(`Error fetching model ${id}:`, err)
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchModel()
    const interval = setInterval(fetchModel, refreshInterval)
    return () => clearInterval(interval)
  }, [id, refreshInterval])

  return { model, loading, error, refetch: fetchModel }
}
```

### useLoadModel Hook

**`src/hooks/useLoadModel.ts`**:

```tsx
import { useState } from 'react'
import { modelsApi, LoadModelRequest } from '../api/models'

interface UseLoadModelResult {
  loadModel: (config: LoadModelRequest) => Promise<void>
  loading: boolean
  error: Error | null
}

/**
 * Hook for loading a new model instance
 */
export function useLoadModel(): UseLoadModelResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadModel = async (config: LoadModelRequest) => {
    setLoading(true)
    setError(null)

    try {
      await modelsApi.load(config)
      // Success - model is now in 'starting' state
    } catch (err) {
      console.error('Error loading model:', err)
      setError(err as Error)
      throw err // Re-throw for component error handling
    } finally {
      setLoading(false)
    }
  }

  return { loadModel, loading, error }
}
```

### useMetrics Hook

**`src/hooks/useMetrics.ts`**:

```tsx
import { useState, useEffect } from 'react'
import { metricsApi, SystemMetrics } from '../api/metrics'

interface UseMetricsResult {
  metrics: SystemMetrics | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook for fetching system metrics with automatic polling
 * @param refreshInterval Polling interval in ms (default: 2000 = 2 seconds)
 * @param enabled Enable/disable automatic polling
 */
export function useMetrics(refreshInterval = 2000, enabled = true): UseMetricsResult {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchMetrics = async () => {
    try {
      const response = await metricsApi.getSystemMetrics()
      setMetrics(response.data)
      setError(null)
    } catch (err) {
      console.error('Error fetching metrics:', err)
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!enabled) return

    fetchMetrics()
    const interval = setInterval(fetchMetrics, refreshInterval)

    return () => clearInterval(interval)
  }, [refreshInterval, enabled])

  return { metrics, loading, error, refetch: fetchMetrics }
}
```

## Error Handling

### Error Types

```tsx
// src/api/types.ts
export interface ApiError {
  message: string
  code: string
  status: number
  details?: Record<string, unknown>
}

export class ApiErrorHandler {
  static parse(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      return {
        message: error.response?.data?.message || error.message,
        code: error.response?.data?.code || 'UNKNOWN_ERROR',
        status: error.response?.status || 500,
        details: error.response?.data?.details,
      }
    }

    return {
      message: 'An unexpected error occurred',
      code: 'UNEXPECTED_ERROR',
      status: 500,
    }
  }

  static isAuthError(error: ApiError): boolean {
    return error.status === 401 || error.status === 403
  }

  static isValidationError(error: ApiError): boolean {
    return error.status === 400
  }

  static isResourceError(error: ApiError): boolean {
    return error.code === 'INSUFFICIENT_GPU_MEMORY' || error.code === 'MODEL_ALREADY_LOADED'
  }
}
```

### Error Display Component

```tsx
// src/components/ErrorAlert.tsx
import React from 'react'
import { Alert, AlertActionCloseButton } from '@patternfly/react-core'
import { ApiError, ApiErrorHandler } from '../api/types'

interface ErrorAlertProps {
  error: Error | ApiError
  onClose: () => void
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({ error, onClose }) => {
  const apiError = ApiErrorHandler.parse(error)

  const variant = apiError.status >= 500 ? 'danger' : 'warning'
  const title = apiError.status >= 500 ? 'Server Error' : 'Request Failed'

  return (
    <Alert
      variant={variant}
      title={title}
      actionClose={<AlertActionCloseButton onClose={onClose} />}
      isInline
    >
      {apiError.message}
      {apiError.details && (
        <pre style={{ marginTop: '1rem' }}>{JSON.stringify(apiError.details, null, 2)}</pre>
      )}
    </Alert>
  )
}
```

## TypeScript Types

### Shared Types from packages/types

```tsx
// src/api/types.ts
// Import shared types from monorepo packages
export type {
  ModelInstance,
  ModelConfiguration,
  ResourceMetrics,
  ControllerOperation,
} from '@sardeenz/types'

// Frontend-specific types
export interface ModelFormData {
  modelPath: string
  displayName: string
  gpuMemoryLimit: number
  port?: number
}

export interface ModelFilters {
  status?: Array<'starting' | 'active' | 'stopping' | 'failed'>
  search?: string
}
```

## Usage Examples

### Loading a Model

```tsx
// src/components/LoadModelDialog.tsx
import React, { useState } from 'react'
import { Modal, Button, Form, FormGroup, TextInput, Slider } from '@patternfly/react-core'
import { useLoadModel } from '../hooks/useLoadModel'

export const LoadModelDialog: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    modelPath: '',
    displayName: '',
    gpuMemoryLimit: 4.0,
  })

  const { loadModel, loading } = useLoadModel()

  const handleSubmit = async () => {
    try {
      await loadModel(formData)
      onSuccess()
      onClose()
    } catch (error) {
      // Error is handled by the hook and stored in error state
      // Display error in UI
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Load Model">
      <Form>
        <FormGroup label="Model Path" isRequired>
          <TextInput
            value={formData.modelPath}
            onChange={(value) => setFormData({ ...formData, modelPath: value })}
          />
        </FormGroup>

        <FormGroup label="Display Name" isRequired>
          <TextInput
            value={formData.displayName}
            onChange={(value) => setFormData({ ...formData, displayName: value })}
          />
        </FormGroup>

        <FormGroup label="GPU Memory Limit (GB)">
          <Slider
            value={formData.gpuMemoryLimit}
            min={0.5}
            max={24}
            step={0.5}
            onChange={(value) => setFormData({ ...formData, gpuMemoryLimit: value })}
          />
        </FormGroup>

        <Button onClick={handleSubmit} isLoading={loading}>
          Load Model
        </Button>
      </Form>
    </Modal>
  )
}
```

### Displaying Model List

```tsx
// src/pages/ModelManagement.tsx
import React from 'react'
import { Page, PageSection, Spinner, Alert } from '@patternfly/react-core'
import { useModels } from '../hooks/useModels'
import { ModelTable } from '../components/ModelTable'

export const ModelManagement: React.FC = () => {
  const { models, loading, error } = useModels(5000) // Poll every 5 seconds

  if (loading && models.length === 0) {
    return <Spinner />
  }

  if (error) {
    return (
      <Alert variant="danger" title="Error loading models">
        {error.message}
      </Alert>
    )
  }

  return (
    <Page>
      <PageSection>
        <ModelTable models={models} />
      </PageSection>
    </Page>
  )
}
```

## Testing with MSW

### MSW Setup

**`src/test/mocks/handlers.ts`**:

```tsx
import { rest } from 'msw'

export const handlers = [
  // List models
  rest.get('/api/v1/models', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        models: [
          {
            id: 'model-1',
            displayName: 'Llama 2 7B',
            status: 'active',
            port: 5001,
            gpuMemoryLimit: 6.0,
            createdAt: '2025-11-11T10:00:00Z',
          },
        ],
        total: 1,
      })
    )
  }),

  // Load model
  rest.post('/api/v1/models/load', async (req, res, ctx) => {
    const body = await req.json()
    return res(
      ctx.status(202),
      ctx.json({
        id: 'model-new',
        ...body,
        status: 'starting',
        createdAt: new Date().toISOString(),
      })
    )
  }),

  // Get metrics
  rest.get('/api/v1/metrics/system', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        timestamp: new Date().toISOString(),
        totalGpuMemory: 24.0,
        usedGpuMemory: 12.5,
        freeGpuMemory: 11.5,
        gpuUtilization: 52,
        models: [{ id: 'model-1', name: 'Llama 2 7B', memoryUsed: 6.2 }],
      })
    )
  }),
]
```

### Test Setup

**`src/test/setup.ts`**:

```tsx
import { setupServer } from 'msw/node'
import { handlers } from './mocks/handlers'

export const server = setupServer(...handlers)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

### Test Example

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { ModelManagement } from './ModelManagement'

test('displays model list', async () => {
  render(<ModelManagement />)

  expect(screen.getByText(/loading/i)).toBeInTheDocument()

  await waitFor(() => {
    expect(screen.getByText('Llama 2 7B')).toBeInTheDocument()
  })
})
```

## Related Documentation

- [Frontend Architecture](../architecture/frontend-architecture.md) - Component architecture and state management
- [Frontend CLAUDE.md](../../apps/frontend/CLAUDE.md) - Development context and guidelines
- [API Guide](../api-guide.md) - Complete Controller API reference
- [Backend CLAUDE.md](../../apps/backend/CLAUDE.md) - Backend API implementation
