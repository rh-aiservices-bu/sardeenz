# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**sardeenz** is a multi-model management platform that enables dynamic loading, management, and serving of multiple Large Language Models (LLMs) through a unified interface. Built on top of vLLM (inference engine) and KVCached (GPU memory sharing), it allows efficient multi-model hosting on a single GPU.

**Core Components:**
- **Controller API**: Dynamically load/unload models, query status, manage GPU memory (Fastify + TypeScript)
  - Real-time model load progress via SSE events
  - Intelligent error extraction from vLLM logs
- **Unified Proxy**: Single endpoint for all inference requests with OpenAI-compatible API (<50ms routing overhead target)
- **Admin Dashboard**: React + PatternFly 6 web interface for model management and monitoring
- **Container Deployment**: Unified CUDA + Node.js container image for OpenShift/Kubernetes

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

**GPU Setup:** On first run, the backend auto-creates a Python venv with vLLM/KVCached. See [`docs/dev-setup.md`](./docs/dev-setup.md) for details.

## Architecture

This project uses an npm workspace monorepo structure:
- `apps/backend` - Fastify backend (Controller API + Proxy)
- `apps/frontend` - React + PatternFly dashboard
- `packages/types` - Shared TypeScript types
- `packages/contracts` - OpenAPI schemas
- `packages/utils` - Shared utilities

**Key Design Decisions:**
- Direct vLLM subprocess management (no Docker-in-Docker) for zero-downtime model loading
- Stateless architecture (in-memory storage for PoC phase)
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
docker build -t sardeenz .
docker run --gpus all -p 3000:3000 sardeenz
```

## Documentation

- [`docs/dev-setup.md`](./docs/dev-setup.md) - GPU development environment setup (vLLM, KVCached, uv)
- [`docs/architecture.md`](./docs/architecture.md) - Detailed system architecture and design
- [`docs/api-guide.md`](./docs/api-guide.md) - API usage examples and integration patterns
- [`docs/deployment.md`](./docs/deployment.md) - Container and OpenShift deployment guide
- [`docs/kvcached/`](./docs/kvcached/) - KVCached GPU memory sharing documentation
- [`specs/001-multi-model-platform/`](./specs/001-multi-model-platform/) - Design specifications and planning

## Active Technologies

- TypeScript 5.7+ (strict mode) with Node.js 22.x (backend), ES2022 target (001-multi-model-platform)
- In-memory storage for PoC phase (Map data structures for ModelInstance, ResourceMetrics, InferenceRequest logs, ControllerOperation audit trail). Future: Config file for ModelConfiguration catalog, optional database for persistence. (001-multi-model-platform)

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

## Recent Changes

- 001-multi-model-platform: Fixed GPU memory visualization for duplicate model instances
  - Added `instance_id` field to `/api/memory/usage` response for unique identification
  - Display names now include suffix for duplicates: "SmolLM2-135M", "SmolLM2-135M (2)", etc.
  - Colors are now derived from instance ID (not model path) for distinct per-instance colors
  - Fixed chart animation/flickering caused by key collisions when same model loaded multiple times
- 001-multi-model-platform: Fixed GPU memory tracking by extracting vLLM EngineCore PID from logs
  - vLLM spawns API Server (no GPU) and EngineCore (allocates VRAM) as separate processes
  - New `engineCorePid` field in `ModelInstance` stores the GPU-using process PID
  - Memory monitor now uses EngineCore PID for accurate per-model GPU breakdown
- 001-multi-model-platform: Added GPU/KVCache memory visualization panel on Model Management page using Nivo charts
  - Two stacked horizontal bars: KVCache (shared pool) and GPU (per-model breakdown)
  - Configurable refresh interval (None, 5s, 15s, 30s, 1m)
  - Color-coded per-model memory segments with tooltips
- 001-multi-model-platform: Enhanced `/api/memory/usage` endpoint with KVCache metrics and per-model GPU breakdown
- 001-multi-model-platform: Added memory metrics parsing from vLLM logs (weights, CUDA graphs, KV cache) with frontend modal display
- 001-multi-model-platform: Implemented async model loading with SSE event streaming, process log buffer, and intelligent error parsing
- 001-multi-model-platform: Added TypeScript 5.7+ (strict mode) with Node.js 22.x (backend), ES2022 target
- 001-multi-model-platform: Added in-memory storage for PoC phase (Map data structures)
