<p align="center">
  <img src="assets/sardeenz.png" alt="Sardeenz Logo" width="300">
</p>

# Sardeenz

Multi-model vLLM management platform with dynamic loading and unified inference proxy.

> **Status:** Early development (PoC phase)

## What is Sardeenz?

Sardeenz is a multi-model management platform that enables dynamic loading, management, and serving of multiple Large Language Models (LLMs) through a unified interface. Built on top of **vLLM** (inference engine) and **KVCached** (GPU memory sharing), it allows efficient multi-model hosting on a single GPU.

### Core Components

- **Controller API** - Dynamically load/unload models, query status, manage GPU memory
- **Unified Proxy** - Single endpoint for all inference requests with OpenAI-compatible API
- **Admin Dashboard** - Web interface for model management and monitoring

## Prerequisites

- Node.js 22.x
- npm 10.x+
- NVIDIA GPU with CUDA 12.x
- 8GB+ VRAM (16GB+ recommended for multiple models)
- Python 3.12 + [uv](https://docs.astral.sh/uv/) (for vLLM)

## Quick Start

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

## Project Structure

This project uses an npm workspace monorepo:

```
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

## Development Commands

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

## Documentation

- [GPU Development Setup](./docs/dev-setup.md) - Local GPU environment with vLLM/KVCached
- [Architecture](./docs/architecture.md) - System design and key decisions
- [API Guide](./docs/api-guide.md) - API usage and integration patterns
- [Deployment](./docs/deployment.md) - Container and OpenShift deployment
- [KVCached Integration](./docs/kvcached/) - GPU memory sharing documentation

## License

Apache-2.0
