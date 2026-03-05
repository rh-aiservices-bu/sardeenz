# kvcached Documentation

This directory contains comprehensive documentation about kvcached and how it will be integrated with the sardeenz backend.

## Table of Contents

- [Overview](#overview)
- [What is kvcached?](#what-is-kvcached)
- [Key Features](#key-features)
- [Quick Start](#quick-start)
- [Documentation Structure](#documentation-structure)

## Overview

**kvcached** is a KV (Key-Value) cache library designed for LLM serving and training on shared GPUs. It introduces an OS-style virtual memory abstraction to LLM systems, enabling elastic and demand-driven KV cache allocation.

This documentation focuses exclusively on **vLLM integration**, as sardeenz will not use SGLang.

### For sardeenz Users

**Important**: sardeenz uses **kvcached's memory sharing capabilities** but **NOT the kvcached Controller**. We directly manage vLLM instances to enable true dynamic model loading without downtime.

👉 **Start here**: [sardeenz-integration.md](./sardeenz-integration.md)

## What is kvcached?

kvcached provides:

- **Virtual Memory Abstraction**: Decouples logical KV cache from physical GPU memory
- **Elastic Memory Allocation**: Dynamically allocate and reclaim KV memory based on demand
- **Multi-Model Support**: Share GPU resources efficiently across multiple LLM instances
- **Intelligent Model Management**: Automatic sleep/wake functionality for idle models

### Performance Benefits

- **2-28x TTFT (Time To First Token) reduction**
- Improved GPU utilization under dynamic workloads
- Dynamic memory sharing between multiple LLMs

## Key Features

### Core kvcached Features (Used by sardeenz)

#### 1. GPU Memory Sharing

- **Virtual Memory Abstraction**: Multiple vLLM instances share GPU memory efficiently
- **Elastic Memory Allocation**: Dynamically allocate and reclaim memory based on demand
- **Transparent Integration**: Enable with environment variables, no code changes needed

#### 2. Memory Control Tools

- **kvctl**: Interactive CLI for memory management
- **kvtop**: Real-time memory usage visualization
- Set absolute or percentage-based memory limits per model
- Prevent OOM errors with memory quotas

### Controller Features (NOT used by sardeenz)

The kvcached Controller provides additional features that sardeenz does **not** use:

- ❌ **Controller & Router**: Unified API endpoint (we implement our own)
- ❌ **Automatic Sleep Management**: Idle model detection (optional feature we may add later)
- ❌ **Integrated Traffic Monitoring**: Built-in request tracking (we implement our own)

**Why not use the Controller?** The Controller requires a full restart to add/remove models, which kills all running instances. This doesn't fit sardeenz's need for dynamic model management without downtime. See [sardeenz-integration.md](./sardeenz-integration.md) for details.

## Quick Start

### Prerequisites

- Python 3.9-3.12
- vLLM v0.14.1 (tested version)
- CUDA-capable GPU

### Installation

```bash
# Install via PyPI
pip install kvcached --no-build-isolation

# Or use Docker
docker pull ghcr.io/ovg-project/kvcached-vllm:latest
```

### Basic Usage (for sardeenz)

**sardeenz uses direct vLLM instance management** (not the Controller):

1. **Enable kvcached** (set environment variables):

```bash
export ENABLE_KVCACHED=true
export KVCACHED_AUTOPATCH=1
```

2. **Launch vLLM models individually**:

```bash
# Model 1
vllm serve meta-llama/Llama-3.2-1B \
  --disable-log-requests \
  --no-enable-prefix-caching \
  --port=12346

# Model 2 (in another process)
vllm serve Qwen/Qwen3-0.6B \
  --disable-log-requests \
  --no-enable-prefix-caching \
  --port=12347
```

**Important**:

- kvcached does NOT support prefix caching. Always use `--no-enable-prefix-caching`.
- Each model runs independently but shares GPU memory automatically via kvcached.

3. **Monitor memory usage**:

```bash
# List all models and their memory usage
kvctl list

# Real-time monitoring
kvtop
```

4. **Set memory limits** (optional but recommended):

```bash
kvctl limit VLLM_MODEL_1 8G
kvctl limit VLLM_MODEL_2 6G
```

For programmatic management from the sardeenz backend, see [sardeenz-integration.md](./sardeenz-integration.md).

## Documentation Structure

This documentation is organized into the following sections:

### For sardeenz Developers (Start Here!)

1. **[sardeenz-integration.md](./sardeenz-integration.md)** - ⭐ **Integration guide for this project**
   - Why we don't use the Controller
   - Recommended architecture for dynamic model management
   - Complete implementation guide with working code
   - Backend API design and examples
   - Memory management strategies
   - Implementation roadmap

### kvcached Reference Documentation

2. **[architecture.md](./architecture.md)** - System architecture and components
   - Core components overview
   - Integration with vLLM
   - Request flow and routing
   - Memory management system

3. **[cli-tools.md](./cli-tools.md)** - CLI command reference (kvctl & kvtop)
   - kvctl: Memory management CLI
   - kvtop: Real-time monitoring tool
   - Usage examples and workflows
   - **Note**: These tools ARE used by sardeenz for monitoring

4. **[model-lifecycle.md](./model-lifecycle.md)** - Model management workflows
   - Loading and launching models (multiple methods)
   - Unloading and sleep modes
   - Usage reporting and monitoring
   - Best practices for programmatic control

5. **[api-reference.md](./api-reference.md)** - Controller API documentation
   - HTTP endpoints and routes
   - Request/response formats
   - **Note**: For reference only; sardeenz implements its own API

6. **[configuration.md](./configuration.md)** - Controller configuration guide
   - YAML configuration structure
   - Environment variables (these ARE used)
   - **Note**: Controller-specific sections not applicable to sardeenz

## Integration with sardeenz

### Architectural Decision

**sardeenz will NOT use the kvcached Controller.** Instead, the backend will directly manage individual vLLM instances.

### How We Use kvcached

The sardeenz backend integrates with kvcached through:

1. **Environment Variables**: Enable kvcached for each vLLM instance

   ```python
   env["ENABLE_KVCACHED"] = "true"
   env["KVCACHED_AUTOPATCH"] = "1"
   ```

2. **Direct vLLM Process Management**: Launch and stop vLLM instances programmatically
   - Each model runs independently on its own port
   - Models automatically share GPU memory via kvcached

3. **Memory Monitoring**: Use kvctl/kvtop CLI tools
   - Track GPU memory usage across all models
   - Set memory limits per model
   - Prevent OOM errors

4. **Custom Backend Logic**: Implement our own features
   - Request routing to model endpoints
   - Usage tracking and metrics
   - Health monitoring
   - Optional sleep/wake functionality

### Why This Approach?

**The kvcached Controller requires a full restart to add/remove models**, which:

- ❌ Kills all running model instances
- ❌ Causes downtime for all models
- ❌ Requires reloading model weights from disk (slow)
- ❌ Doesn't fit our need for dynamic, user-driven model selection

**Direct management gives us**:

- ✅ Add models without affecting running instances
- ✅ Remove models individually with no downtime
- ✅ Full control over model lifecycle
- ✅ Faster response to user actions
- ✅ GPU memory sharing still works automatically

### Implementation Guide

See **[sardeenz-integration.md](./sardeenz-integration.md)** for:

- Complete architecture diagrams
- Production-ready code examples
- Backend API design
- Memory management strategies
- 4-phase implementation roadmap
- Testing strategies

## References

- **GitHub Repository**: https://github.com/ovg-project/kvcached
- **Tested vLLM Version**: v0.14.1
- **Python Support**: 3.9-3.12

## Limitations and Considerations

- **No Prefix Caching Support**: Must disable prefix caching when using kvcached
- **vLLM Version**: Tested with v0.14.1; compatibility with other versions not guaranteed
- **Memory Management**: Requires careful configuration for optimal performance
- **GPU Requirements**: Designed for NVIDIA GPUs (future support for other hardware planned)
