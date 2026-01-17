# kvcached API Reference

This document provides a complete reference for the kvcached Controller HTTP API endpoints.

## Table of Contents

- [Base URL](#base-url)
- [OpenAI-Compatible Endpoints](#openai-compatible-endpoints)
- [Model Management Endpoints](#model-management-endpoints)
- [Traffic Monitoring Endpoints](#traffic-monitoring-endpoints)
- [Sleep Management Endpoints](#sleep-management-endpoints)
- [Health Check Endpoints](#health-check-endpoints)
- [Error Handling](#error-handling)

## Base URL

By default, the kvcached Controller listens on:

```
http://localhost:8080
```

This can be configured in the YAML configuration file under `router.host` and `router.port`.

## OpenAI-Compatible Endpoints

These endpoints are compatible with the OpenAI API specification, allowing drop-in replacement for OpenAI clients.

### POST /v1/completions

Generate text completions for a given prompt.

**Request Body**:

```json
{
  "model": "meta-llama/Llama-3.2-1B",
  "prompt": "Once upon a time",
  "max_tokens": 100,
  "temperature": 0.7,
  "top_p": 0.9,
  "stream": false
}
```

**Request Parameters**:

- `model` (string, required): Model name/identifier
- `prompt` (string, required): Input text to complete
- `max_tokens` (integer, optional): Maximum tokens to generate
- `temperature` (float, optional): Sampling temperature (0.0-2.0)
- `top_p` (float, optional): Nucleus sampling threshold
- `stream` (boolean, optional): Enable streaming responses (default: false)
- Additional vLLM-supported parameters

**Response (Non-Streaming)**:

```json
{
  "id": "cmpl-xxxx",
  "object": "text_completion",
  "created": 1234567890,
  "model": "meta-llama/Llama-3.2-1B",
  "choices": [
    {
      "text": "generated completion text...",
      "index": 0,
      "logprobs": null,
      "finish_reason": "length"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 100,
    "total_tokens": 110
  }
}
```

**Response (Streaming)**:

```
data: {"id":"cmpl-xxxx","object":"text_completion","created":1234567890,"choices":[{"text":"Once","index":0}],"model":"meta-llama/Llama-3.2-1B"}

data: {"id":"cmpl-xxxx","object":"text_completion","created":1234567890,"choices":[{"text":" upon","index":0}],"model":"meta-llama/Llama-3.2-1B"}

data: [DONE]
```

**Example**:

```bash
curl http://localhost:8080/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-3.2-1B",
    "prompt": "The capital of France is",
    "max_tokens": 10
  }'
```

### POST /v1/chat/completions

Generate chat-based completions for a conversation.

**Request Body**:

```json
{
  "model": "meta-llama/Llama-3.2-1B",
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
  "max_tokens": 100,
  "temperature": 0.7,
  "stream": false
}
```

**Request Parameters**:

- `model` (string, required): Model name/identifier
- `messages` (array, required): Conversation history
  - `role` (string): One of "system", "user", "assistant"
  - `content` (string): Message content
- `max_tokens` (integer, optional): Maximum tokens to generate
- `temperature` (float, optional): Sampling temperature
- `stream` (boolean, optional): Enable streaming responses
- Additional vLLM-supported parameters

**Response (Non-Streaming)**:

```json
{
  "id": "chatcmpl-xxxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "meta-llama/Llama-3.2-1B",
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
    "prompt_tokens": 20,
    "completion_tokens": 8,
    "total_tokens": 28
  }
}
```

**Response (Streaming)**:

```
data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","created":1234567890,"model":"meta-llama/Llama-3.2-1B","choices":[{"index":0,"delta":{"role":"assistant","content":"The"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","created":1234567890,"model":"meta-llama/Llama-3.2-1B","choices":[{"index":0,"delta":{"content":" capital"},"finish_reason":null}]}

data: [DONE]
```

**Example**:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-3.2-1B",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

## Model Management Endpoints

### GET /models

List all configured models with their endpoint information.

**Response**:

```json
{
  "object": "list",
  "data": [
    {
      "id": "meta-llama/Llama-3.2-1B",
      "object": "model",
      "created": 1234567890,
      "owned_by": "organization",
      "endpoint": {
        "host": "localhost",
        "port": 12346
      }
    },
    {
      "id": "Qwen/Qwen3-0.6B",
      "object": "model",
      "created": 1234567890,
      "owned_by": "organization",
      "endpoint": {
        "host": "localhost",
        "port": 12347
      }
    }
  ]
}
```

**Example**:

```bash
curl http://localhost:8080/models
```

### GET /models/idle

List models that are currently idle (no recent activity).

**Query Parameters**:

- `threshold` (integer, optional): Idle time threshold in seconds (default: 300)

**Response**:

```json
{
  "idle_models": [
    {
      "model": "meta-llama/Llama-3.2-1B",
      "idle_time": 450,
      "last_activity": "2025-11-08T10:30:00Z"
    }
  ],
  "threshold": 300
}
```

**Example**:

```bash
# Get models idle for more than 5 minutes
curl http://localhost:8080/models/idle?threshold=300
```

### GET /models/active

List models that are currently active (recent activity).

**Query Parameters**:

- `threshold` (integer, optional): Activity threshold in seconds (default: 300)
- `window` (integer, optional): Time window to consider in seconds

**Response**:

```json
{
  "active_models": [
    {
      "model": "Qwen/Qwen3-0.6B",
      "last_activity": "2025-11-08T10:35:00Z",
      "seconds_since_activity": 10,
      "request_count": 25
    }
  ],
  "threshold": 300
}
```

**Example**:

```bash
curl http://localhost:8080/models/active
```

## Traffic Monitoring Endpoints

### GET /traffic/stats

Get overall traffic statistics across all models.

**Query Parameters**:

- `window` (integer, optional): Time window in seconds for statistics (default: all time)

**Response**:

```json
{
  "overall": {
    "total_requests": 1250,
    "successful_requests": 1230,
    "failed_requests": 20,
    "request_rate": 12.5,
    "avg_response_time": 0.85
  },
  "by_model": {
    "meta-llama/Llama-3.2-1B": {
      "total_requests": 800,
      "successful_requests": 795,
      "failed_requests": 5,
      "request_rate": 8.0,
      "avg_response_time": 0.75,
      "last_activity": "2025-11-08T10:35:00Z"
    },
    "Qwen/Qwen3-0.6B": {
      "total_requests": 450,
      "successful_requests": 435,
      "failed_requests": 15,
      "request_rate": 4.5,
      "avg_response_time": 0.95,
      "last_activity": "2025-11-08T10:34:30Z"
    }
  }
}
```

**Metrics Explanation**:

- `total_requests`: Total number of requests received
- `successful_requests`: Requests completed successfully
- `failed_requests`: Requests that failed
- `request_rate`: Requests per minute
- `avg_response_time`: Average response time in seconds
- `last_activity`: Timestamp of last request

**Example**:

```bash
# Get all-time stats
curl http://localhost:8080/traffic/stats

# Get stats for last 5 minutes
curl http://localhost:8080/traffic/stats?window=300
```

### GET /traffic/stats/{model_name}

Get traffic statistics for a specific model.

**Path Parameters**:

- `model_name` (string, required): Model identifier (URL-encoded)

**Query Parameters**:

- `window` (integer, optional): Time window in seconds (default: all time)

**Response**:

```json
{
  "model": "meta-llama/Llama-3.2-1B",
  "total_requests": 800,
  "successful_requests": 795,
  "failed_requests": 5,
  "request_rate": 8.0,
  "avg_response_time": 0.75,
  "last_activity": "2025-11-08T10:35:00Z",
  "idle_time": 45
}
```

**Example**:

```bash
# URL encode the model name
MODEL_NAME=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl http://localhost:8080/traffic/stats/$MODEL_NAME
```

## Sleep Management Endpoints

### GET /sleep/status

Get the current sleep status of all models.

**Response**:

```json
{
  "models": {
    "meta-llama/Llama-3.2-1B": {
      "status": "sleeping",
      "sleep_time": "2025-11-08T10:25:00Z",
      "sleep_duration": 600
    },
    "Qwen/Qwen3-0.6B": {
      "status": "active",
      "last_activity": "2025-11-08T10:35:00Z"
    }
  }
}
```

**Status Values**:

- `active`: Model is running and available
- `sleeping`: Model is in sleep mode
- `waking`: Model is in the process of waking up

**Example**:

```bash
curl http://localhost:8080/sleep/status
```

### GET /sleep/candidates

List models that are eligible for sleep (idle beyond threshold).

**Response**:

```json
{
  "candidates": [
    {
      "model": "meta-llama/Llama-3.2-1B",
      "idle_time": 450,
      "last_activity": "2025-11-08T10:27:30Z",
      "threshold": 300
    }
  ],
  "auto_sleep_enabled": true,
  "idle_threshold": 300
}
```

**Example**:

```bash
curl http://localhost:8080/sleep/candidates
```

### POST /action/sleep/{model_name}

Manually put a specific model to sleep.

**Path Parameters**:

- `model_name` (string, required): Model identifier (URL-encoded)

**Request Body**: None required (empty body or `{}`)

**Response (Success)**:

```json
{
  "status": "success",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Model put to sleep",
  "timestamp": "2025-11-08T10:36:00Z"
}
```

**Response (Error - Model Already Sleeping)**:

```json
{
  "status": "error",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Model is already sleeping"
}
```

**Example**:

```bash
MODEL_NAME=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl -X POST http://localhost:8080/action/sleep/$MODEL_NAME \
  -H "Content-Type: application/json" \
  -d '{}'
```

### POST /action/wakeup/{model_name}

Manually wake up a sleeping model.

**Path Parameters**:

- `model_name` (string, required): Model identifier (URL-encoded)

**Request Body**: None required (empty body or `{}`)

**Response (Success)**:

```json
{
  "status": "success",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Model woken up",
  "timestamp": "2025-11-08T10:37:00Z"
}
```

**Response (Error - Model Already Active)**:

```json
{
  "status": "error",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Model is already active"
}
```

**Response (Error - Minimum Sleep Duration Not Met)**:

```json
{
  "status": "error",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Minimum sleep duration (60s) not met. Slept for 30s.",
  "min_sleep_duration": 60,
  "actual_sleep_duration": 30
}
```

**Example**:

```bash
MODEL_NAME=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl -X POST http://localhost:8080/action/wakeup/$MODEL_NAME \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Health Check Endpoints

### GET /health

Check the overall health of the Controller.

**Response**:

```json
{
  "status": "healthy",
  "timestamp": "2025-11-08T10:38:00Z",
  "uptime": 3600,
  "models_active": 2,
  "models_sleeping": 1
}
```

**Example**:

```bash
curl http://localhost:8080/health
```

### GET /health/{model_name}

Check the health of a specific model endpoint.

**Path Parameters**:

- `model_name` (string, required): Model identifier (URL-encoded)

**Response (Healthy)**:

```json
{
  "model": "meta-llama/Llama-3.2-1B",
  "status": "healthy",
  "endpoint": {
    "host": "localhost",
    "port": 12346
  },
  "response_time": 0.02
}
```

**Response (Unhealthy)**:

```json
{
  "model": "meta-llama/Llama-3.2-1B",
  "status": "unhealthy",
  "endpoint": {
    "host": "localhost",
    "port": 12346
  },
  "error": "Connection refused"
}
```

**Example**:

```bash
MODEL_NAME=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl http://localhost:8080/health/$MODEL_NAME
```

### GET /get_server_info

Get server information (for compatibility).

**Response**:

```json
{
  "version": "0.1.0",
  "controller": "kvcached-multi-llm-controller"
}
```

**Example**:

```bash
curl http://localhost:8080/get_server_info
```

## Error Handling

### HTTP Status Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Model or resource not found
- `500 Internal Server Error`: Server-side error
- `503 Service Unavailable`: Model is unavailable (e.g., waking up)

### Error Response Format

```json
{
  "error": {
    "message": "Model not found: invalid-model-name",
    "type": "not_found",
    "code": "model_not_found"
  }
}
```

### Common Error Scenarios

**Model Not Found**:

```json
{
  "error": {
    "message": "Model 'unknown-model' is not configured",
    "type": "not_found",
    "code": "model_not_found"
  }
}
```

**Model Waking Up**:

```json
{
  "error": {
    "message": "Model 'meta-llama/Llama-3.2-1B' is currently waking up. Please retry in a few seconds.",
    "type": "service_unavailable",
    "code": "model_waking"
  }
}
```

**Invalid Parameters**:

```json
{
  "error": {
    "message": "Invalid parameter 'max_tokens': must be a positive integer",
    "type": "invalid_request",
    "code": "invalid_parameter"
  }
}
```

## Integration Examples

### Python with requests

```python
import requests

# Base URL
BASE_URL = "http://localhost:8080"

# Completion request
response = requests.post(
    f"{BASE_URL}/v1/completions",
    json={
        "model": "meta-llama/Llama-3.2-1B",
        "prompt": "Hello, world!",
        "max_tokens": 50
    }
)
print(response.json())

# Get traffic stats
stats = requests.get(f"{BASE_URL}/traffic/stats").json()
print(f"Total requests: {stats['overall']['total_requests']}")

# Put model to sleep
import urllib.parse
model_name = urllib.parse.quote("meta-llama/Llama-3.2-1B")
response = requests.post(f"{BASE_URL}/action/sleep/{model_name}", json={})
print(response.json())
```

### Python with OpenAI SDK

```python
from openai import OpenAI

# Point OpenAI client to kvcached Controller
client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="not-needed"  # kvcached doesn't require auth by default
)

# Use like normal OpenAI API
response = client.completions.create(
    model="meta-llama/Llama-3.2-1B",
    prompt="The capital of France is",
    max_tokens=10
)
print(response.choices[0].text)
```

### JavaScript/Node.js with fetch

```javascript
// Completion request
const response = await fetch('http://localhost:8080/v1/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'meta-llama/Llama-3.2-1B',
    prompt: 'Hello, world!',
    max_tokens: 50,
  }),
})

const data = await response.json()
console.log(data.choices[0].text)

// Get sleep status
const sleepStatus = await fetch('http://localhost:8080/sleep/status')
const sleepData = await sleepStatus.json()
console.log(sleepData)
```

### cURL Examples

```bash
# Completion
curl http://localhost:8080/v1/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/Llama-3.2-1B","prompt":"Hello","max_tokens":20}'

# Chat completion
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/Llama-3.2-1B","messages":[{"role":"user","content":"Hi"}]}'

# List models
curl http://localhost:8080/models

# Get traffic stats
curl http://localhost:8080/traffic/stats

# Get sleep status
curl http://localhost:8080/sleep/status

# Put model to sleep
MODEL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl -X POST http://localhost:8080/action/sleep/$MODEL -H "Content-Type: application/json" -d '{}'

# Wake up model
curl -X POST http://localhost:8080/action/wakeup/$MODEL -H "Content-Type: application/json" -d '{}'
```

## Rate Limiting and Quotas

kvcached Controller does not implement rate limiting by default. For production use, consider:

- Adding a reverse proxy (nginx, Caddy) with rate limiting
- Implementing application-level quotas
- Using API gateway solutions

## Authentication and Security

By default, kvcached Controller does not require authentication. For production deployments:

- **Recommended**: Deploy behind a reverse proxy with authentication
- **Network Security**: Use firewall rules to restrict access
- **TLS/SSL**: Terminate SSL at reverse proxy level
- **API Keys**: Implement at application layer if needed

## Best Practices

1. **URL Encoding**: Always URL-encode model names in path parameters
2. **Error Handling**: Implement retry logic for 503 errors (waking models)
3. **Monitoring**: Regularly poll `/traffic/stats` for usage metrics
4. **Health Checks**: Use `/health` for liveness probes
5. **Streaming**: Use streaming for long-form generation to reduce latency
6. **Model Selection**: Check `/models` to verify model availability before requests

## Changelog

- **v0.1.0**: Initial API release
  - OpenAI-compatible completion endpoints
  - Traffic monitoring
  - Sleep management
  - Health checks
