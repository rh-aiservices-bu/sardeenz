# API Guide

This guide provides practical examples for using the Sardeenz APIs.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Controller API](#controller-api)
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

| Environment | Base URL | Example Endpoints |
|-------------|----------|-------------------|
| Development | `http://localhost:3000` | `/api/v1/models`, `/v1/chat/completions` |
| Production | `https://your-domain.com` | `/api/v1/models`, `/v1/chat/completions` |

### API Versioning

Both APIs use URL-based versioning:
- Controller: `/api/v1/...`
- Proxy: `/v1/...` (matches OpenAI API convention)

## Authentication

### Controller API

**OAuth 2.0 / OIDC with JWT Bearer Tokens**

```bash
# Obtain access token from your identity provider
TOKEN=$(curl -X POST https://your-idp.com/oauth/token \
  -d "grant_type=client_credentials" \
  -d "client_id=your-client-id" \
  -d "client_secret=your-client-secret" \
  | jq -r '.access_token')

# Use token in requests
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/models
```

### RBAC Roles

| Role | Permissions |
|------|-------------|
| `admin` | Load/unload models, view all data |
| `admin-readonly` | View models and metrics (read-only) |

**JWT Claims:**
```json
{
  "sub": "user@example.com",
  "roles": ["admin"],
  "iat": 1234567890,
  "exp": 1234571490
}
```

### Proxy API

The Proxy API is designed to run behind an API gateway (e.g., OpenShift Router) and assumes authentication is handled at the gateway level.

For development/testing, the proxy may run without authentication.

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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model_path` | string | Yes | Model identifier (HuggingFace path or local path) |
| `max_tokens` | number | No | Maximum context length (default: model's max) |
| `gpu_ids` | number[] | No | GPU indices to use. If omitted, auto-selects GPU(s) with most free memory |
| `tensor_parallel_size` | number | No | Number of GPUs for tensor parallelism (default: 1). KVCached is disabled when >1 |
| `extra_args` | string[] | No | Additional vLLM CLI arguments |

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
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model_path: 'meta-llama/Llama-3.2-1B',
    max_tokens: 4096,
  }),
});

const result = await response.json();
console.log('Model loading:', result.instance_id);
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
      "overhead_memory_gib": 0.40,
      "kv_cache_available_gib": 5.70,
      "kv_cache_per_request_mib": 156.23,
      "max_model_len": 4096
    },
    "launch_command": "python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-3.2-1B --port 5001 ..."
  }
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

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `types` | string | all | Comma-separated event types: `log,status,memory,progress,error` |
| `replay_logs` | string | true | Replay existing buffered logs on connection |

**Event Types:**

| Type | Description |
|------|-------------|
| `log` | vLLM process stdout/stderr output |
| `status` | Model status transitions (starting → active/failed) |
| `memory` | GPU memory updates |
| `progress` | Loading progress updates |
| `error` | Error notifications |

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

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `lines` | number | 100 | Number of lines to return (1-500) |

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
# HELP vllm_stacker_models_total Total number of model instances
# TYPE vllm_stacker_models_total gauge
vllm_stacker_models_total{status="active"} 2
vllm_stacker_models_total{status="starting"} 0
vllm_stacker_models_total{status="stopping"} 0
vllm_stacker_models_total{status="failed"} 0

# HELP vllm_stacker_gpu_memory_used_bytes GPU memory used by all models
# TYPE vllm_stacker_gpu_memory_used_bytes gauge
vllm_stacker_gpu_memory_used_bytes{model_id="llama-3-2-1b-abc123"} 4080218931
vllm_stacker_gpu_memory_used_bytes{model_id="mistral-7b-def456"} 8589934592

# HELP vllm_stacker_requests_total Total inference requests
# TYPE vllm_stacker_requests_total counter
vllm_stacker_requests_total{model_id="llama-3-2-1b-abc123",status="success"} 1523
vllm_stacker_requests_total{model_id="mistral-7b-def456",status="success"} 892

# HELP vllm_stacker_request_duration_ms Request duration in milliseconds
# TYPE vllm_stacker_request_duration_ms histogram
vllm_stacker_request_duration_ms_bucket{model_id="llama-3-2-1b-abc123",le="100"} 234
vllm_stacker_request_duration_ms_bucket{model_id="llama-3-2-1b-abc123",le="500"} 1421
vllm_stacker_request_duration_ms_bucket{model_id="llama-3-2-1b-abc123",le="+Inf"} 1523
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

| Field | Description |
|-------|-------------|
| `kvcache.total_gb` | Total KVCache pool size (shared across all models) |
| `kvcache.prealloc_gb` | Pre-allocated but not actively used KVCache memory |
| `kvcache.used_gb` | Currently active KVCache memory |
| `kvcache.free_gb` | Available KVCache memory |
| `gpu.total_gb` | Total GPU memory |
| `gpu.used_gb` | Used GPU memory (all processes) |
| `gpu.free_gb` | Free GPU memory |
| `gpu.utilization_percent` | GPU utilization percentage |
| `models[].model_path` | Full model path/identifier |
| `models[].instance_id` | Unique instance identifier (stable across API calls) |
| `models[].display_name` | Short display name, unique per instance. For duplicate models, includes suffix: "Model", "Model (2)", etc. |
| `models[].gpu_memory_gb` | Model's GPU footprint (weights + CUDA graphs) |
| `models[].color` | Hex color for visualization (unique per instance, based on instance_id hash) |

**Example (curl):**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/memory/usage
```

**Example (JavaScript):**
```javascript
const response = await fetch('http://localhost:3000/api/memory/usage', {
  headers: { 'Authorization': `Bearer ${token}` },
});
const memoryData = await response.json();

// KVCache metrics (shared pool)
console.log(`KVCache: ${memoryData.kvcache.used_gb}/${memoryData.kvcache.total_gb} GB`);

// GPU metrics with per-model breakdown
console.log(`GPU: ${memoryData.gpu.used_gb}/${memoryData.gpu.total_gb} GB`);
memoryData.models.forEach(model => {
  console.log(`  ${model.display_name}: ${model.gpu_memory_gb} GB`);
});
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
      ]
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
  "messages": [
    {"role": "user", "content": "Write a short poem about AI."}
  ],
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
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

  for (const line of lines) {
    const data = line.replace('data: ', '');
    if (data === '[DONE]') break;

    const parsed = JSON.parse(data);
    const content = parsed.choices[0]?.delta?.content;
    if (content) {
      process.stdout.write(content);
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
import axios from 'axios';

const CONTROLLER_URL = 'http://localhost:3000/api/v1';
const PROXY_URL = 'http://localhost:8000/v1';
const AUTH_TOKEN = process.env.AUTH_TOKEN;

async function completeWorkflow() {
  // 1. Load a model
  console.log('Loading model...');
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
  );

  const modelId = loadResponse.data.id;
  const instanceId = loadResponse.data.instance_id;
  console.log(`Model loading started: ${instanceId}`);

  // 2. Wait for model to be ready
  // Option A: Polling (shown below)
  // Option B: Subscribe to SSE at /api/v1/models/instances/{instance_id}/events
  console.log('Waiting for model to be ready...');
  let status = 'starting';
  while (status === 'starting') {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const statusResponse = await axios.get(
      `${CONTROLLER_URL}/models/${modelId}`,
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    );
    status = statusResponse.data.status;
    console.log(`Status: ${status}`);
  }

  if (status !== 'active') {
    throw new Error(`Model failed to start: ${status}`);
  }

  // 3. Make inference request
  console.log('Making inference request...');
  const inferenceResponse = await axios.post(`${PROXY_URL}/chat/completions`, {
    model: modelId,
    messages: [
      { role: 'user', content: 'What is 2+2?' },
    ],
  });

  console.log('Response:', inferenceResponse.data.choices[0].message.content);

  // 4. Unload model
  console.log('Unloading model...');
  await axios.post(
    `${CONTROLLER_URL}/models/${modelId}/unload`,
    {},
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
  );

  console.log('Workflow complete!');
}

completeWorkflow().catch(console.error);
```

### Python Client Library

```python
import requests
import time
from typing import Optional

class VLLMStackerClient:
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
client = VLLMStackerClient(
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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Human-readable name for the benchmark run |
| `mode` | string | Yes | `isolated` (run scenarios sequentially) or `contention` (run all simultaneously) |
| `scenarios` | array | Yes | One or more scenarios to benchmark |
| `scenarios[].instanceId` | string | Yes | Model instance ID to benchmark |
| `scenarios[].routingMode` | string | No | `direct` (to vLLM) or `proxy` (through unified endpoint). Default: `direct` |
| `scenarios[].inputTokens` | number | Yes | Target input token count |
| `scenarios[].outputTokens` | number | Yes | Max tokens for response |
| `scenarios[].concurrency` | number | Yes | Number of parallel requests |
| `scenarios[].warmupRequests` | number | Yes | Unmeasured warmup requests |
| `scenarios[].totalRequests` | number | Yes | Measured requests |
| `scenarios[].slaThresholdMs` | number | No | SLA threshold for goodput calculation |

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

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Results per page (max 100) |
| `status` | string | all | Filter by status: `pending`, `running`, `completed`, `cancelled`, `failed` |

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

| Event | Description |
|-------|-------------|
| `benchmark:started` | Benchmark run has started |
| `scenario:started` | A scenario has started |
| `scenario:warmup` | Warmup phase progress |
| `scenario:progress` | Measured request progress |
| `scenario:completed` | Scenario finished with metrics |
| `benchmark:completed` | All scenarios complete |
| `benchmark:failed` | Benchmark run failed |

**Example SSE Event:**
```
event: scenario:progress
data: {"scenario_id":"uuid","completed":10,"total":20,"success_count":10,"error_count":0}

event: scenario:completed
data: {"scenario_id":"uuid","metrics":{"ttft_avg":45.2,"tps_avg":156.8,...}}
```

**Example (JavaScript):**
```javascript
const eventSource = new EventSource('/api/benchmarks/550e8400-e29b-41d4-a716-446655440000/events');

eventSource.addEventListener('scenario:progress', (event) => {
  const data = JSON.parse(event.data);
  console.log(`Progress: ${data.completed}/${data.total}`);
});

eventSource.addEventListener('benchmark:completed', (event) => {
  console.log('Benchmark complete!');
  eventSource.close();
});
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
      "overhead_memory_gib": 0.40,
      "kv_cache_available_gib": 5.70,
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
    "overhead_memory_gib": 0.40,
    "kv_cache_available_gib": 5.70,
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

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model_path` | string | Yes | Model path to lookup |
| `max_tokens` | number | Yes | Max tokens configuration |
| `gpu_name` | string | Yes | GPU name (e.g., "NVIDIA GeForce RTX 4090") |

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

| Level | Description |
|-------|-------------|
| `ok` | Model should fit with comfortable headroom |
| `caution` | Memory is tight, model may succeed but is close to limits |
| `danger` | Model will not fit in available GPU memory |
| `info` | No profile found for this configuration |

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

**See Also:**
- [Architecture](./architecture.md) - System architecture details
- [Deployment Guide](./deployment.md) - Container and OpenShift deployment
- [OpenAPI Specification](../specs/001-multi-model-platform/contracts/) - Full API schema (when available)
