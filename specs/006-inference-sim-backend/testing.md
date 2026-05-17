# Testing the Inference-Sim Backend

## 1. Install the binary

```bash
git clone https://github.com/llm-d/llm-d-inference-sim.git
cd llm-d-inference-sim
make build
sudo cp bin/llm-d-inference-sim /usr/local/bin/
llm-d-inference-sim --help  # verify
```

## 2. Single pod

```bash
INFERENCE_BACKEND=inference-sim npm run dev -w apps/backend
```

**Health check:**
```bash
curl http://localhost:3000/api/health
```

**GPU info** (should show simulated GPU):
```bash
curl http://localhost:3000/api/gpu/info
```

**Load a model:**
```bash
curl -X POST http://localhost:3000/api/models/load \
  -H "Content-Type: application/json" \
  -d '{"model_path": "meta-llama/Llama-3.2-7B-Instruct"}'
```

**List models** (wait ~3s for it to reach "running"):
```bash
curl http://localhost:3000/api/models
```

**Memory usage:**
```bash
curl http://localhost:3000/api/memory/usage
curl http://localhost:3000/api/memory/usage/multi-gpu
```

**Send inference:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "meta-llama/Llama-3.2-7B-Instruct", "messages": [{"role": "user", "content": "hello"}]}'
```

**Unload by instance ID** (get the ID from list models):
```bash
curl -X DELETE http://localhost:3000/api/models/instances/<instance_id>
```

**Unload by model path:**
```bash
curl -X DELETE http://localhost:3000/api/models/meta-llama%2FLlama-3.2-7B-Instruct
```

## 3. Multi-pod cluster

```bash
export SECRET=$(openssl rand -hex 32)

# Terminal 1
PORT=3001 INFERENCE_BACKEND=inference-sim DEV_VIRTUAL_GPU_COUNT=2 \
  SIM_GPU_MEMORY_GB=24 CLUSTER_PEERS=localhost:3001,localhost:3002 \
  CLUSTER_SECRET=$SECRET npm run dev -w apps/backend

# Terminal 2
PORT=3002 INFERENCE_BACKEND=inference-sim DEV_VIRTUAL_GPU_COUNT=2 \
  SIM_GPU_MEMORY_GB=24 CLUSTER_PEERS=localhost:3001,localhost:3002 \
  CLUSTER_SECRET=$SECRET npm run dev -w apps/backend
```

## 4. Things to verify

- **Default mode unchanged**: Start without `INFERENCE_BACKEND` — same vLLM behavior as before
- **Invalid value rejected**: `INFERENCE_BACKEND=bogus npm run dev -w apps/backend` fails at startup
- **Capacity rejection**: Load a 70B model (37 GB estimated) on a 24 GB simulated GPU — should fail
- **Memory freed on unload**: Check `/api/memory/usage/multi-gpu` before and after unload
- **GPU availability**: `curl http://localhost:3000/api/gpu/available` shows recommendations based on simulated free memory
