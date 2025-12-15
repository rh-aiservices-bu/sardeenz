<p align="center">
  <img src="assets/sardeenz.png" alt="Sardeenz Logo" width="300">
</p>

# Sardeenz

Multi-model vLLM management platform with dynamic loading and unified inference proxy.

> **Status:** Early development (PoC phase)

## What is Sardeenz?

Sardeenz is a multi-model management platform that enables dynamic loading, management, and serving of multiple Large Language Models (LLMs) through a unified interface. Built on top of **vLLM** (inference engine) and **KVCached** (GPU memory sharing), it provides efficient multi-model hosting with intelligent GPU resource management.

### Core Components

- **Controller API** - Dynamically load/unload models, query status, manage GPU memory across multiple GPUs
- **Unified Proxy** - Single endpoint for all inference requests with OpenAI-compatible API
- **Admin Dashboard** - Web interface for model management, monitoring, benchmarking, and inference testing

### Key Features

#### Model Management

- Dynamic model loading/unloading with real-time progress tracking (SSE)
- Support for Hugging Face models and local model sources
- Multiple instances of the same model
- Model configuration presets (save/load model sets with GPU assignments)
- Sequential loading with GPU conflict detection

#### GPU & Memory

- Multi-GPU support with tensor parallelism
- Intelligent GPU selection based on available memory
- KVCached integration for shared GPU memory across model instances
- Detailed per-GPU memory breakdown and utilization tracking

#### Performance & Monitoring

- OpenAI-compatible inference API with <50ms routing overhead target
- Model benchmarking with latency/throughput metrics
- Memory profiling for capacity planning
- Real-time GPU resource visualization
- Comprehensive logging with error extraction

#### Deployment

- Single-process container (Fastify serves API + static frontend)
- OpenShift/Kubernetes ready with health probes
- Prometheus metrics exposure

## Screenshots

### Model Management Dashboard

![Model Management Dashboard](img/dashboard.png)

### GPU Memory Visualization

![GPU Memory Visualization](img/gpu-memory.png)

### Model Configuration/Loading

![Model Configuration](img/model-config.png)

### Model Loading Progress

![Model Loading Progress](img/model-loading.png)

## Development

### Prerequisites

- Node.js 22.x
- npm 10.x+
- NVIDIA GPU with CUDA 12.x
- 8GB+ VRAM (16GB+ recommended for multiple models)
- Python 3.12 + [uv](https://docs.astral.sh/uv/) (for vLLM)

### Quick Start

```bash
# Install dependencies
npm install

# Build shared packages
npm run build -w packages/types
npm run build -w packages/utils

# Start development servers (backend:3000, frontend:5173)
npm run dev
```

On first run, the backend will automatically set up a Python virtual environment with vLLM and KVCached.

**GPU Development:** See [docs/dev-setup.md](./docs/dev-setup.md) for detailed GPU setup, model recommendations, and troubleshooting.

### Project Structure

This project uses an npm workspace monorepo:

```txt
sardeenz/
├── apps/
│   ├── backend/     # Fastify backend (Controller API + Proxy)
│   └── frontend/    # React + PatternFly 6 dashboard
├── packages/
│   ├── types/       # Shared TypeScript types
│   ├── contracts/   # OpenAPI schemas
│   └── utils/       # Shared utilities
└── docs/            # Documentation
```

### Development Commands

```bash
# Build all packages
npm run build

# Run all tests
npm run test

# Lint all workspaces
npm run lint

# Start individual workspaces
npm run dev -w apps/backend
npm run dev -w apps/frontend

# Type checking
npm run typecheck
```

### Documentation

📖 **[Full Documentation](./docs/README.md)** - Complete documentation index

#### Quick Links

| Category | Documents |
|----------|-----------|
| **Architecture** | [Overview](./docs/architecture.md) · [Backend](./docs/architecture/backend-architecture.md) · [Frontend](./docs/architecture/frontend-architecture.md) |
| **Development** | [GPU Setup](./docs/dev-setup.md) · [PatternFly 6 Guide](./docs/development/pf6-guide/README.md) · [API Client](./docs/development/frontend-api-client.md) |
| **Operations** | [API Guide](./docs/api-guide.md) · [Deployment](./docs/deployment.md) · [KVCached](./docs/kvcached/) |
| **Project** | [Changelog](./CHANGELOG.md) · [Specifications](./specs/001-multi-model-platform/) |

## License

Apache-2.0
