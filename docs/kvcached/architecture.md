# kvcached Architecture

This document describes the architecture of kvcached and how it integrates with vLLM for the sardeenz project.

## Table of Contents

- [System Overview](#system-overview)
- [Core Components](#core-components)
- [vLLM Integration](#vllm-integration)
- [Request Flow](#request-flow)
- [Memory Management](#memory-management)

## System Overview

kvcached implements an OS-style virtual memory abstraction for managing KV (Key-Value) caches in LLM serving environments. The system enables multiple vLLM instances to share GPU resources efficiently through dynamic memory allocation and intelligent model lifecycle management.

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Requests                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Controller Frontend                        │
│              (OpenAI-compatible API)                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      LLM Router                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐ │
│  │ Traffic        │  │ Sleep          │  │ Request       │ │
│  │ Monitor        │  │ Manager        │  │ Routing       │ │
│  └────────────────┘  └────────────────┘  └───────────────┘ │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┬─────────────┐
        ▼             ▼             ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ vLLM Model 1 │ │ vLLM Model 2 │ │ vLLM Model N │
│ (Active)     │ │ (Sleeping)   │ │ (Active)     │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              kvcached Memory Management Layer                │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐ │
│  │ KV Cache       │  │ Page           │  │ Memory Info   │ │
│  │ Manager        │  │ Allocator      │  │ Tracker       │ │
│  └────────────────┘  └────────────────┘  └───────────────┘ │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      GPU Memory (Shared)                     │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Controller Frontend (`controller/frontend.py`)

The **Controller Frontend** provides a unified HTTP API interface that is compatible with OpenAI's API specification.

**Responsibilities**:

- Expose REST API endpoints for model interactions
- Handle streaming and non-streaming requests
- Provide health checks and server information
- Serve as the entry point for all client requests

**Key Features**:

- OpenAI-compatible `/v1/completions` and `/v1/chat/completions` endpoints
- Model listing and health status endpoints
- Traffic statistics and monitoring endpoints
- Sleep/wake control endpoints

### 2. LLM Router (`controller/router.py`)

The **LLM Router** manages request distribution across multiple vLLM model instances.

**Responsibilities**:

- Route requests to appropriate model endpoints
- Check model availability (sleeping vs. active)
- Trigger model wake-up when needed
- Handle endpoint health checks

**Key Features**:

- Dynamic model endpoint configuration
- Integration with Sleep Manager for automatic wake-up
- Support for both streaming and non-streaming requests
- Unlimited connection pooling to avoid bottlenecks
- Configurable request timeouts

**Configuration Formats**:

```python
# Nested format
{
  "models": {
    "model_name": {
      "endpoint": {
        "host": "localhost",
        "port": 12346
      }
    }
  }
}

# Flattened format
{
  "model_name": {
    "host": "localhost",
    "port": 12346
  }
}
```

### 3. Sleep Manager (`controller/sleep_manager.py`)

The **Sleep Manager** handles the lifecycle of model instances, putting idle models to sleep and waking them on demand.

**Responsibilities**:

- Monitor model idle time based on traffic
- Automatically put idle models to sleep
- Wake up sleeping models when requests arrive
- Enforce minimum sleep duration before wake-up

**Key Features**:

- Configurable idle threshold (default: 5 minutes)
- Configurable minimum sleep duration
- Support for both vLLM and SGLang (we use vLLM only)
- Manual and automatic sleep modes
- Background monitoring task for auto-sleep

**Configuration Parameters**:

```python
SleepConfig(
    idle_threshold_seconds=300,      # Time before sleep
    auto_sleep_enabled=True,         # Enable auto-sleep
    min_sleep_duration_seconds=60    # Minimum sleep time
)
```

**Model Sleep Process**:

1. Traffic Monitor detects model has been idle > threshold
2. Sleep Manager marks model as candidate for sleep
3. Model is put to sleep (GPU memory released)
4. Model state is preserved for quick wake-up

**Model Wake Process**:

1. Request arrives for sleeping model
2. Router detects model is asleep
3. Sleep Manager checks minimum sleep duration
4. Model is woken up and becomes available
5. Request is forwarded to the model

### 4. Traffic Monitor (`controller/traffic_monitor.py`)

The **Traffic Monitor** tracks request metrics and model activity for operational insights and sleep management decisions.

**Responsibilities**:

- Record request start and completion times
- Track per-model statistics
- Identify idle and active models
- Maintain rolling history of requests

**Metrics Tracked**:

- Total requests per model
- Successful vs. failed requests
- Request rate (requests per minute)
- Average response time
- Last activity timestamp
- Current idle time

**Key Features**:

- Thread-safe statistics tracking
- Automatic cleanup of historical data (maintains last 10,000 requests)
- Time-windowed statistics (e.g., last 5 minutes)
- Async background cleanup tasks

**Data Structure**:

```python
ModelActivityStats:
    - total_requests: int
    - successful_requests: int
    - failed_requests: int
    - last_activity_time: datetime
    - request_rate: float  # requests/min
    - avg_response_time: float  # seconds
```

### 5. KV Cache Manager (`kvcached/kv_cache_manager.py`)

The **KV Cache Manager** implements the core virtual memory abstraction for KV caches.

**Responsibilities**:

- Decouple logical KV cache from physical GPU memory
- Dynamically allocate and reclaim memory
- Manage IPC (Inter-Process Communication) segments for memory sharing
- Coordinate memory between multiple model instances

**Key Concepts**:

- **IPC Segments**: Shared memory regions identified by name (e.g., "VLLM", "MODEL_1")
- **Virtual Memory**: Logical KV cache addresses mapped to physical GPU memory
- **Demand Paging**: Allocate memory only when needed, reclaim when idle

### 6. Page Allocator (`kvcached/page_allocator.py`)

The **Page Allocator** manages fine-grained memory allocation at the page level.

**Responsibilities**:

- Allocate and free memory pages
- Track page usage across models
- Implement memory limits and quotas
- Pre-allocate pages for performance

### 7. Memory Info Tracker (`kvcached/mem_info_tracker.py`)

The **Memory Info Tracker** monitors GPU memory usage in real-time.

**Responsibilities**:

- Track total, used, and free GPU memory
- Monitor per-IPC-segment memory usage
- Provide data for CLI tools (kvctl, kvtop)
- Enforce memory limits

### 8. CLI Tools (`kvcached/cli/`)

**kvctl** (`kvcached/cli/kvctl.py`):

- Interactive CLI for memory management
- Commands: list, limit, limit-percent, watch, delete, shell
- Supports human-readable sizes (e.g., "512M", "2G")

**kvtop** (`kvcached/cli/kvtop.py`):

- Real-time memory usage visualization
- Curses-based TUI (Text User Interface)
- Color-coded memory usage bars
- Refreshes at configurable intervals

## vLLM Integration

### How kvcached Integrates with vLLM

kvcached integrates with vLLM through **autopatching** - automatic modification of vLLM's memory management behavior at runtime.

**Integration Method**:

1. Set environment variables:

   ```bash
   export ENABLE_KVCACHED=true
   export KVCACHED_AUTOPATCH=1
   ```

2. Launch vLLM normally:

   ```bash
   vllm serve meta-llama/Llama-3.2-1B --no-enable-prefix-caching
   ```

3. kvcached automatically patches vLLM's KV cache allocation

**Autopatch Mechanism** (`kvcached/autopatch.py`):

- Intercepts vLLM's memory allocation calls
- Redirects to kvcached's virtual memory system
- Maintains compatibility with vLLM's API
- Transparent to vLLM's internal logic

**Key Integration Points**:

- **Memory Allocation**: vLLM requests → kvcached Page Allocator
- **KV Cache Storage**: vLLM cache → kvcached IPC segments
- **Memory Release**: vLLM free → kvcached page deallocation

### vLLM-Specific Limitations

- **No Prefix Caching**: kvcached does not support vLLM's prefix caching feature
  - Must use `--no-enable-prefix-caching` flag
  - Incompatibility with `--enable-prefix-caching`

- **Tested Version**: v0.14.1
  - Other versions may have compatibility issues

## Request Flow

### Standard Request Flow (Active Model)

1. **Client** sends HTTP request to Controller Frontend

   ```
   POST /v1/completions
   {
     "model": "meta-llama/Llama-3.2-1B",
     "prompt": "Hello, world!"
   }
   ```

2. **Frontend** receives request and forwards to Router

3. **Router** performs routing logic:
   - Looks up model endpoint configuration
   - Checks if model is sleeping
   - Records request start with Traffic Monitor

4. **Traffic Monitor** updates statistics:
   - Increments request count
   - Updates last activity time
   - Records timestamp

5. **Router** forwards request to vLLM instance:

   ```
   → http://localhost:12346/v1/completions
   ```

6. **vLLM** processes request:
   - Allocates KV cache via kvcached
   - Generates completion
   - Returns response

7. **Router** returns response to Frontend

8. **Traffic Monitor** records completion:
   - Updates success/failure count
   - Calculates response time
   - Updates request rate

9. **Frontend** returns response to Client

### Request Flow with Model Wake-Up

1. **Client** sends request for sleeping model

2. **Frontend** → **Router**

3. **Router** detects model is sleeping

4. **Router** calls **Sleep Manager**.`handle_model_wakeup_on_request()`

5. **Sleep Manager** wakes up model:
   - Checks minimum sleep duration
   - Sends wake-up command to vLLM
   - Waits for model to become ready

6. **Router** retries request to now-active model

7. Continues as standard flow (steps 6-9 above)

### Background Sleep Process

1. **Sleep Manager** runs background task (async)

2. Periodically checks for idle models:
   - Queries **Traffic Monitor** for idle times
   - Identifies models idle > threshold

3. For each idle model:
   - Marks as sleep candidate
   - Calls `put_model_to_sleep()`

4. Model sleep operation:
   - Notifies vLLM to release KV cache
   - kvcached reclaims GPU memory
   - Model marked as sleeping

## Memory Management

### Memory Hierarchy

```
┌─────────────────────────────────────────────┐
│         Application Layer (vLLM)            │
│   Requests KV cache for token generation    │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│      Virtual Memory Layer (kvcached)        │
│  Logical KV cache addresses (per model)     │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│         Page Allocator (kvcached)           │
│    Physical page allocation & tracking      │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│            GPU Memory (CUDA)                │
│         Physical GPU RAM (shared)           │
└─────────────────────────────────────────────┘
```

### IPC Segments

**IPC (Inter-Process Communication) Segments** are named shared memory regions used to organize KV cache memory.

**Purpose**:

- Isolate memory for different models or applications
- Apply per-segment memory limits
- Track usage separately for monitoring
- Enable memory sharing between processes

**Example IPC Segment Names**:

- `VLLM` - Default vLLM instance
- `VLLM_MODEL_1` - First model instance
- `VLLM_MODEL_2` - Second model instance

**Operations on IPC Segments**:

- **List**: View all segments and their usage
- **Limit**: Set memory cap (absolute or percentage)
- **Delete**: Remove segment and reclaim memory
- **Monitor**: Track usage in real-time

### Memory Control via CLI

**kvctl** provides interactive memory management:

```bash
# Launch interactive shell
kvctl

# List all IPC segments
> list

# Set absolute limit
> limit VLLM_MODEL_1 4G

# Set percentage limit
> limit-percent VLLM_MODEL_2 30

# Watch usage continuously
> watch

# Delete segment
> delete VLLM_MODEL_1
```

**kvtop** provides visual monitoring:

```bash
# Launch real-time monitor
kvtop

# Monitor specific segments
kvtop VLLM_MODEL_1 VLLM_MODEL_2

# Custom refresh rate (2 seconds)
kvtop -r 2
```

### Memory Allocation Strategies

1. **Demand-Driven Allocation**:
   - Memory allocated only when models need it
   - Unused memory available for other models

2. **Dynamic Reclamation**:
   - Idle models release memory back to pool
   - Memory redistributed to active models

3. **Pre-Allocation** (optional):
   - Pre-allocate pages for faster startup
   - Configured per model in YAML

4. **Hard Limits**:
   - Enforce maximum memory per IPC segment
   - Prevent single model from consuming all GPU memory

### Memory Sharing Example

```
Initial State:
┌─────────────────────────────────────┐
│   GPU Memory: 24 GB Total           │
│                                     │
│   Model A: 0 GB (not loaded)        │
│   Model B: 0 GB (not loaded)        │
│   Free: 24 GB                       │
└─────────────────────────────────────┘

After Loading Model A:
┌─────────────────────────────────────┐
│   GPU Memory: 24 GB Total           │
│                                     │
│   Model A: 8 GB (active)            │
│   Model B: 0 GB (not loaded)        │
│   Free: 16 GB                       │
└─────────────────────────────────────┘

After Loading Model B:
┌─────────────────────────────────────┐
│   GPU Memory: 24 GB Total           │
│                                     │
│   Model A: 8 GB (active)            │
│   Model B: 6 GB (active)            │
│   Free: 10 GB                       │
└─────────────────────────────────────┘

After Model A Goes Idle (Auto-Sleep):
┌─────────────────────────────────────┐
│   GPU Memory: 24 GB Total           │
│                                     │
│   Model A: 0 GB (sleeping)          │
│   Model B: 6 GB (active)            │
│   Free: 18 GB                       │
└─────────────────────────────────────┘
```

## Component Interactions

### Startup Sequence

1. **Configuration Loading**:
   - Read YAML configuration file
   - Parse model instances, router, sleep settings

2. **Controller Initialization**:
   - Initialize Traffic Monitor
   - Initialize Sleep Manager with traffic monitor
   - Initialize LLM Router with configurations

3. **Frontend Launch**:
   - Start HTTP server (default port 8080)
   - Register API endpoints
   - Start accepting requests

4. **Model Instance Launch** (per configured model):
   - Launch vLLM process via tmux
   - Set environment variables (ENABLE_KVCACHED, KVCACHED_AUTOPATCH)
   - Pass vLLM arguments (model, port, etc.)
   - Wait for model to become ready

5. **Background Tasks**:
   - Start Sleep Manager monitoring task
   - Start Traffic Monitor cleanup task

### Shutdown Sequence

1. **Graceful Shutdown Signal** (SIGTERM, SIGINT)

2. **Stop Accepting New Requests**:
   - Frontend stops accepting connections

3. **Complete In-Flight Requests**:
   - Wait for ongoing requests to finish

4. **Stop Background Tasks**:
   - Cancel Sleep Manager monitoring
   - Cancel Traffic Monitor cleanup

5. **Shutdown Model Instances**:
   - Send shutdown signals to vLLM processes
   - Wait for clean termination

6. **Release Resources**:
   - Close IPC segments
   - Release GPU memory
   - Clean up tmux sessions

## Performance Considerations

### Benefits of kvcached Architecture

1. **Improved TTFT (Time To First Token)**:
   - 2-28x reduction in TTFT
   - Achieved through efficient memory sharing

2. **Higher GPU Utilization**:
   - Multiple models share same GPU
   - Idle models don't waste memory

3. **Dynamic Scaling**:
   - Add/remove models without restarting
   - Automatic resource rebalancing

4. **Cost Efficiency**:
   - Serve more models on same hardware
   - Reduce idle resource waste

### Trade-offs and Limitations

1. **Wake-Up Latency**:
   - Sleeping models take time to wake
   - First request after sleep is slower

2. **Memory Fragmentation**:
   - Dynamic allocation can fragment memory
   - May reduce efficiency over time

3. **Complexity**:
   - Additional layer adds operational complexity
   - Debugging is more difficult

4. **vLLM Version Lock**:
   - Tested only with specific vLLM version
   - May break with updates

## Summary

kvcached provides a sophisticated architecture for managing multiple vLLM instances on shared GPU resources. The key innovation is the **virtual memory abstraction** that decouples logical KV cache from physical GPU memory, combined with **intelligent lifecycle management** through the Sleep Manager.

For sardeenz, the most important integration points are:

- **Controller API** for model management
- **Sleep/wake endpoints** for resource optimization
- **Traffic monitoring** for usage insights
- **Memory control** for resource allocation

See the other documentation files for detailed API references, CLI usage, configuration options, and workflow examples.
