# GPU Development Setup

This guide covers setting up a local development environment with NVIDIA GPU support for running vLLM and KVCached.

## Prerequisites

### Hardware
- NVIDIA GPU with CUDA 12.x drivers
- 8GB+ VRAM (16GB+ recommended for larger models)

### Software
- **Node.js 22.x** - See main README for installation
- **Python 3.12** - Required for vLLM (auto-installed by uv on first run)
- **uv** - Fast Python package manager

### Verify GPU Setup

```bash
# Check NVIDIA driver and CUDA version
nvidia-smi

# Expected output shows GPU name, driver version, CUDA version
# Example: NVIDIA GeForce RTX 3070, Driver 535.xx, CUDA 12.x
```

### Install uv (Python Package Manager)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Quick Start

Once prerequisites are installed, the development scripts handle everything automatically:

```bash
# Install Node.js dependencies
npm install
npm run build -w packages/types && npm run build -w packages/utils

# Start development (auto-creates Python venv on first run)
npm run dev
```

On first run, the script will:
1. Create a Python virtual environment at `apps/backend/.venv`
2. Install vLLM 0.11.0 and KVCached
3. Set up KVCached environment variables
4. Start the backend and frontend development servers

## How It Works

### Environment Variables

The backend uses environment variables for configuration. A reference file is available at `apps/backend/.env.example`.

**KVCached variables** (configured by start-dev script):

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_KVCACHED` | `true` | Enables KVCached memory sharing |
| `KVCACHED_AUTOPATCH` | `1` | Auto-patches vLLM for KVCached support |
| `CUDA_VISIBLE_DEVICES` | `0` | GPU device index |

**HuggingFace authentication** (for gated models like Llama):

| Variable | Default | Description |
|----------|---------|-------------|
| `HF_TOKEN` | (none) | HuggingFace access token for gated models |

Get your token from [HuggingFace Settings](https://huggingface.co/settings/tokens). You can also set this via the Settings page in the web UI.

### Model Loading

Models are loaded dynamically via the API or Admin Dashboard - no models are pre-loaded at startup. When you load a model:

1. Backend receives the load request
2. vLLM process is spawned with KVCached environment
3. Model is downloaded (if not cached) and loaded to GPU
4. Multiple models can share GPU memory via KVCached

## Recommended Models for 8GB VRAM

For development and testing on 8GB GPUs:

| Model | Parameters | VRAM Usage | Notes |
|-------|-----------|------------|-------|
| `Qwen/Qwen3-0.6B` | 0.6B | ~2GB | Ideal for testing, fast inference |
| `meta-llama/Llama-3.2-1B` | 1B | ~3GB | Good balance of size and capability |
| `microsoft/phi-2` | 2.7B | ~6GB | Near 8GB limit, good quality |
| `TinyLlama/TinyLlama-1.1B-Chat-v1.0` | 1.1B | ~3GB | Chat-optimized small model |

### Memory Tips

- Use `--gpu-memory-utilization 0.3` for small models to leave room for others
- With KVCached, you can load 2-3 small models on an 8GB GPU
- Monitor VRAM with `nvidia-smi` or the Admin Dashboard

## Manual Python Setup (Optional)

If you prefer to set up the Python environment manually:

```bash
cd apps/backend

# Ensure Python 3.12 is available (downloads if needed)
uv python install 3.12

# Create virtual environment
uv venv .venv --python 3.12

# Activate it
source .venv/bin/activate

# Install vLLM and KVCached
uv pip install vllm==0.11.0
uv pip install kvcached --no-build-isolation
```

Then run the server without the wrapper:
```bash
# Set environment variables manually
export ENABLE_KVCACHED=true
export KVCACHED_AUTOPATCH=1
export CUDA_VISIBLE_DEVICES=0

# Run server directly
npm run dev:server -w apps/backend
```

## Running Without GPU

If you don't have a GPU but want to develop the frontend or test the API:

```bash
# Skip the vLLM setup, run server directly
npm run dev:server -w apps/backend

# Or run frontend only
npm run dev -w apps/frontend
```

The backend will start but model loading will fail without GPU/vLLM.

## Troubleshooting

### "uv is not installed"

Install uv:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc  # or restart terminal
```

### "nvidia-smi: command not found"

NVIDIA drivers are not installed. Install them from:
- Ubuntu: `sudo apt install nvidia-driver-535`
- Fedora: `sudo dnf install akmod-nvidia`
- Or download from [NVIDIA's website](https://www.nvidia.com/drivers)

### "CUDA out of memory"

- Use smaller models (see recommendations above)
- Reduce `--gpu-memory-utilization` in model config
- Unload unused models via API/Dashboard
- Check for other GPU processes: `nvidia-smi`

### "vLLM not found" or spawn errors

Ensure the virtual environment is activated and vLLM is installed:
```bash
source apps/backend/.venv/bin/activate
which vllm  # Should show path in .venv/bin/
```

### KVCached IPC errors

If you see IPC segment errors:
```bash
# Clear stale IPC segments
ipcs -m | grep $(whoami) | awk '{print $2}' | xargs -I {} ipcrm -m {}
```

## KVCached Tools

KVCached provides CLI tools for monitoring:

```bash
# Activate the venv first
source apps/backend/.venv/bin/activate

# List active memory segments
kvctl list

# Monitor memory usage in real-time
kvtop

# Set memory limit for a model
kvctl limit <segment-name> 4G
```

## Additional Resources

- [Architecture Documentation](./architecture.md) - System design and vLLM integration
- [API Guide](./api-guide.md) - Model loading API endpoints
- [KVCached Documentation](./kvcached/) - Detailed KVCached configuration
