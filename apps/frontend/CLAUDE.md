# CLAUDE.md - Frontend Context

> **Note for AI Assistants**: This is a frontend-specific context file for the **sardeenz** application. For project overview, see root [CLAUDE.md](../../CLAUDE.md). For backend context, see [backend/CLAUDE.md](../backend/CLAUDE.md).

## 🎯 Frontend Overview

**sardeenz** - React 18 admin dashboard for managing multiple vLLM model instances on shared GPU infrastructure.

**Purpose**: Provide operators with a web interface to:
- View all loaded models and their resource consumption
- Load and unload LLM instances dynamically
- Monitor GPU memory usage and inference metrics
- Manage model configurations via Controller API
- Run performance benchmarks on loaded models
- Manage memory profiles for capacity planning

**Technology Stack**: React 18.3+, PatternFly 6.x, React Router 7, TypeScript 5.7+, Vite 6.0+
**Development**: Port 5173 with Vite HMR (Hot Module Replacement)
**Production**: Built and served statically by Fastify backend on port 3000

**For detailed architecture**, see [Frontend Architecture](../../docs/architecture/frontend-architecture.md).

## 🎨 PatternFly 6 Critical Requirements

⚠️ **MANDATORY**: Follow the [PatternFly 6 Development Guide](../../docs/development/pf6-guide/README.md) as the **AUTHORITATIVE SOURCE** for all UI development.

### ⚠️ Context7 Warning

**DO NOT use Context7 for PatternFly components.** Context7 may contain outdated PatternFly versions.

**Instead use:**
- Local guide: `docs/development/pf6-guide/`
- Official docs: PatternFly.org

Context7 is fine for: React, Axios, React Router, Vitest, and other non-PatternFly libraries.

### Essential Rules

1. **Class Prefix**: ALL PatternFly classes MUST use `pf-v6-` prefix
2. **Design Tokens**: Use semantic tokens only, never hardcode colors
3. **Component Import**: Import from `@patternfly/react-core` v6 and other @patternfly libraries
4. **Theme Testing**: Test in both light and dark themes
5. **Table Patterns**: Follow guide's table implementation for model lists

### Common Mistakes and Token Usage

**Critical rules** - See [`docs/development/pf6-guide/guidelines/styling-standards.md`](../../docs/development/pf6-guide/guidelines/styling-standards.md) for complete guide:

- ✅ **ALWAYS** use `pf-v6-` prefix for component classes
- ✅ **ALWAYS** use `--pf-t--` prefix for design tokens (semantic tokens with `-t-`)
- ✅ Choose tokens by **meaning** (e.g., `--pf-t--global--color--brand--default`), not appearance
- ❌ **NEVER** hardcode colors or measurements
- ❌ **NEVER** use legacy `--pf-v6-global--` tokens or numbered base tokens

### Component Import Pattern

```tsx
import { Button, Card, Page, PageSection } from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { CubeIcon, MemoryIcon, TrashIcon } from '@patternfly/react-icons';
```

**Version**: PatternFly 6.x (NOT PatternFly 5)

## 🗃️ State Management Philosophy

- **Local State First**: Use `useState` for component-specific state (loading, errors, form data)
- **Context for Auth**: OAuth/OIDC user context for authentication state and role-based access
- **Server State**: Direct API calls with axios and local loading/error states (consider React Query for future optimization)
- **Real-Time Updates**: Polling or WebSocket for model status and metrics (architecture TBD)
- **No Redux**: Keep state management simple with React Context API

## 🎯 Component Development Checklist

### Before Creating ANY Component

1. **Check PatternFly 6 docs** - Use existing PF6 components whenever possible
2. **Follow PatternFly 6 requirements** - ALWAYS use `pf-v6-` prefix, semantic tokens, v6 imports
3. **Review architecture docs** - Check [Frontend Architecture](../../docs/architecture/frontend-architecture.md) for component specs

### Critical Rules for ALL Components

1. **Error Handling**: MUST handle API errors gracefully
   - Use `.catch()` with axios calls
   - Log errors with `console.error()` for debugging
   - Display user-friendly error alerts with PatternFly Alert component
   - Show inline validation errors on forms

2. **Data Fetching**: Use direct axios calls with local state
   - Set loading state before call
   - Handle errors in `.catch()`
   - Update component state on success
   - Consider debouncing for frequent updates

3. **Authentication**: MUST integrate with OAuth/OIDC context
   - Check user role before rendering admin actions (load/unload buttons)
   - Redirect to login if unauthenticated
   - Handle token refresh automatically

