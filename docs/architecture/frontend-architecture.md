# Frontend Architecture

This document provides detailed frontend architecture specifications for the sardeenz admin dashboard.

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Component Hierarchy](#component-hierarchy)
- [State Management](#state-management)
- [Routing Architecture](#routing-architecture)
- [Authentication Flow](#authentication-flow)
- [API Integration](#api-integration)
- [Real-Time Updates](#real-time-updates)
- [Key Component Specifications](#key-component-specifications)
- [Error Handling](#error-handling)
- [Performance Considerations](#performance-considerations)

## Overview

The sardeenz frontend is a React-based admin dashboard that enables operators to:

- Monitor all loaded LLM instances and their resource consumption
- Load and unload models dynamically
- View real-time GPU memory metrics and inference statistics
- Manage model configurations and operational state

**Design Principles:**

- **PatternFly-first**: Leverage PatternFly 6 components for consistent UX
- **Type-safe**: TypeScript strict mode throughout
- **Accessibility**: WCAG 2.1 AA compliance
- **Performance**: <3s initial load, <200ms interactions
- **Security**: OAuth 2.0 with role-based access control

## Technology Stack

| Layer             | Technology                     | Purpose                   |
| ----------------- | ------------------------------ | ------------------------- |
| **UI Framework**  | React 18.3+                    | Component-based UI        |
| **Language**      | TypeScript 5.7+ (strict)       | Type safety               |
| **Design System** | PatternFly 6.x                 | Enterprise UI components  |
| **Routing**       | React Router 7                 | Client-side routing       |
| **Build Tool**    | Vite 6.0+                      | Fast dev server + bundler |
| **HTTP Client**   | Axios                          | API communication         |
| **Testing**       | Vitest + React Testing Library | Unit/integration tests    |
| **Mocking**       | MSW (Mock Service Worker)      | API mocking               |
| **State**         | React Context API + useState   | Local and global state    |

## Component Hierarchy

```
App (AuthProvider, Router)
├── ProtectedRoute (Auth guard)
│   └── AppLayout (PF Page component)
│       ├── NavSidebar (PF Nav)
│       │   ├── Dashboard link
│       │   ├── Models link
│       │   └── Metrics link
│       └── PageSection (Content area)
│           └── Routes
│               ├── Dashboard
│               │   ├── ModelsSummaryCard
│               │   │   ├── ModelStatusBadge (x N models)
│               │   │   └── LoadModelButton
│               │   ├── GPUMetricsCard
│               │   │   └── MemoryUsageChart
│               │   └── RecentActivityCard
│               │       └── OperationLogList
│               ├── ModelManagement
│               │   ├── ModelListToolbar
│               │   │   ├── SearchInput
│               │   │   ├── StatusFilter
│               │   │   └── LoadModelButton → LoadModelDialog
│               │   ├── ModelTable (PF Table)
│               │   │   └── ModelRow (x N)
│               │   │       ├── ModelStatusBadge
│               │   │       ├── MemoryProgressBar
│               │   │       └── ActionButtons (unload, details)
│               │   └── EmptyState (when no models)
│               ├── ModelDetails (:id)
│               │   ├── ModelHeader
│               │   │   ├── ModelStatusBadge
│               │   │   └── ActionButtons
│               │   ├── ConfigurationCard
│               │   │   └── ConfigDisplay (key-value pairs)
│               │   ├── MetricsCard
│               │   │   ├── RequestRateChart
│               │   │   └── LatencyChart
│               │   └── LogsCard
│               │       └── LogViewer
│               └── Metrics
│                   ├── SystemMetricsCard
│                   │   └── GPUMemoryTimeSeries
│                   └── ModelMetricsGrid
│                       └── ModelMetricsCard (x N models)
│
└── Shared Components
    ├── LoadModelDialog (Modal form)
    ├── SaveConfigurationDialog (Save current models as preset)
    ├── LoadConfigurationDialog (Load saved configuration)
    ├── UnloadModelDialog (Confirmation)
    ├── ErrorAlert (Notification)
    └── LoadingSpinner
```

## State Management

### Strategy

- **Local State (`useState`)**: Component-specific UI state (loading, form inputs, errors)
- **Context API**: Global state (auth, user role, theme)
- **Server State**: Fetched directly via axios, stored locally in components
- **Future Optimization**: React Query for caching, refetching, optimistic updates

### State Distribution

#### Local State Examples

```tsx
// Component-level loading state
const [loading, setLoading] = useState(false)

// Form input state
const [modelConfig, setModelConfig] = useState({ name: '', memory: 0.5 })

// UI state
const [isDialogOpen, setIsDialogOpen] = useState(false)
```

#### Global State (Context)

**AuthContext** (`src/context/AuthContext.tsx`):

```typescript
interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  role: 'admin' | 'admin-readonly' | null
  login: () => void
  logout: () => void
  refreshToken: () => Promise<void>
}
```

**Usage:**

```tsx
const { user, role, isAuthenticated } = useAuth()

// Conditional rendering based on role
{
  role === 'admin' && <LoadModelButton />
}
```

### Server State Pattern

```tsx
const ModelList: React.FC = () => {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    fetchModels()
    const interval = setInterval(fetchModels, 5000) // Poll every 5s
    return () => clearInterval(interval)
  }, [])

  const fetchModels = async () => {
    try {
      const response = await modelsApi.list()
      setModels(response.data)
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  return <ModelTable models={models} loading={loading} error={error} />
}
```

## Routing Architecture

### Route Structure

| Path         | Component       | Purpose                                        |
| ------------ | --------------- | ---------------------------------------------- |
| `/`          | ModelManagement | Model list, load, unload, memory visualization |
| `/gpu`       | GpuInfo         | GPU metrics and monitoring                     |
| `/benchmark` | ModelBenchmark  | Performance testing                            |
| `/settings`  | Settings        | Application configuration                      |

### Centralized Route Configuration

Routes are defined in a centralized configuration file (`src/routes.tsx`) that serves as the single source of truth for both routing and navigation:

```tsx
// src/routes.tsx
import ModelManagement from './pages/ModelManagement'
import GpuInfo from './pages/GpuInfo'
import ModelBenchmark from './pages/ModelBenchmark'
import Settings from './pages/Settings'

export interface RouteConfig {
  path: string
  element: JSX.Element
  label: string // Navigation display label
  itemId: string // NavItem identifier
}

export const routes: RouteConfig[] = [
  {
    path: '/',
    element: <ModelManagement />,
    label: 'Model Management',
    itemId: 'model-management',
  },
  {
    path: '/gpu',
    element: <GpuInfo />,
    label: 'GPU Info',
    itemId: 'gpu-info',
  },
  {
    path: '/benchmark',
    element: <ModelBenchmark />,
    label: 'Model Benchmark',
    itemId: 'model-benchmark',
  },
  {
    path: '/settings',
    element: <Settings />,
    label: 'Settings',
    itemId: 'settings',
  },
]
```

### App Integration with Auto-Generated Routes

The `App.tsx` component imports the route configuration and automatically generates both the route definitions and navigation sidebar:

```tsx
// src/App.tsx
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { routes } from './routes'

function App() {
  const location = useLocation()

  // Auto-generated navigation sidebar from routes
  const sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody>
        <Nav>
          <NavList>
            {routes.map((route) => (
              <NavItem
                key={route.itemId}
                itemId={route.itemId}
                isActive={location.pathname === route.path}
              >
                <Link to={route.path}>{route.label}</Link>
              </NavItem>
            ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  // Auto-generated route definitions
  return (
    <Page masthead={masthead} sidebar={sidebar}>
      <Routes>
        {routes.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Routes>
    </Page>
  )
}
```

### Benefits of Centralized Routing

1. **Single Source of Truth**: Routes and navigation are defined in one place
2. **Automatic Synchronization**: Navigation automatically updates when routes change
3. **Type Safety**: TypeScript ensures all routes have required metadata
4. **Easy Maintenance**: Adding a new route requires only one change in `routes.tsx`
5. **Reduced Duplication**: No need to maintain separate route and navigation definitions

## Authentication Flow

### OAuth 2.0 Integration

```
┌─────────┐                ┌──────────┐                ┌──────────┐
│ Browser │                │ Frontend │                │ Backend  │
└────┬────┘                └────┬─────┘                └────┬─────┘
     │                          │                           │
     │  1. Navigate to /models  │                           │
     ├─────────────────────────>│                           │
     │                          │                           │
     │  2. Check auth state     │                           │
     │     (no token)           │                           │
     │                          │                           │
     │  3. Redirect /auth/login │                           │
     │<─────────────────────────┤                           │
     │                          │                           │
     │  4. GET /auth/login      │                           │
     ├──────────────────────────┼──────────────────────────>│
     │                          │                           │
     │  5. 302 to IdP           │                           │
     │<──────────────────────────────────────────────────────┤
     │                          │                           │
     │  6. OAuth flow           │                           │
     │  (user authenticates)    │                           │
     │                          │                           │
     │  7. Callback with code   │                           │
     ├──────────────────────────┼──────────────────────────>│
     │                          │                           │
     │  8. Exchange code → JWT  │                           │
     │<──────────────────────────────────────────────────────┤
     │                          │                           │
     │  9. Store JWT, redirect  │                           │
     │     to /models           │                           │
     ├─────────────────────────>│                           │
     │                          │                           │
     │ 10. Render protected     │                           │
     │     route                │                           │
     │<─────────────────────────┤                           │
```

### JWT Handling

**Storage:** In-memory only (NOT localStorage)

```tsx
// src/api/client.ts
let jwtToken: string | null = null

export const setToken = (token: string) => {
  jwtToken = token
}

export const getToken = () => jwtToken

export const clearToken = () => {
  jwtToken = null
}
```

**Axios Interceptor:**

```tsx
import axios from 'axios'

const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
})

// Request interceptor: Add JWT to all requests
apiClient.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: Handle 401 (redirect to login)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

## API Integration

### API Client Structure

```
src/api/
├── client.ts          # Axios instance + interceptors
├── models.ts          # Model endpoints
├── metrics.ts         # Metrics endpoints
└── types.ts           # API response types
```

### API Modules

**`client.ts`** - Base configuration:

```tsx
import axios, { AxiosInstance } from 'axios'

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add interceptors (auth, error handling)
```

**`models.ts`** - Model operations:

```tsx
import { apiClient } from './client'
import { ModelInstance, LoadModelRequest, LoadModelResponse } from './types'

export const modelsApi = {
  list: () => apiClient.get<ModelInstance[]>('/models'),

  get: (id: string) => apiClient.get<ModelInstance>(`/models/${id}`),

  load: (request: LoadModelRequest) => apiClient.post<LoadModelResponse>('/models/load', request),

  unload: (id: string) => apiClient.post(`/models/${id}/unload`),

  status: (id: string) => apiClient.get<ModelInstance>(`/models/${id}/status`),
}
```

**`metrics.ts`** - Metrics endpoints:

```tsx
import { apiClient } from './client'
import { ResourceMetrics, SystemMetrics } from './types'

export const metricsApi = {
  getModelMetrics: (id: string) => apiClient.get<ResourceMetrics>(`/metrics/models/${id}`),

  getSystemMetrics: () => apiClient.get<SystemMetrics>('/metrics/system'),

  getAll: () => apiClient.get<ResourceMetrics[]>('/metrics'),
}
```

### Custom Hooks for API Calls

**`src/hooks/useModels.ts`**:

```tsx
import { useState, useEffect } from 'react'
import { modelsApi } from '../api/models'
import { ModelInstance } from '../api/types'

export function useModels(refreshInterval = 5000) {
  const [models, setModels] = useState<ModelInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchModels = async () => {
    try {
      const response = await modelsApi.list()
      setModels(response.data)
      setError(null)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchModels()
    const interval = setInterval(fetchModels, refreshInterval)
    return () => clearInterval(interval)
  }, [refreshInterval])

  return { models, loading, error, refetch: fetchModels }
}
```

## Real-Time Updates

### Polling Strategy (MVP)

- **Model status**: Poll `/api/v1/models` every 5 seconds
- **GPU metrics**: Poll `/api/v1/metrics` every 2 seconds
- **Stop polling**: When component unmounts or user navigates away

### Polling Hook

**`src/hooks/usePolling.ts`**:

```tsx
import { useState, useEffect, useRef } from 'react'

export function usePolling<T>(fetchFn: () => Promise<T>, interval: number, enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const poll = async () => {
      try {
        const result = await fetchFn()
        if (isMountedRef.current) {
          setData(result)
          setError(null)
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(err as Error)
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false)
        }
      }
    }

    poll() // Initial fetch
    const timer = setInterval(poll, interval)

    return () => clearInterval(timer)
  }, [fetchFn, interval, enabled])

  return { data, error, loading }
}
```

### Future: WebSocket Integration

**Planned architecture** (post-MVP):

```tsx
// src/hooks/useWebSocket.ts
export function useWebSocket(url: string) {
  const [data, setData] = useState(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const ws = new WebSocket(url)

    ws.onopen = () => setConnected(true)
    ws.onmessage = (event) => setData(JSON.parse(event.data))
    ws.onclose = () => setConnected(false)

    return () => ws.close()
  }, [url])

  return { data, connected }
}
```

## Key Component Specifications

### 1. ModelCard / ModelCardCompact

**Purpose:** Display a single model instance with status, GPU placement, and actions.

**Props:**

```tsx
interface ModelCardProps {
  model: ModelInstanceDTO
  onUnload: (instanceId: string, modelPath: string, isFailed: boolean) => void
  onSleep?: (instanceId: string) => void
  onWake?: (instanceId: string) => void
  isUnloading?: boolean
  isSleeping?: boolean
  isWaking?: boolean
}
```

**PatternFly Components:**

- `Card`, `CardTitle`, `CardBody`, `CardFooter`
- `DescriptionList` (for model details)
- `Badge` (via `ModelStatusBadge` for status)
- `Button` (for actions)
- `ExpandableSection` (for launch command)
- `Dropdown` with `DropdownItem` for actions menu
- `MoonIcon`, `SunIcon` (for sleep/wake actions)

**Layout:**

```
┌─────────────────────────────────────┐
│ meta-llama/Llama-3.2-1B   [Running] │
│                                     │
│ Served model name: Llama-3.2-1B     │
│ Port: 8001                          │
│ Max Tokens: 4096                    │
│ GPU Memory: 80%             Details │
│ GPU: 0        (or GPUs: 0, 1 (...)) │
│ Started at: 12/5/2025, 10:30 AM     │
│                                     │
│ ▸ Launch Command                    │
│                                     │
│ [Unload]                            │
└─────────────────────────────────────┘
```

**GPU Display:**

- Single GPU: Shows "GPU 0"
- Multiple GPUs: Shows "GPU 0, GPU 1 (tensor parallel)"
- The "(tensor parallel)" suffix indicates model is split across GPUs

### 2. LoadModelDialog

**Purpose:** Modal form for loading a new model instance.

**Props:**

```tsx
interface LoadModelDialogProps {
  isOpen: boolean
  onClose: () => void
  onLoad: (config: LoadModelConfig) => Promise<void>
}

interface LoadModelConfig {
  modelPath: string
  displayName: string
  gpuMemoryLimit: number // 0.1 - 0.9
  port?: number // Optional, auto-assign if not provided
  enableSleepMode?: boolean // Enable sleep mode for this model
}
```

**PatternFly Components:**

- `Modal`
- `Form`, `FormGroup`
- `TextInput` (model path, display name)
- `Slider` (GPU memory allocation)
- `NumberInput` (port, optional)
- `Checkbox` (Enable Sleep Mode)
- `Button` (Load, Cancel)

**Validation:**

- Model path: Required, must exist
- Display name: Required, max 50 chars
- GPU memory: 0.1-0.9 (10%-90%)
- Port: Optional, 1024-65535
- Enable Sleep Mode: Optional checkbox to allow the model to be put to sleep later

### 3. MemoryUsageChart

**Purpose:** Real-time visualization of GPU memory allocation.

**Props:**

```tsx
interface MemoryUsageChartProps {
  totalMemory: number // Total GPU memory in GB
  models: Array<{
    id: string
    name: string
    memoryUsed: number
    color: string
  }>
}
```

**Chart Type:** Stacked bar chart or donut chart

**PatternFly Components:**

- `Card`, `CardBody`
- PatternFly Charts (Victory-based)

**Data Source:** `/api/v1/metrics` (poll every 2-5 seconds)

### 4. ModelStatusBadge

**Purpose:** Visual status indicator for models.

**Props:**

```tsx
interface ModelStatusBadgeProps {
  status: 'starting' | 'active' | 'sleeping' | 'stopping' | 'failed'
}
```

**PatternFly Components:**

- `Badge`
- `Spinner` (for 'starting', 'stopping' status)
- `MoonIcon` (for 'sleeping' status)

**Color Mapping:**

- `starting` → Blue badge with spinner
- `active` → Green badge
- `sleeping` → Purple badge with moon icon
- `stopping` → Orange badge with spinner
- `failed` → Red badge

## Error Handling

### Error Types

1. **Network Errors** (offline, timeout)
2. **Authentication Errors** (401, 403)
3. **Validation Errors** (400)
4. **Server Errors** (500, 503)
5. **Resource Errors** (insufficient GPU memory)

### Error Display Pattern

```tsx
import { Alert, AlertActionCloseButton } from '@patternfly/react-core'

const ErrorAlert: React.FC<{ error: Error; onClose: () => void }> = ({ error, onClose }) => {
  const variant = error.response?.status === 401 ? 'danger' : 'warning'
  const title = error.response?.status === 401 ? 'Authentication Required' : 'Error'

  return (
    <Alert
      variant={variant}
      title={title}
      actionClose={<AlertActionCloseButton onClose={onClose} />}
      isInline
    >
      {error.message}
    </Alert>
  )
}
```

### Global Error Boundary (Future)

```tsx
// src/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component<Props, State> {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error boundary caught:', error, errorInfo)
    // Log to monitoring service
  }

  render() {
    if (this.state.hasError) {
      return <ErrorPage />
    }
    return this.props.children
  }
}
```

## Performance Considerations

### Bundle Size Optimization

- **Code splitting**: Use React.lazy() for routes
- **Tree shaking**: Vite handles automatically
- **PatternFly imports**: Import specific components, not entire library

**Example:**

```tsx
// ✅ Good - Tree-shakeable
import { Button, Card } from '@patternfly/react-core'

// ❌ Bad - Imports entire library
import * as PF from '@patternfly/react-core'
```

### Rendering Optimization

**Memoization for expensive components:**

```tsx
import { memo } from 'react'

const ModelCard = memo<ModelCardProps>(
  ({ model, onUnload }) => {
    // Component logic
  },
  (prevProps, nextProps) => {
    // Custom comparison: only re-render if model data changed
    return (
      prevProps.model.id === nextProps.model.id && prevProps.model.status === nextProps.model.status
    )
  }
)
```

**Debouncing for search/filter:**

```tsx
import { useState, useCallback } from 'react'
import { debounce } from 'lodash-es'

const ModelSearch: React.FC = () => {
  const [search, setSearch] = useState('')

  const debouncedSearch = useCallback(
    debounce((value: string) => {
      // Perform search API call
    }, 300),
    []
  )

  const handleChange = (value: string) => {
    setSearch(value)
    debouncedSearch(value)
  }

  return <TextInput value={search} onChange={handleChange} />
}
```

### Polling Optimization

- **Adaptive polling**: Increase interval when user is inactive
- **Pause when hidden**: Use Page Visibility API to stop polling when tab is hidden
- **Conditional polling**: Only poll on relevant pages

```tsx
import { useEffect, useState } from 'react'

function useVisibilityChange() {
  const [isVisible, setIsVisible] = useState(!document.hidden)

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return isVisible
}

// Usage in polling hook
const isVisible = useVisibilityChange()
const { data } = usePolling(fetchFn, 5000, isVisible)
```

## Testing Strategy

### Unit Tests

Test individual components in isolation with mocked dependencies.

```tsx
// ModelCard.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelCard } from './ModelCard'

describe('ModelCard', () => {
  const mockModel = {
    id: 'model-1',
    displayName: 'llama-2-7b',
    status: 'active' as const,
    port: 5001,
    gpuMemoryLimit: 6.0,
    // ... other fields
  }

  it('renders model information correctly', () => {
    render(<ModelCard model={mockModel} onUnload={vi.fn()} userRole="admin" />)

    expect(screen.getByText('llama-2-7b')).toBeInTheDocument()
    expect(screen.getByText('Port: 5001')).toBeInTheDocument()
  })

  it('calls onUnload when unload button clicked (admin only)', async () => {
    const user = userEvent.setup()
    const onUnload = vi.fn()

    render(<ModelCard model={mockModel} onUnload={onUnload} userRole="admin" />)

    const unloadButton = screen.getByRole('button', { name: /unload/i })
    await user.click(unloadButton)

    expect(onUnload).toHaveBeenCalledWith('model-1')
  })

  it('hides unload button for read-only users', () => {
    render(<ModelCard model={mockModel} onUnload={vi.fn()} userRole="admin-readonly" />)

    expect(screen.queryByRole('button', { name: /unload/i })).not.toBeInTheDocument()
  })
})
```

### Integration Tests

Test API integration with MSW (Mock Service Worker).

```tsx
// ModelManagement.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { setupServer } from 'msw/node'
import { ModelManagement } from './ModelManagement'

const server = setupServer(
  rest.get('/api/v1/models', (req, res, ctx) => {
    return res(ctx.json([mockModel1, mockModel2]))
  })
)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('loads and displays models', async () => {
  render(<ModelManagement />)

  expect(screen.getByText(/loading/i)).toBeInTheDocument()

  await waitFor(() => {
    expect(screen.getByText('llama-2-7b')).toBeInTheDocument()
    expect(screen.getByText('mistral-7b')).toBeInTheDocument()
  })
})
```

## Accessibility Guidelines

### WCAG 2.1 AA Compliance

- **Keyboard navigation**: All interactive elements must be keyboard-accessible
- **Screen readers**: Proper ARIA labels and semantic HTML
- **Color contrast**: Minimum 4.5:1 for text, 3:1 for large text
- **Focus indicators**: Visible focus states on all interactive elements

### Example Accessibility Implementation

```tsx
<Button
  aria-label="Unload llama-2-7b model"
  onClick={() => onUnload(model.id)}
>
  Unload
</Button>

<ProgressBar
  value={70}
  min={0}
  max={100}
  title="GPU memory usage"
  aria-label="GPU memory usage: 70%"
/>

<Table aria-label="Model instances list">
  {/* Table content */}
</Table>
```

## Related Documentation

- [PatternFly 6 Guide](../development/pf6-guide/README.md) - Component library documentation
- [Frontend API Client](../development/frontend-api-client.md) - API integration guide
- [Frontend CLAUDE.md](../../apps/frontend/CLAUDE.md) - Development context
- [Architecture](../architecture.md) - System-wide architecture overview
