# kvcached Integration Guide for sardeenz

This document describes how the sardeenz project will integrate with kvcached for dynamic multi-model management on shared GPUs.

## Table of Contents

- [Executive Summary](#executive-summary)
- [Why Not Use the kvcached Controller](#why-not-use-the-kvcached-controller)
- [Recommended Architecture](#recommended-architecture)
- [Implementation Details](#implementation-details)
- [Backend API Design](#backend-api-design)
- [Memory Management](#memory-management)
- [Monitoring and Observability](#monitoring-and-observability)
- [Implementation Roadmap](#implementation-roadmap)
- [Trade-offs and Considerations](#trade-offs-and-considerations)

## Executive Summary

**Decision:** sardeenz will **NOT** use the kvcached Controller for model management. Instead, the backend will directly manage individual vLLM instances with kvcached enabled.

**Why:**

- The Controller requires a full restart to add/remove models
- Restarting kills all running instances, causing downtime
- sardeenz needs true dynamic model management

**How:**

- Backend launches vLLM instances directly with `ENABLE_KVCACHED=true`
- Each model runs independently but shares GPU memory via kvcached
- Backend implements its own routing, monitoring, and lifecycle management
- Use kvcached CLI tools (`kvctl`, `kvtop`) for memory monitoring

**Benefits:**

- ✅ Add models without affecting running instances
- ✅ Remove models individually with no downtime
- ✅ Full control over model lifecycle
- ✅ GPU memory sharing via kvcached still works automatically
- ✅ Simpler architecture (no Controller dependency)

## Why Not Use the kvcached Controller

### The Controller's Limitations

The kvcached Controller is designed for **static, long-running deployments** where the model lineup is known in advance and rarely changes.

#### Problem 1: No Dynamic Model Addition

**Controller behavior:**

```yaml
# config.yaml - Must define all models upfront
instances:
  - name: 'llama-3.2-1b'
    model: 'meta-llama/Llama-3.2-1B'
    engine: 'vllm'
    port: 12346
  # Cannot add models without restarting
```

**Missing features:**

- ❌ No API to add models at runtime
- ❌ No hot-reload of configuration
- ❌ No dynamic instance registration

#### Problem 2: Restart Kills All Models

**What happens when you want to add a model:**

```
Step 1: User wants to add "Qwen/Qwen3-0.6B"
    ↓
Step 2: Update YAML config with new model
    ↓
Step 3: Restart Controller
    ↓
Shutdown sequence:
    - meta-llama/Llama-3.2-1B: KILLED ❌
    - (Any in-flight requests: LOST ❌)
    ↓
Startup sequence:
    - meta-llama/Llama-3.2-1B: Re-loading from disk (2-5 min)
    - Qwen/Qwen3-0.6B: Loading from disk (2-5 min)
    ↓
Step 4: Both models ready (after significant downtime)
```

**Impact:**

- **Downtime**: All models unavailable during restart
- **Slow**: Must reload all model weights from disk/network
- **Disruptive**: In-flight requests are lost
- **Inefficient**: Existing models are unnecessarily restarted

#### Problem 3: Poor Fit for User-Driven Model Selection

sardeenz's use case:

- Users select which models to load from a UI
- Users can add/remove models on demand
- Need instant response to user actions

Controller's design:

- System administrator defines models in YAML
- Configuration changes require restart
- Long restart times (minutes for large models)

**Mismatch:** The Controller assumes infrastructure-managed, rarely-changing model deployments, not user-driven dynamic selection.

### What We Would Gain from the Controller

For completeness, here's what the Controller provides that we're giving up:

1. **Unified Router**: Single HTTP endpoint for all models
   - OpenAI-compatible API
   - Automatic routing to correct model endpoint

2. **Automatic Sleep/Wake Management**
   - Models sleep when idle
   - Auto-wake on request
   - Configurable thresholds

3. **Integrated Traffic Monitoring**
   - Per-model request statistics
   - Success/failure tracking
   - Request rate and response time metrics

4. **Declarative Configuration**
   - YAML-based model definitions
   - Centralized settings management

**Our assessment:** These features are nice but not worth the downtime and inflexibility. We can implement equivalent functionality in our backend with more control.

## Recommended Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│         sardeenz Backend (FastAPI/Flask)       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │         Model Lifecycle Manager                    │ │
│  │  - Launch vLLM instances                           │ │
│  │  - Track running models                            │ │
│  │  - Health checks                                   │ │
│  │  - Process management                              │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │         Request Router                             │ │
│  │  - Forward requests to model endpoints             │ │
│  │  - Load balancing (if needed)                      │ │
│  │  - Error handling                                  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │         Monitoring & Metrics                       │ │
│  │  - Track usage per model                           │ │
│  │  - Memory monitoring (kvctl integration)           │ │
│  │  - Health status                                   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
└────────────┬─────────────────────────────────┬──────────┘
             │                                 │
             │ Launch with                     │ Monitor with
             │ ENABLE_KVCACHED=true            │ kvctl/kvtop
             │                                 │
             ▼                                 ▼
┌─────────────────────────────────────────────────────────┐
│                    vLLM Instances                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ vLLM Model 1 │  │ vLLM Model 2 │  │ vLLM Model N │  │
│  │ Port: 12346  │  │ Port: 12347  │  │ Port: 1234N  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └─────────────────┼─────────────────┘           │
│                           ▼                             │
│              kvcached Memory Sharing Layer              │
│                  (Automatic, Transparent)               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
                    GPU Memory (Shared)
```

### Key Components

#### 1. Model Lifecycle Manager

**Responsibilities:**

- Launch vLLM instances on demand
- Track running models and their endpoints
- Stop individual models cleanly
- Health monitoring

**Does NOT use:**

- kvcached Controller
- tmux sessions (Controller feature)
- YAML configuration for model list

**Uses:**

- Direct subprocess management
- kvcached environment variables
- Individual model processes

#### 2. Request Router

**Responsibilities:**

- Accept requests from frontend/API clients
- Route to appropriate model endpoint
- Handle errors and retries

**Simple approach:**

- Forward requests to `http://localhost:{model_port}/v1/...`
- Return responses to client

#### 3. Memory Monitor

**Responsibilities:**

- Track GPU memory usage
- Report statistics to frontend
- Alert on high usage

**Uses:**

- `kvctl list --json` for programmatic access
- `kvtop` for debugging/development

### How kvcached Fits In

**kvcached's role:**

- Enable GPU memory sharing between vLLM instances
- Manage KV cache allocation dynamically
- Allow multiple models to coexist on same GPU

**What we use:**

- ✅ kvcached's memory management layer (core feature)
- ✅ kvcached CLI tools for monitoring
- ✅ Environment variables for enabling kvcached
- ❌ kvcached Controller (too inflexible)

**How it works:**

1. Backend sets `ENABLE_KVCACHED=true` for each vLLM launch
2. Each vLLM instance automatically uses kvcached for memory
3. GPU memory is shared transparently via IPC segments
4. Backend uses `kvctl` to monitor and set limits

## Implementation Details

### Model Launch Process

**Step-by-step:**

1. **User selects model in UI**

   ```
   User clicks "Load meta-llama/Llama-3.2-1B"
   ```

2. **Backend receives request**

   ```
   POST /api/models/load
   {
     "model_path": "meta-llama/Llama-3.2-1B",
     "max_tokens": 4096
   }
   ```

3. **Backend launches vLLM instance**

   ```python
   # Set environment variables
   env = os.environ.copy()
   env["ENABLE_KVCACHED"] = "true"
   env["KVCACHED_AUTOPATCH"] = "1"

   # Launch vLLM
   process = subprocess.Popen([
       "vllm", "serve", "meta-llama/Llama-3.2-1B",
       "--disable-log-requests",
       "--no-enable-prefix-caching",  # Required for kvcached
       "--port=12346",
       "--gpu-memory-utilization=0.9",
       "--max-model-len=4096"
   ], env=env)
   ```

4. **Backend waits for model ready**

   ```python
   # Poll health endpoint
   for i in range(60):  # 2 minutes max
       try:
           response = requests.get("http://localhost:12346/health")
           if response.status_code == 200:
               break
       except:
           pass
       time.sleep(2)
   ```

5. **Backend registers model**

   ```python
   # Track in memory
   self.running_models["meta-llama/Llama-3.2-1B"] = {
       "process": process,
       "port": 12346,
       "status": "active",
       "loaded_at": datetime.now()
   }
   ```

6. **Return success to frontend**
   ```json
   {
     "status": "success",
     "model": "meta-llama/Llama-3.2-1B",
     "endpoint": "http://localhost:12346",
     "loaded_at": "2025-11-08T10:30:00Z"
   }
   ```

### Model Unload Process

**Step-by-step:**

1. **User requests unload**

   ```
   DELETE /api/models/meta-llama%2FLlama-3.2-1B
   ```

2. **Backend kills all vLLM processes with SIGKILL**

   ```python
   model_info = self.running_models["meta-llama/Llama-3.2-1B"]
   process = model_info["process"]

   # Get all descendant PIDs (includes EngineCore which uses GPU)
   descendants = get_descendant_pids(process.pid)

   # Kill descendants first (EngineCore must be killed to free GPU memory)
   for pid in descendants:
       try:
           os.kill(pid, signal.SIGKILL)
       except ProcessLookupError:
           pass  # Already exited

   # Then kill the parent process
   process.kill()  # SIGKILL
   process.wait()
   ```

   > **Important:** We use SIGKILL instead of SIGTERM because kvcached registers
   > Python signal handlers that delete the IPC segment on SIGTERM. Using SIGKILL
   > bypasses these handlers, allowing other models on the same GPU to continue
   > using the shared memory.
   >
   > **Note:** SIGKILL doesn't propagate to child processes. vLLM spawns an EngineCore
   > process that allocates GPU VRAM, so we must explicitly kill all descendants
   > before killing the parent to ensure GPU memory is freed.

3. **Do NOT delete IPC segment**

   ```python
   # DO NOT call kvctl delete here!
   # Models on the same GPU share the IPC segment (e.g., kvcached_vllm_GPU0)
   # Deleting it would break other running models on that GPU
   ```

4. **Backend removes from registry**

   ```python
   del self.running_models["meta-llama/Llama-3.2-1B"]
   ```

5. **Return success**
   ```json
   {
     "status": "success",
     "model": "meta-llama/Llama-3.2-1B",
     "unloaded_at": "2025-11-08T10:35:00Z"
   }
   ```

**IPC Cleanup (Server Shutdown Only):**

The IPC segments are only deleted when the server shuts down and all models are unloaded.

**IPC Segment Naming:**

Each GPU (or GPU-pair for tensor-parallel models) gets its own IPC segment:

| GPU Configuration         | IPC Segment Name                    |
| ------------------------- | ----------------------------------- |
| Single GPU (GPU 0)        | `kvcached_vllm_GPU0`                |
| Single GPU (GPU 1)        | `kvcached_vllm_GPU1`                |
| Tensor-parallel (GPU 0+1) | `kvcached_vllm_GPU0_GPU1`           |
| Tensor-parallel (GPU 0-3) | `kvcached_vllm_GPU0_GPU1_GPU2_GPU3` |

This is configured automatically via the `KVCACHED_IPC_NAME` environment variable set by the backend based on the model's GPU assignment.

```python
def shutdown_all(self):
    """Shutdown all models and clean up shared resources."""
    # Unload all models first
    for model_path in list(self.running_models.keys()):
        self.unload_model(model_path)

    # Delete all kvcached IPC segments (single-GPU and multi-GPU patterns)
    for i in range(8):  # Try single-GPU segments
        subprocess.run(["kvctl", "delete", f"kvcached_vllm_GPU{i}"])
    # Try common multi-GPU patterns
    subprocess.run(["kvctl", "delete", "kvcached_vllm_GPU0_GPU1"])
    subprocess.run(["kvctl", "delete", "kvcached_vllm_GPU0_GPU1_GPU2_GPU3"])
```

### Request Routing

**Simple forwarding approach:**

```python
@app.post("/v1/completions")
async def completions(request: Request):
    """Forward completion request to appropriate model."""

    data = await request.json()
    model_name = data.get("model")

    # Look up model endpoint
    if model_name not in running_models:
        return {"error": f"Model {model_name} not loaded"}, 404

    port = running_models[model_name]["port"]

    # Forward request
    response = requests.post(
        f"http://localhost:{port}/v1/completions",
        json=data,
        stream=data.get("stream", False)
    )

    # Return response
    return response.json(), response.status_code
```

**For streaming:**

```python
@app.post("/v1/completions")
async def completions(request: Request):
    """Handle both streaming and non-streaming."""

    data = await request.json()
    model_name = data.get("model")
    port = running_models[model_name]["port"]

    if data.get("stream"):
        # Stream response
        def generate():
            response = requests.post(
                f"http://localhost:{port}/v1/completions",
                json=data,
                stream=True
            )
            for chunk in response.iter_lines():
                yield chunk + b"\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    else:
        # Non-streaming
        response = requests.post(
            f"http://localhost:{port}/v1/completions",
            json=data
        )
        return response.json()
```

### Code Example: Complete Model Manager

```python
import subprocess
import os
import time
import signal
from typing import Dict, Optional
from datetime import datetime
import requests

class ModelManager:
    """Manages vLLM model instances with kvcached."""

    def __init__(self, base_port: int = 12346):
        self.running_models: Dict[str, dict] = {}
        self.base_port = base_port
        self.next_port = base_port

    def launch_model(
        self,
        model_path: str,
        max_tokens: int = 4096,
        gpu_memory_utilization: float = 0.9
    ) -> dict:
        """Launch a vLLM model with kvcached enabled."""

        # Check if already running
        if model_path in self.running_models:
            return {
                "status": "already_loaded",
                "model": model_path,
                "port": self.running_models[model_path]["port"]
            }

        # Allocate port
        port = self.next_port
        self.next_port += 1

        # Prepare environment
        env = os.environ.copy()
        env["ENABLE_KVCACHED"] = "true"
        env["KVCACHED_AUTOPATCH"] = "1"

        # Build command
        cmd = [
            "vllm", "serve", model_path,
            "--disable-log-requests",
            "--no-enable-prefix-caching",  # Required!
            f"--port={port}",
            f"--gpu-memory-utilization={gpu_memory_utilization}",
            f"--max-model-len={max_tokens}"
        ]

        # Launch process
        try:
            process = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
        except Exception as e:
            return {"status": "error", "message": str(e)}

        # Wait for model to be ready
        ready = self._wait_for_ready(port, timeout=180)

        if not ready:
            process.kill()
            return {
                "status": "error",
                "message": "Model failed to start within timeout"
            }

        # Register model
        self.running_models[model_path] = {
            "process": process,
            "port": port,
            "status": "active",
            "loaded_at": datetime.now(),
            "max_tokens": max_tokens,
            "gpu_memory_utilization": gpu_memory_utilization
        }

        return {
            "status": "success",
            "model": model_path,
            "port": port,
            "loaded_at": datetime.now().isoformat()
        }

    def _wait_for_ready(self, port: int, timeout: int = 180) -> bool:
        """Wait for model to be ready."""
        start = time.time()

        while time.time() - start < timeout:
            try:
                response = requests.get(
                    f"http://localhost:{port}/health",
                    timeout=2
                )
                if response.status_code == 200:
                    return True
            except requests.exceptions.RequestException:
                pass

            time.sleep(2)

        return False

    def unload_model(self, model_path: str) -> dict:
        """Unload a running model."""

        if model_path not in self.running_models:
            return {
                "status": "error",
                "message": f"Model {model_path} not loaded"
            }

        model_info = self.running_models[model_path]
        process = model_info["process"]

        # Get all descendant PIDs (includes EngineCore which uses GPU)
        descendants = self._get_descendant_pids(process.pid)

        # Kill descendants first with SIGKILL (frees GPU memory)
        # SIGKILL doesn't propagate to children, so we must kill them explicitly
        for pid in descendants:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass  # Already exited

        # Kill parent process with SIGKILL (bypasses Python signal handlers
        # that would delete the shared IPC segment)
        process.kill()
        process.wait()

        # NOTE: Do NOT delete IPC segment here!
        # All models share 'kvcached_mem_info' - deleting it breaks other models
        # IPC is only deleted on server shutdown (see shutdown_all)

        # Remove from registry
        del self.running_models[model_path]

        return {
            "status": "success",
            "model": model_path,
            "unloaded_at": datetime.now().isoformat()
        }

    def _get_descendant_pids(self, parent_pid: int) -> list:
        """Get all descendant PIDs using /proc filesystem."""
        descendants = []
        queue = [parent_pid]

        while queue:
            pid = queue.pop(0)
            try:
                children_path = f"/proc/{pid}/task/{pid}/children"
                with open(children_path) as f:
                    child_pids = [int(p) for p in f.read().split() if p]
                    descendants.extend(child_pids)
                    queue.extend(child_pids)
            except (FileNotFoundError, ProcessLookupError):
                pass

        return descendants

    def list_models(self) -> dict:
        """List all running models."""
        return {
            "models": [
                {
                    "model": model_path,
                    "port": info["port"],
                    "status": info["status"],
                    "loaded_at": info["loaded_at"].isoformat(),
                    "uptime_seconds": (datetime.now() - info["loaded_at"]).total_seconds()
                }
                for model_path, info in self.running_models.items()
            ],
            "total": len(self.running_models)
        }

    def get_model_health(self, model_path: str) -> dict:
        """Check health of a specific model."""

        if model_path not in self.running_models:
            return {"status": "not_loaded"}

        port = self.running_models[model_path]["port"]

        try:
            response = requests.get(
                f"http://localhost:{port}/health",
                timeout=2
            )
            return {
                "status": "healthy" if response.status_code == 200 else "unhealthy",
                "response_code": response.status_code
            }
        except requests.exceptions.RequestException as e:
            return {
                "status": "unreachable",
                "error": str(e)
            }

    def shutdown_all(self):
        """Shutdown all running models and clean up shared resources."""
        models = list(self.running_models.keys())
        for model_path in models:
            self.unload_model(model_path)

        # Delete all kvcached IPC segments (per-GPU and multi-GPU patterns)
        for i in range(8):  # Try single-GPU segments
            try:
                subprocess.run(
                    ["kvctl", "delete", f"kvcached_vllm_GPU{i}"],
                    capture_output=True,
                    timeout=5
                )
            except:
                pass  # Non-critical if segment doesn't exist
        # Try common multi-GPU patterns for tensor-parallel models
        for segment in ["kvcached_vllm_GPU0_GPU1", "kvcached_vllm_GPU0_GPU1_GPU2_GPU3"]:
            try:
                subprocess.run(["kvctl", "delete", segment], capture_output=True, timeout=5)
            except:
                pass

# Usage
manager = ModelManager()

# Load a model
result = manager.launch_model("meta-llama/Llama-3.2-1B")
print(result)

# Load another model (runs concurrently, shares GPU memory)
result = manager.launch_model("Qwen/Qwen3-0.6B")
print(result)

# List models
print(manager.list_models())

# Unload one model (other continues running)
manager.unload_model("Qwen/Qwen3-0.6B")

# Shutdown all
manager.shutdown_all()
```

## Backend API Design

### Recommended REST API Endpoints

```
POST   /api/models/load              # Load a model
DELETE /api/models/{model_name}      # Unload a model
GET    /api/models                   # List loaded models
GET    /api/models/{model_name}      # Get model details
GET    /api/models/{model_name}/health  # Check model health

GET    /api/memory/usage             # GPU memory usage (from kvctl)
GET    /api/memory/limits            # Memory limits per model
POST   /api/memory/limits            # Set memory limits

POST   /v1/completions              # Forward to vLLM (OpenAI-compatible)
POST   /v1/chat/completions         # Forward to vLLM (OpenAI-compatible)
```

### Example API Payloads

**Load Model:**

```json
POST /api/models/load
{
  "model_path": "meta-llama/Llama-3.2-1B",
  "max_tokens": 4096,
  "gpu_memory_utilization": 0.9
}

Response:
{
  "status": "success",
  "model": "meta-llama/Llama-3.2-1B",
  "port": 12346,
  "loaded_at": "2025-11-08T10:30:00Z"
}
```

**List Models:**

```json
GET /api/models

Response:
{
  "models": [
    {
      "model": "meta-llama/Llama-3.2-1B",
      "port": 12346,
      "status": "active",
      "loaded_at": "2025-11-08T10:30:00Z",
      "uptime_seconds": 1234
    },
    {
      "model": "Qwen/Qwen3-0.6B",
      "port": 12347,
      "status": "active",
      "loaded_at": "2025-11-08T10:32:00Z",
      "uptime_seconds": 1114
    }
  ],
  "total": 2
}
```

**Memory Usage:**

```json
GET /api/memory/usage

Response:
{
  "gpu_total_gb": 24.0,
  "gpu_used_gb": 15.2,
  "gpu_free_gb": 8.8,
  "models": [
    {
      "model": "meta-llama/Llama-3.2-1B",
      "memory_used_gb": 8.0,
      "memory_limit_gb": 10.0,
      "usage_percent": 80.0
    },
    {
      "model": "Qwen/Qwen3-0.6B",
      "memory_used_gb": 5.5,
      "memory_limit_gb": 8.0,
      "usage_percent": 68.75
    }
  ]
}
```

## Memory Management

### Memory Baseline Tracking

When a model transitions to 'running' status, the backend captures its memory baseline:

- **`memoryBaselineByGpu: Record<number, number>`** - Memory footprint per GPU in GB
- This represents the idle memory consumption before any inference requests
- Captured from NVML using the EngineCore PID
- For tensor-parallel models, baselines are captured on each GPU

**Purpose:** The memory baseline is used for accurate KVCache total calculation:

```
KVCache Total = GPU Total - Model Baselines - Other Processes
```

This provides accurate KVCache metrics per GPU, as opposed to reading a stale `total_size` from the IPC segment that was set at initialization and never updated as models were added/removed.

### Setting Memory Limits

**Why set limits:**

- Prevent one model from consuming all GPU memory
- Ensure fair sharing between models
- Avoid OOM errors

**How to set:**

```python
import subprocess
import json

def set_model_memory_limit(model_name: str, limit_gb: float):
    """Set memory limit for a model's IPC segment."""

    ipc_segment = get_ipc_segment_name(model_name)

    # Set limit via kvctl
    subprocess.run([
        "kvctl", "limit", ipc_segment, f"{limit_gb}G"
    ])

def get_memory_usage() -> dict:
    """Get current memory usage from kvctl."""

    result = subprocess.run(
        ["kvctl", "list", "--json"],
        capture_output=True,
        text=True
    )

    return json.loads(result.stdout)

# Usage
set_model_memory_limit("meta-llama/Llama-3.2-1B", 10.0)  # 10GB limit
usage = get_memory_usage()
```

### Memory Allocation Strategy

**Recommended approach:**

```python
class MemoryAllocator:
    """Allocate GPU memory fairly among models."""

    def __init__(self, total_gpu_memory_gb: float = 24.0):
        self.total_memory = total_gpu_memory_gb
        self.reserved_for_weights = 0.1  # 10% reserved
        self.available_for_kv = total_gpu_memory_gb * 0.9

    def calculate_limit(self, num_models: int) -> float:
        """Calculate memory limit per model."""
        # Divide available memory evenly
        return self.available_for_kv / num_models

    def update_limits(self, models: list):
        """Update memory limits for all models."""
        limit_per_model = self.calculate_limit(len(models))

        for model in models:
            set_model_memory_limit(model, limit_per_model)

# Usage
allocator = MemoryAllocator(total_gpu_memory_gb=24.0)

# User loads 3 models
models = ["meta-llama/Llama-3.2-1B", "Qwen/Qwen3-0.6B", "microsoft/Phi-3-mini"]
allocator.update_limits(models)  # Each gets ~7.2GB
```

## Monitoring and Observability

### Health Checks

**Per-model health:**

```python
def check_model_health(model_path: str) -> dict:
    """Check if model is responding."""

    port = running_models[model_path]["port"]

    try:
        response = requests.get(
            f"http://localhost:{port}/health",
            timeout=5
        )
        return {
            "model": model_path,
            "status": "healthy",
            "response_time_ms": response.elapsed.total_seconds() * 1000
        }
    except Exception as e:
        return {
            "model": model_path,
            "status": "unhealthy",
            "error": str(e)
        }
```

**Overall system health:**

```python
def check_system_health() -> dict:
    """Check health of all models and system."""

    model_health = [
        check_model_health(model)
        for model in running_models.keys()
    ]

    memory_usage = get_memory_usage()

    return {
        "models": model_health,
        "total_models": len(running_models),
        "healthy_models": sum(1 for m in model_health if m["status"] == "healthy"),
        "gpu_memory_usage_percent": (memory_usage["used"] / memory_usage["total"]) * 100
    }
```

### Usage Metrics

**Track per-model usage:**

```python
class UsageTracker:
    """Track model usage statistics."""

    def __init__(self):
        self.stats = {}

    def record_request(self, model: str, duration_ms: float, success: bool):
        """Record a request."""
        if model not in self.stats:
            self.stats[model] = {
                "total_requests": 0,
                "successful_requests": 0,
                "failed_requests": 0,
                "total_duration_ms": 0,
                "last_request_at": None
            }

        self.stats[model]["total_requests"] += 1
        if success:
            self.stats[model]["successful_requests"] += 1
        else:
            self.stats[model]["failed_requests"] += 1

        self.stats[model]["total_duration_ms"] += duration_ms
        self.stats[model]["last_request_at"] = datetime.now()

    def get_stats(self, model: Optional[str] = None) -> dict:
        """Get usage statistics."""
        if model:
            return self.stats.get(model, {})
        return self.stats

# Usage with request routing
tracker = UsageTracker()

@app.post("/v1/completions")
async def completions(request: Request):
    data = await request.json()
    model = data["model"]

    start = time.time()
    try:
        response = forward_to_model(model, data)
        success = True
    except Exception as e:
        success = False
        raise
    finally:
        duration_ms = (time.time() - start) * 1000
        tracker.record_request(model, duration_ms, success)

    return response
```

## Implementation Roadmap

### Phase 1: Basic Model Management (Week 1-2)

**Goals:**

- Launch and stop individual vLLM instances
- Basic health checks
- Simple request routing

**Tasks:**

1. Implement `ModelManager` class
   - `launch_model()`
   - `unload_model()`
   - `list_models()`

2. Create backend API endpoints
   - POST `/api/models/load`
   - DELETE `/api/models/{model_name}`
   - GET `/api/models`

3. Implement request forwarding
   - POST `/v1/completions`
   - POST `/v1/chat/completions`

4. Basic testing
   - Load 2-3 models
   - Verify memory sharing
   - Test request routing

**Deliverable:** Backend can load/unload models and route requests

### Phase 2: Memory Management (Week 3)

**Goals:**

- Monitor GPU memory usage
- Set memory limits per model
- Prevent OOM errors

**Tasks:**

1. Integrate kvctl for memory monitoring
   - Parse `kvctl list --json` output
   - Expose via API

2. Implement memory allocation strategy
   - Calculate fair limits
   - Update limits when models change

3. Add memory management API
   - GET `/api/memory/usage`
   - POST `/api/memory/limits`

4. Frontend integration
   - Display memory usage in UI
   - Show per-model allocation

**Deliverable:** Full memory visibility and control

### Phase 3: Monitoring & Observability (Week 4)

**Goals:**

- Track usage metrics
- Health monitoring
- Error handling

**Tasks:**

1. Implement usage tracking
   - Per-model request counts
   - Success/failure rates
   - Response times

2. Health check system
   - Periodic health checks
   - Alert on failures
   - Automatic recovery (optional)

3. Logging and debugging
   - Structured logging
   - Error tracking
   - Performance profiling

**Deliverable:** Production-ready monitoring

### Phase 4: Advanced Features (Week 5+)

**Optional enhancements:**

1. **Automatic model sleep/wake**
   - Track idle time per model
   - Sleep idle models (stop process)
   - Wake on first request

2. **Load balancing**
   - Multiple instances of same model
   - Distribute requests evenly

3. **Model caching**
   - Cache frequently-used models
   - Faster reload times

4. **Resource quotas**
   - Limit total GPU memory usage
   - Queue model loads if at capacity

## Trade-offs and Considerations

### What We Gain

✅ **True dynamic model management**

- Add/remove models without downtime
- No impact on running models
- Instant response to user actions

✅ **Full control**

- Custom routing logic
- Flexible health checks
- Tailored monitoring

✅ **Simpler architecture**

- No Controller dependency
- Fewer moving parts
- Easier debugging

✅ **Same kvcached benefits**

- GPU memory sharing still works
- Multiple models coexist
- Memory management via kvctl

### What We Lose

❌ **Unified router**

- Need to implement our own
- More code to maintain

❌ **Automatic sleep/wake**

- Would need to implement ourselves
- Or just let models run (simpler)

❌ **Integrated traffic monitoring**

- Need to track our own metrics
- But gives us more control

❌ **Declarative configuration**

- No single YAML file
- But configuration is more dynamic

### Assessment

The trade-offs heavily favor direct management for sardeenz:

**Critical for us:**

- ✅ No downtime when adding models
- ✅ Dynamic, user-driven model selection
- ✅ Fast response to user actions

**Nice to have (Controller features):**

- ⚠️ Unified router - Easy to implement ourselves
- ⚠️ Auto sleep - Optional, can add later if needed
- ⚠️ Traffic monitoring - We need custom metrics anyway

**Conclusion:** Direct management is the right choice.

## Testing Strategy

### Unit Tests

```python
import unittest
from model_manager import ModelManager

class TestModelManager(unittest.TestCase):
    def setUp(self):
        self.manager = ModelManager()

    def test_launch_model(self):
        """Test launching a model."""
        result = self.manager.launch_model("meta-llama/Llama-3.2-1B")
        self.assertEqual(result["status"], "success")
        self.assertIn("port", result)

    def test_unload_model(self):
        """Test unloading a model."""
        self.manager.launch_model("meta-llama/Llama-3.2-1B")
        result = self.manager.unload_model("meta-llama/Llama-3.2-1B")
        self.assertEqual(result["status"], "success")

    def test_multiple_models(self):
        """Test running multiple models simultaneously."""
        self.manager.launch_model("meta-llama/Llama-3.2-1B")
        self.manager.launch_model("Qwen/Qwen3-0.6B")

        models = self.manager.list_models()
        self.assertEqual(len(models["models"]), 2)
```

### Integration Tests

```python
def test_kvcached_memory_sharing():
    """Test that models share GPU memory via kvcached."""

    manager = ModelManager()

    # Launch first model
    manager.launch_model("meta-llama/Llama-3.2-1B")

    # Check memory usage
    usage1 = get_memory_usage()
    total_used_1 = sum(seg["used"] for seg in usage1.values())

    # Launch second model
    manager.launch_model("Qwen/Qwen3-0.6B")

    # Check memory usage again
    usage2 = get_memory_usage()
    total_used_2 = sum(seg["used"] for seg in usage2.values())

    # Verify both models are using shared memory
    assert len(usage2) == 2  # Two IPC segments
    assert total_used_2 < GPU_TOTAL_MEMORY  # Sharing works
```

### Manual Testing Checklist

- [ ] Load a single model successfully
- [ ] Load multiple models simultaneously
- [ ] Verify models appear in kvtop
- [ ] Send requests to each model
- [ ] Unload one model while others continue running
- [ ] Check memory is released after unload
- [ ] Reload a model after unloading
- [ ] Test error handling (invalid model path, OOM, etc.)
- [ ] Verify health checks work
- [ ] Test API endpoints from frontend

## Next Steps

1. **Review this integration guide** with the team
2. **Implement Phase 1** (basic model management)
3. **Test with 2-3 small models** first
4. **Iterate based on findings**
5. **Expand to larger models and more features**

## Questions or Issues

If you encounter issues during implementation:

1. **Check kvcached documentation** in this repository:
   - `docs/kvcached/README.md` - Overview
   - `docs/kvcached/architecture.md` - How it works
   - `docs/kvcached/cli-tools.md` - Memory management

2. **Verify environment variables:**

   ```bash
   echo $ENABLE_KVCACHED        # Should be "true"
   echo $KVCACHED_AUTOPATCH     # Should be "1"
   ```

3. **Check vLLM is using kvcached:**

   ```bash
   kvctl list  # Should show IPC segments
   ```

4. **Review vLLM logs** for errors

5. **Test with smallest models first** (Llama-3.2-1B, Qwen3-0.6B)

## Summary

**Integration approach:** Direct vLLM instance management with kvcached enabled

**Key decisions:**

- ❌ Don't use kvcached Controller (too inflexible)
- ✅ Launch vLLM instances directly
- ✅ Backend implements routing and lifecycle management
- ✅ Use kvctl/kvtop for memory monitoring
- ✅ kvcached provides GPU memory sharing automatically

**Implementation roadmap:**

1. Basic model management
2. Memory management
3. Monitoring & observability
4. Advanced features (optional)

**Next step:** Implement Phase 1 and test with small models.