4. **Accessibility**: MUST include ARIA labels and keyboard navigation
   - Add `aria-label` to interactive elements
   - Ensure keyboard navigation works (Tab, Enter, Escape)
   - Use semantic HTML elements
   - Test with screen readers when possible

5. **PatternFly 6**: MUST use `pf-v6-` prefix and semantic design tokens
   - Never hardcode colors or spacing
   - Use `--pf-t--` tokens for styling
   - Test in both light and dark themes

### Component Pattern Example

```tsx
import React from 'react';
import axios from 'axios';
import { Alert, Spinner } from '@patternfly/react-core';

interface Model {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'loading';
}

const ModelList: React.FC = () => {
  const [loading, setLoading] = React.useState(false);
  const [models, setModels] = React.useState<Model[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const fetchModels = React.useCallback(() => {
    setLoading(true);
    setError(null);

    axios.get<Model[]>('/api/v1/models')
      .then(response => {
        setModels(response.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching models:', err);
        setError(err.response?.data?.message || 'Failed to load models');
        setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  if (loading) return <Spinner />;
  if (error) return <Alert variant="danger" title="Error" isInline>{error}</Alert>;

  return (
    <div>
      {/* Component JSX */}
    </div>
  );
};

export default ModelList;
```

## 🚀 Essential Development Commands

```bash
# Development server with HMR
npm run dev

# Building
npm run build          # TypeScript check + Vite production build

# Testing
npm run test           # Run Vitest tests
npm run test:coverage  # Coverage report

# Code quality
npm run lint           # ESLint check
npm run type-check     # TypeScript type checking
npm run format         # Prettier format

# CI pipeline
npm run ci-checks      # type-check + lint + test:coverage
```

**For complete workflow**, see [Development Workflow](../../docs/development/development-workflow.md).

## 📁 Project Structure

```
frontend/
├── src/
│   ├── components/      # Shared UI components
│   │   ├── ModelCard.tsx
│   │   ├── MemoryChart.tsx
│   │   ├── LoadModelDialog.tsx
│   │   ├── MemoryDetailsModal.tsx
│   │   ├── benchmark/           # Benchmark-related components
│   │   │   ├── BenchmarkConfigForm.tsx    # Benchmark configuration UI
│   │   │   ├── BenchmarkHistoryTable.tsx  # List of past benchmark runs
│   │   │   ├── BenchmarkProgress.tsx      # Real-time progress display
│   │   │   ├── BenchmarkResultsPanel.tsx  # Metrics visualization
│   │   │   ├── CreateProfileCard.tsx      # Create memory profile from model
│   │   │   ├── MemoryProfilesTab.tsx      # Memory profiles management tab
│   │   │   ├── ProfilesTable.tsx          # List of saved profiles
│   │   │   └── index.ts
│   │   └── Layout/
│   │       ├── AppLayout.tsx
│   │       └── NavSidebar.tsx
│   ├── pages/           # Route-specific page components
│   │   ├── ModelManagement.tsx
│   │   ├── ModelBenchmark.tsx   # Benchmark page with tabs
│   │   ├── GpuInfo.tsx
│   │   └── Settings.tsx
│   ├── services/        # API client layer
│   │   └── api.ts       # All API calls (models, benchmarks, profiles)
│   ├── App.tsx          # Root component with routing
│   └── main.tsx         # Entry point
├── dist/                # Vite build output
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript config
└── package.json
```

## 🌐 Routing

- **React Router v7** for navigation
- **Routes defined in `src/routes.tsx`** - Centralized route configuration
- Auto-generated navigation from route metadata
- **Main routes**:
  - `/` - Model Management (model list, load, unload, memory visualization)
  - `/gpu` - GPU Info (GPU metrics and monitoring)
  - `/benchmark` - Model Benchmark (performance testing)
  - `/settings` - Settings (application configuration)

### Route Configuration

Routes are centrally defined in `src/routes.tsx` with metadata for navigation:

```tsx
// src/routes.tsx
import ModelManagement from './pages/ModelManagement'
import GpuInfo from './pages/GpuInfo'
import ModelBenchmark from './pages/ModelBenchmark'
import Settings from './pages/Settings'

export interface RouteConfig {
  path: string
  element: JSX.Element
  label: string
  itemId: string
}

export const routes: RouteConfig[] = [
  { path: '/', element: <ModelManagement />, label: 'Model Management', itemId: 'model-management' },
  { path: '/gpu', element: <GpuInfo />, label: 'GPU Info', itemId: 'gpu-info' },
  { path: '/benchmark', element: <ModelBenchmark />, label: 'Model Benchmark', itemId: 'model-benchmark' },
  { path: '/settings', element: <Settings />, label: 'Settings', itemId: 'settings' },
]
```

