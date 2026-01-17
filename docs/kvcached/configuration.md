# kvcached Configuration Guide

This document describes how to configure kvcached for managing multiple vLLM models.

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [Environment Variables](#environment-variables)
- [YAML Configuration File](#yaml-configuration-file)
- [Model Instance Configuration](#model-instance-configuration)
- [Router Configuration](#router-configuration)
- [Sleep Manager Configuration](#sleep-manager-configuration)
- [kvcached Global Settings](#kvcached-global-settings)
- [Complete Configuration Examples](#complete-configuration-examples)
- [Configuration for sardeenz](#configuration-for-sardeenz)

## Configuration Overview

kvcached configuration consists of two parts:

1. **Environment Variables**: Enable kvcached and set runtime options
2. **YAML Configuration File**: Define models, router, and sleep management settings

### Configuration Hierarchy

```
Environment Variables
    ↓
YAML Configuration File
    ├── kvcached (global settings)
    ├── router (HTTP API settings)
    ├── sleep_manager (model lifecycle)
    └── instances (model definitions)
```

## Environment Variables

### Required Variables

These variables must be set for kvcached to work with vLLM:

```bash
# Enable kvcached
export ENABLE_KVCACHED=true

# Enable automatic patching of vLLM
export KVCACHED_AUTOPATCH=1
```

### Optional Variables

Additional environment variables for tuning:

```bash
# GPU utilization target (0.0-1.0)
export KVCACHED_GPU_MEMORY_UTILIZATION=0.9

# Pre-allocate pages for faster startup
export KVCACHED_PREALLOCATE_PAGES=true

# Log level (DEBUG, INFO, WARNING, ERROR)
export KVCACHED_LOG_LEVEL=INFO

# IPC segment name prefix (legacy)
export KVCACHED_IPC_PREFIX="VLLM"
```

### KVCACHED_IPC_NAME

Per-GPU IPC segment name set automatically by sardeenz backend based on GPU assignment:

```bash
# Single GPU on GPU 0
export KVCACHED_IPC_NAME="kvcached_vllm_GPU0"

# Single GPU on GPU 1
export KVCACHED_IPC_NAME="kvcached_vllm_GPU1"

# Tensor-parallel on GPUs 0 and 1
export KVCACHED_IPC_NAME="kvcached_vllm_GPU0_GPU1"

# Tensor-parallel on GPUs 0-3
export KVCACHED_IPC_NAME="kvcached_vllm_GPU0_GPU1_GPU2_GPU3"
```

This replaces the old global `kvcached_mem_info` segment with per-GPU segments for accurate multi-model memory tracking across GPUs. The sardeenz backend automatically sets this environment variable based on the model's `gpuIds` configuration.

### Setting Environment Variables

**Option 1: Shell Export**

```bash
export ENABLE_KVCACHED=true
export KVCACHED_AUTOPATCH=1
vllm serve meta-llama/Llama-3.2-1B --no-enable-prefix-caching
```

**Option 2: Inline**

```bash
ENABLE_KVCACHED=true KVCACHED_AUTOPATCH=1 vllm serve meta-llama/Llama-3.2-1B --no-enable-prefix-caching
```

**Option 3: .env File**

```bash
# .env
ENABLE_KVCACHED=true
KVCACHED_AUTOPATCH=1
KVCACHED_GPU_MEMORY_UTILIZATION=0.9
```

Load with:

```bash
source .env
# or
export $(cat .env | xargs)
```

**Option 4: Per-Instance in YAML** (see below)

## YAML Configuration File

The YAML configuration file defines the entire kvcached Controller setup, including models, router, and sleep management.

### Basic Structure

```yaml
# Global kvcached settings
kvcached:
  gpu_memory_utilization: 0.9
  preallocate_pages: true
  log_level: INFO

# Router/frontend settings
router:
  enabled: true
  host: '0.0.0.0'
  port: 8080

# Sleep management settings
sleep_manager:
  enabled: true
  idle_threshold_seconds: 300
  auto_sleep_enabled: true
  min_sleep_duration_seconds: 60

# Model instance definitions
instances:
  - name: 'model-1'
    model: 'meta-llama/Llama-3.2-1B'
    engine: 'vllm'
    # ... additional settings
```

### Configuration Sections

1. **kvcached**: Global kvcached runtime settings
2. **router**: HTTP API server configuration
3. **sleep_manager**: Model lifecycle management
4. **instances**: Individual model configurations (array)

## Model Instance Configuration

Each model instance in the `instances` array can have the following settings:

### Basic Model Settings

```yaml
instances:
  - name: 'llama-3.2-1b' # Unique identifier
    model: 'meta-llama/Llama-3.2-1B' # HuggingFace model path or local path
    engine: 'vllm' # Engine type (only "vllm" for our use)
    port: 12346 # Port for this model's vLLM server
```

**Fields**:

- `name` (string, required): Unique name for this instance
- `model` (string, required): Model identifier or path
- `engine` (string, required): Must be `"vllm"` (SGLang not used)
- `port` (integer, required): Port number for vLLM server

### Virtual Environment Settings

```yaml
instances:
  - name: "llama-3.2-1b"
    model: "meta-llama/Llama-3.2-1B"
    engine: "vllm"
    port: 12346

    # Virtual environment
    venv: "/path/to/venv"              # Path to Python virtual environment
    # or
    venv: "~/vllm-env"                 # Supports ~ expansion
```

**Field**:

- `venv` (string, optional): Path to virtual environment to use for this model

### Environment Variable Overrides

Override environment variables for specific model instances:

```yaml
instances:
  - name: 'llama-3.2-1b'
    model: 'meta-llama/Llama-3.2-1B'
    engine: 'vllm'
    port: 12346

    # Environment overrides
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
      KVCACHED_GPU_MEMORY_UTILIZATION: '0.8'
      CUDA_VISIBLE_DEVICES: '0'
      HF_TOKEN: '${HF_TOKEN}' # Reference shell environment variable
```

**Field**:

- `env` (object, optional): Key-value pairs of environment variables
- Variables can reference shell environment with `${VAR_NAME}` syntax

### Engine Arguments

Pass arguments directly to the vLLM engine:

```yaml
instances:
  - name: 'llama-3.2-1b'
    model: 'meta-llama/Llama-3.2-1B'
    engine: 'vllm'
    port: 12346

    # vLLM engine arguments
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false # Must be false for kvcached
      tensor_parallel_size: 1
      gpu_memory_utilization: 0.9
      max_model_len: 4096
      dtype: 'auto'
      trust_remote_code: true
```

**Field**:

- `engine_args` (object, optional): Arguments passed to `vllm serve`

**Important vLLM Arguments for kvcached**:

- `enable_prefix_caching`: **Must be `false`** (kvcached incompatible)
- `disable_log_requests`: Recommended for cleaner logs
- `gpu_memory_utilization`: Memory fraction for model weights (0.0-1.0)
- `tensor_parallel_size`: Number of GPUs for tensor parallelism
- `max_model_len`: Maximum sequence length

**Common vLLM Arguments**:

- `dtype`: Data type (`"auto"`, `"float16"`, `"bfloat16"`)
- `trust_remote_code`: Allow custom model code
- `download_dir`: Directory for model downloads
- `load_format`: Model loading format (`"auto"`, `"pt"`, `"safetensors"`)

### Complete Instance Example

```yaml
instances:
  - name: 'llama-3.2-1b-main'
    model: 'meta-llama/Llama-3.2-1B'
    engine: 'vllm'
    port: 12346
    venv: '~/vllm-env'

    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
      CUDA_VISIBLE_DEVICES: '0'

    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      tensor_parallel_size: 1
      gpu_memory_utilization: 0.9
      max_model_len: 4096
      dtype: 'auto'
```

## Router Configuration

Configure the HTTP API server (controller frontend):

```yaml
router:
  enabled: true # Enable/disable router
  host: '0.0.0.0' # Listen address (0.0.0.0 = all interfaces)
  port: 8080 # HTTP port
  timeout: 300 # Request timeout in seconds
```

**Fields**:

- `enabled` (boolean, default: `true`): Enable the router
- `host` (string, default: `"0.0.0.0"`): Bind address
  - `"0.0.0.0"`: Listen on all network interfaces
  - `"127.0.0.1"`: Localhost only
  - Specific IP: Bind to that IP
- `port` (integer, default: `8080`): HTTP port number
- `timeout` (integer, default: `300`): Request timeout in seconds

### Router Configuration Examples

**Development (localhost only)**:

```yaml
router:
  enabled: true
  host: '127.0.0.1'
  port: 8080
```

**Production (all interfaces)**:

```yaml
router:
  enabled: true
  host: '0.0.0.0'
  port: 8080
  timeout: 600 # 10 minutes for long requests
```

**Custom Port**:

```yaml
router:
  enabled: true
  host: '0.0.0.0'
  port: 9000
```

## Sleep Manager Configuration

Configure automatic model sleep and wake behavior:

```yaml
sleep_manager:
  enabled: true # Enable/disable sleep management
  idle_threshold_seconds: 300 # Time before model becomes sleep candidate
  auto_sleep_enabled: true # Automatically put idle models to sleep
  min_sleep_duration_seconds: 60 # Minimum time model must sleep before wake
  check_interval_seconds: 60 # How often to check for idle models
```

**Fields**:

- `enabled` (boolean, default: `true`): Enable sleep management
- `idle_threshold_seconds` (integer, default: `300`): Idle time before sleep eligibility (5 minutes)
- `auto_sleep_enabled` (boolean, default: `true`): Automatically sleep idle models
- `min_sleep_duration_seconds` (integer, default: `60`): Minimum sleep time before wake allowed
- `check_interval_seconds` (integer, default: `60`): Background check frequency

### Sleep Manager Behavior

**Idle Threshold**:

- Model is considered idle after `idle_threshold_seconds` with no requests
- Only idle models are candidates for sleep

**Auto Sleep**:

- When `auto_sleep_enabled` is `true`, background task checks for idle models every `check_interval_seconds`
- Idle models are automatically put to sleep

**Manual Sleep**:

- Even with `auto_sleep_enabled: false`, you can manually sleep models via API
- Use `/action/sleep/{model_name}` endpoint

**Minimum Sleep Duration**:

- Prevents rapid sleep/wake cycles
- If model has been asleep < `min_sleep_duration_seconds`, wake requests are rejected
- Reduces overhead from frequent state changes

### Sleep Manager Examples

**Aggressive Sleep (quick resource reclamation)**:

```yaml
sleep_manager:
  enabled: true
  idle_threshold_seconds: 120 # 2 minutes
  auto_sleep_enabled: true
  min_sleep_duration_seconds: 30 # 30 seconds
  check_interval_seconds: 30 # Check every 30s
```

**Conservative Sleep (keep models warm longer)**:

```yaml
sleep_manager:
  enabled: true
  idle_threshold_seconds: 900 # 15 minutes
  auto_sleep_enabled: true
  min_sleep_duration_seconds: 120 # 2 minutes
  check_interval_seconds: 120 # Check every 2 minutes
```

**Manual Sleep Only**:

```yaml
sleep_manager:
  enabled: true
  auto_sleep_enabled: false # No automatic sleep
  min_sleep_duration_seconds: 60
```

**Sleep Disabled**:

```yaml
sleep_manager:
  enabled: false # No sleep management
```

## kvcached Global Settings

Global kvcached runtime settings:

```yaml
kvcached:
  gpu_memory_utilization: 0.9 # GPU memory fraction for KV cache
  preallocate_pages: false # Pre-allocate memory pages
  log_level: 'INFO' # Logging level
  ipc_prefix: 'VLLM' # IPC segment name prefix
```

**Fields**:

- `gpu_memory_utilization` (float, default: `0.9`): Fraction of GPU memory for KV cache (0.0-1.0)
- `preallocate_pages` (boolean, default: `false`): Pre-allocate memory for faster startup
- `log_level` (string, default: `"INFO"`): Logging verbosity
  - `"DEBUG"`: Very verbose
  - `"INFO"`: Normal
  - `"WARNING"`: Warnings only
  - `"ERROR"`: Errors only
- `ipc_prefix` (string, default: `"VLLM"`): Prefix for IPC segment names

### GPU Memory Utilization

Controls how much GPU memory kvcached can use for KV cache:

```yaml
kvcached:
  gpu_memory_utilization: 0.9 # 90% of GPU memory
```

**Considerations**:

- Higher values = more memory for KV cache = better performance
- Lower values = reserve memory for other workloads
- Typically: 0.8-0.95 is safe
- Must account for model weights (they use separate memory)

**Example**: 24GB GPU, 2 models (8GB each for weights)

- Model weights: 16GB
- Remaining: 8GB
- `gpu_memory_utilization: 0.9` → 7.2GB for KV cache

### Pre-Allocate Pages

```yaml
kvcached:
  preallocate_pages: true
```

**Benefits**:

- Faster first request (memory already allocated)
- More predictable latency

**Drawbacks**:

- Slower startup time
- Memory unavailable to other processes even if unused

**Recommendation**: `false` for development, `true` for production

### Logging

```yaml
kvcached:
  log_level: 'DEBUG'
```

**Use Cases**:

- `DEBUG`: Troubleshooting kvcached issues
- `INFO`: Normal operation (default)
- `WARNING`: Production with minimal logging
- `ERROR`: Only critical issues

## Complete Configuration Examples

### Example 1: Two Models with Auto-Sleep

```yaml
kvcached:
  gpu_memory_utilization: 0.9
  log_level: INFO

router:
  enabled: true
  host: '0.0.0.0'
  port: 8080

sleep_manager:
  enabled: true
  idle_threshold_seconds: 300
  auto_sleep_enabled: true
  min_sleep_duration_seconds: 60

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
      gpu_memory_utilization: 0.9
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
      gpu_memory_utilization: 0.9
      max_model_len: 4096
```

### Example 2: Three Models with Manual Sleep

```yaml
kvcached:
  gpu_memory_utilization: 0.85
  preallocate_pages: true
  log_level: WARNING

router:
  enabled: true
  host: '127.0.0.1' # Localhost only
  port: 9000

sleep_manager:
  enabled: true
  auto_sleep_enabled: false # Manual sleep only
  min_sleep_duration_seconds: 120

instances:
  - name: 'llama-7b'
    model: 'meta-llama/Llama-2-7b-hf'
    engine: 'vllm'
    port: 12346
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
      CUDA_VISIBLE_DEVICES: '0'
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      tensor_parallel_size: 1

  - name: 'mistral-7b'
    model: 'mistralai/Mistral-7B-v0.1'
    engine: 'vllm'
    port: 12347
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
      CUDA_VISIBLE_DEVICES: '0'
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      tensor_parallel_size: 1

  - name: 'phi-3-mini'
    model: 'microsoft/Phi-3-mini-4k-instruct'
    engine: 'vllm'
    port: 12348
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
      CUDA_VISIBLE_DEVICES: '0'
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      trust_remote_code: true
```

### Example 3: Production Multi-GPU Setup

```yaml
kvcached:
  gpu_memory_utilization: 0.95
  preallocate_pages: true
  log_level: WARNING

router:
  enabled: true
  host: '0.0.0.0'
  port: 8080
  timeout: 600

sleep_manager:
  enabled: true
  idle_threshold_seconds: 600 # 10 minutes
  auto_sleep_enabled: true
  min_sleep_duration_seconds: 120
  check_interval_seconds: 120

instances:
  - name: 'llama-70b-gpu0-1'
    model: 'meta-llama/Llama-2-70b-hf'
    engine: 'vllm'
    port: 12346
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
      CUDA_VISIBLE_DEVICES: '0,1'
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      tensor_parallel_size: 2 # Use 2 GPUs

  - name: 'codellama-34b-gpu2'
    model: 'codellama/CodeLlama-34b-hf'
    engine: 'vllm'
    port: 12347
    env:
      ENABLE_KVCACHED: 'true'
      KVCACHED_AUTOPATCH: '1'
      CUDA_VISIBLE_DEVICES: '2'
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      tensor_parallel_size: 1
```

## Configuration for sardeenz

### Backend-Managed Configuration

For sardeenz, the backend should dynamically generate YAML configurations based on user requests:

```python
# Backend generates config based on user's model selections
def generate_kvcached_config(models, gpu_memory_gb=24):
    """Generate kvcached YAML config for requested models."""

    # Calculate memory allocation per model
    num_models = len(models)
    memory_per_model = 0.9 / num_models  # Share 90% of GPU

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
            "auto_sleep_enabled": True,
            "min_sleep_duration_seconds": 60
        },
        "instances": []
    }

    # Add each model instance
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
                "gpu_memory_utilization": memory_per_model,
                "max_model_len": model.get("max_len", 4096)
            }
        }
        config["instances"].append(instance)

    return config

# Usage
models = [
    {"path": "meta-llama/Llama-3.2-1B", "max_len": 4096},
    {"path": "Qwen/Qwen3-0.6B", "max_len": 4096}
]

config = generate_kvcached_config(models)

# Write to YAML
import yaml
with open("kvcached-config.yaml", "w") as f:
    yaml.dump(config, f)
```

### Configuration Template

```yaml
# kvcached-template.yaml
# Template for sardeenz

kvcached:
  gpu_memory_utilization: {{ gpu_utilization }}
  log_level: {{ log_level }}

router:
  enabled: true
  host: "0.0.0.0"
  port: {{ router_port }}

sleep_manager:
  enabled: {{ sleep_enabled }}
  idle_threshold_seconds: {{ idle_threshold }}
  auto_sleep_enabled: {{ auto_sleep }}
  min_sleep_duration_seconds: 60

instances:
{% for model in models %}
  - name: "{{ model.name }}"
    model: "{{ model.path }}"
    engine: "vllm"
    port: {{ model.port }}
    env:
      ENABLE_KVCACHED: "true"
      KVCACHED_AUTOPATCH: "1"
    engine_args:
      disable_log_requests: true
      enable_prefix_caching: false
      gpu_memory_utilization: {{ model.memory }}
      max_model_len: {{ model.max_len }}
{% endfor %}
```

## Configuration Best Practices

1. **Always Disable Prefix Caching**: Set `enable_prefix_caching: false` for all vLLM instances
2. **Set Memory Limits**: Use `gpu_memory_utilization` to prevent OOM errors
3. **Use Auto-Sleep in Production**: Enables efficient resource sharing
4. **Configure Appropriate Thresholds**: Balance between wake latency and memory efficiency
5. **Log at INFO Level**: Provides good visibility without excessive verbosity
6. **Use Environment Variables for Secrets**: Reference shell env vars with `${VAR}`
7. **Validate Configuration**: Test with small models first
8. **Monitor Memory Usage**: Use kvctl/kvtop to verify limits are working
9. **Document Custom Settings**: Comment complex configurations
10. **Version Control Configs**: Track configuration changes in git

## Troubleshooting Configuration

### Model Won't Start

**Check**:

- `ENABLE_KVCACHED=true` and `KVCACHED_AUTOPATCH=1` are set
- `enable_prefix_caching: false` in engine_args
- Port is not already in use
- Model path is correct
- Virtual environment exists (if specified)

### Router Not Accessible

**Check**:

- `router.enabled: true`
- Correct host/port combination
- Firewall rules allow access
- No other service using the port

### Models Not Sleeping

**Check**:

- `sleep_manager.enabled: true`
- `sleep_manager.auto_sleep_enabled: true`
- Models are actually idle (check with `/traffic/stats`)
- `idle_threshold_seconds` is not too high

### Memory Errors

**Check**:

- Total `gpu_memory_utilization` across instances doesn't exceed GPU capacity
- Model weights fit in memory
- KV cache allocation limits (use kvctl)

## Related Documentation

- [architecture.md](./architecture.md) - System architecture
- [model-lifecycle.md](./model-lifecycle.md) - Model management workflows
- [cli-tools.md](./cli-tools.md) - Memory management tools
- [api-reference.md](./api-reference.md) - API endpoints
