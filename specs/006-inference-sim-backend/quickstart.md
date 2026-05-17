# Quickstart: Inference Simulator Backend

## Prerequisites

1. **Install llm-d-inference-sim**: Build from source (Go 1.22+ required):
   ```bash
   git clone https://github.com/llm-d/llm-d-inference-sim.git
   cd llm-d-inference-sim
   make build
   sudo cp bin/llm-d-inference-sim /usr/local/bin/
   ```

   Or use a pre-built release:
   ```bash
   # Check https://github.com/llm-d/llm-d-inference-sim/releases for latest
   ```

2. **Verify installation**:
   ```bash
   llm-d-inference-sim --help
   ```

## Single Pod (GPU-Free)

Start the backend with inference-sim mode:

```bash
cd apps/backend
INFERENCE_BACKEND=inference-sim npm run dev
```

The backend starts without GPU/NVML dependencies and creates 1 simulated GPU with 24 GB memory.

Load a model via the dashboard at `http://localhost:5173` or via API:

```bash
curl -X POST http://localhost:3000/api/models \
  -H "Content-Type: application/json" \
  -d '{"modelPath": "meta-llama/Llama-3.2-7B-Instruct"}'
```

The model loads in ~3 seconds (simulated) and reports ~14 GB memory usage (estimated from "7B" in the name).

## Multi-Pod Cluster (GPU-Free)

Start 2 pods with cluster configuration:

```bash
# Terminal 1: Pod A
PORT=3001 \
INFERENCE_BACKEND=inference-sim \
DEV_VIRTUAL_GPU_COUNT=2 \
SIM_GPU_MEMORY_GB=24 \
CLUSTER_PEERS=localhost:3001,localhost:3002 \
CLUSTER_SECRET=$(openssl rand -hex 32) \
npm run dev -w apps/backend

# Terminal 2: Pod B (same CLUSTER_SECRET)
PORT=3002 \
INFERENCE_BACKEND=inference-sim \
DEV_VIRTUAL_GPU_COUNT=2 \
SIM_GPU_MEMORY_GB=24 \
CLUSTER_PEERS=localhost:3001,localhost:3002 \
CLUSTER_SECRET=<same-secret-as-above> \
npm run dev -w apps/backend
```

Open the dashboard pointing at either pod. Load models, verify cross-pod routing, test model moves.

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_BACKEND` | `vllm` | `vllm` or `inference-sim` |
| `SIM_GPU_MEMORY_GB` | `24` | Memory per simulated GPU (GB) |
| `SIM_MODEL_MEMORY_GB` | `4` | Default model memory estimate (GB) |
| `SIM_STARTUP_DURATION` | `3s` | Simulated model loading time |
| `INFERENCE_SIM_BINARY` | `llm-d-inference-sim` | Path to the binary |
| `DEV_VIRTUAL_GPU_COUNT` | `0` (1 in sim mode) | Number of simulated GPUs |

## Verifying It Works

1. **Health check**: `curl http://localhost:3000/api/health` — should return `{ "status": "healthy" }`
2. **GPU info**: `curl http://localhost:3000/api/gpu/info` — should show simulated GPU(s)
3. **Load model**: POST to `/api/models` — should complete in ~3 seconds
4. **Memory usage**: `curl http://localhost:3000/api/memory/usage` — should show estimated model memory
5. **Inference**: `curl http://localhost:3000/v1/chat/completions -d '{"model":"meta-llama/Llama-3.2-7B-Instruct","messages":[{"role":"user","content":"hello"}]}'` — should return synthetic response