### App Integration

App.tsx imports routes and auto-generates both routing and navigation:

```tsx
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { routes } from './routes'

function App() {
  const location = useLocation()

  // Auto-generated navigation sidebar
  const sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody>
        <Nav>
          <NavList>
            {routes.map((route) => (
              <NavItem key={route.itemId} itemId={route.itemId} isActive={location.pathname === route.path}>
                <Link to={route.path}>{route.label}</Link>
              </NavItem>
            ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  // Auto-generated routes
  return (
    <Page sidebar={sidebar}>
      <Routes>
        {routes.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Routes>
    </Page>
  )
}
```

### Adding New Routes

To add a new route:

1. Add entry to routes array in `src/routes.tsx`
2. Navigation and routing automatically update
3. No changes needed in App.tsx

## 🧪 Testing Guidelines

### Testing Stack

- **Test Runner**: Vitest (NOT Jest)
- **Component Testing**: @testing-library/react + @testing-library/user-event
- **Mocking**: MSW (Mock Service Worker) for API mocking
- **Coverage Target**: 70%+ for critical paths (model operations, auth)

### PatternFly 6 Testing Patterns

- **Modals**: Use `role="dialog"` to query modals
- **Dropdowns**: Use `role="menuitem"` for dropdown options
- **Buttons**: Use `getByRole('button', { name: 'Button Text' })`
- **Forms**: Query by `role="textbox"`, `role="combobox"`, etc.

**Example Test**:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadModelDialog } from './LoadModelDialog';

test('should load model when form submitted', async () => {
  const user = userEvent.setup();
  const onLoad = vi.fn();

  render(<LoadModelDialog isOpen onClose={vi.fn()} onLoad={onLoad} />);

  // Fill model name
  const nameInput = screen.getByRole('textbox', { name: /model name/i });
  await user.type(nameInput, 'llama-2-7b');

  // Submit form
  const submitButton = screen.getByRole('button', { name: /load model/i });
  await user.click(submitButton);

  await waitFor(() => {
    expect(onLoad).toHaveBeenCalledWith({ name: 'llama-2-7b' });
  });
});
```

**For testing patterns**, see [PatternFly 6 Testing Patterns](../../docs/development/pf6-guide/testing-patterns/README.md).

## 🎨 Styling Guidelines

- Use PatternFly 6 design tokens exclusively
- Support dark theme with semantic tokens (they auto-adapt)
- Avoid hardcoded values - use `--pf-t--` tokens
- Test in both light and dark themes

**Example**:
```css
/* ✅ CORRECT - Semantic token */
.model-card {
  background-color: var(--pf-t--global--background--color--primary);
  border-color: var(--pf-t--global--border--color--default);
  padding: var(--pf-t--global--spacer--md);
}

/* ❌ WRONG - Hardcoded value */
.model-card {
  background-color: #ffffff;
  border-color: #d2d2d2;
  padding: 16px;
}
```

## 🔐 Authentication Integration

### OAuth/OIDC Flow

1. **Redirect to IdP** when user visits protected route
2. **Receive authorization code** on callback URL
3. **Exchange code for JWT** via backend `/auth/callback` endpoint
4. **Store JWT** in memory (NOT localStorage for security)
5. **Inject JWT** in axios interceptor for all API calls
6. **Refresh token** automatically before expiration

### Role-Based Access Control

- **Admin role** (`admin`): Can load/unload models, modify configurations
- **Read-only role** (`admin-readonly`): Can view models and metrics, cannot modify

### Implementation Pattern

```tsx
import React from 'react';
import axios from 'axios';

interface User {
  id: string;
  name: string;
  role: 'admin' | 'admin-readonly';
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

export const AuthContext = React.createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<User | null>(null);

  const login = () => {
    // Redirect to OAuth provider
    window.location.href = '/auth/login';
  };

