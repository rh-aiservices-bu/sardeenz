# API Guide

This guide provides practical examples for using the Sardeenz APIs.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Controller API](#controller-api)
- [Proxy API](#proxy-api)
- [Error Handling](#error-handling)
- [Code Examples](#code-examples)

## Overview

Sardeenz provides two main APIs:

1. **Controller API** (`http://localhost:3000/api/v1/`) - Manage model lifecycle
2. **Proxy API** (`http://localhost:8000/v1/`) - OpenAI-compatible inference endpoint

### Base URLs

| Environment | Controller API | Proxy API |
|-------------|---------------|-----------|
| Development | `http://localhost:3000/api/v1` | `http://localhost:8000/v1` |
| Production | `https://your-domain.com/api/v1` | `https://your-domain.com/v1` |

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
  "modelPath": "/models/meta-llama/Llama-3.2-1B",
  "displayName": "Llama 3.2 1B",
  "gpuMemoryLimit": 4.0,
  "port": 5001
}
```

**Response (202 Accepted):**
```json
{
  "id": "llama-3-2-1b-abc123",
  "modelPath": "/models/meta-llama/Llama-3.2-1B",
  "displayName": "Llama 3.2 1B",
  "status": "starting",
  "port": 5001,
  "gpuMemoryLimit": 4.0,
  "createdAt": "2025-11-11T10:30:00Z"
}
```

**Example (curl):**
```bash
curl -X POST http://localhost:3000/api/v1/models/load \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "modelPath": "/models/meta-llama/Llama-3.2-1B",
    "displayName": "Llama 3.2 1B",
    "gpuMemoryLimit": 4.0,
    "port": 5001
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
    modelPath: '/models/meta-llama/Llama-3.2-1B',
    displayName: 'Llama 3.2 1B',
    gpuMemoryLimit: 4.0,
    port: 5001,
  }),
});

const model = await response.json();
console.log('Model loading:', model.id);
```

### List Models

**Endpoint:** `GET /api/v1/models`

**Response (200 OK):**
```json
{
  "models": [
    {
      "id": "llama-3-2-1b-abc123",
      "modelPath": "/models/meta-llama/Llama-3.2-1B",
      "displayName": "Llama 3.2 1B",
      "status": "active",
      "port": 5001,
      "pid": 12345,
      "gpuMemoryLimit": 4.0,
      "createdAt": "2025-11-11T10:30:00Z",
      "startedAt": "2025-11-11T10:31:15Z"
    },
    {
      "id": "mistral-7b-def456",
      "modelPath": "/models/mistralai/Mistral-7B-v0.1",
      "displayName": "Mistral 7B",
      "status": "active",
      "port": 5002,
      "pid": 12346,
      "gpuMemoryLimit": 8.0,
      "createdAt": "2025-11-11T10:35:00Z",
      "startedAt": "2025-11-11T10:36:20Z"
    }
  ]
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
  "id": "llama-3-2-1b-abc123",
  "modelPath": "/models/meta-llama/Llama-3.2-1B",
  "displayName": "Llama 3.2 1B",
  "status": "active",
  "port": 5001,
  "pid": 12345,
  "gpuMemoryLimit": 4.0,
  "createdAt": "2025-11-11T10:30:00Z",
  "startedAt": "2025-11-11T10:31:15Z",
  "metrics": {
    "requestCount": 1523,
    "activeConnections": 3,
    "gpuMemoryUsed": 3.8,
    "avgResponseTime": 234,
    "p95ResponseTime": 456
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

**Endpoint:** `GET /health`

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-11T10:45:00Z",
  "uptime": 3600,
  "models": {
    "total": 2,
    "active": 2,
    "starting": 0,
    "stopping": 0,
    "failed": 0
  }
}
```

**Example (curl):**
```bash
curl http://localhost:3000/health
```

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

---

**See Also:**
- [Architecture](./architecture.md) - System architecture details
- [Deployment Guide](./deployment.md) - Container and OpenShift deployment
- [OpenAPI Specification](../specs/001-multi-model-platform/contracts/) - Full API schema (when available)
