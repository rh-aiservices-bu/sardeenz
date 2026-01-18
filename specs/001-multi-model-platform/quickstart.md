# Quickstart Guide: Sardeenz

**Feature**: 001-multi-model-platform
**Date**: 2025-11-08
**Purpose**: Get the development environment running quickly

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Initial Setup](#initial-setup)
4. [Running in Development](#running-in-development)
5. [Testing the Platform](#testing-the-platform)
6. [Common Tasks](#common-tasks)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- **Node.js**: v22.x (LTS) - [Install via nvm](https://github.com/nvm-sh/nvm)
- **npm**: v10.x (included with Node.js 22)
- **Git**: v2.x
- **NVIDIA GPU**: CUDA-capable GPU with ≥8GB VRAM
- **CUDA Toolkit**: v12.x
- **Docker**: v24.x (for containerized deployment)

### System Requirements

- **OS**: Linux (Ubuntu 22.04+ recommended) or compatible
- **GPU Memory**: ≥8GB VRAM (16GB+ recommended for multiple models)
- **RAM**: ≥16GB (32GB+ recommended)
- **Disk**: ≥50GB free space (for models and dependencies)

### Installing Dependencies

**On Ubuntu 22.04:**

```bash
# Install Node.js 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# Verify installation
node --version  # Should show v22.x.x
npm --version   # Should show v10.x.x

# Install CUDA Toolkit (if not already installed)
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt-get update
sudo apt-get install -y cuda-toolkit-12-4

# Verify CUDA installation
nvidia-smi  # Should show CUDA version 12.x
```

---

## Project Structure

```
sardeenz/
├── apps/                           # Application workspaces
│   ├── backend/                    # Fastify backend (Controller + Proxy)
│   │   ├── src/
│   │   │   ├── server.ts          # Main entry point
│   │   │   ├── routes/            # API route handlers
│   │   │   │   ├── models.ts      # Controller API routes
│   │   │   │   └── proxy.ts       # Proxy API routes
│   │   │   ├── services/          # Business logic
│   │   │   │   ├── model-manager.ts   # vLLM lifecycle management
│   │   │   │   ├── memory-monitor.ts  # kvcached memory monitoring
│   │   │   │   └── metrics.ts         # Prometheus metrics
│   │   │   └── plugins/           # Fastify plugins
│   │   │       ├── auth.ts        # OAuth 2.0 plugin
│   │   │       └── swagger.ts     # OpenAPI plugin
│   │   ├── tests/                 # Backend tests
│   │   │   ├── integration/       # API integration tests
│   │   │   └── unit/              # Unit tests
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── frontend/                   # React + PatternFly UI
│       ├── src/
│       │   ├── main.tsx           # Entry point
│       │   ├── App.tsx            # Root component
│       │   ├── components/        # Reusable components
│       │   │   ├── ModelCard.tsx
│       │   │   ├── MemoryChart.tsx
│       │   │   └── LoadModelDialog.tsx
│       │   ├── pages/             # Page components
│       │   │   ├── Dashboard.tsx  # Main dashboard
│       │   │   └── Models.tsx     # Model management page
│       │   └── services/          # API client services
│       │       └── api.ts         # API wrapper
│       ├── tests/                 # Frontend tests
│       ├── public/                # Static assets
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── packages/                       # Shared packages
│   ├── types/                     # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── models.ts          # Entity types (ModelInstance, etc.)
│   │   │   ├── api.ts             # API request/response types
│   │   │   └── metrics.ts         # Metrics types
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── contracts/                 # OpenAPI schemas
│   │   ├── openapi/
│   │   │   ├── controller-api.yaml
│   │   │   └── proxy-api.yaml
│   │   └── package.json
│   │
│   └── utils/                     # Shared utilities
│       ├── src/
│       │   ├── logger.ts          # Structured logging
│       │   └── validation.ts      # Schema validation
│       ├── package.json
│       └── tsconfig.json
│
├── docker/                        # Docker configuration
│   ├── Dockerfile.backend         # Backend container
│   ├── Dockerfile.frontend        # Frontend container
│   ├── Dockerfile.unified         # All-in-one container for OpenShift
│   └── docker-compose.yml         # Development environment
│
├── docs/                          # Documentation
│   ├── kvcached/                  # kvcached integration docs
│   └── architecture.md            # System architecture (to be created)
│
├── specs/                         # Feature specifications
│   └── 001-multi-model-platform/
│       ├── spec.md                # Feature specification
│       ├── plan.md                # Implementation plan
│       ├── research.md            # Technical research
│       ├── data-model.md          # Data model
│       ├── quickstart.md          # This file
│       └── contracts/             # API contracts
│
├── .github/                       # GitHub configuration
│   └── workflows/
│       └── ci.yml                 # CI/CD pipeline
│
├── package.json                   # Root workspace config
├── tsconfig.base.json             # Shared TypeScript config
├── .eslintrc.json                 # ESLint config
├── .prettierrc.json               # Prettier config
├── .gitignore
├── README.md
└── CLAUDE.md                      # Claude Code guidance
```

### Key Directories

**`apps/backend/`**: Fastify backend server

- Handles Controller API (model lifecycle)
- Handles Proxy API (inference routing)
- Manages vLLM subprocesses
- Integrates with kvcached for memory management

**`apps/frontend/`**: React + PatternFly dashboard

- Model management UI
- Memory usage visualization
- Real-time metrics display

**`packages/types/`**: Shared TypeScript types

- Single source of truth for data structures
- Imported by both backend and frontend
- Ensures type consistency across monorepo

**`packages/contracts/`**: OpenAPI specifications

- API contract definitions
- Used for validation and documentation
- Source for client SDK generation

---

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/rh-aiservices-bu/sardeenz.git
cd sardeenz
```

### 2. Install Dependencies

```bash
# Install all workspace dependencies
npm install

# This installs dependencies for:
# - Root workspace
# - apps/backend
# - apps/frontend
# - packages/types
# - packages/utils
```

### 3. Configure Environment Variables

```bash
# Create environment file for backend
cat > apps/backend/.env <<EOF
# Server Configuration
PORT=3000
NODE_ENV=development

# OAuth 2.0 Configuration
OAUTH_CLIENT_ID=sardeenz
OAUTH_CLIENT_SECRET=change-me-in-production
OAUTH_ISSUER_URL=https://oauth-openshift.apps.example.com
K8S_API_URL=https://api.example.com:6443
JWT_SECRET=change-me-in-production
API_BASE_URL=http://localhost:3000

# vLLM Configuration
VLLM_BASE_PORT=12346
VLLM_MAX_INSTANCES=10

# kvcached Configuration
ENABLE_KVCACHED=true
KVCACHED_AUTOPATCH=1

# Logging
LOG_LEVEL=info
EOF

# Create environment file for frontend
cat > apps/frontend/.env <<EOF
VITE_API_BASE_URL=http://localhost:3000
EOF
```

### 4. Build Shared Packages

```bash
# Build types package (required by backend and frontend)
npm run build -w packages/types

# Build utils package
npm run build -w packages/utils
```

### 5. Type Check

```bash
# Run TypeScript type checking across all workspaces
npm run typecheck
```

---

## Running in Development

### Option 1: Run All Services Concurrently

```bash
# Start backend and frontend in parallel
npm run dev

# This runs:
# - Backend on http://localhost:3000 (API)
# - Frontend on http://localhost:5173 (UI)
```

### Option 2: Run Services Separately

**Terminal 1 - Backend:**

```bash
npm run dev:backend

# Backend starts on http://localhost:3000
# API docs available at http://localhost:3000/docs
```

**Terminal 2 - Frontend:**

```bash
npm run dev:frontend

# Frontend starts on http://localhost:5173
# Proxies API requests to http://localhost:3000
```

### Accessing the Platform

- **Frontend UI**: http://localhost:5173
- **API Documentation**: http://localhost:3000/docs (Swagger UI)
- **Controller API**: http://localhost:3000/api
- **Proxy API**: http://localhost:3000/v1
- **Metrics**: http://localhost:3000/metrics (Prometheus format)

---

## Testing the Platform

### 1. Load Your First Model

**Via API (curl):**

```bash
# Load a small model (Llama 3.2 1B)
curl -X POST http://localhost:3000/api/models/load \
  -H "Content-Type: application/json" \
  -d '{
    "model_path": "meta-llama/Llama-3.2-1B",
    "max_tokens": 4096,
    "gpu_memory_utilization": 0.9
  }'

# Expected response:
# {
#   "status": "success",
#   "model": "meta-llama/Llama-3.2-1B",
#   "port": 12346,
#   "loaded_at": "2025-11-08T10:30:00Z"
# }
```

**Via Frontend UI:**

1. Open http://localhost:5173
2. Click "Load Model" button
3. Enter model path: `meta-llama/Llama-3.2-1B`
4. Click "Load"
5. Wait for model to become "Active" (60-120 seconds)

### 2. Send Inference Request

```bash
# Send completion request via proxy
curl -X POST http://localhost:3000/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-3.2-1B",
    "prompt": "Once upon a time",
    "max_tokens": 50,
    "temperature": 0.7
  }'

# Expected response:
# {
#   "id": "cmpl-123",
#   "object": "text_completion",
#   "created": 1699000000,
#   "model": "meta-llama/Llama-3.2-1B",
#   "choices": [
#     {
#       "text": " there was a young wizard...",
#       "index": 0,
#       "finish_reason": "stop"
#     }
#   ]
# }
```

### 3. Check Memory Usage

```bash
# Get GPU memory usage
curl http://localhost:3000/api/memory/usage

# Expected response:
# {
#   "gpu_total_gb": 24.0,
#   "gpu_used_gb": 8.5,
#   "gpu_free_gb": 15.5,
#   "models": [
#     {
#       "model_path": "meta-llama/Llama-3.2-1B",
#       "gpu_memory_used_gb": 8.0,
#       "gpu_memory_limit_gb": 10.0,
#       "gpu_memory_usage_percent": 80.0,
#       ...
#     }
#   ]
# }
```

### 4. Unload Model

```bash
# Unload the model
curl -X DELETE http://localhost:3000/api/models/meta-llama%2FLlama-3.2-1B

# Expected response:
# {
#   "status": "success",
#   "model": "meta-llama/Llama-3.2-1B",
#   "unloaded_at": "2025-11-08T10:35:00Z"
# }
```

---

## Common Tasks

### Running Tests

```bash
# Run all tests
npm run test --workspaces

# Run backend tests only
npm run test -w apps/backend

# Run frontend tests only
npm run test -w apps/frontend

# Run tests in watch mode
npm run test:watch -w apps/backend
```

### Linting and Formatting

```bash
# Run ESLint
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Run Prettier
npm run format

# Check formatting without modifying files
npm run format:check
```

### Building for Production

```bash
# Build all workspaces
npm run build --workspaces

# Build backend only
npm run build -w apps/backend

# Build frontend only
npm run build -w apps/frontend
```

### Running Production Build Locally

```bash
# Start backend in production mode
npm run start -w apps/backend

# Serve frontend build (requires serve package)
npx serve apps/frontend/dist
```

### Monitoring kvcached

```bash
# List all kvcached IPC segments
kvctl list

# Monitor memory usage in real-time
kvtop

# Get detailed info on a specific segment
kvctl info VLLM_META_LLAMA_LLAMA_3_2_1B

# Set memory limit for a model
kvctl limit VLLM_META_LLAMA_LLAMA_3_2_1B 10G
```

### Checking Logs

```bash
# Backend logs (structured JSON)
tail -f apps/backend/logs/app.log

# vLLM instance logs
# Logs are written to backend process stdout/stderr
# Check backend logs for vLLM output
```

---

## Troubleshooting

### Model Fails to Load

**Symptom**: Model status stays "starting" or transitions to "failed"

**Possible Causes**:

1. Insufficient GPU memory
2. Model path incorrect or inaccessible
3. kvcached not enabled
4. vLLM binary not in PATH

**Solutions**:

```bash
# Check GPU memory
nvidia-smi

# Verify vLLM installation
which vllm
vllm --version

# Check kvcached environment variables
echo $ENABLE_KVCACHED  # Should be "true"
echo $KVCACHED_AUTOPATCH  # Should be "1"

# Check backend logs for errors
tail -f apps/backend/logs/app.log | grep ERROR

# Try loading a smaller model first
curl -X POST http://localhost:3000/api/models/load \
  -H "Content-Type: application/json" \
  -d '{"model_path": "Qwen/Qwen3-0.6B"}'
```

### Port Already in Use

**Symptom**: Backend fails to start with "EADDRINUSE" error

**Solution**:

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or change backend port in apps/backend/.env
PORT=3001
```

### Frontend Cannot Connect to Backend

**Symptom**: Frontend shows "Network Error" or CORS errors

**Solution**:

```bash
# Ensure backend is running
curl http://localhost:3000/api/models

# Check Vite proxy configuration in apps/frontend/vite.config.ts
# Should proxy /api and /v1 to backend

# If using different ports, update VITE_API_BASE_URL in apps/frontend/.env
```

### TypeScript Errors After Installing Dependencies

**Symptom**: Type errors in IDE or during build

**Solution**:

```bash
# Rebuild types package
npm run build -w packages/types

# Clear TypeScript cache
rm -rf apps/backend/.tsbuildinfo apps/frontend/.tsbuildinfo

# Restart TypeScript server in VS Code
# Cmd/Ctrl + Shift + P → "TypeScript: Restart TS Server"
```

### kvcached Segments Not Cleaned Up

**Symptom**: IPC segments remain after unloading models

**Solution**:

```bash
# List all segments
kvctl list

# Manually delete specific segment
kvctl delete VLLM_META_LLAMA_LLAMA_3_2_1B

# Delete all vLLM segments (CAUTION)
kvctl list | grep VLLM | awk '{print $1}' | xargs -I {} kvctl delete {}
```

---

## Next Steps

1. **Read Architecture Documentation**: `docs/architecture.md` (to be created)
2. **Review API Contracts**: `specs/001-multi-model-platform/contracts/`
3. **Explore Data Model**: `specs/001-multi-model-platform/data-model.md`
4. **Run Integration Tests**: See `apps/backend/tests/integration/`
5. **Deploy to Container**: See `docker/docker-compose.yml`

---

## Getting Help

- **Project Documentation**: `/docs` directory
- **API Documentation**: http://localhost:3000/docs (when backend is running)
- **kvcached Docs**: `/docs/kvcached` directory
- **Issue Tracker**: https://github.com/rh-aiservices-bu/sardeenz/issues