  const logout = () => {
    axios.post('/auth/logout').then(() => {
      setUser(null);
    });
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
```

**For API client setup**, see [Frontend API Client Guide](../../docs/development/frontend-api-client.md).

## 📊 Real-Time Updates

### SSE for Model Loading

The backend provides Server-Sent Events for real-time model loading progress:

**Endpoint:** `GET /api/v1/models/instances/{instance_id}/events`

**Event Types:**
- `status` - Model state transitions (starting → active/failed)
- `log` - vLLM process stdout/stderr output
- `error` - Error notifications with extracted messages

**Usage with EventSource:**
```tsx
const eventSource = new EventSource(
  `/api/v1/models/instances/${instanceId}/events?types=status,log`
);

eventSource.addEventListener('status', (event) => {
  const data = JSON.parse(event.data);
  if (data.data.currentStatus === 'active') {
    // Model ready
  } else if (data.data.currentStatus === 'failed') {
    // Show error: data.data.errorMessage
  }
});

eventSource.addEventListener('log', (event) => {
  const data = JSON.parse(event.data);
  // Append to log viewer: data.data.content
});
```

### Metrics Polling Strategy

- **Model status**: Poll `/api/v1/models` every 5 seconds when on model pages
- **GPU metrics**: Poll `/api/v1/metrics` every 2 seconds when on metrics page
- **Stop polling** when user navigates away to reduce load

### Example Polling Hook

```tsx
import React from 'react';
import axios from 'axios';

export function usePolling<T>(
  url: string,
  interval: number,
  enabled: boolean = true
) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!enabled) return;

    const fetchData = () => {
      axios.get<T>(url)
        .then(res => setData(res.data))
        .catch(err => setError(err));
    };

    fetchData(); // Initial fetch
    const timer = setInterval(fetchData, interval);

    return () => clearInterval(timer);
  }, [url, interval, enabled]);

  return { data, error };
}

