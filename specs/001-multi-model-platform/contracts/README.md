# API Contracts

This directory contains OpenAPI 3.1 specifications for the Sardeenz platform.

## Contracts

### 1. Controller API (`controller-api.yaml`)

**Purpose**: Model lifecycle management and monitoring

**Base Path**: `/api`

**Authentication**: OAuth 2.0 required

**Endpoints**:

- `POST /models/load` - Load a new model (requires `admin` role)
- `DELETE /models/{model_path}` - Unload a model (requires `admin` role)
- `GET /models` - List all loaded models (requires `admin-readonly` role)
- `GET /models/{model_path}` - Get model details (requires `admin-readonly` role)
- `GET /models/{model_path}/health` - Check model health (requires `admin-readonly` role)
- `GET /memory/usage` - Get GPU memory usage (requires `admin-readonly` role)
- `POST /memory/limits` - Set memory limits (requires `admin` role)

**Use Cases**:

- Platform operators managing model lifecycle via API
- Admin UI calling controller endpoints
- Automated scripts for model deployment

---

### 2. Proxy API (`proxy-api.yaml`)

**Purpose**: Unified inference endpoint for routing requests to models

**Base Path**: `/v1`

**Authentication**: NOT required (assumes trusted network or gateway-level auth)

**Endpoints**:

- `POST /v1/completions` - Text completion (OpenAI-compatible)
- `POST /v1/chat/completions` - Chat completion (OpenAI-compatible)

**Use Cases**:

- Application developers sending inference requests
- End users interacting with models via unified endpoint
- Streaming and non-streaming completions

**Performance Requirements**:

- Routing overhead MUST be <50ms (per constitution)
- Streaming requests use direct TCP passthrough

---

## Usage

### Viewing the Specifications

**Option 1: Swagger UI (recommended)**

```bash
# Install swagger-ui-watcher
npm install -g swagger-ui-watcher

# Serve controller API
swagger-ui-watcher controller-api.yaml

# Serve proxy API
swagger-ui-watcher proxy-api.yaml
```

**Option 2: VS Code Extension**

Install "Swagger Viewer" or "OpenAPI (Swagger) Editor" extension and open the YAML files.

**Option 3: Online Viewer**

Upload the YAML files to https://editor.swagger.io/

---

### Generating Client SDKs

**TypeScript Client (for frontend)**:

```bash
# Install OpenAPI Generator
npm install -g @openapitools/openapi-generator-cli

# Generate TypeScript client for Controller API
openapi-generator-cli generate \
  -i controller-api.yaml \
  -g typescript-fetch \
  -o ../../../packages/api-client/src/controller

# Generate TypeScript client for Proxy API
openapi-generator-cli generate \
  -i proxy-api.yaml \
  -g typescript-fetch \
  -o ../../../packages/api-client/src/proxy
```

**Python Client (for testing/scripts)**:

```bash
openapi-generator-cli generate \
  -i controller-api.yaml \
  -g python \
  -o ../../tests/api-client-python
```

---

### Validating Contracts

**Using OpenAPI CLI Tools**:

```bash
# Install validator
npm install -g @apidevtools/swagger-cli

# Validate controller API
swagger-cli validate controller-api.yaml

# Validate proxy API
swagger-cli validate proxy-api.yaml
```

---

## Contract Testing

Contract tests ensure the backend implementation matches these OpenAPI specifications.

**Recommended Tools**:

- **Dredd**: HTTP API testing framework
- **Schemathesis**: Property-based testing for OpenAPI specs

**Example with Dredd**:

```bash
# Install Dredd
npm install -g dredd

# Run contract tests for Controller API
dredd controller-api.yaml http://localhost:3000

# Run contract tests for Proxy API
dredd proxy-api.yaml http://localhost:3000
```

---

## Versioning

**Current Version**: 0.1.0 (PoC phase)

**Versioning Strategy**:

- URL path versioning: `/api/v1/`, `/api/v2/`, etc.
- Breaking changes require major version bump
- Backward-compatible additions require minor version bump

**Migration Path**:

- v0.x.x: PoC phase (rapid iteration, breaking changes allowed)
- v1.0.0: Production-ready stable API
- v1.x.x: Backward-compatible enhancements

---

## Related Documents

- **Data Model**: `../data-model.md` - Entity definitions and relationships
- **Research**: `../research.md` - Technical decisions and patterns
- **Quickstart**: `../quickstart.md` - Development setup and project structure

---

## Notes

### Authentication in Proxy API

The Proxy API does NOT require authentication by design:

- Assumes deployment behind a trusted network or API gateway
- Gateway/ingress handles authentication and authorization
- Simplifies client integration and reduces latency

If authentication is needed:

1. Deploy an API gateway (e.g., Kong, Traefik) in front of the proxy
2. Configure OAuth/API key authentication at gateway level
3. Proxy remains auth-free for performance

### OpenAI Compatibility

The Proxy API follows OpenAI's API conventions:

- Same request/response formats for completions and chat
- Compatible with OpenAI client libraries (with custom base URL)
- Supports streaming via Server-Sent Events (SSE)

**Example with OpenAI Python client**:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="not-needed"  # Proxy doesn't require auth
)

response = client.completions.create(
    model="meta-llama/Llama-3.2-1B",
    prompt="Once upon a time",
    max_tokens=100
)
```
