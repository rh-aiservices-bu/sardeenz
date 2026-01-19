# kvcached Model Lifecycle Management

This document describes how to manage the lifecycle of vLLM models using kvcached, including loading, unloading, sleeping, waking, and monitoring model usage.

## Table of Contents

- [Model Lifecycle Overview](#model-lifecycle-overview)
- [Loading Models](#loading-models)
- [Unloading Models](#unloading-models)
- [Model Sleep and Wake](#model-sleep-and-wake)
- [Usage Reporting and Monitoring](#usage-reporting-and-monitoring)
- [Complete Workflows](#complete-workflows)
- [Integration Patterns for sardeenz](#integration-patterns-for-sardeenz)

## Model Lifecycle Overview

kvcached models go through several states during their lifecycle:

```
┌─────────────┐
│   Not       │
│  Loaded     │
└──────┬──────┘
       │ Launch
       ▼
┌─────────────┐
│  Starting   │
└──────┬──────┘
       │ Ready
       ▼
┌─────────────┐     Idle > threshold      ┌─────────────┐
│   Active    │────────────────────────────>│  Sleeping   │
│ (Running)   │                             │  (Idle)     │
└──────┬──────┘<────────────────────────────┘─────────────┘
       │                Request received
       │ Shutdown/Unload
       ▼
┌─────────────┐
│  Stopped    │
└─────────────┘
```

### State Definitions

- **Not Loaded**: Model is not running; no resources allocated
- **Starting**: Model process is launching; initializing weights and KV cache
- **Active**: Model is running and ready to serve requests
- **Sleeping**: Model is idle; GPU memory released but process still running for fast wake-up
- **Stopped**: Model process has been terminated; all resources released

## Loading Models

There are three methods to load models with kvcached:

1. **Controller Launch** (Recommended for multi-model setups)
2. **Manual vLLM Launch** (For single models or custom setups)
3. **Programmatic Launch** (For backend integration)

### Method 1: Controller Launch

Use the kvcached Controller to launch and manage multiple models from a YAML configuration.

**Configuration File** (`config.yaml`):

```yaml
kvcached:
  gpu_memory_utilization: 0.9
  log_level: INFO

router:
  enabled: true
  host: '0.0.0.0'
  port: 8080

instances:
  - name: 'llama-3.2-1b'
    model: 'meta-llama/Llama-3.2-1B'
    engine: 'vllm'
    port: 12346
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      max_model_len: 4096

  - name: 'qwen-0.6b'
    model: 'Qwen/Qwen3-0.6B'
    engine: 'vllm'
    port: 12347
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      max_model_len: 4096
```

**Launch Command**:

```bash
python -m controller.launch --config config.yaml
```

**What Happens**:

1. Controller reads configuration
2. For each instance:
   - Creates tmux session
   - Sets environment variables
   - Launches vLLM server
   - Waits for model to be ready
3. Starts router/frontend on port 8080
4. Begins traffic monitoring and sleep management

**Checking Status**:

```bash
# Check models are running
curl http://localhost:8080/models

# Check health
curl http://localhost:8080/health
```

### Method 2: Manual vLLM Launch

Launch vLLM directly with kvcached enabled.

**Command**:

```bash
# Set environment variables
export ENABLE_KVCACHED=true
export KVCACHED_AUTOPATCH=1

# Launch vLLM
vllm serve meta-llama/Llama-3.2-1B \
  --disable-log-requests \
  --no-enable-prefix-caching \
  --port=12346 \
  --gpu-memory-utilization=0.9 \
  --max-model-len=4096
```

**Verification**:

```bash
# Check vLLM is responding
curl http://localhost:12346/v1/models

# Check kvcached IPC segment
kvctl list
```

**Use Cases**:

- Single model deployment
- Testing and development
- Custom launch scripts
- Integration with existing infrastructure

### Method 3: Programmatic Launch

Launch models from Python code for backend integration.

**Python Example**:

```python
import subprocess
import os
import time
import requests

def launch_vllm_model(model_path, port, max_tokens=4096):
    """Launch a vLLM model with kvcached enabled."""

    # Set environment
    env = os.environ.copy()
    env["ENABLE_KVCACHED"] = "true"
    env["KVCACHED_AUTOPATCH"] = "1"

    # Build command
    cmd = [
        "vllm", "serve", model_path,
        "--disable-log-requests",
        "--no-enable-prefix-caching",
        f"--port={port}",
        "--gpu-memory-utilization=0.9",
        f"--max-model-len={max_tokens}"
    ]

    # Launch process
    process = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Wait for model to be ready
    max_retries = 30
    for i in range(max_retries):
        try:
            response = requests.get(f"http://localhost:{port}/health")
            if response.status_code == 200:
                print(f"Model {model_path} ready on port {port}")
                return process
        except requests.exceptions.ConnectionError:
            pass

        time.sleep(2)

    raise RuntimeError(f"Model {model_path} failed to start")

# Usage
process = launch_vllm_model("meta-llama/Llama-3.2-1B", port=12346)
```

**Enhanced with Controller Integration**:

```python
import yaml
import subprocess

def launch_with_controller(models):
    """Launch multiple models using kvcached controller."""

    # Generate config
    config = {
        "kvcached": {
            "gpu_memory_utilization": 0.9,
            "log_level": "INFO"
        },
        "router": {
            "enabled": True,
            "host": "0.0.0.0",
            "port": 8080
        },
        "sleep_manager": {
            "enabled": True,
            "idle_threshold_seconds": 300,
            "auto_sleep_enabled": True
        },
        "instances": []
    }

    # Add model instances
    for i, model in enumerate(models):
        instance = {
            "name": f"model-{i}",
            "model": model["path"],
            "engine": "vllm",
            "port": 12346 + i,
            "env": {
                "ENABLE_KVCACHED": "true",
                "KVCACHED_AUTOPATCH": "1"
            },
            "engine_args": {
                "disable_log_requests": True,
                "enable_prefix_caching": False,
                "max_model_len": model.get("max_len", 4096)
            }
        }
        config["instances"].append(instance)

    # Write config
    config_path = "/tmp/kvcached-config.yaml"
    with open(config_path, "w") as f:
        yaml.dump(config, f)

    # Launch controller
    process = subprocess.Popen([
        "python", "-m", "controller.launch",
        "--config", config_path
    ])

    return process

# Usage
models = [
    {"path": "meta-llama/Llama-3.2-1B", "max_len": 4096},
    {"path": "Qwen/Qwen3-0.6B", "max_len": 4096}
]
process = launch_with_controller(models)
```

## Unloading Models

Models can be unloaded by stopping their processes. **Important:** When using kvcached with shared memory, you must use SIGKILL (not SIGTERM) to avoid deleting the shared IPC segment.

### Understanding IPC Lifecycle

kvcached uses a shared IPC segment (`kvcached_mem_info`) for all models. When a vLLM process receives SIGTERM, Python's signal handlers run `MemInfoTracker.cleanup()` which deletes this shared segment, breaking all other running models.

**Solution:** Use SIGKILL to bypass signal handlers. The shared IPC segment is only deleted on server shutdown when all models are gone.

### Understanding vLLM Process Tree

vLLM spawns multiple processes:

- **API Server** (parent) - handles HTTP requests, no GPU memory
- **EngineCore** (child) - allocates and uses GPU VRAM

SIGKILL only kills the target process - it doesn't propagate to children. If you only kill the parent, the EngineCore child becomes an orphan and continues consuming GPU memory. **You must kill all descendant processes before killing the parent.**

### Method 1: Stop vLLM Process (SIGKILL)

**If launched manually**:

```bash
# Find process
ps aux | grep vllm

# Use SIGKILL (-9), NOT SIGTERM
kill -9 <PID>

# Or use pkill with -9
pkill -9 -f "vllm serve meta-llama/Llama-3.2-1B"
```

> **Warning:** Do NOT use `kill <PID>` without `-9` as it sends SIGTERM which triggers IPC cleanup.

**If launched via controller (tmux)**:

```bash
# List tmux sessions
tmux list-sessions

# Kill specific session (sends SIGKILL by default)
tmux kill-session -t <session-name>
```

### Method 2: Programmatic Termination

**Python Example**:

```python
import subprocess
import signal
import os

def get_descendant_pids(parent_pid):
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

def stop_vllm_process(process):
    """Stop a vLLM process and all its children using SIGKILL.

    IMPORTANT: Must kill descendants (EngineCore) before parent!
    - SIGKILL doesn't propagate to children
    - EngineCore is the process that allocates GPU VRAM
    - SIGTERM would trigger IPC cleanup, breaking other models
    """
    # Get all descendant PIDs (includes EngineCore)
    descendants = get_descendant_pids(process.pid)

    # Kill descendants first (frees GPU memory)
    for pid in descendants:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    # Kill parent process
    process.kill()  # SIGKILL
    process.wait()
    print("Process and all children stopped")

def stop_vllm_by_port(port):
    """Stop vLLM process listening on specific port."""

    # Find process using port
    result = subprocess.run(
        ["lsof", "-ti", f":{port}"],
        capture_output=True,
        text=True
    )

    if result.stdout:
        pid = int(result.stdout.strip())

        # Kill descendants first
        descendants = get_descendant_pids(pid)
        for child_pid in descendants:
            try:
                os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

        # Kill parent
        os.kill(pid, signal.SIGKILL)
        print(f"Stopped process on port {port}")
    else:
        print(f"No process found on port {port}")

# Usage
stop_vllm_by_port(12346)
```

### Method 3: Controller Shutdown

Stop the entire controller and all managed models:

```bash
# Find controller process
ps aux | grep "controller.launch"

# Use SIGKILL
kill -9 <PID>

# Or use Ctrl+C if running in foreground (followed by cleanup)
```

### IPC Cleanup (Server Shutdown Only)

**Do NOT** delete IPC segments when unloading individual models. The shared segment is only deleted when the server shuts down:

```bash
# Only after ALL models are unloaded:
kvctl delete kvcached_mem_info
```

```python
def shutdown_all(self):
    """Shutdown all models and clean up shared resources."""
    # First, unload all models
    for model_path in list(self.running_models.keys()):
        self.unload_model(model_path)

    # Now it's safe to delete the shared IPC segment
    subprocess.run(["kvctl", "delete", "kvcached_mem_info"])
```

> **Note:** If you're only unloading one model while others continue running, do NOT call `kvctl delete`. The shared IPC segment must remain for other models.

## Model Sleep and Wake

kvcached's key feature is the ability to put models to sleep and wake them on demand.

### Automatic Sleep

When `auto_sleep_enabled: true` in configuration, the Sleep Manager automatically puts idle models to sleep.

**Configuration**:

```yaml
sleep_manager:
  enabled: true
  auto_sleep_enabled: true
  idle_threshold_seconds: 300 # 5 minutes
  min_sleep_duration_seconds: 60
  check_interval_seconds: 60
```

**Behavior**:

1. Traffic Monitor tracks last request time per model
2. Sleep Manager checks idle times every `check_interval_seconds`
3. Models idle > `idle_threshold_seconds` are put to sleep
4. GPU memory is released
5. Process remains running for fast wake-up

**Checking Sleep Status**:

```bash
curl http://localhost:8080/sleep/status
```

**Response**:

```json
{
  "models": {
    "meta-llama/Llama-3.2-1B": {
      "status": "sleeping",
      "sleep_time": "2025-11-08T10:25:00Z",
      "sleep_duration": 180
    },
    "Qwen/Qwen3-0.6B": {
      "status": "active",
      "last_activity": "2025-11-08T10:28:00Z"
    }
  }
}
```

### Manual Sleep

Put a model to sleep manually via API:

**cURL**:

```bash
MODEL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl -X POST http://localhost:8080/action/sleep/$MODEL \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Python**:

```python
import requests
import urllib.parse

def put_model_to_sleep(model_name, base_url="http://localhost:8080"):
    """Put a model to sleep."""
    encoded_name = urllib.parse.quote(model_name)
    url = f"{base_url}/action/sleep/{encoded_name}"

    response = requests.post(url, json={})
    return response.json()

# Usage
result = put_model_to_sleep("meta-llama/Llama-3.2-1B")
print(result)
```

**Response (Success)**:

```json
{
  "status": "success",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Model put to sleep",
  "timestamp": "2025-11-08T10:30:00Z"
}
```

### Automatic Wake on Request

When a request arrives for a sleeping model, it is automatically woken up.

**Flow**:

1. Client sends request to sleeping model
2. Router detects model is asleep
3. Sleep Manager wakes up model
4. Router waits for model to be ready
5. Request is forwarded to model
6. Response returned to client

**Example**:

```python
import requests

# Model is sleeping
# Send request (will trigger automatic wake)
response = requests.post(
    "http://localhost:8080/v1/completions",
    json={
        "model": "meta-llama/Llama-3.2-1B",
        "prompt": "Hello",
        "max_tokens": 10
    }
)

# First request may be slower due to wake time
# Subsequent requests are normal speed
```

**Wake-Up Latency**:

- Typically: 2-10 seconds
- Depends on model size and hardware
- First request after wake is slower
- Subsequent requests are normal

### Manual Wake

Wake a sleeping model manually:

**cURL**:

```bash
MODEL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl -X POST http://localhost:8080/action/wakeup/$MODEL \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Python**:

```python
def wake_up_model(model_name, base_url="http://localhost:8080"):
    """Wake up a sleeping model."""
    encoded_name = urllib.parse.quote(model_name)
    url = f"{base_url}/action/wakeup/{encoded_name}"

    response = requests.post(url, json={})
    return response.json()

# Usage
result = wake_up_model("meta-llama/Llama-3.2-1B")
print(result)
```

**Response (Success)**:

```json
{
  "status": "success",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Model woken up",
  "timestamp": "2025-11-08T10:35:00Z"
}
```

**Response (Error - Too Soon)**:

```json
{
  "status": "error",
  "model": "meta-llama/Llama-3.2-1B",
  "message": "Minimum sleep duration (60s) not met. Slept for 30s.",
  "min_sleep_duration": 60,
  "actual_sleep_duration": 30
}
```

### Sleep Candidates

Check which models are eligible for sleep:

```bash
curl http://localhost:8080/sleep/candidates
```

**Response**:

```json
{
  "candidates": [
    {
      "model": "meta-llama/Llama-3.2-1B",
      "idle_time": 450,
      "last_activity": "2025-11-08T10:20:00Z",
      "threshold": 300
    }
  ],
  "auto_sleep_enabled": true,
  "idle_threshold": 300
}
```

## Usage Reporting and Monitoring

kvcached provides comprehensive usage reporting through traffic monitoring and memory tracking.

### Traffic Statistics

Get overall traffic stats:

```bash
curl http://localhost:8080/traffic/stats
```

**Response**:

```json
{
  "overall": {
    "total_requests": 1250,
    "successful_requests": 1230,
    "failed_requests": 20,
    "request_rate": 12.5,
    "avg_response_time": 0.85
  },
  "by_model": {
    "meta-llama/Llama-3.2-1B": {
      "total_requests": 800,
      "successful_requests": 795,
      "failed_requests": 5,
      "request_rate": 8.0,
      "avg_response_time": 0.75,
      "last_activity": "2025-11-08T10:35:00Z"
    },
    "Qwen/Qwen3-0.6B": {
      "total_requests": 450,
      "successful_requests": 435,
      "failed_requests": 15,
      "request_rate": 4.5,
      "avg_response_time": 0.95,
      "last_activity": "2025-11-08T10:34:30Z"
    }
  }
}
```

**Per-Model Stats**:

```bash
MODEL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl http://localhost:8080/traffic/stats/$MODEL
```

**Time-Windowed Stats** (last 5 minutes):

```bash
curl http://localhost:8080/traffic/stats?window=300
```

### Memory Usage Monitoring

Use CLI tools to monitor memory:

**kvctl** (detailed view):

```bash
kvctl list
```

**Output**:

```
IPC Name         Total      Used       Free       Limit      Usage
─────────────────────────────────────────────────────────────────
VLLM_MODEL_1     8.0 GB     4.2 GB     3.8 GB     6.0 GB     52%
VLLM_MODEL_2     6.0 GB     1.5 GB     4.5 GB     6.0 GB     25%
```

**kvtop** (real-time visual):

```bash
kvtop
```

**JSON Output for Programmatic Access**:

```bash
kvctl list --json
```

```json
{
  "VLLM_MODEL_1": {
    "total": 8589934592,
    "used": 4496293888,
    "free": 4093640704,
    "limit": 8589934592,
    "usage_percent": 52.3
  }
}
```

### Active vs. Idle Models

**Active Models**:

```bash
curl http://localhost:8080/models/active
```

**Idle Models**:

```bash
curl http://localhost:8080/models/idle
```

### Health Checks

**Overall Health**:

```bash
curl http://localhost:8080/health
```

**Per-Model Health**:

```bash
MODEL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('meta-llama/Llama-3.2-1B'))")
curl http://localhost:8080/health/$MODEL
```

### Programmatic Monitoring

**Python Example**:

```python
import requests

class kvcachedMonitor:
    """Monitor kvcached models."""

    def __init__(self, base_url="http://localhost:8080"):
        self.base_url = base_url

    def get_traffic_stats(self, window_seconds=None):
        """Get traffic statistics."""
        url = f"{self.base_url}/traffic/stats"
        params = {"window": window_seconds} if window_seconds else {}
        response = requests.get(url, params=params)
        return response.json()

    def get_model_stats(self, model_name, window_seconds=None):
        """Get stats for specific model."""
        import urllib.parse
        encoded_name = urllib.parse.quote(model_name)
        url = f"{self.base_url}/traffic/stats/{encoded_name}"
        params = {"window": window_seconds} if window_seconds else {}
        response = requests.get(url, params=params)
        return response.json()

    def get_sleep_status(self):
        """Get sleep status of all models."""
        url = f"{self.base_url}/sleep/status"
        response = requests.get(url)
        return response.json()

    def get_active_models(self, threshold=300):
        """Get list of active models."""
        url = f"{self.base_url}/models/active"
        params = {"threshold": threshold}
        response = requests.get(url, params=params)
        return response.json()

    def get_idle_models(self, threshold=300):
        """Get list of idle models."""
        url = f"{self.base_url}/models/idle"
        params = {"threshold": threshold}
        response = requests.get(url, params=params)
        return response.json()

# Usage
monitor = kvcachedMonitor()

# Get overall stats
stats = monitor.get_traffic_stats()
print(f"Total requests: {stats['overall']['total_requests']}")

# Get model-specific stats
model_stats = monitor.get_model_stats("meta-llama/Llama-3.2-1B")
print(f"Model request rate: {model_stats['request_rate']} req/min")

# Check sleep status
sleep_status = monitor.get_sleep_status()
for model, status in sleep_status['models'].items():
    print(f"{model}: {status['status']}")

# Get active models
active = monitor.get_active_models()
print(f"Active models: {len(active['active_models'])}")
```

## Complete Workflows

### Workflow 1: Launch Multiple Models and Monitor

```bash
# 1. Create configuration
cat > config.yaml << EOF
kvcached:
  gpu_memory_utilization: 0.9
  log_level: INFO

router:
  enabled: true
  host: "0.0.0.0"
  port: 8080

sleep_manager:
  enabled: true
  idle_threshold_seconds: 300
  auto_sleep_enabled: true

instances:
  - name: "llama-3.2-1b"
    model: "meta-llama/Llama-3.2-1B"
    engine: "vllm"
    port: 12346
    env:
      ENABLE_KVCACHED: "true"
      KVCACHED_AUTOPATCH: "1"
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false

  - name: "qwen-0.6b"
    model: "Qwen/Qwen3-0.6B"
    engine: "vllm"
    port: 12347
    env:
      ENABLE_KVCACHED: "true"
      KVCACHED_AUTOPATCH: "1"
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
EOF

# 2. Launch controller
python -m controller.launch --config config.yaml &

# 3. Wait for startup
sleep 30

# 4. Check models are loaded
curl http://localhost:8080/models

# 5. Monitor memory usage
kvtop &

# 6. Send test requests
curl http://localhost:8080/v1/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/Llama-3.2-1B","prompt":"Hello","max_tokens":10}'

# 7. Check traffic stats
curl http://localhost:8080/traffic/stats

# 8. Check sleep status (after 5+ minutes of idle)
curl http://localhost:8080/sleep/status
```

### Workflow 2: Dynamic Model Management

```python
"""
Dynamic model management workflow.
Add and remove models based on demand.
"""
import time
import requests
import subprocess

class DynamicModelManager:
    def __init__(self):
        self.active_models = {}
        self.base_port = 12346

    def launch_model(self, model_path, name=None):
        """Launch a new model dynamically."""
        if name is None:
            name = model_path.split("/")[-1]

        port = self.base_port + len(self.active_models)

        # Launch vLLM
        import os
        env = os.environ.copy()
        env["ENABLE_KVCACHED"] = "true"
        env["KVCACHED_AUTOPATCH"] = "1"

        cmd = [
            "vllm", "serve", model_path,
            "--disable-log-requests",
            "--no-enable-prefix-caching",
            f"--port={port}"
        ]

        process = subprocess.Popen(cmd, env=env)

        # Wait for ready
        for _ in range(30):
            try:
                response = requests.get(f"http://localhost:{port}/health")
                if response.status_code == 200:
                    break
            except:
                pass
            time.sleep(2)

        # Store reference
        self.active_models[name] = {
            "process": process,
            "port": port,
            "model_path": model_path
        }

        print(f"Launched {name} on port {port}")

    def stop_model(self, name):
        """Stop a model."""
        if name in self.active_models:
            self.active_models[name]["process"].terminate()
            self.active_models[name]["process"].wait(timeout=30)
            del self.active_models[name]
            print(f"Stopped {name}")

    def list_models(self):
        """List active models."""
        return list(self.active_models.keys())

# Usage
manager = DynamicModelManager()

# Launch models based on demand
manager.launch_model("meta-llama/Llama-3.2-1B", "llama")
manager.launch_model("Qwen/Qwen3-0.6B", "qwen")

# List active
print("Active:", manager.list_models())

# Later: stop unused model
time.sleep(600)
manager.stop_model("qwen")
```

### Workflow 3: Batch Processing with Sleep Management

```python
"""
Process batches of requests with automatic model sleep between batches.
"""
import requests
import time
import urllib.parse

class BatchProcessor:
    def __init__(self, base_url="http://localhost:8080"):
        self.base_url = base_url

    def process_batch(self, model_name, prompts):
        """Process a batch of prompts."""
        results = []

        for prompt in prompts:
            response = requests.post(
                f"{self.base_url}/v1/completions",
                json={
                    "model": model_name,
                    "prompt": prompt,
                    "max_tokens": 50
                }
            )
            results.append(response.json())

        return results

    def sleep_model(self, model_name):
        """Put model to sleep."""
        encoded = urllib.parse.quote(model_name)
        response = requests.post(
            f"{self.base_url}/action/sleep/{encoded}",
            json={}
        )
        return response.json()

# Usage
processor = BatchProcessor()

# Process batch 1
batch1 = ["Hello", "How are you?", "What is AI?"]
results1 = processor.process_batch("meta-llama/Llama-3.2-1B", batch1)

# Put model to sleep
processor.sleep_model("meta-llama/Llama-3.2-1B")

# Wait for next batch
time.sleep(300)

# Process batch 2 (model will auto-wake)
batch2 = ["Explain Python", "What is machine learning?"]
results2 = processor.process_batch("meta-llama/Llama-3.2-1B", batch2)
```

## Integration Patterns for sardeenz

### Pattern 1: Backend-Managed Lifecycle

The sardeenz backend manages the entire model lifecycle:

```python
class ModelStackerBackend:
    """Backend for sardeenz with kvcached integration."""

    def __init__(self):
        self.controller_process = None
        self.active_models = []

    def deploy_models(self, model_configs):
        """Deploy multiple models using kvcached controller."""

        # Generate YAML config
        config = self._generate_config(model_configs)

        # Write config file
        config_path = "/tmp/kvcached-config.yaml"
        with open(config_path, "w") as f:
            yaml.dump(config, f)

        # Launch controller
        self.controller_process = subprocess.Popen([
            "python", "-m", "controller.launch",
            "--config", config_path
        ])

        # Wait for models to be ready
        self._wait_for_models()

        self.active_models = [m["name"] for m in model_configs]

    def _generate_config(self, model_configs):
        """Generate kvcached YAML config."""
        return {
            "kvcached": {
                "gpu_memory_utilization": 0.9,
                "log_level": "INFO"
            },
            "router": {
                "enabled": True,
                "host": "0.0.0.0",
                "port": 8080
            },
            "sleep_manager": {
                "enabled": True,
                "idle_threshold_seconds": 300,
                "auto_sleep_enabled": True
            },
            "instances": [
                {
                    "name": m["name"],
                    "model": m["path"],
                    "engine": "vllm",
                    "port": 12346 + i,
                    "env": {
                        "ENABLE_KVCACHED": "true",
                        "KVCACHED_AUTOPATCH": "1"
                    },
                    "engine_args": {
                        "disable_log_requests": True,
                        "enable_prefix_caching": False,
                        "max_model_len": m.get("max_len", 4096)
                    }
                }
                for i, m in enumerate(model_configs)
            ]
        }

    def _wait_for_models(self, timeout=120):
        """Wait for all models to be ready."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                response = requests.get("http://localhost:8080/health")
                if response.status_code == 200:
                    return True
            except:
                pass
            time.sleep(5)
        raise TimeoutError("Models failed to start")

    def get_model_stats(self):
        """Get usage statistics for all models."""
        response = requests.get("http://localhost:8080/traffic/stats")
        return response.json()

    def shutdown(self):
        """Shutdown all models."""
        if self.controller_process:
            self.controller_process.terminate()
            self.controller_process.wait()

# Usage in sardeenz
backend = ModelStackerBackend()

# User selects models
models = [
    {"name": "llama", "path": "meta-llama/Llama-3.2-1B", "max_len": 4096},
    {"name": "qwen", "path": "Qwen/Qwen3-0.6B", "max_len": 4096}
]

# Deploy
backend.deploy_models(models)

# Get stats for dashboard
stats = backend.get_model_stats()

# Shutdown when done
backend.shutdown()
```

### Pattern 2: API Proxy with Usage Tracking

sardeenz acts as a proxy, tracking usage and managing sleep:

```python
from flask import Flask, request, jsonify
import requests

app = Flask(__name__)
KVCACHED_URL = "http://localhost:8080"

@app.route("/v1/completions", methods=["POST"])
def completions():
    """Proxy completion requests to kvcached."""

    # Log request for tracking
    data = request.json
    model_name = data.get("model")

    # Forward to kvcached
    response = requests.post(
        f"{KVCACHED_URL}/v1/completions",
        json=data
    )

    return response.json(), response.status_code

@app.route("/admin/models/stats")
def model_stats():
    """Get model usage stats."""
    response = requests.get(f"{KVCACHED_URL}/traffic/stats")
    return response.json()

@app.route("/admin/models/<model_name>/sleep", methods=["POST"])
def sleep_model(model_name):
    """Put model to sleep."""
    import urllib.parse
    encoded = urllib.parse.quote(model_name)
    response = requests.post(
        f"{KVCACHED_URL}/action/sleep/{encoded}",
        json={}
    )
    return response.json()

if __name__ == "__main__":
    app.run(port=5000)
```

### Pattern 3: Event-Driven Model Management

Use events to trigger model sleep/wake based on usage patterns:

```python
import threading
import time
import requests

class EventDrivenModelManager:
    """Manage models based on usage events."""

    def __init__(self, base_url="http://localhost:8080"):
        self.base_url = base_url
        self.usage_counts = {}
        self.monitor_thread = None
        self.running = False

    def start_monitoring(self):
        """Start monitoring model usage."""
        self.running = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop)
        self.monitor_thread.start()

    def _monitor_loop(self):
        """Background monitoring loop."""
        while self.running:
            # Get traffic stats
            stats = self._get_stats()

            # Check each model
            for model, model_stats in stats.get("by_model", {}).items():
                # If model has low usage, put to sleep
                if model_stats["request_rate"] < 1.0:  # < 1 req/min
                    self._sleep_model(model)

            time.sleep(60)  # Check every minute

    def _get_stats(self):
        """Get current stats."""
        response = requests.get(f"{self.base_url}/traffic/stats?window=300")
        return response.json()

    def _sleep_model(self, model_name):
        """Put model to sleep."""
        import urllib.parse
        encoded = urllib.parse.quote(model_name)
        try:
            requests.post(f"{self.base_url}/action/sleep/{encoded}", json={})
        except:
            pass

    def stop_monitoring(self):
        """Stop monitoring."""
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join()

# Usage
manager = EventDrivenModelManager()
manager.start_monitoring()

# Let it run...
time.sleep(3600)

# Stop
manager.stop_monitoring()
```

## Best Practices

1. **Use Controller for Multi-Model**: Simplifies management and enables sleep/wake
2. **Set Memory Limits**: Use kvctl to prevent OOM errors
3. **Monitor Memory Usage**: Use kvtop during operation
4. **Configure Appropriate Sleep Thresholds**: Balance latency vs. resource efficiency
5. **Implement Health Checks**: Regularly check model health
6. **Track Usage Metrics**: Use traffic stats for capacity planning
7. **Graceful Shutdown**: Always terminate processes gracefully
8. **Clean Up IPC Segments**: Delete segments for stopped models
9. **Test Wake-Up Times**: Understand latency for your models
10. **Log Model Lifecycle Events**: Track launches, sleeps, wakes, and stops

## Troubleshooting

### Model Won't Wake Up

- Check minimum sleep duration hasn't been violated
- Verify model process is still running
- Check logs for errors
- Try manual wake via API

### High Wake-Up Latency

- Pre-allocate pages (`preallocate_pages: true`)
- Reduce model size
- Increase `gpu_memory_utilization`
- Consider keeping frequently-used models active

### Models Not Sleeping

- Verify `auto_sleep_enabled: true`
- Check idle threshold is appropriate
- Ensure models are actually idle (check traffic stats)
- Review sleep manager logs

### Memory Fragmentation

- Restart models periodically
- Use consistent model sizes
- Set appropriate memory limits
- Monitor with kvtop

## Related Documentation

- [api-reference.md](./api-reference.md) - API endpoints for model management
- [cli-tools.md](./cli-tools.md) - Memory management CLI tools
- [configuration.md](./configuration.md) - Configuration options
- [architecture.md](./architecture.md) - System architecture
