# Phase 0 Research: Multi-Model Platform

**Feature**: 001-multi-model-platform
**Date**: 2025-11-08
**Purpose**: Document all technical decisions and research findings to resolve NEEDS CLARIFICATION items

## Table of Contents

1. [Fastify Best Practices for TypeScript](#1-fastify-best-practices-for-typescript)
2. [kvcached Subprocess Management](#2-kvcached-subprocess-management)
3. [OAuth 2.0 Integration](#3-oauth-20-integration)
4. [Streaming Proxy Implementation](#4-streaming-proxy-implementation)
5. [Prometheus Metrics in Fastify](#5-prometheus-metrics-in-fastify)
6. [PatternFly 6 + Vite Setup](#6-patternfly-6--vite-setup)
7. [npm Workspaces Monorepo](#7-npm-workspaces-monorepo)
8. [Decisions Summary](#decisions-summary)

---

## 1. Fastify Best Practices for TypeScript

### Decision: Use Fastify with TypeScript strict mode and OpenAPI integration

**Rationale:**

- Fastify is high-performance (67k req/sec benchmarks), meets <50ms routing overhead requirement
- Native TypeScript support with `fastify` npm package
- OpenAPI integration via `@fastify/swagger` and `@fastify/swagger-ui`
- Schema-based validation with compile-time type inference

**Implementation Pattern:**

```typescript
// apps/backend/src/server.ts
import Fastify from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

const fastify = Fastify({
  logger: {
    level: 'info',
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        requestId: req.id,
      }),
    },
  },
}).withTypeProvider<TypeBoxTypeProvider>()

// Register plugins
await fastify.register(import('@fastify/swagger'), {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Sardeenz API',
      version: '0.1.0',
    },
  },
})

await fastify.register(import('@fastify/swagger-ui'), {
  routePrefix: '/docs',
})

// Type-safe route definition
fastify.post(
  '/api/models/load',
  {
    schema: {
      body: Type.Object({
        model_path: Type.String(),
        max_tokens: Type.Optional(Type.Integer({ default: 4096 })),
        gpu_memory_utilization: Type.Optional(Type.Number({ default: 0.9 })),
      }),
      response: {
        200: Type.Object({
          status: Type.Literal('success'),
          model: Type.String(),
          port: Type.Integer(),
          loaded_at: Type.String(),
        }),
      },
    },
  },
  async (request, reply) => {
    // TypeScript infers request.body types automatically
    const { model_path, max_tokens, gpu_memory_utilization } = request.body
    // Implementation...
  }
)
```

**Key Libraries:**

- `fastify`: ^5.1.0
- `@fastify/swagger`: ^9.3.0
- `@fastify/swagger-ui`: ^5.0.1
- `@fastify/type-provider-typebox`: ^5.0.0
- `@sinclair/typebox`: ^0.34.0

**Best Practices:**

1. Use TypeBox for schema definitions (better TypeScript inference than JSON Schema)
2. Enable strict mode in tsconfig.json
3. Use Fastify plugins for separation of concerns
4. Structured logging with request IDs
5. Error handling via `@fastify/error`

**Alternatives Considered:**

- Express: Too slow for <50ms routing requirement
- NestJS: Over-engineered for PoC, unnecessary abstraction layers
- tRPC: Excellent type safety but ties frontend to backend implementation

---

## 2. kvcached Subprocess Management

### Decision: Direct subprocess spawning with Node.js child_process

**Rationale:**

- kvcached Controller requires restart for model changes (unacceptable downtime)
- Direct vLLM subprocess management provides full lifecycle control
- Node.js `child_process` is sufficient, no need for Python wrapper
- Documented in `docs/kvcached/sardeenz-integration.md` (comprehensive guide available)

**Implementation Pattern:**

```typescript
// apps/backend/src/services/model-manager.ts
import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

interface ModelInstance {
  process: ChildProcess
  port: number
  status: 'starting' | 'active' | 'stopping' | 'failed'
  loadedAt: Date
  maxTokens: number
  gpuMemoryUtilization: number
}

export class ModelManager extends EventEmitter {
  private runningModels: Map<string, ModelInstance> = new Map()
  private nextPort: number = 12346

  async launchModel(
    modelPath: string,
    maxTokens: number = 4096,
    gpuMemoryUtilization: number = 0.9
  ): Promise<ModelInstance> {
    // Check if already running
    if (this.runningModels.has(modelPath)) {
      throw new Error(`Model ${modelPath} already loaded`)
    }

    const port = this.nextPort++

    // Launch vLLM with kvcached enabled
    const process = spawn(
      'vllm',
      [
        'serve',
        modelPath,
        '--disable-log-requests',
        '--no-enable-prefix-caching', // Required for kvcached
        `--port=${port}`,
        `--gpu-memory-utilization=${gpuMemoryUtilization}`,
        `--max-model-len=${maxTokens}`,
      ],
      {
        env: {
          ...process.env,
          ENABLE_KVCACHED: 'true',
          KVCACHED_AUTOPATCH: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    // Track instance
    const instance: ModelInstance = {
      process,
      port,
      status: 'starting',
      loadedAt: new Date(),
      maxTokens,
      gpuMemoryUtilization,
    }

    this.runningModels.set(modelPath, instance)

    // Wait for health endpoint
    await this.waitForReady(port, 180_000) // 3 minutes timeout

    instance.status = 'active'
    this.emit('model:loaded', modelPath, instance)

    return instance
  }

  async unloadModel(modelPath: string): Promise<void> {
    const instance = this.runningModels.get(modelPath)
    if (!instance) {
      throw new Error(`Model ${modelPath} not loaded`)
    }

    instance.status = 'stopping'

    // Graceful shutdown
    instance.process.kill('SIGTERM')

    // Wait up to 30 seconds
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        instance.process.kill('SIGKILL')
        resolve()
      }, 30_000)

      instance.process.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    // Clean up IPC segment via kvctl
    const ipcSegment = this.getIpcSegmentName(modelPath)
    await this.deleteIpcSegment(ipcSegment)

    this.runningModels.delete(modelPath)
    this.emit('model:unloaded', modelPath)
  }

  private async waitForReady(port: number, timeout: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const response = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) return
      } catch {
        // Continue polling
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    throw new Error(`Model failed to start within ${timeout}ms`)
  }

  private getIpcSegmentName(modelPath: string): string {
    // Convert "meta-llama/Llama-3.2-1B" -> "VLLM_META_LLAMA_LLAMA_3_2_1B"
    const name = modelPath.replace(/\//g, '_').replace(/-/g, '_').replace(/\./g, '_').toUpperCase()
    return `VLLM_${name}`
  }

  private async deleteIpcSegment(segmentName: string): Promise<void> {
    try {
      await spawn('kvctl', ['delete', segmentName]).on('exit', () => {})
    } catch {
      // Non-critical, segment may have been auto-cleaned
    }
  }
}
```

**Key Environment Variables:**

- `ENABLE_KVCACHED=true`: Enable kvcached memory sharing
- `KVCACHED_AUTOPATCH=1`: Auto-patch vLLM for kvcached compatibility

**Critical vLLM Flags:**

- `--no-enable-prefix-caching`: Required for kvcached (incompatible otherwise)
- `--disable-log-requests`: Reduce noise in logs

**Alternatives Considered:**

- kvcached Controller: Rejected due to restart requirement for model changes
- Python wrapper scripts: Unnecessary complexity, Node.js subprocess management is sufficient
- Docker containers per model: Requires Docker-in-Docker, adds latency and complexity

---

## 3. OAuth 2.0 Integration

### Decision: Use manual OAuth 2.0 flow for OpenShift compatibility

**Rationale:**

- Enterprise-grade authentication via OAuth 2.0 (constitution requirement)
- Supports role-based access control via JWT claims
- Compatible with Keycloak, Auth0, Okta, Azure AD
- Fastify-native plugin with TypeScript support

**Implementation Pattern:**

```typescript
// apps/backend/src/plugins/auth.ts
import fp from 'fastify-plugin'
import oauth2 from '@fastify/oauth2'
import jwt from '@fastify/jwt'

export default fp(async (fastify) => {
  // Register JWT plugin
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    decode: { complete: true },
  })

  // Register OAuth2 plugin
  await fastify.register(oauth2, {
    name: 'oauth2Auth',
    scope: ['openid', 'profile', 'email'],
    credentials: {
      client: {
        id: process.env.OAUTH_CLIENT_ID!,
        secret: process.env.OAUTH_CLIENT_SECRET!,
      },
      auth: oauth2.PROVIDER_DISCOVERY,
    },
    startRedirectPath: '/auth/login',
    callbackUri: `${process.env.API_BASE_URL}/auth/callback`,
    discovery: {
      issuer: process.env.OAUTH_ISSUER_URL!, // e.g., https://oauth-openshift.apps.example.com
    },
  })

  // Decorate request with user info
  fastify.decorateRequest('user', null)

  // Authentication hook
  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify()
      request.user = request.user as JWTPayload
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // Authorization decorator
  fastify.decorate('requireRole', (role: 'admin' | 'admin-readonly') => {
    return async (request, reply) => {
      await fastify.authenticate(request, reply)
      const userRoles = request.user?.realm_access?.roles || []
      if (!userRoles.includes(role)) {
        reply.code(403).send({ error: 'Forbidden: insufficient permissions' })
      }
    }
  })
})

// Usage in routes:
fastify.post(
  '/api/models/load',
  {
    onRequest: fastify.requireRole('admin'),
  },
  async (request, reply) => {
    // Only accessible to 'admin' role
  }
)

fastify.get(
  '/api/models',
  {
    onRequest: fastify.requireRole('admin-readonly'),
  },
  async (request, reply) => {
    // Accessible to both 'admin' and 'admin-readonly'
  }
)
```

**Required Environment Variables:**

- `OAUTH_CLIENT_ID`: OAuth client ID
- `OAUTH_CLIENT_SECRET`: OAuth client secret
- `OAUTH_ISSUER_URL`: OAuth issuer URL (e.g., OpenShift OAuth server)
- `K8S_API_URL`: Kubernetes API URL for user info lookup
- `JWT_SECRET`: Secret for signing/verifying JWTs
- `API_BASE_URL`: Base URL for callback redirect

**RBAC Roles (from constitution):**

- `admin`: Full access (load/unload models, configure settings)
- `admin-readonly`: Read-only access (view models, metrics, logs)

**JWT Claims Expected:**

```json
{
  "sub": "user-uuid",
  "preferred_username": "john.doe",
  "email": "john@example.com",
  "realm_access": {
    "roles": ["admin", "user"]
  }
}
```

**Key Libraries:**

- `@fastify/oauth2`: ^8.1.0
- `@fastify/jwt`: ^9.0.1

**Alternatives Considered:**

- API Key-based auth: Too simple, no SSO integration, manual key management
- JWT with simple login: No OAuth provider integration, manual user management
- Defer to Phase 2: Constitution requires security by design from start

---

## 4. Streaming Proxy Implementation

### Decision: Use Fastify reply.hijack() for efficient streaming

**Rationale:**

- vLLM supports streaming completions via Server-Sent Events (SSE)
- Fastify's `reply.hijack()` allows low-level HTTP streaming
- Minimal latency overhead (direct TCP passthrough)
- Meets <50ms routing overhead requirement

**Implementation Pattern:**

```typescript
// apps/backend/src/routes/proxy.ts
import { FastifyInstance } from 'fastify'
import { pipeline } from 'stream/promises'

export default async function proxyRoutes(fastify: FastifyInstance) {
  // Non-streaming completions
  fastify.post('/v1/completions', async (request, reply) => {
    const body = request.body as { model: string; stream?: boolean }
    const modelInstance = modelManager.get(body.model)

    if (!modelInstance) {
      return reply.code(404).send({ error: `Model ${body.model} not loaded` })
    }

    const targetUrl = `http://localhost:${modelInstance.port}/v1/completions`

    if (body.stream) {
      // Streaming response
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      // Stream response body
      await pipeline(response.body as NodeJS.ReadableStream, reply.raw)
    } else {
      // Non-streaming response
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      return reply.send(data)
    }
  })

  // Chat completions (similar pattern)
  fastify.post('/v1/chat/completions', async (request, reply) => {
    const body = request.body as { model: string; messages: any[]; stream?: boolean }
    const modelInstance = modelManager.get(body.model)

    if (!modelInstance) {
      return reply.code(404).send({ error: `Model ${body.model} not loaded` })
    }

    const targetUrl = `http://localhost:${modelInstance.port}/v1/chat/completions`

    if (body.stream) {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      await pipeline(response.body as NodeJS.ReadableStream, reply.raw)
    } else {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      return reply.send(data)
    }
  })
}
```

**Performance Optimization:**

- Connection pooling to vLLM instances via `http.Agent` (maxSockets: 100)
- No buffering for streaming responses (direct TCP passthrough)
- Request ID propagation for tracing

**Alternatives Considered:**

- `http-proxy` package: Additional dependency, not Fastify-native
- `reply.send(stream)`: Fastify wraps streams, adds latency
- Separate proxy service: Adds network hop and complexity

---

## 5. Prometheus Metrics in Fastify

### Decision: Use `fastify-metrics` with custom metrics

**Rationale:**

- Prometheus is industry-standard for observability
- `fastify-metrics` provides automatic HTTP metrics + custom metric support
- Meets constitution requirement for Prometheus-format metrics

**Implementation Pattern:**

```typescript
// apps/backend/src/plugins/metrics.ts
import fp from 'fastify-plugin'
import metricsPlugin from 'fastify-metrics'
import { register, Counter, Histogram, Gauge } from 'prom-client'

export default fp(async (fastify) => {
  await fastify.register(metricsPlugin, {
    endpoint: '/metrics',
    routeMetrics: {
      enabled: true,
      registeredRoutesOnly: true,
      groupStatusCodes: true,
    },
  })

  // Custom metrics
  const modelLoadDuration = new Histogram({
    name: 'vllm_model_load_duration_seconds',
    help: 'Duration of model load operations',
    labelNames: ['model_path', 'status'],
    buckets: [10, 30, 60, 120, 300], // 10s, 30s, 1m, 2m, 5m
  })

  const modelUnloadDuration = new Histogram({
    name: 'vllm_model_unload_duration_seconds',
    help: 'Duration of model unload operations',
    labelNames: ['model_path'],
    buckets: [1, 5, 10, 30], // 1s, 5s, 10s, 30s
  })

  const routingLatency = new Histogram({
    name: 'vllm_routing_latency_milliseconds',
    help: 'Latency of request routing to vLLM instances',
    labelNames: ['model', 'endpoint'],
    buckets: [1, 5, 10, 25, 50, 100, 250], // milliseconds
  })

  const activeModels = new Gauge({
    name: 'vllm_active_models',
    help: 'Number of currently loaded models',
  })

  const activeConnections = new Gauge({
    name: 'vllm_active_connections',
    help: 'Number of active connections to vLLM instances',
    labelNames: ['model'],
  })

  const inferenceRequests = new Counter({
    name: 'vllm_inference_requests_total',
    help: 'Total number of inference requests',
    labelNames: ['model', 'status', 'streaming'],
  })

  // Decorate fastify with metrics
  fastify.decorate('metrics', {
    modelLoadDuration,
    modelUnloadDuration,
    routingLatency,
    activeModels,
    activeConnections,
    inferenceRequests,
  })

  // Register metrics
  register.registerMetric(modelLoadDuration)
  register.registerMetric(modelUnloadDuration)
  register.registerMetric(routingLatency)
  register.registerMetric(activeModels)
  register.registerMetric(activeConnections)
  register.registerMetric(inferenceRequests)
})

// Usage example:
const timer = fastify.metrics.modelLoadDuration.startTimer()
try {
  await modelManager.launchModel(modelPath)
  timer({ model_path: modelPath, status: 'success' })
} catch (err) {
  timer({ model_path: modelPath, status: 'failure' })
  throw err
}
```

**Metrics to Track (from constitution):**

- `vllm_routing_latency_milliseconds` (p50, p95, p99 via histogram)
- `vllm_active_connections` (per model)
- `vllm_model_load_duration_seconds`
- `vllm_model_unload_duration_seconds`
- `vllm_inference_requests_total` (counter with status labels)
- `vllm_active_models` (gauge)

**Key Libraries:**

- `fastify-metrics`: ^11.0.0
- `prom-client`: ^15.1.3

**Alternatives Considered:**

- Custom Prometheus implementation: Reinventing the wheel
- OpenTelemetry: More complex, overkill for PoC phase
- StatsD: Not Prometheus-compatible

---

## 6. PatternFly 6 + Vite Setup

### Decision: Use Vite + React + PatternFly 6 with TypeScript

**Rationale:**

- Vite is fastest dev server and build tool (esbuild-based)
- PatternFly 6 provides enterprise UI components (Red Hat design system)
- Full TypeScript support with strict mode
- Tree-shaking for optimal bundle size

**Setup Pattern:**

```bash
# Initialize Vite project
npm create vite@latest apps/frontend -- --template react-ts

# Install PatternFly 6
cd apps/frontend
npm install @patternfly/react-core@6 @patternfly/react-table@6 @patternfly/react-icons@6
```

**Vite Configuration:**

```typescript
// apps/frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
```

**PatternFly Setup:**

```typescript
// apps/frontend/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@patternfly/react-core/dist/styles/base.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

**Example Component:**

```typescript
// apps/frontend/src/components/ModelDashboard.tsx
import React from 'react'
import {
  Page,
  PageSection,
  Title,
  Card,
  CardBody,
  DataList,
  DataListItem,
  DataListCell,
  Button,
} from '@patternfly/react-core'

export const ModelDashboard: React.FC = () => {
  return (
    <Page>
      <PageSection>
        <Title headingLevel="h1">Model Dashboard</Title>
      </PageSection>
      <PageSection>
        <Card>
          <CardBody>
            <DataList aria-label="Loaded models">
              <DataListItem>
                <DataListCell>
                  <strong>meta-llama/Llama-3.2-1B</strong>
                </DataListCell>
                <DataListCell>
                  Status: Active
                </DataListCell>
                <DataListCell>
                  <Button variant="danger" size="sm">Unload</Button>
                </DataListCell>
              </DataListItem>
            </DataList>
          </CardBody>
        </Card>
      </PageSection>
    </Page>
  )
}
```

**Key Libraries:**

- `vite`: ^6.0.0
- `react`: ^18.3.1
- `react-dom`: ^18.3.1
- `@patternfly/react-core`: ^6.0.0
- `@patternfly/react-table`: ^6.0.0
- `@patternfly/react-icons`: ^6.0.0
- `react-router-dom`: ^6.28.0

**TypeScript Configuration:**

```json
// apps/frontend/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"],
      "@types/*": ["../../packages/types/src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

**Alternatives Considered:**

- Next.js: Over-engineered for dashboard UI, unnecessary SSR
- Create React App: Deprecated, slower build times
- Webpack: Slower than Vite, more configuration

---

## 7. npm Workspaces Monorepo

### Decision: Use npm workspaces (built into Node.js 22)

**Rationale:**

- No additional tooling required (built into npm 7+)
- Simple configuration
- Workspace protocol for linking packages
- Compatible with TypeScript path mapping

**Monorepo Structure:**

```
/
├── package.json                    # Root workspace configuration
├── tsconfig.base.json              # Shared TypeScript config
├── apps/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json           # Extends tsconfig.base.json
│   │   └── src/
│   │       ├── server.ts
│   │       ├── routes/
│   │       ├── services/
│   │       └── plugins/
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json           # Extends tsconfig.base.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── components/
│           └── pages/
├── packages/
│   ├── types/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── models.ts
│   │       ├── api.ts
│   │       └── metrics.ts
│   ├── contracts/
│   │   ├── package.json
│   │   └── openapi/
│   │       ├── controller-api.yaml
│   │       ├── proxy-api.yaml
│   │       └── monitoring-api.yaml
│   └── utils/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── logger.ts
│           └── validation.ts
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── docker-compose.yml
└── .github/
    └── workflows/
        └── ci.yml
```

**Root package.json:**

```json
{
  "name": "sardeenz",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:backend": "npm run dev -w apps/backend",
    "dev:frontend": "npm run dev -w apps/frontend",
    "dev": "npm run dev:backend & npm run dev:frontend",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "tsc --noEmit -p tsconfig.base.json"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "eslint": "^9.0.0",
    "prettier": "^3.4.0"
  }
}
```

**Workspace package.json (backend):**

```json
{
  "name": "@sardeenz/backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "fastify": "^5.1.0",
    "@sardeenz/types": "workspace:*",
    "@sardeenz/utils": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

**TypeScript Base Config:**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "paths": {
      "@sardeenz/types": ["./packages/types/src"],
      "@sardeenz/utils": ["./packages/utils/src"]
    }
  }
}
```

**Key Commands:**

- `npm install`: Install all workspace dependencies
- `npm run dev -w apps/backend`: Run backend in dev mode
- `npm run build --workspaces`: Build all workspaces
- `npm run test --workspaces --if-present`: Run tests in all workspaces

**Alternatives Considered:**

- pnpm workspaces: Faster, but additional tool dependency
- yarn workspaces: Mature, but npm workspaces are built-in
- Nx/Turborepo: Over-engineered for PoC, adds complexity

---

## Decisions Summary

| Area                   | Decision                    | Key Library/Tool                               | Rationale                                                              |
| ---------------------- | --------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| **Backend Framework**  | Fastify with TypeScript     | `fastify@^5.1.0`                               | Performance (<50ms routing), TypeScript support, OpenAPI integration   |
| **Process Management** | Direct subprocess           | Node.js `child_process`                        | Full control, no downtime on model changes, kvcached compatible        |
| **Authentication**     | OAuth 2.0                   | Manual OAuth flow                              | Enterprise-grade auth, RBAC via JWT claims, OpenShift OAuth compatible |
| **Streaming Proxy**    | Fastify reply.hijack()      | Built-in                                       | Minimal latency, direct TCP passthrough                                |
| **Metrics**            | Prometheus                  | `fastify-metrics@^11.0.0`                      | Industry standard, custom metrics support                              |
| **Frontend**           | React + PatternFly 6 + Vite | `vite@^6.0.0`, `@patternfly/react-core@^6.0.0` | Fast dev server, enterprise UI components, TypeScript support          |
| **Monorepo**           | npm workspaces              | Built-in (npm 7+)                              | No additional tooling, simple configuration                            |

## Next Steps

1. **Phase 1**: Generate data-model.md with entity relationships
2. **Phase 1**: Generate API contracts (OpenAPI schemas in `contracts/`)
3. **Phase 1**: Generate quickstart.md with setup instructions
4. **Phase 1**: Update agent context with new technologies
5. **Phase 2**: Generate tasks.md for implementation

## References

- Fastify docs: https://fastify.dev/
- kvcached integration guide: `/docs/kvcached/sardeenz-integration.md`
- PatternFly 6 docs: https://www.patternfly.org/
- npm workspaces: https://docs.npmjs.com/cli/using-npm/workspaces
- Constitution: `/.specify/memory/constitution.md`
