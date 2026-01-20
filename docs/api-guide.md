# API Guide

This guide provides practical examples for using the Sardeenz APIs.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Controller API](#controller-api)
- [Sleep Mode API](#sleep-mode-api)
- [GPU API](#gpu-api)
- [Direct Proxy API](#direct-proxy-api)
- [Proxy API](#proxy-api)
- [Error Handling](#error-handling)
- [Code Examples](#code-examples)
- [Benchmark API](#benchmark-api)
- [Memory Profile API](#memory-profile-api)
- [Configuration API](#configuration-api)

## Overview

Sardeenz provides a unified API on a single port:

1. **Controller API** (`/api/*`) - Manage model lifecycle, GPU selection, memory monitoring
2. **Inference Proxy** (`/v1/*`) - OpenAI-compatible inference endpoint
3. **GPU API** (`/api/gpu/*`) - GPU availability and recommendations
4. **Direct Proxy** (`/api/direct/:port/*`) - Port-based proxy for testing

### Base URLs

| Environment | Base URL                  | Example Endpoints                        |
| ----------- | ------------------------- | ---------------------------------------- |
| Development | `http://localhost:3000`   | `/api/v1/models`, `/v1/chat/completions` |
| Production  | `https://your-domain.com` | `/api/v1/models`, `/v1/chat/completions` |

### API Versioning

Both APIs use URL-based versioning:

- Controller: `/api/v1/...`
- Proxy: `/v1/...` (matches OpenAI API convention)

## Authentication

Sardeenz uses a **dual-authentication model** that separates admin access from inference access:

| Auth Type          | Purpose                   | Mechanism                            |
| ------------------ | ------------------------- | ------------------------------------ |
| **Admin Auth**     | Controller API, Dashboard | JWT (simple or OAuth)                |
| **Inference Auth** | Inference endpoints       | Optional API key (OpenAI-compatible) |

### Authentication Modes

Admin authentication is configured via the `AUTH_MODE` environment variable:

| Mode     | Description                | Use Case                                   | Roles                                 |
| -------- | -------------------------- | ------------------------------------------ | ------------------------------------- |
| `none`   | Authentication disabled    | Development, testing, trusted environments | All users are admin                   |
| `simple` | Username/password with JWT | Single-admin deployments                   | Authenticated user gets `admin` role  |
| `oauth`  | OAuth 2.0 (OpenShift)      | Enterprise deployments with SSO            | Roles from OpenShift group membership |

### Route Categories

| Route Type    | Routes                                                                                                    | Auth When `AUTH_MODE!=none`          |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Public**    | `/api/health/*`, `/api/auth/*`, `/docs/*`, `/metrics`                                                     | None required                        |
| **Admin**     | `/api/models/*`, `/api/gpu/*`, `/api/memory/*`, `/api/benchmarks/*`, `/api/configurations/*`              | JWT required                         |
| **Inference** | `/v1/*`, `/api/direct/*`, `/tokenize`, `/detokenize`, `/pooling`, `/classification`, `/score`, `/re-rank` | API key (if `INFERENCE_API_KEY` set) |

### Inference API Key (OpenAI-Compatible)

Inference endpoints can be protected separately from admin endpoints using the `INFERENCE_API_KEY` environment variable:

| `INFERENCE_API_KEY` | Behavior                                                         |
| ------------------- | ---------------------------------------------------------------- |
| Not set (empty)     | Inference endpoints are open (no auth required)                  |
| Set to a value      | Inference endpoints require `Authorization: Bearer <key>` header |

**Example with API key protection:**

```bash
# Set inference API key
export INFERENCE_API_KEY=sk-your-secret-key

# Inference request (requires API key)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "llama-1b", "messages": [{"role": "user", "content": "Hello!"}]}'
```

**OpenAI SDK compatibility:**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-your-secret-key"  # Your INFERENCE_API_KEY value
)

response = client.chat.completions.create(
    model="llama-1b",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

**Frontend Dashboard:** When authenticated via the dashboard, the inference API key is automatically provided to the frontend, allowing inference tests and benchmarks to work seamlessly without manual key entry.

### Public Endpoints (No Auth Required)

These endpoints are always accessible without authentication:

- `/api/health/*` - Health checks
- `/api/auth/*` - Authentication endpoints
- `/docs`, `/docs/*` - Swagger documentation
- `/metrics` - Prometheus metrics

### Mode: None (No Authentication)

When `AUTH_MODE=none`, all endpoints are accessible without authentication. This is the default for development.

```bash
# No token needed
curl http://localhost:3000/api/v1/models
```

### Mode: Simple (Username/Password)

When `AUTH_MODE=simple`, users authenticate with username/password to receive a JWT.

**Required Environment Variables:**

- `ADMIN_USERNAME` - Admin username (default: `admin`)
- `ADMIN_PASSWORD` - Admin password (required)
- `JWT_SECRET` - Secret for JWT signing

**Login:**

```bash
# Authenticate and get token
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}' \
  | jq -r '.token')

# Use token in requests
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/models
```

### Mode: OAuth (OpenShift OAuth)

When `AUTH_MODE=oauth`, users authenticate via OpenShift OAuth 2.0.

**Required Environment Variables:**

| Variable              | Description                               |
| --------------------- | ----------------------------------------- |
| `OAUTH_ISSUER_URL`    | OpenShift OAuth server URL                |
| `OAUTH_CLIENT_ID`     | OAuth2 client ID                          |
| `OAUTH_CLIENT_SECRET` | OAuth2 client secret                      |
| `K8S_API_URL`         | Kubernetes API URL for fetching user info |
| `API_BASE_URL`        | Backend URL for callbacks                 |
| `JWT_SECRET`          | Secret for JWT signing                    |

**OAuth Role Mapping:**

Users must be members of OpenShift groups to access the dashboard:

| OpenShift Group            | Application Role | Access Level            |
| -------------------------- | ---------------- | ----------------------- |
| `sardeenz-admins`          | `admin`          | Full read/write access  |
| `sardeenz-admins-readonly` | `admin-readonly` | Read-only access        |
| (no matching group)        | (denied)         | Cannot access dashboard |

> **Setup:** For step-by-step instructions on creating OpenShift groups and adding users, see the [Deployment Guide: Authentication and RBAC](./deployment.md#authentication-and-rbac).

> **Access Denied:** Users who successfully authenticate but are not members of either group will see an **Access Denied** page explaining which groups are required and how to request access from their OpenShift administrator. After being added to a group, they can click "Try Again" to re-authenticate.

**Flow:**

1. Frontend redirects to `/api/auth/login`
2. Backend redirects to OpenShift OAuth authorization URL
3. User authenticates with OpenShift
4. Provider redirects to `/api/auth/callback`
5. Backend exchanges code for access token
6. Backend fetches user info from K8s API (`/apis/user.openshift.io/v1/users/~`)
7. Backend maps OpenShift groups to application roles
8. Backend issues internal JWT
9. Frontend receives JWT via URL fragment

### Using JWT Tokens

All authenticated requests require the `Authorization` header:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/models
```

**JWT Claims:**

```json
{
  "sub": "user@example.com",
  "username": "admin",
  "roles": ["admin"],
  "authMode": "simple",
  "iat": 1234567890,
  "exp": 1234571490
}
```

### RBAC Roles

Role-based access control is enforced on all API routes when authentication is enabled (`AUTH_MODE` is `simple` or `oauth`).

| Role             | Description                                 |
| ---------------- | ------------------------------------------- |
| `admin`          | Full read/write access to all operations    |
| `admin-readonly` | Read-only access to view data and run tests |

**Detailed Permissions:**

| Action                                     | `admin` | `admin-readonly` |
| ------------------------------------------ | :-----: | :--------------: |
| View models, GPU, memory, configurations   |   ✅    |        ✅        |
| View logs and SSE events                   |   ✅    |        ✅        |
| Run inference tests (chat, benchmarks)     |   ✅    |        ✅        |
| View benchmark results and memory profiles |   ✅    |        ✅        |
| Load/unload models                         |   ✅    |        ❌        |
| Save/delete/load configurations            |   ✅    |        ❌        |
| Create/delete benchmarks                   |   ✅    |        ❌        |
| Delete memory profiles                     |   ✅    |        ❌        |
| Modify settings (HF token)                 |   ✅    |        ❌        |
| View real HF token value                   |   ✅    |   ❌ (masked)    |
| Kill orphan processes                      |   ✅    |        ❌        |

> **Note:** The `admin-readonly` role cannot see the real HuggingFace token value. The API returns a masked placeholder (`hf_****...`) instead.

**Frontend Visual Hints:**

When authenticated with the `admin-readonly` role, the frontend displays visual indicators:

- User dropdown shows role label (e.g., "admin" or "admin-readonly")
- Write action buttons are disabled with tooltips explaining the permission requirement
- Read-only users can still navigate all pages and view data

### Auth API Endpoints

| Endpoint             | Method | Description                     |
| -------------------- | ------ | ------------------------------- |
| `/api/auth/info`     | GET    | Returns auth mode configuration |
| `/api/auth/login`    | POST   | Simple mode login (returns JWT) |
| `/api/auth/login`    | GET    | OAuth mode redirect to provider |
| `/api/auth/callback` | GET    | OAuth callback (issues JWT)     |
| `/api/auth/me`       | GET    | Get current user info           |
| `/api/auth/logout`   | POST   | Logout (client clears token)    |

## Controller API

### Load a Model

**Endpoint:** `POST /api/v1/models/load`

> **Note:** This endpoint returns immediately with `status: "starting"`. The model loads in the background. Subscribe to the SSE events endpoint (`/api/v1/models/instances/{instance_id}/events`) to monitor loading progress and receive the final `active` or `failed` status.

**Request Body:**

```json
{
  "model_path": "meta-llama/Llama-3.2-1B",
  "max_tokens": 4096,
  "gpu_ids": [0],
  "tensor_parallel_size": 1,
  "extra_args": ["--trust-remote-code"]
}
```

**Request Fields:**

| Field                  | Type     | Required | Description                                                                                                                                                                              |
| ---------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model_path`           | string   | Yes      | Model identifier (HuggingFace path or local path)                                                                                                                                        |
| `max_tokens`           | number   | No       | Maximum context length (default: model's max)                                                                                                                                            |
| `gpu_ids`              | number[] | No       | GPU indices to use. If omitted, auto-selects GPU(s) with most free memory                                                                                                                |
| `tensor_parallel_size` | number   | No       | Number of GPUs for tensor parallelism (default: 1). kvcached is disabled when >1                                                                                                         |
| `extra_args`           | string[] | No       | Additional vLLM CLI arguments                                                                                                                                                            |
| `enable_sleep_mode`    | boolean  | No       | Enable sleep mode for this model. When enabled, the model can be put to sleep to free GPU memory (~90%) while remaining loaded for quick wake-up. See [Sleep Mode API](#sleep-mode-api). |

**Response (202 Accepted):**

```json
{
  "status": "success",
  "model": "meta-llama/Llama-3.2-1B",
  "port": 5001,
  "loaded_at": "2025-11-11T10:30:00Z",
  "instance_id": "llama-3-2-1b-abc123"
}
```

**Example (curl):**

```bash
curl -X POST http://localhost:3000/api/v1/models/load \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model_path": "meta-llama/Llama-3.2-1B",
    "max_tokens": 4096
  }'
```

**Example with tensor parallelism (2 GPUs):**

```bash
curl -X POST http://localhost:3000/api/v1/models/load \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model_path": "meta-llama/Llama-3.1-70B",
    "max_tokens": 8192,
    "gpu_ids": [0, 1],
    "tensor_parallel_size": 2
  }'
```

**Example (JavaScript):**

```javascript
const response = await fetch('http://localhost:3000/api/v1/models/load', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model_path: 'meta-llama/Llama-3.2-1B',
    max_tokens: 4096,
  }),
})

const result = await response.json()
console.log('Model loading:', result.instance_id)
```

### List Models

**Endpoint:** `GET /api/v1/models`

**Response (200 OK):**

```json
{
  "models": [
    {
      "id": "llama-3-2-1b-abc123",
      "model_path": "meta-llama/Llama-3.2-1B",
      "model_name": "Llama-3.2-1B",
      "status": "active",
      "port": 5001,
      "process_id": 12345,
      "max_tokens": 4096,
      "gpu_memory_utilization": 0.9,
      "gpu_ids": [0],
      "tensor_parallel_size": 1,
      "kvcached_enabled": true,
      "loaded_at": "2025-11-11T10:30:00Z",
      "ready_at": "2025-11-11T10:31:15Z"
    },
    {
      "id": "llama-70b-def456",
      "model_path": "meta-llama/Llama-3.1-70B",
      "model_name": "Llama-3.1-70B",
      "status": "active",
      "port": 5002,
      "process_id": 12346,
      "max_tokens": 8192,
      "gpu_memory_utilization": 0.9,
      "gpu_ids": [0, 1],
      "tensor_parallel_size": 2,
      "kvcached_enabled": false,
      "loaded_at": "2025-11-11T10:35:00Z",
      "ready_at": "2025-11-11T10:36:20Z"
    }
  ],
  "total": 2
}
```

**Example (curl):**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/models
```

### Get Model Details

**Endpoint:** `GET /api/v1/models/{id}`

**Response (200 OK):**

```json
{
  "model": {
    "id": "llama-3-2-1b-abc123",
    "model_path": "meta-llama/Llama-3.2-1B",
    "model_name": "Llama-3.2-1B",
    "status": "active",
    "port": 5001,
    "process_id": 12345,
    "max_tokens": 4096,
    "gpu_memory_utilization": 0.9,
    "gpu_ids": [0],
    "tensor_parallel_size": 1,
    "kvcached_enabled": true,
    "loaded_at": "2025-11-11T10:30:00Z",
    "ready_at": "2025-11-11T10:31:15Z",
    "memory_metrics": {
      "total_gpu_memory_gib": 1.22,
      "weights_memory_gib": 0.67,
      "cuda_graph_memory_gib": 0.55,
      "overhead_memory_gib": 0.4,
      "kv_cache_available_gib": 5.7,
      "kv_cache_per_request_mib": 156.23,
      "max_model_len": 4096
    },
    "memory_baseline_by_gpu": {
      "0": 1.22
    },
    "launch_command": "python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-3.2-1B --port 5001 ..."
  }
}
```

**Memory Baseline Field:**

| Field                    | Type                     | Description                                                                                            |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `memory_baseline_by_gpu` | `Record<number, number>` | Memory footprint per GPU in GB, captured when model becomes ready. Used for KVCache total calculation. |

For tensor-parallel models, baselines are captured on each GPU:

```json
"memory_baseline_by_gpu": {
  "0": 8.5,
  "1": 8.5
}
```

**Example (curl):**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/models/llama-3-2-1b-abc123
```

### Subscribe to Model Events (SSE)

**Endpoint:** `GET /api/v1/models/instances/{instance_id}/events`

Real-time Server-Sent Events stream for model instance status and logs.

**Query Parameters:**

| Parameter     | Type   | Default | Description                                                     |
| ------------- | ------ | ------- | --------------------------------------------------------------- |
| `types`       | string | all     | Comma-separated event types: `log,status,memory,progress,error` |
| `replay_logs` | string | true    | Replay existing buffered logs on connection                     |

**Event Types:**

| Type       | Description                                         |
| ---------- | --------------------------------------------------- |
| `log`      | vLLM process stdout/stderr output                   |
| `status`   | Model status transitions (starting → active/failed) |
| `memory`   | GPU memory updates                                  |
| `progress` | Loading progress updates                            |
| `error`    | Error notifications                                 |

**Response (SSE Stream):**

```
event: status
data: {"id":"evt-123","timestamp":"2025-11-11T10:30:00Z","instanceId":"abc123","eventType":"status","data":{"previousStatus":"starting","currentStatus":"active","message":"Model ready for inference"}}

event: log
data: {"id":"evt-124","timestamp":"2025-11-11T10:30:01Z","instanceId":"abc123","eventType":"log","data":{"stream":"stdout","content":"INFO: Uvicorn running on http://0.0.0.0:5001"}}
```

**Example (curl):**

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/models/instances/abc123/events?types=status,log"
```

### Get Model Instance Logs

**Endpoint:** `GET /api/v1/models/instances/{instance_id}/logs`

Retrieve buffered vLLM process logs for debugging.

**Query Parameters:**

| Parameter | Type   | Default | Description                       |
| --------- | ------ | ------- | --------------------------------- |
| `lines`   | number | 100     | Number of lines to return (1-500) |

**Response (200 OK):**

```json
{
  "instance_id": "abc123",
  "logs": "[stdout] INFO: Loading model...\n[stderr] WARNING: Using default config",
  "line_count": 45
}
```

**Example (curl):**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/models/instances/abc123/logs?lines=50"
```

### Unload a Model

**Endpoint:** `POST /api/v1/models/{id}/unload`

**Response (202 Accepted):**

```json
{
  "id": "llama-3-2-1b-abc123",
  "status": "stopping",
  "message": "Model unload initiated"
}
```

**Example (curl):**

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/models/llama-3-2-1b-abc123/unload
```

### Get System Metrics

**Endpoint:** `GET /api/v1/metrics`

**Response (200 OK - Prometheus Format):**

```
# HELP sardeenz_models_total Total number of model instances
# TYPE sardeenz_models_total gauge
sardeenz_models_total{status="active"} 2
sardeenz_models_total{status="starting"} 0
sardeenz_models_total{status="stopping"} 0
sardeenz_models_total{status="failed"} 0

# HELP sardeenz_gpu_memory_used_bytes GPU memory used by all models
# TYPE sardeenz_gpu_memory_used_bytes gauge
sardeenz_gpu_memory_used_bytes{model_id="llama-3-2-1b-abc123"} 4080218931
sardeenz_gpu_memory_used_bytes{model_id="mistral-7b-def456"} 8589934592

# HELP sardeenz_requests_total Total inference requests
# TYPE sardeenz_requests_total counter
sardeenz_requests_total{model_id="llama-3-2-1b-abc123",status="success"} 1523
sardeenz_requests_total{model_id="mistral-7b-def456",status="success"} 892

# HELP sardeenz_request_duration_ms Request duration in milliseconds
# TYPE sardeenz_request_duration_ms histogram
sardeenz_request_duration_ms_bucket{model_id="llama-3-2-1b-abc123",le="100"} 234
sardeenz_request_duration_ms_bucket{model_id="llama-3-2-1b-abc123",le="500"} 1421
sardeenz_request_duration_ms_bucket{model_id="llama-3-2-1b-abc123",le="+Inf"} 1523
```

**Example (curl):**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/metrics
```

### Health Check

**Endpoint:** `GET /api/health`

> **Note:** Health check endpoints (`/api/health`, `/api/health/ready`, `/api/health/live`) have quiet logging enabled. Successful requests (2xx) are logged at debug level only to reduce log noise from frequent polling. Errors (4xx/5xx) are always logged at warn/error levels.

**Response (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2025-11-11T10:45:00Z",
  "uptime": 3600,
  "version": "0.1.0"
}
```

**Additional Health Endpoints:**

- `GET /api/health/ready` - Readiness probe (returns `{"status": "ready", "timestamp": "..."}`)
- `GET /api/health/live` - Liveness probe (returns `{"status": "alive", "timestamp": "..."}`)

**Example (curl):**

```bash
curl http://localhost:3000/api/health
```

### Get Memory Usage

**Endpoint:** `GET /api/memory/usage`

Returns GPU and KVCache memory usage with per-model breakdown for visualization (used by the GPU Memory Overview panel in the dashboard).

**Response (200 OK):**

```json
{
  "kvcache": {
    "total_gb": 12.5,
    "prealloc_gb": 6.2,
    "used_gb": 3.8,
    "free_gb": 2.5
  },
  "gpu": {
    "total_gb": 24.0,
    "used_gb": 18.5,
    "free_gb": 5.5,
    "utilization_percent": 77.0
  },
  "models": [
    {
      "model_path": "meta-llama/Llama-3.2-1B",
      "instance_id": "llama-3-2-1b-abc123",
      "display_name": "Llama-3.2-1B",
      "gpu_memory_gb": 1.22,
      "color": "#0066CC"
    },
    {
      "model_path": "meta-llama/Llama-3.2-1B",
      "instance_id": "llama-3-2-1b-def456",
      "display_name": "Llama-3.2-1B (2)",
      "gpu_memory_gb": 1.22,
      "color": "#5752D1"
    },
    {
      "model_path": "mistralai/Mistral-7B-v0.1",
      "instance_id": "mistral-7b-ghi789",
      "display_name": "Mistral-7B-v0.1",
      "gpu_memory_gb": 5.45,
      "color": "#009596"
    }
  ]
}
```

**Field Descriptions:**

| Field                     | Description                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `kvcache.total_gb`        | Total KVCache pool size (shared across all models)                                                         |
| `kvcache.prealloc_gb`     | Pre-allocated but not actively used KVCache memory                                                         |
| `kvcache.used_gb`         | Currently active KVCache memory                                                                            |
| `kvcache.free_gb`         | Available KVCache memory                                                                                   |
| `gpu.total_gb`            | Total GPU memory                                                                                           |
| `gpu.used_gb`             | Used GPU memory (all processes)                                                                            |
| `gpu.free_gb`             | Free GPU memory                                                                                            |
| `gpu.utilization_percent` | GPU utilization percentage                                                                                 |
| `models[].model_path`     | Full model path/identifier                                                                                 |
| `models[].instance_id`    | Unique instance identifier (stable across API calls)                                                       |
| `models[].display_name`   | Short display name, unique per instance. For duplicate models, includes suffix: "Model", "Model (2)", etc. |
| `models[].gpu_memory_gb`  | Model's GPU footprint (weights + CUDA graphs)                                                              |
| `models[].color`          | Hex color for visualization (unique per instance, based on instance_id hash)                               |

**KVCache Calculation Formulas:**

| Formula                                          | Description                                 |
| ------------------------------------------------ | ------------------------------------------- |
| `KVCache Total = GPU Free + Prealloc + Used`     | Total memory available to KVCache pool      |
| `KVCache Free = max(0, Total - Used - Prealloc)` | Available memory for new allocations        |

**Note:** Prealloc memory appears as "used" in nvidia-smi but is actually available to the KVCache pool.

**Conditional Display:** The `kvcache` field is omitted from responses when no models are loaded, preventing stale preallocation values from being displayed.

**Example (curl):**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/memory/usage
```

**Example (JavaScript):**

```javascript
const response = await fetch('http://localhost:3000/api/memory/usage', {
  headers: { Authorization: `Bearer ${token}` },
})
const memoryData = await response.json()

// KVCache metrics (shared pool)
console.log(`KVCache: ${memoryData.kvcache.used_gb}/${memoryData.kvcache.total_gb} GB`)

// GPU metrics with per-model breakdown
console.log(`GPU: ${memoryData.gpu.used_gb}/${memoryData.gpu.total_gb} GB`)
memoryData.models.forEach((model) => {
  console.log(`  ${model.display_name}: ${model.gpu_memory_gb} GB`)
})
```

### Get Multi-GPU Memory Usage

**Endpoint:** `GET /api/memory/usage/multi-gpu`

Returns per-GPU memory breakdown for multi-GPU systems.

**Response (200 OK):**

```json
{
  "gpus": [
    {
      "gpu_index": 0,
      "name": "NVIDIA GeForce RTX 4090",
      "total_gb": 24.0,
      "used_gb": 8.5,
      "free_gb": 15.5,
      "utilization_percent": 35.0,
      "models": [
        {
          "model_path": "meta-llama/Llama-3.2-1B",
          "instance_id": "abc123",
          "display_name": "Llama-3.2-1B",
          "gpu_memory_gb": 1.22,
          "color": "#0066CC"
        }
      ],
      "kvcache": {
        "total_gb": 12.5,
        "prealloc_gb": 2.0,
        "used_gb": 3.5,
        "free_gb": 7.0
      }
    },
    {
      "gpu_index": 1,
      "name": "NVIDIA GeForce RTX 4090",
      "total_gb": 24.0,
      "used_gb": 12.0,
      "free_gb": 12.0,
      "utilization_percent": 50.0,
      "models": []
    }
  ],
  "kvcache": {
    "total_gb": 12.5,
    "prealloc_gb": 6.2,
    "used_gb": 3.8,
    "free_gb": 2.5
  },
  "total_system_free_gb": 27.5
}
```

**Per-GPU KVCache Metrics:**

Each GPU with loaded models includes a `kvcache` object with per-GPU KVCache metrics:

| Field                        | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| `gpus[].kvcache`             | Per-GPU KVCache metrics (undefined if no models loaded on this GPU) |
| `gpus[].kvcache.total_gb`    | KVCache pool size = GPU Total - Model Baselines - Other Processes   |
| `gpus[].kvcache.used_gb`     | Currently active KVCache memory (from IPC segment)                  |
| `gpus[].kvcache.prealloc_gb` | Pre-allocated but not active memory (from IPC segment)              |
| `gpus[].kvcache.free_gb`     | Available KVCache memory for new allocations                        |

The KVCache total is calculated dynamically as: `GPU Total - Model Baselines - Other Processes`. This replaces the old approach of reading a stale `total_size` from the IPC segment.

**Note:** For tensor-parallel models spanning multiple GPUs, KVCache usage is split evenly across participating GPUs.

## Sleep Mode API

Sleep mode allows models to be put to sleep to free GPU memory (~90%) while remaining loaded for quick wake-up. This is useful for models that are not frequently used but need to be available on short notice.

> **Important:** Sleep mode must be enabled when loading the model via the `enable_sleep_mode` parameter. Models loaded without this flag cannot be put to sleep.

### How Sleep Mode Works

vLLM's sleep mode offloads model weights from GPU to CPU RAM:

| Level | Action                                       | Memory Freed | Use Case                |
| ----- | -------------------------------------------- | ------------ | ----------------------- |
| 1     | Offload weights to CPU RAM, discard KV cache | ~90%         | Quick sleep/wake cycles |
| 2     | Discard weights and KV cache entirely        | ~95%         | Model switching, RLHF   |

Wake-up reloads the weights from CPU back to GPU, which is faster than loading from disk.

### Put Model to Sleep

**Endpoint:** `POST /api/models/instances/:instance_id/sleep`

Puts a running model to sleep to free GPU memory.

**Query Parameters:**

| Parameter | Type   | Default | Description                                    |
| --------- | ------ | ------- | ---------------------------------------------- |
| `level`   | number | 1       | Sleep level: 1 (offload to CPU) or 2 (discard) |

**Response (200 OK):**

```json
{
  "status": "success",
  "instance_id": "llama-3-2-1b-abc123",
  "model_path": "meta-llama/Llama-3.2-1B",
  "sleep_level": 1,
  "slept_at": "2025-11-29T12:00:00Z"
}
```

**Error Responses:**

| Status | Condition              | Message                                        |
| ------ | ---------------------- | ---------------------------------------------- |
| 400    | Sleep mode not enabled | Model was not loaded with sleep mode enabled   |
| 404    | Instance not found     | Model instance {id} not found                  |
| 409    | Model not running      | Cannot sleep model: current status is {status} |

**Example (curl):**

```bash
# Put model to sleep (level 1 - offload to CPU)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/models/instances/abc123/sleep?level=1"

# Put model to deep sleep (level 2 - discard)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/models/instances/abc123/sleep?level=2"
```

### Wake Up Model

**Endpoint:** `POST /api/models/instances/:instance_id/wake`

Wakes a sleeping model, restoring it to running state.

**Request Body (optional):**

```json
{
  "tags": "weights"
}
```

**Request Fields:**

| Field  | Type   | Required | Description                                                             |
| ------ | ------ | -------- | ----------------------------------------------------------------------- |
| `tags` | string | No       | What to reload: `weights` (model weights) or `kv_cache` (KV cache data) |

**Response (200 OK):**

```json
{
  "status": "success",
  "instance_id": "llama-3-2-1b-abc123",
  "model_path": "meta-llama/Llama-3.2-1B",
  "woke_at": "2025-11-29T12:05:00Z"
}
```

**Error Responses:**

| Status | Condition          | Message                       |
| ------ | ------------------ | ----------------------------- |
| 404    | Instance not found | Model instance {id} not found |
| 409    | Model not sleeping | Model is not sleeping         |

**Example (curl):**

```bash
# Wake up model
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/models/instances/abc123/wake"
```

### Get Sleep Status

**Endpoint:** `GET /api/models/instances/:instance_id/sleep-status`

Returns the current sleep status of a model instance.

**Response (200 OK):**

```json
{
  "instance_id": "llama-3-2-1b-abc123",
  "is_sleeping": true,
  "sleep_level": 1
}
```

When the model is not sleeping:

```json
{
  "instance_id": "llama-3-2-1b-abc123",
  "is_sleeping": false
}
```

**Example (curl):**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/models/instances/abc123/sleep-status"
```

### Sleep Mode and Inference

When a model is sleeping, inference requests to that model will receive a 503 error:

```json
{
  "error": {
    "message": "Model {model_name} is sleeping. Wake it up to serve requests.",
    "type": "service_unavailable",
    "code": "model_sleeping"
  }
}
```

Wake the model before sending inference requests.

## GPU API

### Get Available GPUs

**Endpoint:** `GET /api/gpu/available`

Returns all GPUs with availability information and a recommendation for the next model load.

**Response (200 OK):**

```json
{
  "gpus": [
    {
      "index": 0,
      "name": "NVIDIA GeForce RTX 4090",
      "memory_total_mb": 24564,
      "memory_used_mb": 8500,
      "memory_free_mb": 16064,
      "utilization_percent": 35,
      "models_loaded": 2,
      "recommended": true
    },
    {
      "index": 1,
      "name": "NVIDIA GeForce RTX 4090",
      "memory_total_mb": 24564,
      "memory_used_mb": 12000,
      "memory_free_mb": 12564,
      "utilization_percent": 50,
      "models_loaded": 1,
      "recommended": false
    }
  ],
  "recommendation": {
    "gpu_id": 0,
    "free_memory_gb": 15.69,
    "reason": "GPU 0 has most free memory (15.7 GB)"
  }
}
```

**Example (curl):**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/gpu/available
```

## Direct Proxy API

The Direct Proxy provides a lightweight, port-based proxy for testing and debugging. It bypasses the model routing layer and forwards requests directly to a specific vLLM instance port.

> **Authentication:** Like the Proxy API, when `INFERENCE_API_KEY` is set, direct proxy endpoints require `Authorization: Bearer <api-key>` header. See [Inference API Key](#inference-api-key-openai-compatible) for details.

### Forward Request to Port

**Endpoint:** `ALL /api/direct/:port/*`

Forwards any request directly to `http://localhost:{port}/{path}`.

**Parameters:**

- `port` - The vLLM instance port (e.g., 5001)
- `*` - The path to forward (e.g., `v1/chat/completions`)

**Example (curl):**

```bash
# Chat completion via direct proxy to port 5001
curl -X POST http://localhost:3000/api/direct/5001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'
```

**Supported Responses:**

- JSON responses are returned directly
- SSE/streaming responses are piped through

**Use Cases:**

- Testing a specific model instance without model routing
- Debugging inference issues
- Bypassing the proxy layer for performance testing

## Proxy API

The Proxy API provides OpenAI-compatible endpoints for inference requests.

> **Authentication:** When `INFERENCE_API_KEY` is set, all proxy endpoints require `Authorization: Bearer <api-key>` header. When not set, endpoints are open. See [Inference API Key](#inference-api-key-openai-compatible) for details.

### Chat Completions

**Endpoint:** `POST /v1/chat/completions`

**Request Body:**

```json
{
  "model": "llama-3-2-1b-abc123",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "What is the capital of France?"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 100,
  "stream": false
}
```

**Response (200 OK):**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1699999999,
  "model": "llama-3-2-1b-abc123",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 24,
    "completion_tokens": 7,
    "total_tokens": 31
  }
}
```

**Example (curl):**

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-2-1b-abc123",
    "messages": [
      {"role": "user", "content": "What is the capital of France?"}
    ]
  }'
```

**Example (Python with OpenAI SDK):**

```python
from openai import OpenAI

# Point to your Sardeenz proxy
client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="not-needed"  # API key handled by gateway
)

response = client.chat.completions.create(
    model="llama-3-2-1b-abc123",
    messages=[
        {"role": "user", "content": "What is the capital of France?"}
    ]
)

print(response.choices[0].message.content)
```

### Streaming Chat Completions

**Request Body (with streaming):**

```json
{
  "model": "llama-3-2-1b-abc123",
  "messages": [{ "role": "user", "content": "Write a short poem about AI." }],
  "stream": true
}
```

**Response (Server-Sent Events):**

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699999999,"model":"llama-3-2-1b-abc123","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699999999,"model":"llama-3-2-1b-abc123","choices":[{"index":0,"delta":{"content":"In"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699999999,"model":"llama-3-2-1b-abc123","choices":[{"index":0,"delta":{"content":" silicon"},"finish_reason":null}]}

...

data: [DONE]
```

**Example (Python with OpenAI SDK):**

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="not-needed")

stream = client.chat.completions.create(
    model="llama-3-2-1b-abc123",
    messages=[{"role": "user", "content": "Write a short poem about AI."}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="")
```

**Example (JavaScript with fetch):**

```javascript
const response = await fetch('http://localhost:8000/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-3-2-1b-abc123',
    messages: [{ role: 'user', content: 'Write a short poem about AI.' }],
    stream: true,
  }),
})

const reader = response.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  const chunk = decoder.decode(value)
  const lines = chunk.split('\n').filter((line) => line.startsWith('data: '))

  for (const line of lines) {
    const data = line.replace('data: ', '')
    if (data === '[DONE]') break

    const parsed = JSON.parse(data)
    const content = parsed.choices[0]?.delta?.content
    if (content) {
      process.stdout.write(content)
    }
  }
}
```

### Completions (Legacy)

**Endpoint:** `POST /v1/completions`

**Request Body:**

```json
{
  "model": "llama-3-2-1b-abc123",
  "prompt": "Once upon a time",
  "max_tokens": 50,
  "temperature": 0.7
}
```

**Response (200 OK):**

```json
{
  "id": "cmpl-abc123",
  "object": "text_completion",
  "created": 1699999999,
  "model": "llama-3-2-1b-abc123",
  "choices": [
    {
      "text": " in a land far away, there lived a brave knight...",
      "index": 0,
      "finish_reason": "length"
    }
  ],
  "usage": {
    "prompt_tokens": 4,
    "completion_tokens": 50,
    "total_tokens": 54
  }
}
```

## Error Handling

### Controller API Errors

**Model Not Found (404):**

```json
{
  "error": {
    "code": "MODEL_NOT_FOUND",
    "message": "Model with ID 'invalid-id' not found",
    "statusCode": 404
  }
}
```

**Insufficient GPU Memory (400):**

```json
{
  "error": {
    "code": "INSUFFICIENT_MEMORY",
    "message": "Insufficient GPU memory. Requested: 16GB, Available: 8GB",
    "statusCode": 400
  }
}
```

**Unauthorized (401):**

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing authentication token",
    "statusCode": 401
  }
}
```

**Forbidden (403):**

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions. Required role: admin",
    "statusCode": 403
  }
}
```

**Model Already Exists (409):**

```json
{
  "error": {
    "code": "MODEL_ALREADY_EXISTS",
    "message": "A model instance already exists on port 5001",
    "statusCode": 409
  }
}
```

### Proxy API Errors

**Invalid Model (400):**

```json
{
  "error": {
    "message": "Invalid model identifier: 'unknown-model'",
    "type": "invalid_request_error",
    "param": "model",
    "code": "invalid_model"
  }
}
```

**Model Not Ready (503):**

```json
{
  "error": {
    "message": "Model 'llama-3-2-1b-abc123' is not ready (status: starting)",
    "type": "service_unavailable",
    "code": "model_not_ready"
  }
}
```

## Code Examples

### Complete Workflow (TypeScript)

```typescript
import axios from 'axios'

const CONTROLLER_URL = 'http://localhost:3000/api/v1'
const PROXY_URL = 'http://localhost:8000/v1'
const AUTH_TOKEN = process.env.AUTH_TOKEN

async function completeWorkflow() {
  // 1. Load a model
  console.log('Loading model...')
  const loadResponse = await axios.post(
    `${CONTROLLER_URL}/models/load`,
    {
      modelPath: '/models/meta-llama/Llama-3.2-1B',
      displayName: 'Llama 3.2 1B',
      gpuMemoryLimit: 4.0,
      port: 5001,
    },
    {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    }
  )

  const modelId = loadResponse.data.id
  const instanceId = loadResponse.data.instance_id
  console.log(`Model loading started: ${instanceId}`)

  // 2. Wait for model to be ready
  // Option A: Polling (shown below)
  // Option B: Subscribe to SSE at /api/v1/models/instances/{instance_id}/events
  console.log('Waiting for model to be ready...')
  let status = 'starting'
  while (status === 'starting') {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const statusResponse = await axios.get(`${CONTROLLER_URL}/models/${modelId}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    })
    status = statusResponse.data.status
    console.log(`Status: ${status}`)
  }

  if (status !== 'active') {
    throw new Error(`Model failed to start: ${status}`)
  }

  // 3. Make inference request
  console.log('Making inference request...')
  const inferenceResponse = await axios.post(`${PROXY_URL}/chat/completions`, {
    model: modelId,
    messages: [{ role: 'user', content: 'What is 2+2?' }],
  })

  console.log('Response:', inferenceResponse.data.choices[0].message.content)

  // 4. Unload model
  console.log('Unloading model...')
  await axios.post(
    `${CONTROLLER_URL}/models/${modelId}/unload`,
    {},
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
  )

  console.log('Workflow complete!')
}

completeWorkflow().catch(console.error)
```

### Python Client Library

```python
import requests
import time
from typing import Optional

class SardeenzClient:
    def __init__(self, controller_url: str, proxy_url: str, auth_token: str):
        self.controller_url = controller_url
        self.proxy_url = proxy_url
        self.headers = {"Authorization": f"Bearer {auth_token}"}

    def load_model(self, model_path: str, display_name: str,
                   gpu_memory: float, port: int) -> str:
        """Load a model and return its ID."""
        response = requests.post(
            f"{self.controller_url}/models/load",
            json={
                "modelPath": model_path,
                "displayName": display_name,
                "gpuMemoryLimit": gpu_memory,
                "port": port,
            },
            headers=self.headers,
        )
        response.raise_for_status()
        return response.json()["id"]

    def wait_for_model(self, model_id: str, timeout: int = 300) -> None:
        """Wait for model to be active."""
        start_time = time.time()
        while True:
            if time.time() - start_time > timeout:
                raise TimeoutError(f"Model {model_id} did not start in {timeout}s")

            status = self.get_model_status(model_id)
            if status == "active":
                return
            elif status == "failed":
                raise RuntimeError(f"Model {model_id} failed to start")

            time.sleep(5)

    def get_model_status(self, model_id: str) -> str:
        """Get model status."""
        response = requests.get(
            f"{self.controller_url}/models/{model_id}",
            headers=self.headers,
        )
        response.raise_for_status()
        return response.json()["status"]

    def chat(self, model_id: str, messages: list) -> str:
        """Send chat completion request."""
        response = requests.post(
            f"{self.proxy_url}/chat/completions",
            json={"model": model_id, "messages": messages},
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    def unload_model(self, model_id: str) -> None:
        """Unload a model."""
        response = requests.post(
            f"{self.controller_url}/models/{model_id}/unload",
            headers=self.headers,
        )
        response.raise_for_status()

# Usage
client = SardeenzClient(
    controller_url="http://localhost:3000/api/v1",
    proxy_url="http://localhost:8000/v1",
    auth_token="your-token-here",
)

model_id = client.load_model(
    model_path="/models/meta-llama/Llama-3.2-1B",
    display_name="Llama 3.2 1B",
    gpu_memory=4.0,
    port=5001,
)

client.wait_for_model(model_id)
response = client.chat(model_id, [{"role": "user", "content": "Hello!"}])
print(response)
client.unload_model(model_id)
```

## Benchmark API

The Benchmark API allows you to run performance tests on loaded models, measuring latency, throughput, and other metrics.

### Create a Benchmark Run

**Endpoint:** `POST /api/benchmarks`

**Request Body:**

```json
{
  "name": "SmolLM Performance Test",
  "mode": "isolated",
  "scenarios": [
    {
      "instanceId": "smollm2-135m-abc123",
      "routingMode": "direct",
      "inputTokens": 100,
      "outputTokens": 50,
      "concurrency": 4,
      "warmupRequests": 3,
      "totalRequests": 20,
      "slaThresholdMs": 500
    }
  ]
}
```

**Fields:**

| Field                        | Type   | Required | Description                                                                      |
| ---------------------------- | ------ | -------- | -------------------------------------------------------------------------------- |
| `name`                       | string | No       | Human-readable name for the benchmark run                                        |
| `mode`                       | string | Yes      | `isolated` (run scenarios sequentially) or `contention` (run all simultaneously) |
| `scenarios`                  | array  | Yes      | One or more scenarios to benchmark                                               |
| `scenarios[].instanceId`     | string | Yes      | Model instance ID to benchmark                                                   |
| `scenarios[].routingMode`    | string | No       | `direct` (to vLLM) or `proxy` (through unified endpoint). Default: `direct`      |
| `scenarios[].inputTokens`    | number | Yes      | Target input token count                                                         |
| `scenarios[].outputTokens`   | number | Yes      | Max tokens for response                                                          |
| `scenarios[].concurrency`    | number | Yes      | Number of parallel requests                                                      |
| `scenarios[].warmupRequests` | number | Yes      | Unmeasured warmup requests                                                       |
| `scenarios[].totalRequests`  | number | Yes      | Measured requests                                                                |
| `scenarios[].slaThresholdMs` | number | No       | SLA threshold for goodput calculation                                            |

**Per-Model Benchmark Parameters:**

Each scenario can have independent test configuration, allowing you to:

- Test different concurrency levels per model
- Use different token configurations based on model context length
- Set custom SLA thresholds for goodput calculation

**Token Validation:**

The combined `inputTokens + outputTokens` must not exceed the model's `max_tokens` limit. The API validates this and returns 400 if exceeded:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Combined tokens (8192) exceeds model max_tokens (4096)"
  }
}
```

**Response (201 Created):**

```json
{
  "benchmark": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "SmolLM Performance Test",
    "status": "pending",
    "mode": "isolated",
    "kvcached_enabled": true,
    "created_at": "2025-11-29T12:00:00Z",
    "scenarios": [
      {
        "id": "scenario-uuid",
        "instance_id": "smollm2-135m-abc123",
        "routing_mode": "direct",
        "model_path": "HuggingFaceTB/SmolLM2-135M-Instruct",
        "model_name": "SmolLM2-135M-Instruct",
        "input_tokens": 100,
        "output_tokens": 50,
        "concurrency": 4,
        "warmup_requests": 3,
        "total_requests": 20,
        "sla_threshold_ms": 500,
        "status": "pending"
      }
    ]
  }
}
```

### List Benchmark Runs

**Endpoint:** `GET /api/benchmarks`

**Query Parameters:**

| Parameter | Type   | Default | Description                                                                |
| --------- | ------ | ------- | -------------------------------------------------------------------------- |
| `page`    | number | 1       | Page number                                                                |
| `limit`   | number | 20      | Results per page (max 100)                                                 |
| `status`  | string | all     | Filter by status: `pending`, `running`, `completed`, `cancelled`, `failed` |

**Response (200 OK):**

```json
{
  "benchmarks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "SmolLM Performance Test",
      "status": "completed",
      "mode": "isolated",
      "kvcached_enabled": true,
      "created_at": "2025-11-29T12:00:00Z",
      "started_at": "2025-11-29T12:00:01Z",
      "completed_at": "2025-11-29T12:02:30Z",
      "total_requests": 20,
      "successful_requests": 20,
      "failed_requests": 0,
      "duration_seconds": 149.5
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### Get Benchmark Details

**Endpoint:** `GET /api/benchmarks/{id}`

Returns full benchmark details including scenarios and aggregated metrics.

**Response (200 OK):**

```json
{
  "benchmark": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "SmolLM Performance Test",
    "status": "completed",
    "mode": "isolated",
    "kvcached_enabled": true,
    "created_at": "2025-11-29T12:00:00Z",
    "completed_at": "2025-11-29T12:02:30Z",
    "total_requests": 20,
    "successful_requests": 20,
    "failed_requests": 0,
    "duration_seconds": 149.5,
    "scenarios": [
      {
        "id": "scenario-uuid",
        "instance_id": "smollm2-135m-abc123",
        "routing_mode": "direct",
        "model_path": "HuggingFaceTB/SmolLM2-135M-Instruct",
        "model_name": "SmolLM2-135M-Instruct",
        "input_tokens": 100,
        "output_tokens": 50,
        "concurrency": 4,
        "status": "completed",
        "metrics": {
          "ttft_avg": 45.2,
          "ttft_p50": 42.1,
          "ttft_p90": 68.3,
          "ttft_p95": 78.5,
          "ttft_p99": 95.2,
          "tps_avg": 156.8,
          "tps_p50": 158.2,
          "tps_p90": 142.3,
          "tps_p95": 138.5,
          "e2e_avg": 320.5,
          "e2e_p50": 315.2,
          "e2e_p90": 385.3,
          "e2e_p95": 412.1,
          "e2e_p99": 478.5,
          "goodput_count": 18,
          "goodput_percent": 90.0,
          "requests_per_second": 12.5,
          "tokens_per_second_total": 1960.0,
          "total_requests": 20,
          "successful_requests": 20,
          "failed_requests": 0
        }
      }
    ]
  }
}
```

### Subscribe to Benchmark Events (SSE)

**Endpoint:** `GET /api/benchmarks/{id}/events`

Real-time progress updates via Server-Sent Events.

**Event Types:**

| Event                 | Description                    |
| --------------------- | ------------------------------ |
| `benchmark:started`   | Benchmark run has started      |
| `scenario:started`    | A scenario has started         |
| `scenario:warmup`     | Warmup phase progress          |
| `scenario:progress`   | Measured request progress      |
| `scenario:completed`  | Scenario finished with metrics |
| `benchmark:completed` | All scenarios complete         |
| `benchmark:failed`    | Benchmark run failed           |

**Example SSE Event:**

```
event: scenario:progress
data: {"scenario_id":"uuid","completed":10,"total":20,"success_count":10,"error_count":0}

event: scenario:completed
data: {"scenario_id":"uuid","metrics":{"ttft_avg":45.2,"tps_avg":156.8,...}}
```

**Example (JavaScript):**

```javascript
// Note: EventSource cannot send Authorization headers, so pass JWT as query parameter
const token = getAuthToken() // Retrieve your JWT token
const eventSource = new EventSource(
  `/api/benchmarks/550e8400-e29b-41d4-a716-446655440000/events?token=${token}`
)

eventSource.addEventListener('scenario:progress', (event) => {
  const data = JSON.parse(event.data)
  console.log(`Progress: ${data.completed}/${data.total}`)
})

eventSource.addEventListener('benchmark:completed', (event) => {
  console.log('Benchmark complete!')
  eventSource.close()
})
```

### Delete a Benchmark Run

**Endpoint:** `DELETE /api/benchmarks/{id}`

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Benchmark run deleted"
}
```

## Memory Profile API

The Memory Profile API allows you to save and retrieve GPU memory footprints for capacity planning.

### List Memory Profiles

**Endpoint:** `GET /api/memory/profiles`

**Response (200 OK):**

```json
{
  "profiles": [
    {
      "id": "profile-uuid",
      "profile_name": "SmolLM2-135M @ 2048 tokens",
      "model_path": "HuggingFaceTB/SmolLM2-135M-Instruct",
      "max_tokens": 2048,
      "total_gpu_memory_gib": 1.22,
      "weights_memory_gib": 0.27,
      "cuda_graphs_gib": 0.55,
      "overhead_memory_gib": 0.4,
      "kv_cache_available_gib": 5.7,
      "gpu_name": "NVIDIA GeForce RTX 4090",
      "gpu_total_memory_gib": 24.0,
      "created_at": "2025-11-29T12:00:00Z"
    }
  ],
  "total": 1
}
```

### Create a Memory Profile

**Endpoint:** `POST /api/memory/profiles`

Create a profile from a running model instance:

**Request Body:**

```json
{
  "instanceId": "smollm2-135m-abc123",
  "profileName": "SmolLM2-135M @ 2048 tokens",
  "comments": "Baseline profile for capacity planning"
}
```

Or create manually with explicit values:

```json
{
  "profileName": "SmolLM2-135M @ 2048 tokens",
  "modelPath": "HuggingFaceTB/SmolLM2-135M-Instruct",
  "maxTokens": 2048,
  "totalGpuMemoryGib": 1.22,
  "weightsMemoryGib": 0.27,
  "cudaGraphsGib": 0.55,
  "gpuName": "NVIDIA GeForce RTX 4090",
  "gpuTotalMemoryGib": 24.0
}
```

**Response (201 Created):**

```json
{
  "profile": {
    "id": "new-profile-uuid",
    "profile_name": "SmolLM2-135M @ 2048 tokens",
    "model_path": "HuggingFaceTB/SmolLM2-135M-Instruct",
    "max_tokens": 2048,
    "total_gpu_memory_gib": 1.22,
    "weights_memory_gib": 0.27,
    "cuda_graphs_gib": 0.55,
    "overhead_memory_gib": 0.4,
    "kv_cache_available_gib": 5.7,
    "gpu_name": "NVIDIA GeForce RTX 4090",
    "gpu_total_memory_gib": 24.0,
    "created_at": "2025-11-29T12:00:00Z"
  }
}
```

### Lookup a Memory Profile

**Endpoint:** `GET /api/memory/profiles/lookup`

Find a profile by model configuration (useful before loading a model).

**Query Parameters:**

| Parameter    | Type   | Required | Description                                |
| ------------ | ------ | -------- | ------------------------------------------ |
| `model_path` | string | Yes      | Model path to lookup                       |
| `max_tokens` | number | Yes      | Max tokens configuration                   |
| `gpu_name`   | string | Yes      | GPU name (e.g., "NVIDIA GeForce RTX 4090") |

**Example:**

```bash
curl "http://localhost:3000/api/memory/profiles/lookup?model_path=HuggingFaceTB/SmolLM2-135M-Instruct&max_tokens=2048&gpu_name=NVIDIA%20GeForce%20RTX%204090"
```

**Response (200 OK):** Same as single profile response

**Response (404 Not Found):** If no matching profile exists

### Pre-Load Memory Check

**Endpoint:** `POST /api/memory/profiles/check`

Check if a model will fit in available GPU memory before loading.

**Request Body:**

```json
{
  "modelPath": "HuggingFaceTB/SmolLM2-135M-Instruct",
  "maxTokens": 2048
}
```

**Response (200 OK):**

```json
{
  "warning_level": "ok",
  "message": "Model should fit with 5.2 GiB headroom",
  "profile_found": true,
  "estimated_memory_gib": 1.22,
  "available_memory_gib": 6.42,
  "gpu_name": "NVIDIA GeForce RTX 4090",
  "gpu_total_memory_gib": 24.0
}
```

**Warning Levels:**

| Level     | Description                                               |
| --------- | --------------------------------------------------------- |
| `ok`      | Model should fit with comfortable headroom                |
| `caution` | Memory is tight, model may succeed but is close to limits |
| `danger`  | Model will not fit in available GPU memory                |
| `info`    | No profile found for this configuration                   |

### Delete a Memory Profile

**Endpoint:** `DELETE /api/memory/profiles/{id}`

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Memory profile deleted"
}
```

## Configuration API

The Configuration API allows you to save and restore model configurations for quick deployment of model presets.

### List Configurations

**Endpoint:** `GET /api/configurations`

**Response (200 OK):**

```json
{
  "configurations": [
    {
      "id": "config-uuid",
      "name": "Production Models",
      "description": "Standard production model set",
      "modelCount": 3,
      "createdAt": "2025-12-01T10:00:00Z",
      "updatedAt": "2025-12-01T10:00:00Z"
    }
  ],
  "total": 1
}
```

### Get Configuration Details

**Endpoint:** `GET /api/configurations/{id}`

**Response (200 OK):**

```json
{
  "configuration": {
    "id": "config-uuid",
    "name": "Production Models",
    "description": "Standard production model set",
    "modelCount": 3,
    "createdAt": "2025-12-01T10:00:00Z",
    "entries": [
      {
        "id": "entry-uuid",
        "modelPath": "meta-llama/Llama-3.2-1B",
        "servedModelName": "llama-1b",
        "maxTokens": 4096,
        "sourceType": "huggingface",
        "gpuIds": [0],
        "tensorParallelSize": 1,
        "extraArgs": ["--trust-remote-code"],
        "loadOrder": 0
      }
    ]
  }
}
```

### Create Configuration

**Endpoint:** `POST /api/configurations`

Saves current running models as a configuration preset.

**Request Body:**

```json
{
  "name": "Production Models",
  "description": "Standard production model set"
}
```

**Response (201 Created):**

```json
{
  "configuration": {
    "id": "new-config-uuid",
    "name": "Production Models",
    "modelCount": 3,
    "createdAt": "2025-12-01T10:00:00Z"
  }
}
```

### Load Configuration

**Endpoint:** `POST /api/configurations/{id}/load`

Unloads all current models and loads models from the saved configuration.

> **Note:** Models sharing GPUs are loaded sequentially to prevent vLLM memory calculation conflicts. Models on disjoint GPUs load in parallel for faster restoration.

**Response (202 Accepted):**

```json
{
  "status": "started",
  "configId": "config-uuid",
  "configName": "Production Models",
  "modelCount": 3
}
```

### Delete Configuration

**Endpoint:** `DELETE /api/configurations/{id}`

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Configuration deleted"
}
```

---

## Model Move API

The Model Move API enables moving a running model from one GPU to another without dropping requests. It uses a blue-green deployment pattern: spawn a new instance on the target GPU, wait for it to be ready, update routing, gracefully drain the source, then unload it.

### Key Concepts

- **Blue-green deployment**: Target instance spins up while source continues serving
- **Graceful drain**: Existing requests complete before source unload
- **Automatic rollback**: If target fails to start, source continues unchanged
- **Concurrent limit**: Only 1 move operation can run system-wide at a time

### Move Phases

```
VALIDATING  → Pre-flight checks (GPU memory, tensor parallelism)
SPAWNING    → Loading model on target GPU (progress 0-100%)
SWITCHING   → Updating routing table (new requests go to target)
DRAINING    → Waiting for source connections to complete
COMPLETING  → Unloading source instance
COMPLETED   → Move finished successfully
FAILED      → Error occurred (automatic rollback to source)
```

### Move Model

**Endpoint:** `POST /api/models/instances/{instance_id}/move`

Initiates a move operation for the specified model instance.

**Request Body:**

```json
{
  "target_gpu_ids": [1],
  "drain_timeout_ms": 60000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target_gpu_ids` | `number[]` | Yes | Target GPU index(es). Must match source tensor parallelism. |
| `drain_timeout_ms` | `number` | No | Max time (ms) to wait for source connections to complete. Default: 60000 (60s). |

**Response (202 Accepted):**

```json
{
  "move_id": "move-uuid",
  "source_instance_id": "instance-uuid",
  "target_gpu_ids": [1]
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid request (same GPU, wrong tensor parallelism, insufficient memory) |
| 404 | Instance not found |
| 409 | Another move operation is already in progress |

**Example (curl):**

```bash
curl -X POST http://localhost:3000/api/models/instances/abc123/move \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "target_gpu_ids": [1],
    "drain_timeout_ms": 60000
  }'
```

**Example (JavaScript):**

```javascript
const response = await fetch(
  `${baseUrl}/api/models/instances/${instanceId}/move`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      target_gpu_ids: [1],
      drain_timeout_ms: 60000,
    }),
  }
)
const { move_id } = await response.json()
```

**Example (Python):**

```python
import requests

response = requests.post(
    f"{base_url}/api/models/instances/{instance_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "target_gpu_ids": [1],
        "drain_timeout_ms": 60000
    }
)
move_id = response.json()["move_id"]
```

### Subscribe to Move Events

**Endpoint:** `GET /api/models/moves/{move_id}/events`

Server-Sent Events (SSE) stream for real-time move progress updates.

**Event Format:**

```
event: move_progress
data: {"move_id":"move-uuid","phase":"spawning","message":"Loading model on GPU 1...","progress":45}
```

**Event Data Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `move_id` | `string` | Move operation ID |
| `phase` | `string` | Current phase (validating, spawning, switching, draining, completing, completed, failed) |
| `message` | `string` | Human-readable progress message |
| `progress` | `number` | Progress percentage (0-100, only during spawning phase) |
| `error` | `string` | Error message (only when phase is "failed") |

**Example (JavaScript):**

```javascript
const eventSource = new EventSource(
  `${baseUrl}/api/models/moves/${moveId}/events?token=${token}`
)

eventSource.addEventListener('move_progress', (event) => {
  const data = JSON.parse(event.data)
  console.log(`Phase: ${data.phase}, Progress: ${data.progress}%`)

  if (data.phase === 'completed' || data.phase === 'failed') {
    eventSource.close()
  }
})

eventSource.onerror = (error) => {
  console.error('SSE connection error:', error)
  eventSource.close()
}
```

**Example (Python):**

```python
import sseclient
import requests

response = requests.get(
    f"{base_url}/api/models/moves/{move_id}/events",
    headers={"Authorization": f"Bearer {token}"},
    stream=True
)
client = sseclient.SSEClient(response)

for event in client.events():
    if event.event == 'move_progress':
        data = json.loads(event.data)
        print(f"Phase: {data['phase']}, Message: {data['message']}")
        if data['phase'] in ('completed', 'failed'):
            break
```

### Cancel Move

**Endpoint:** `DELETE /api/models/moves/{move_id}`

Cancels an in-progress move operation.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `force` | `boolean` | `false` | If `false`, reverts to source (graceful). If `true`, force completes (may drop connections). |

**Behavior by Phase:**

| Phase | Graceful (force=false) | Force (force=true) |
|-------|------------------------|-------------------|
| VALIDATING | Abort immediately | Abort immediately |
| SPAWNING | Kill target, keep source | Kill target, keep source |
| SWITCHING | Revert routing to source, unload target | Force complete, unload source |
| DRAINING | Revert routing to source, unload target | Force complete, unload source (may drop connections) |
| COMPLETING | Too late to cancel | Too late to cancel |

**Response (204 No Content):** Success

**Error Responses:**

| Status | Description |
|--------|-------------|
| 404 | Move operation not found |
| 409 | Cannot cancel (already completed or failed) |

**Example (curl):**

```bash
# Graceful cancel (revert to source)
curl -X DELETE http://localhost:3000/api/models/moves/move-uuid \
  -H "Authorization: Bearer $TOKEN"

# Force cancel (complete immediately, may drop connections)
curl -X DELETE "http://localhost:3000/api/models/moves/move-uuid?force=true" \
  -H "Authorization: Bearer $TOKEN"
```

### Validation Rules

- **Source status**: Model must be `running` or `sleeping`
- **Target GPUs**: Must be different from source GPUs
- **Tensor parallelism**: Target must have same number of GPUs as source
- **Memory**: Target GPU(s) must have sufficient free memory
- **Concurrent moves**: Only 1 move operation can run at a time

### Sleeping Models

Moving sleeping models is supported:

- Source stays in `sleeping` state during move
- Target loads fresh (does not inherit sleep state)
- After move completes, target is in `running` state

---

**See Also:**

- [Architecture](./architecture.md) - System architecture details
- [Deployment Guide](./deployment.md) - Container and OpenShift deployment
- [OpenAPI Specification](../specs/001-multi-model-platform/contracts/) - Full API schema (when available)