// Usage
const { data: models } = usePolling<Model[]>('/api/v1/models', 5000, isOnModelPage);
```

## ⚠️ Key Implementation Guidelines

### For AI Assistants

**DO:**
- ✅ Use PatternFly 6 components with `pf-v6-` prefix
- ✅ Import from `@patternfly/react-core`, `@patternfly/react-table`, `@patternfly/react-icons` v6
- ✅ Use `--pf-t--` semantic design tokens for styling
- ✅ Use `useState` for local state, Context API for auth/global state
- ✅ Use Vite 6.0+ for build (NOT Webpack)
- ✅ Use Vitest for testing (NOT Jest)
- ✅ Handle errors with try/catch and display PatternFly Alert components
- ✅ Integrate OAuth/OIDC for all routes
- ✅ Include ARIA labels and accessibility features
- ✅ Use TypeScript with strict mode
- ✅ Test with `@testing-library/react` and `@testing-library/user-event`
- ✅ **Run `npm run format` after creating or modifying files** - Ensures consistent Prettier formatting

**DON'T:**
- ❌ Use PatternFly 5 or hardcoded `pf-` classes (must be `pf-v6-`)
- ❌ Use hardcoded colors, sizes, or spacing (use `--pf-t--` tokens)
- ❌ Use legacy `--pf-v6-global--` tokens (use semantic `--pf-t--` tokens)
- ❌ Use Webpack (project uses Vite)
- ❌ Use Jest (project uses Vitest)
- ❌ Skip authentication checks on protected actions
- ❌ Skip accessibility features
- ❌ Use inline styles unless absolutely necessary
- ❌ Store JWT in localStorage (security risk - use memory or httpOnly cookies)
- ❌ Hardcode API URLs (use environment variables)

### PatternFly 6 Guide

For comprehensive PatternFly 6 development guidance:
- **[Complete PF6 Guide](../../docs/development/pf6-guide/README.md)** - Components, styling, testing patterns, and best practices
- **[Component Reference](../../docs/development/pf6-guide/components/README.md)** - PatternFly 6 component usage
- **[Styling Standards](../../docs/development/pf6-guide/guidelines/styling-standards.md)** - Design token usage and theming
- **[Testing Patterns](../../docs/development/pf6-guide/testing-patterns/README.md)** - Testing guides for PatternFly 6 components
- **[Troubleshooting](../../docs/development/pf6-guide/troubleshooting/README.md)** - Common issues and solutions

## 🎯 Key vLLM-Specific Components

### 1. ModelCard Component

Display a single model instance with status, memory usage, and actions.

**Required Props:**
- `model: ModelInstance` - Model data from API
- `onLoad: () => void` - Load model action
- `onUnload: () => void` - Unload model action
- `userRole: 'admin' | 'admin-readonly'` - For conditional rendering

**PatternFly Components:** Card, CardTitle, CardBody, Button, Badge, ProgressBar

### 2. LoadModelDialog Component

Modal form for loading a new model instance with configuration.

**Required Fields:**
- Model identifier (dropdown or text input)
- GPU memory allocation (slider, 0.1-0.9)
- Port assignment (auto or manual)

**PatternFly Components:** Modal, Form, FormGroup, TextInput, Select, Slider

### 3. MemoryUsageChart Component

Real-time chart showing GPU memory allocation across models.

**Data Source:** `/api/v1/metrics` endpoint (poll every 2-5 seconds)

**PatternFly Components:** Card, CardBody
**Chart Library:** Consider PatternFly Charts (Victory-based) or Chart.js

### 4. ModelStatusBadge Component

Status indicator with color-coding.

**Statuses:**
- `active` - Green badge (model serving requests)
- `starting` - Blue badge with spinner (model loading in background)
- `stopping` - Yellow badge (graceful shutdown)
- `failed` - Red badge with error tooltip
- `stopped` - Gray badge (not running)

**PatternFly Components:** Badge, Spinner, Tooltip

## 📊 Benchmark Components

### 5. BenchmarkConfigForm Component

Form for configuring benchmark parameters before running.

**Key Fields:**
- Benchmark name (optional)
- Execution mode: `isolated` or `contention`
- Model instance selection (multi-select for contention mode)
- Input/output token targets
- Concurrency level
- Warmup and total request counts
- SLA threshold (optional, for goodput)

**PatternFly Components:** Form, FormGroup, TextInput, Select, NumberInput, Switch

### 6. BenchmarkProgress Component

Real-time display of benchmark execution progress.

**Features:**
- Phase indicator (warmup vs measured)
- Progress bar per scenario
- Live request count updates
- Error count display
- SSE connection for real-time updates

**PatternFly Components:** Progress, Card, DescriptionList

### 7. BenchmarkResultsPanel Component

Displays benchmark metrics after completion.

**Metrics Displayed:**
- TTFT (Time To First Token): min, max, avg, p50, p90, p95, p99
- TPS (Tokens Per Second): distribution with percentiles
- E2E Latency: distribution with percentiles
- Goodput percentage (requests under SLA)
- Requests per second throughput

**PatternFly Components:** Card, Table, DescriptionList

### 8. BenchmarkHistoryTable Component

Paginated table of past benchmark runs.

**Columns:**
- Name/ID
- Status (pending, running, completed, failed)
- Mode (isolated/contention)
- Created timestamp
- Duration
- Request counts (total/success/failed)

**PatternFly Components:** Table, Pagination, Label, Timestamp

### 9. MemoryProfilesTab Component

Tab content for memory profile management.

**Features:**
- List saved profiles in a table
- Create profile from running model instance
- Delete profiles
- Profile lookup by model/tokens/GPU

**PatternFly Components:** Tabs, Table, Button, Modal

### 10. CreateProfileCard Component

Card for creating a memory profile from a loaded model.

**Features:**
- Model instance selector
- Auto-populated memory metrics from model
- Custom profile name input
- Comments field

**PatternFly Components:** Card, Form, Select, TextInput, TextArea

## 🔧 Known Limitations

- No internationalization (i18n) - English only for MVP
- No offline support or service worker
- No WebSocket implementation (polling only)
- Limited error recovery (manual refresh required for some errors)
- No undo/redo for model operations
- No bulk operations (load/unload multiple models at once)

## 🛠️ Debugging Workflow

1. **Make component changes** - Save the file
2. **Check Vite dev server** - Vite compiles automatically, check terminal output
3. **If TypeScript errors** - Fix types and save, Vite will recompile
4. **If ESLint warnings** - Fix or add disable comment if intentional
5. **Check browser** - HMR should auto-update, check browser console for runtime errors
6. **If HMR fails** - Browser will show error overlay with details, fix and save to retry

**Primary debugging tool**: Browser DevTools Console (React DevTools extension recommended)

## 📚 Related Documentation

- [Frontend Architecture](../../docs/architecture/frontend-architecture.md) - Component specifications and data flow
- [Frontend API Client](../../docs/development/frontend-api-client.md) - Controller API integration guide
- [PatternFly 6 Guide](../../docs/development/pf6-guide/README.md) - Comprehensive guide for UI development
- Root [CLAUDE.md](../../CLAUDE.md) - Project overview
- Backend [CLAUDE.md](../backend/CLAUDE.md) - Backend API context

