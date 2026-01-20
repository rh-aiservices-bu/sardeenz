# Sardeenz Documentation

Welcome to the Sardeenz documentation! This directory contains comprehensive guides for understanding, developing, deploying, and using the platform.

## Quick Navigation

### 📚 Core Documentation

| Document                                                             | Description                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [**Architecture Overview**](./architecture.md)                       | High-level system architecture, design decisions, and technical details |
| [**Backend Architecture**](./architecture/backend-architecture.md)   | Detailed backend components, flows, and process management              |
| [**Frontend Architecture**](./architecture/frontend-architecture.md) | Frontend component specs, state management, and API integration         |
| [**API Guide**](./api-guide.md)                                      | API reference with code examples for Controller and Proxy APIs          |
| [**Deployment Guide**](./deployment.md)                              | Container building and OpenShift/Kubernetes deployment                  |
| [**RBAC Setup**](./rbac-setup.md)                                    | Kubernetes-native RBAC configuration for OAuth authentication           |

### 🛠️ Development Guides

| Resource                                                        | Description                                     |
| --------------------------------------------------------------- | ----------------------------------------------- |
| [**Development Guide**](./development/README.md)                | Getting started with local development          |
| [**GPU Setup**](./dev-setup.md)                                 | GPU environment setup (vLLM, kvcached, uv)      |
| [**PatternFly 6 Guide**](./development/pf6-guide/README.md)     | Complete UI development guide with PatternFly 6 |
| [**Frontend API Client**](./development/frontend-api-client.md) | API client integration for the frontend         |

### 🔧 Technical Resources

| Resource                                                 | Description                                                |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| [**kvcached**](./kvcached/)                              | GPU memory sharing documentation and setup guides          |
| [**Specifications**](../specs/001-multi-model-platform/) | Design specifications, planning documents, and data models |
| [**Changelog**](../CHANGELOG.md)                         | Project change history                                     |

### 🚀 Getting Started

**New to Sardeenz?** Start here:

1. **Quick Deploy**
   - Pre-built images at `quay.io/rh-aiservices-bu/sardeenz`
   - See [deployment.md](./deployment.md) for OpenShift/Kubernetes setup

2. **Understand the Project**
   - Read the [main README](../README.md) for overview
   - Review [architecture.md](./architecture.md) for system design

3. **Develop Locally**
   - Follow the [Development Guide](./development/README.md)
   - See [GPU Setup](./dev-setup.md) for vLLM/kvcached configuration

4. **Use the APIs**
   - Explore [api-guide.md](./api-guide.md) for API examples
   - Test with provided code snippets (Python, JavaScript, curl)

## Documentation by Role

### 🧑‍💻 Developers

**Building features and fixing bugs?**

