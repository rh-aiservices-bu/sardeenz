# GPU Development Setup

This guide covers setting up a local development environment with NVIDIA GPU support for running vLLM and kvcached.

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
2. Install dependencies from `apps/backend/pyproject.toml` (vLLM, kvcached)
3. Set up kvcached environment variables
4. Start the backend and frontend development servers

## How It Works

### Environment Variables

The backend uses environment variables for configuration. A reference file is available at `apps/backend/.env.example`.

**kvcached variables** (configured by start-dev script):

| Variable               | Default | Description                            |
| ---------------------- | ------- | -------------------------------------- |
| `ENABLE_KVCACHED`      | `true`  | Enables kvcached memory sharing        |
| `KVCACHED_AUTOPATCH`   | `1`     | Auto-patches vLLM for kvcached support |
| `CUDA_VISIBLE_DEVICES` | `0`     | GPU device index                       |

**HuggingFace authentication** (for gated models like Llama):

| Variable   | Default | Description                               |
| ---------- | ------- | ----------------------------------------- |
| `HF_TOKEN` | (none)  | HuggingFace access token for gated models |

Get your token from [HuggingFace Settings](https://huggingface.co/settings/tokens). You can also set this via the Settings page in the web UI.

### Model Loading

Models are loaded dynamically via the API or Admin Dashboard - no models are pre-loaded at startup. When you load a model:

1. Backend receives the load request
2. vLLM process is spawned with kvcached environment
3. Model is downloaded (if not cached) and loaded to GPU
4. Multiple models can share GPU memory via kvcached

## Recommended Models for 8GB VRAM

For development and testing on 8GB GPUs:

| Model                                | Parameters | VRAM Usage | Notes                               |
| ------------------------------------ | ---------- | ---------- | ----------------------------------- |
| `Qwen/Qwen3-0.6B`                    | 0.6B       | ~2GB       | Ideal for testing, fast inference   |
| `meta-llama/Llama-3.2-1B`            | 1B         | ~3GB       | Good balance of size and capability |
| `microsoft/phi-2`                    | 2.7B       | ~6GB       | Near 8GB limit, good quality        |
| `TinyLlama/TinyLlama-1.1B-Chat-v1.0` | 1.1B       | ~3GB       | Chat-optimized small model          |

### Memory Tips

- Use `--gpu-memory-utilization 0.3` for small models to leave room for others
- With kvcached, you can load 2-3 small models on an 8GB GPU
- Monitor VRAM with `nvidia-smi` or the Admin Dashboard

## Python Dependency Management

Python dependencies are managed via `apps/backend/pyproject.toml` using [uv](https://docs.astral.sh/uv/).

### Dependency Groups

| Group  | Packages | Used In                               |
| ------ | -------- | ------------------------------------- |
| (base) | kvcached | Dev + Docker                          |
| dev    | vllm     | Dev only (Docker base image has vLLM) |

### Adding New Packages

1. Edit `apps/backend/pyproject.toml`:
   - Add to `dependencies` for packages needed in both dev and production
   - Add to `[dependency-groups] dev` for development-only packages

2. Regenerate lock file:

   ```bash
   cd apps/backend
   uv lock
   ```

3. Install updated dependencies:

   ```bash
   uv sync --locked --group dev
   ```

4. Commit both `pyproject.toml` and `uv.lock`

## Manual Python Setup (Optional)

If you prefer to set up the Python environment manually:

```bash
cd apps/backend

# Create venv and install all dependencies (including dev group)
uv sync --locked --group dev

# Activate the environment
source .venv/bin/activate
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

## Virtual GPU Mode (Testing Multi-GPU Features)

If you only have a single GPU but need to test multi-GPU features like the model move feature, you can enable virtual GPU mode. This creates multiple virtual GPUs that all map to your single physical GPU.

### Usage

```bash
# Start backend with 2 virtual GPUs
DEV_VIRTUAL_GPU_COUNT=2 npm run dev -w apps/backend

# In another terminal
npm run dev -w apps/frontend
```

### What It Does

- **GPU Detection**: Returns N virtual GPUs based on your real GPU's specs
- **Model Assignment**: Models are assigned to virtual GPU IDs (0, 1, etc.)
- **Physical Mapping**: All models actually run on physical GPU 0 via `CUDA_VISIBLE_DEVICES=0`
- **Memory Display**: Each virtual GPU shows the real GPU's memory stats

### What You Can Test

| Feature | Testable? |
|---------|-----------|
| Model move between GPUs | ✅ |
| Move phase transitions | ✅ |
| Connection draining | ✅ |
| Cancel/rollback semantics | ✅ |
| Multi-GPU UI display | ✅ |
| Actual GPU memory isolation | ❌ |
| Real tensor parallelism | ❌ |

### Limitations

- All virtual GPUs share the same physical GPU memory
- Memory tracking per virtual GPU is approximate
- Cannot test actual multi-GPU tensor parallelism
- Loading too many models will exhaust real GPU memory

### Example Workflow

1. Start backend with `DEV_VIRTUAL_GPU_COUNT=2`
2. Open UI - you'll see 2 GPUs listed
3. Load a model on vGPU 0
4. Use "Move to different GPU" to move it to vGPU 1
5. Verify the move completes through all phases
6. Model now appears on vGPU 1 in the UI

## Running Without GPU

If you don't have a GPU but want to develop the frontend or test the API:

```bash
# Skip the vLLM setup, run server directly
npm run dev:server -w apps/backend

# Or run frontend only
npm run dev -w apps/frontend
```

The backend will start but model loading will fail without GPU/vLLM.

## Developing with OAuth Authentication

If you want to test OAuth authentication locally against a remote OpenShift cluster, follow these steps.

### Prerequisites

- Access to an OpenShift cluster with OAuth configured
- `oc` CLI logged in with namespace admin permissions
- A namespace for sardeenz RBAC resources (e.g., `sardeenz`)

### Step 1: Create OAuth Client on OpenShift

Register a development OAuth client with localhost callback URL:

```bash
oc apply -f - <<EOF
apiVersion: oauth.openshift.io/v1
kind: OAuthClient
metadata:
  name: sardeenz-dev
grantMethod: auto
redirectURIs:
  - http://localhost:3000/api/auth/callback
secret: dev-secret-change-me
EOF
```

> **Note:** Change the `secret` value to something unique for your development environment.

### Step 2: Create RBAC Resources on OpenShift

Create the namespace and apply the RBAC manifests from the deployment folder:

```bash
# Create namespace (if it doesn't exist)
oc new-project sardeenz

# Apply ServiceAccount and RBAC resources
oc apply -f deployment/serviceaccount.yaml -n sardeenz
oc apply -f deployment/rbac.yaml -n sardeenz
```

This creates:

- The `sardeenz` ServiceAccount
- The `sardeenz-admin` and `sardeenz-admin-readonly` marker Roles
- The `sardeenz-auth-reviewer` Role and RoleBinding

### Step 3: Create RoleBinding for Your User

Grant yourself admin access:

```bash
oc adm policy add-role-to-user sardeenz-admin $(oc whoami) -n sardeenz
```

For complete RBAC configuration options (adding other users, groups, or all authenticated users), see the [RBAC Setup Guide](./rbac-setup.md).

> **Note for Cluster-Admin Users:** If you're logged in as a cluster-admin, you will automatically have access to sardeenz regardless of whether you have a sardeenz-admin RoleBinding. This is expected Kubernetes RBAC behavior—cluster-admin has wildcard permissions on all resources including sardeenz marker roles. To properly test RBAC authorization (denied access, read-only vs admin), use a non-cluster-admin account.

### Step 4: Generate ServiceAccount Token

Generate a long-lived token for local development:

```bash
oc create token sardeenz -n sardeenz --duration=8760h
```

Save this token - you'll need it for the environment variable.

### Step 5: Configure Environment Variables

Create or update `apps/backend/.env` with the OAuth configuration:

```bash
# Authentication mode
AUTH_MODE=oauth

# OAuth client configuration (must match the OAuthClient created above)
OAUTH_CLIENT_ID=sardeenz-dev
OAUTH_CLIENT_SECRET=dev-secret-change-me

# OpenShift URLs
OAUTH_ISSUER_URL=https://oauth-openshift.apps.your-cluster.com
K8S_API_URL=https://api.your-cluster.com:6443

# RBAC configuration
NAMESPACE=sardeenz
SERVICE_ACCOUNT_TOKEN=<paste token from Step 4>

# Local development URLs
API_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# JWT secret (any random string for development)
JWT_SECRET=your-dev-jwt-secret-change-me
```

### Getting the OpenShift URLs

To find the correct URLs for your cluster:

```bash
# Get the Kubernetes API URL
oc whoami --show-server
# Example output: https://api.your-cluster.com:6443

# The OAuth issuer URL is typically derived from the API URL
# Replace 'api.' with 'oauth-openshift.apps.' and remove the port
# Example: https://oauth-openshift.apps.your-cluster.com
```

### Step 6: Start Development

```bash
npm run dev
```

Navigate to `http://localhost:5173`. When you click "Login", you'll be redirected to OpenShift OAuth, then back to the local frontend with your session authenticated.

### Troubleshooting OAuth Development

**"Access denied" after login:**

- Verify your RoleBinding exists: `oc get rolebindings -n sardeenz`
- Check if you have the right role: `oc auth can-i get admin.sardeenz.rh-aiservices-bu.io -n sardeenz --as=$(oc whoami)`

**"LocalSubjectAccessReview failed" errors:**

- Check that the `sardeenz-auth-reviewer` RoleBinding exists
- Verify your SERVICE_ACCOUNT_TOKEN is valid and not expired
- Ensure K8S_API_URL is correct and reachable from your machine

**"Invalid redirect URI" from OpenShift:**

- Verify the OAuthClient has `http://localhost:3000/api/auth/callback` in redirectURIs
- Ensure API_BASE_URL matches exactly

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
cd apps/backend
uv sync --locked --group dev
source .venv/bin/activate
which vllm  # Should show path in .venv/bin/
```

### kvcached IPC errors

If you see IPC segment errors:

```bash
# Clear stale IPC segments
ipcs -m | grep $(whoami) | awk '{print $2}' | xargs -I {} ipcrm -m {}
```

## kvcached Tools

kvcached provides CLI tools for monitoring:

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
- [RBAC Setup Guide](./rbac-setup.md) - Kubernetes-native RBAC configuration for OAuth
- [kvcached Documentation](./kvcached/) - Detailed kvcached configuration
