# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**sardeenz** is a multi-model management platform that enables dynamic loading, management, and serving of multiple Large Language Models (LLMs) through a unified interface. Built on top of vLLM (inference engine) and kvcached (GPU memory sharing), it allows efficient multi-model hosting on a single GPU.

**Core Components:**

- **Controller API**: Dynamically load/unload models, query status, manage GPU memory (Fastify + TypeScript)
  - Real-time model load progress via SSE events
  - Intelligent error extraction from vLLM logs
  - LLM benchmarking with latency/throughput metrics
  - Memory profiling for capacity planning
  - Multi-GPU support with tensor parallelism and intelligent GPU selection
  - Model configuration presets (save/load model sets with GPU assignments)
- **Unified Proxy**: Single endpoint for all inference requests with OpenAI-compatible API (<50ms routing overhead target)
- **Admin Dashboard**: React + PatternFly 6 web interface for model management, monitoring, and benchmarking
- **Container Deployment**: Unified single-process container (Fastify serves API + frontend) for OpenShift/Kubernetes
- **Authentication**: Dual-auth model separating admin (JWT) from inference (optional API key)
  - Admin: Three modes (`none`, `simple`, `oauth`) via `AUTH_MODE` for dashboard/controller API
  - Inference: Optional `INFERENCE_API_KEY` for OpenAI-compatible endpoints (`/v1/*`)

**Documentation:** See [`docs/`](./docs/) for detailed architecture, API guides, and deployment instructions.

## Quick Start

```bash
# Install dependencies
npm install

# Build shared packages
npm run build -w packages/types
npm run build -w packages/utils

# Start development servers (backend + frontend)
npm run dev
```

**Prerequisites:** Node.js 22.x, Python 3.12 + uv, NVIDIA GPU with CUDA 12.x, 8GB+ VRAM (16GB+ recommended)

**GPU Setup:** On first run, the backend auto-creates a Python venv with vLLM/kvcached. See [`docs/dev-setup.md`](./docs/dev-setup.md) for details.

## Architecture

This project uses an npm workspace monorepo structure:

- `apps/backend` - Fastify backend (Controller API + Proxy)
- `apps/frontend` - React + PatternFly dashboard
- `packages/types` - Shared TypeScript types
- `packages/contracts` - OpenAPI schemas
- `packages/utils` - Shared utilities

**Key Design Decisions:**

- Direct vLLM subprocess management (no Docker-in-Docker) for zero-downtime model loading
- Hybrid storage: in-memory for runtime state, SQLite for benchmarks/profiles persistence
- OpenAI-compatible API via vLLM native format
- Performance-first proxy with TCP passthrough (<50ms routing overhead)

For detailed architecture documentation, see [`docs/architecture.md`](./docs/architecture.md).

## Common Commands

```bash
# Workspace management
npm install                          # Install all dependencies
npm run build                        # Build all packages
npm run dev                          # Start dev servers (backend:3000, frontend:5173)
npm run test                         # Run all tests
npm run lint                         # Lint all workspaces

# Individual workspace commands
npm run build -w packages/types      # Build specific package
npm run dev -w apps/backend          # Start backend only
npm run dev -w apps/frontend         # Start frontend only

# Container operations
make build VERSION=x.y.z           # Build image as quay.io/rh-aiservices-bu/sardeenz:x.y.z
make push VERSION=x.y.z            # Push to registry
```

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) - System architecture overview
- [`docs/architecture/backend-architecture.md`](./docs/architecture/backend-architecture.md) - Backend component details
- [`docs/architecture/frontend-architecture.md`](./docs/architecture/frontend-architecture.md) - Frontend component details
- [`docs/dev-setup.md`](./docs/dev-setup.md) - GPU development environment setup
- [`docs/api-guide.md`](./docs/api-guide.md) - API usage examples
- [`docs/deployment.md`](./docs/deployment.md) - Container and OpenShift deployment
- [`docs/kvcached/`](./docs/kvcached/) - kvcached GPU memory sharing
- [`CHANGELOG.md`](./CHANGELOG.md) - Project change history

## Active Technologies

- TypeScript 5.7+ (strict mode) with Node.js 22.x, ES2022 target
- Fastify 5.1+ (backend), React 18 + PatternFly 6 (frontend)
- SQLite (better-sqlite3) for persistence, in-memory Maps for runtime state

## Component-Specific Context

For detailed context specific to backend or frontend development:

- **Backend**: See [backend/CLAUDE.md](apps/backend/CLAUDE.md)
- **Frontend**: See [frontend/CLAUDE.md](apps/frontend/CLAUDE.md)

### Context7 Usage Guidelines

⚠️ **Important for AI tools using Context7**:

- ✅ **Use Context7 for**: Backend libraries, non-UI frontend libraries (React, Axios,...)
- ❌ **Don't use Context7 for**: PatternFly 6 components. use `docs/development/pf6-guide/` + PatternFly.org instead)
- ✅ **Use `docs/development/pf6-guide/` + PatternFly.org** for Patternfly 6 components

Context7 may contain outdated PatternFly versions. For all PatternFly 6 UI development, refer to the local PF6 guide and official PatternFly.org documentation.