- [Development Guide](./development/README.md) - Local setup, commands, project structure
- [Architecture Overview](./architecture.md) - Understand system components and data flow
- [Backend Architecture](./architecture/backend-architecture.md) - Backend component details
- [Frontend Architecture](./architecture/frontend-architecture.md) - Frontend component specs
- [API Guide](./api-guide.md#code-examples) - Integration code examples
- [Specifications](../specs/001-multi-model-platform/spec.md) - Feature requirements

**Key Files:**

- `apps/backend/` - Fastify backend source code
- `apps/frontend/` - React + PatternFly dashboard
- `packages/types/` - Shared TypeScript types

### 🏗️ DevOps Engineers

**Deploying and managing the platform?**

- [Deployment Guide](./deployment.md) - Container build and OpenShift deployment
- [RBAC Setup Guide](./rbac-setup.md) - Kubernetes-native RBAC for OAuth authentication
- [Deployment Guide: Configuration](./deployment.md#configuration) - Environment variables
- [Deployment Guide: Monitoring](./deployment.md#monitoring) - Prometheus metrics setup
- [Deployment Guide: Troubleshooting](./deployment.md#troubleshooting) - Common issues

**Key Resources:**

- GPU-enabled OpenShift cluster setup
- App Data PVC (required for SQLite)
- Model storage: HuggingFace cache PVC or local/mounted models (see [deployment/README.md](../deployment/README.md#storage-configuration))
- OAuth 2.0 integration with Kubernetes RBAC (see [rbac-setup.md](./rbac-setup.md))

### 📊 Data Scientists / ML Engineers

**Loading and using models?**

- [API Guide: Controller API](./api-guide.md#controller-api) - Load/unload models
- [API Guide: Model Move API](./api-guide.md#model-move-api) - Move models between GPUs without downtime
- [API Guide: Proxy API](./api-guide.md#proxy-api) - Inference requests (OpenAI-compatible)
- [kvcached Documentation](./kvcached/) - GPU memory sharing for multi-model hosting
- [Architecture: Memory Management](./architecture.md#memory-management) - GPU allocation strategy

**Supported Models:**

- Any model compatible with vLLM (Llama, Mistral, Qwen, etc.)
- HuggingFace format or local paths

### 🎨 Frontend Developers

**Working on the dashboard?**

- [Frontend Architecture](./architecture/frontend-architecture.md) - Component specs and state management
- [PatternFly 6 Guide](./development/pf6-guide/README.md) - Complete local UI development guide
- [Frontend API Client](./development/frontend-api-client.md) - API client integration
- [PatternFly 6 Documentation](https://www.patternfly.org/v6/) - Official UI component library
- [CLAUDE.md](../CLAUDE.md#common-commands) - Frontend development commands

**Key Files:**

- `apps/frontend/src/components/` - Reusable UI components
- `apps/frontend/src/pages/` - Page-level components
- `apps/frontend/src/hooks/` - Custom React hooks

## Document Index

### Architecture & Design

| Document                                                                         | Topics Covered                                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)                                             | System overview, technology stack, component architecture, data model, security, performance |
| [architecture/backend-architecture.md](./architecture/backend-architecture.md)   | Backend components, model loading flows, process management, GPU memory tracking             |
| [architecture/frontend-architecture.md](./architecture/frontend-architecture.md) | Frontend components, state management, routing, API integration, real-time updates           |
| [specs/spec.md](../specs/001-multi-model-platform/spec.md)                       | Feature requirements, priorities, user stories                                               |
| [specs/plan.md](../specs/001-multi-model-platform/plan.md)                       | Implementation plan, milestones, timeline                                                    |
| [specs/data-model.md](../specs/001-multi-model-platform/data-model.md)           | Entity schemas, relationships, validation rules                                              |

### API & Integration

| Document                                                         | Topics Covered                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [api-guide.md](./api-guide.md)                                   | Controller API (load/unload/move models), Proxy API (inference), authentication, error handling, code examples (Python, JavaScript, curl) |
| [specs/contracts/](../specs/001-multi-model-platform/contracts/) | OpenAPI 3.1 specifications (when available)                                                                                          |

### Deployment & Operations

| Document                         | Topics Covered                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [deployment.md](./deployment.md) | Container build, Docker Compose, OpenShift deployment, configuration, health checks, monitoring, troubleshooting |
| [rbac-setup.md](./rbac-setup.md) | Kubernetes-native RBAC setup for OAuth mode, Role/RoleBinding configuration, ServiceAccount permissions          |
| [kvcached/](./kvcached/)         | kvcached installation, configuration, memory segment management                                                  |

### Development Guides

| Document                                                                   | Topics Covered                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [development/README.md](./development/README.md)                           | Local setup, prerequisites, project structure, development commands           |
| [dev-setup.md](./dev-setup.md)                                             | GPU development environment, vLLM setup, kvcached configuration               |
| [development/pf6-guide/](./development/pf6-guide/README.md)                | PatternFly 6 components, styling standards, testing patterns, troubleshooting |
| [development/frontend-api-client.md](./development/frontend-api-client.md) | Axios setup, API client patterns, error handling                              |

### Project Management

| Document                                                               | Topics Covered                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [CLAUDE.md](../CLAUDE.md)                                              | Project overview, quick start, common commands, active technologies |
| [CHANGELOG.md](../CHANGELOG.md)                                        | Project change history, feature additions, bug fixes                |
| [specs/quickstart.md](../specs/001-multi-model-platform/quickstart.md) | Developer quickstart guide                                          |

## Key Concepts

### Controller API

The **Controller API** manages the lifecycle of model instances:

- **Load models** dynamically without downtime
- **Unload models** to free GPU memory
- **Query status** of all running models
- **Monitor metrics** (GPU usage, request counts)

**Base URL:** `http://localhost:3000/api/v1/`

**Authentication:** OAuth 2.0 with RBAC (`admin`, `admin-readonly` roles)

### Proxy API

The **Proxy API** provides a unified inference endpoint:

- **OpenAI-compatible** format (drop-in replacement)
- **Routes requests** to the correct model instance
- **Streaming support** via Server-Sent Events (SSE)
- **<50ms routing overhead** (performance target)

**Base URL:** `http://localhost:8000/v1/`

**Compatible with:** OpenAI Python SDK, OpenAI JavaScript SDK, curl

### kvcached

**kvcached** is a GPU memory sharing tool that enables multiple vLLM instances to coexist on a single GPU:

- **IPC segments** for shared KV cache
- **Memory limits** enforced per model
- **Dynamic allocation** based on demand

See [kvcached/README.md](./kvcached/README.md) for detailed setup instructions.

### Model Instance Lifecycle

```
┌─────────────┐
│   STARTING  │  ← Model loading, process spawning
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   ACTIVE    │  ← Serving requests, healthy
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   STOPPING  │  ← Graceful shutdown
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   STOPPED   │  ← Process terminated, memory freed
└─────────────┘

       ┌─────────────┐
       │   FAILED    │  ← Error during startup or runtime
       └─────────────┘
```

## Performance Targets

| Metric                     | Target                     | Status      |
| -------------------------- | -------------------------- | ----------- |
| **Proxy Routing Overhead** | <50ms (p95)                | 🔴 CRITICAL |
| **Model Load Time**        | <60s (1-3B params)         | 🟡 Target   |
| **Model Unload Time**      | <30s                       | 🟡 Target   |
| **Concurrent Models**      | 3-5 (24GB GPU)             | 🟡 Target   |
| **Request Throughput**     | vLLM native + <5% overhead | 🟡 Target   |

## FAQ

<details>
<summary><strong>Can I use this with non-NVIDIA GPUs?</strong></summary>

No, vLLM and kvcached require NVIDIA GPUs with CUDA support. AMD GPUs (ROCm) are not currently supported.

</details>

<details>
<summary><strong>Is this compatible with the OpenAI Python SDK?</strong></summary>

Yes! The Proxy API is OpenAI-compatible. Just point your OpenAI client to the proxy URL:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8000/v1", api_key="not-needed")
```

</details>

<details>
<summary><strong>How many models can I run simultaneously?</strong></summary>

It depends on your GPU memory. Example on a 24GB GPU:

- 3-5 small models (1-3B params)
- 2-3 medium models (7B params)
- 1 large model (13B+ params) + 1-2 small models

Use kvcached to optimize memory sharing.

</details>

<details>
<summary><strong>Can I deploy this on CPU-only machines?</strong></summary>

No, vLLM requires GPU acceleration. CPU-only inference is not supported.

</details>

<details>
<summary><strong>Is persistent storage required?</strong></summary>

Yes, an App Data PVC (1Gi) is required for the SQLite database that stores benchmarks and memory profiles. For models, you can either:

- Use a Model Cache PVC for HuggingFace downloads (optional)
- Mount pre-downloaded models via `LOCAL_MODELS_PATH` (optional)
- Or use both sources simultaneously

See [deployment/README.md Storage Configuration](../deployment/README.md#storage-configuration) for details.

</details>

<details>
<summary><strong>How do I enable authentication?</strong></summary>

Set the `AUTH_MODE` environment variable:

**Simple Mode** (username/password):

- `AUTH_MODE=simple`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=<your-password>`
- `JWT_SECRET=<your-secret>`

**OAuth Mode** (OpenShift):

- `AUTH_MODE=oauth`
- `OAUTH_ISSUER_URL=<your-openshift-oauth-url>`
- `OAUTH_CLIENT_ID=sardeenz`
- `OAUTH_CLIENT_SECRET=<client-secret>`
- `K8S_API_URL=<kubernetes-api-url>`
- `JWT_SECRET=<your-secret>`

Roles are assigned via Kubernetes RoleBindings. See [rbac-setup.md](./rbac-setup.md) for complete RBAC configuration.

See [api-guide.md](./api-guide.md#authentication) and [deployment.md](./deployment.md#configuration) for details.

</details>

## Contributing

This project follows the principles defined in [`.specify/memory/constitution.md`](../specs/001-multi-model-platform/):

- **Type Safety**: TypeScript strict mode
- **Performance-First**: <50ms routing overhead
- **API-First Design**: OpenAPI 3.1 specifications
- **Security by Design**: OAuth 2.0 + RBAC
- **Observability**: Prometheus metrics, structured logging

Before contributing, read:

1. [Architecture](./architecture.md) - System design
2. [Specifications](../specs/001-multi-model-platform/spec.md) - Feature requirements
3. [CLAUDE.md](../CLAUDE.md) - Development setup

## Support

- **Issues**: [GitHub Issues](https://github.com/rh-aiservices-bu/sardeenz/issues) (if public repo)
- **Specifications**: See [specs/001-multi-model-platform/](../specs/001-multi-model-platform/)
- **Documentation**: This directory

## License

_To be determined_

---

**Last Updated:** 2025-11-11
**Project Status:** Early Development (001-multi-model-platform)
