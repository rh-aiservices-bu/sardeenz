# Development Guide

This guide covers setting up a local development environment for contributing to Sardeenz.

## Prerequisites

- **Node.js 22.x** with npm 10.x+
- **Python 3.12** + [uv](https://docs.astral.sh/uv/) (for vLLM)
- **NVIDIA GPU** with CUDA 12.x and 8GB+ VRAM (16GB+ recommended for multiple models)

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

On first run, the backend will automatically set up a Python virtual environment with vLLM and kvcached.

**GPU Development:** See [GPU Setup Guide](../dev-setup.md) for detailed GPU configuration, model recommendations, and troubleshooting.

## Project Structure

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

## Development Commands

```bash
# Build all packages
npm run build

# Run all tests
npm run test

# Lint all workspaces
npm run lint

# Type checking
npm run typecheck

# Start individual workspaces
npm run dev -w apps/backend
npm run dev -w apps/frontend
```

## Component-Specific Guides

| Component        | Guide                                                    | Description                                               |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| **Backend**      | [apps/backend/CLAUDE.md](../../apps/backend/CLAUDE.md)   | Backend architecture, API patterns, process management    |
| **Frontend**     | [apps/frontend/CLAUDE.md](../../apps/frontend/CLAUDE.md) | React patterns, PatternFly 6 components, state management |
| **GPU Setup**    | [dev-setup.md](../dev-setup.md)                          | vLLM, kvcached, Python environment                        |
| **PatternFly 6** | [pf6-guide/](./pf6-guide/README.md)                      | UI component guide and best practices                     |
| **API Client**   | [frontend-api-client.md](./frontend-api-client.md)       | Frontend API integration                                  |

## See Also

- [Full Documentation](../README.md) - Complete documentation index
- [Architecture Overview](../architecture.md) - System design and components
- [API Guide](../api-guide.md) - API reference with code examples
