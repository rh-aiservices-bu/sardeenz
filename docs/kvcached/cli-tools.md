# kvcached CLI Tools Reference

This document provides a complete reference for kvcached's command-line tools for memory management and monitoring.

## Table of Contents

- [Overview](#overview)
- [kvctl - Memory Control CLI](#kvctl---memory-control-cli)
- [kvtop - Real-Time Monitoring](#kvtop---real-time-monitoring)
- [Usage Workflows](#usage-workflows)
- [Integration with Backend](#integration-with-backend)

## Overview

kvcached provides two primary CLI tools for managing GPU memory:

1. **kvctl**: Interactive CLI for memory management and control
2. **kvtop**: Real-time visual monitoring of memory usage (like `htop` for KV cache)

Both tools operate on **IPC (Inter-Process Communication) segments**, which are named shared memory regions used to organize KV cache memory for different models.

## kvctl - Memory Control CLI

**kvctl** is an interactive command-line interface for managing KV cache memory limits and usage.

### Installation

kvctl is included with the kvcached package:

```bash
pip install kvcached --no-build-isolation
```

### Basic Usage

Launch the interactive shell:

```bash
kvctl
```

You'll see a prompt like:

```
kvctl>
```

### Commands

#### list

List all IPC memory segments and their usage.

**Syntax**:

```bash
list [ipc_names...]
```

**Options**:

- `--json`: Output in JSON format

**Examples**:

```bash
# List all IPC segments
kvctl> list

# List specific IPC segments
kvctl> list VLLM_MODEL_1 VLLM_MODEL_2

# JSON output
kvctl> list --json
```

**Sample Output**:

```
IPC Name         Total      Used       Free       Limit      Usage
─────────────────────────────────────────────────────────────────
VLLM_MODEL_1     8.0 GB     4.2 GB     3.8 GB     8.0 GB     52%
VLLM_MODEL_2     6.0 GB     1.5 GB     4.5 GB     6.0 GB     25%
VLLM_MODEL_3     4.0 GB     0.0 GB     4.0 GB     None       0%
```

**JSON Output**:

```json
{
  "VLLM_MODEL_1": {
    "total": 8589934592,
    "used": 4496293888,
    "free": 4093640704,
    "limit": 8589934592,
    "usage_percent": 52.3
  },
  "VLLM_MODEL_2": {
    "total": 6442450944,
    "used": 1610612736,
    "free": 4831838208,
    "limit": 6442450944,
    "usage_percent": 25.0
  }
}
```

#### limit

Set an absolute memory limit for an IPC segment.

**Syntax**:

```bash
limit <ipc_name> <size>
```

**Size Format**:

- Supports human-readable sizes: `512M`, `2G`, `1.5G`, `4096M`
- Suffixes: `K` (KB), `M` (MB), `G` (GB), `T` (TB)
- Case-insensitive

**Examples**:

```bash
# Set 4GB limit
kvctl> limit VLLM_MODEL_1 4G

# Set 512MB limit
kvctl> limit VLLM_MODEL_2 512M

# Set 1.5GB limit
kvctl> limit VLLM_MODEL_3 1.5G
```

**Sample Output**:

```
Memory limit for VLLM_MODEL_1 set to 4.0 GB
```

**Notes**:

- Limit is enforced immediately
- If current usage exceeds new limit, allocation will fail for new requests
- Does not forcibly evict existing allocations

#### limit-percent

Set a memory limit as a percentage of total GPU RAM.

**Syntax**:

```bash
limit-percent <ipc_name> <percentage>
```

**Percentage**:

- Integer value (0-100)
- Based on total GPU memory available

**Examples**:

```bash
# Set to 30% of total GPU memory
kvctl> limit-percent VLLM_MODEL_1 30

# Set to 50% of total GPU memory
kvctl> limit-percent VLLM_MODEL_2 50
```

**Sample Output**:

```
Memory limit for VLLM_MODEL_1 set to 30% (7.2 GB of 24 GB total)
```

**Use Cases**:

- Ensure fair sharing among models
- Reserve GPU memory for non-kvcached workloads
- Dynamic allocation based on available GPU memory

#### watch

Continuously display memory usage table with auto-refresh.

**Syntax**:

```bash
watch [ipc_names...] [-n INTERVAL] [--interval INTERVAL]
```

**Options**:

- `-n INTERVAL` or `--interval INTERVAL`: Refresh interval in seconds (default: 1)

**Examples**:

```bash
# Watch all IPC segments (1 second refresh)
kvctl> watch

# Watch specific segments
kvctl> watch VLLM_MODEL_1 VLLM_MODEL_2

# Custom refresh interval (2 seconds)
kvctl> watch -n 2

# Watch with 0.5 second refresh
kvctl> watch --interval 0.5
```

**Sample Output** (refreshes every second):

```
IPC Name         Total      Used       Free       Limit      Usage
─────────────────────────────────────────────────────────────────
VLLM_MODEL_1     8.0 GB     4.5 GB     3.5 GB     8.0 GB     56%
VLLM_MODEL_2     6.0 GB     2.1 GB     3.9 GB     6.0 GB     35%

Refreshing every 1.0 seconds... (Press Ctrl+C to stop)
```

**Exiting**: Press `Ctrl+C` to stop watching

#### delete

Delete an IPC segment and remove its memory limit entry.

**Syntax**:

```bash
delete <ipc_name>
```

**Examples**:

```bash
kvctl> delete VLLM_MODEL_1
```

**Sample Output**:

```
IPC segment 'VLLM_MODEL_1' deleted successfully
Memory limit entry removed
```

**Warning**: This will forcibly remove the IPC segment. Only use if the model is no longer running.

#### shell

Enter interactive shell mode with enhanced features.

**Syntax**:

```bash
shell
```

**Features**:

- Tab completion for commands and IPC names
- Command history (use Up/Down arrows)
- Multi-line editing
- Shell command execution with `!` prefix

**Examples**:

```bash
kvctl> shell

# Execute shell command
kvctl> !nvidia-smi

# Use tab completion
kvctl> lim<TAB>  # Completes to "limit"

# Command history
kvctl> <UP>      # Recall previous command
```

**Exiting**: Type `exit`, `quit`, or press `Ctrl+D`

### Non-Interactive Usage

You can also use kvctl non-interactively:

```bash
# Single command execution
kvctl list

kvctl limit VLLM_MODEL_1 4G

kvctl list --json > memory_usage.json
```

### Color-Coded Output

kvctl uses color coding to indicate memory usage levels:

- **Green** (0-60%): Normal usage
- **Yellow** (60-85%): Moderate usage
- **Red** (85-100%): High usage

### Complete Example Session

```bash
# Launch kvctl
$ kvctl

# List current IPC segments
kvctl> list
IPC Name         Total      Used       Free       Limit      Usage
─────────────────────────────────────────────────────────────────
VLLM_MODEL_1     8.0 GB     0.0 GB     8.0 GB     None       0%
VLLM_MODEL_2     6.0 GB     0.0 GB     6.0 GB     None       0%

# Set memory limits
kvctl> limit VLLM_MODEL_1 6G
Memory limit for VLLM_MODEL_1 set to 6.0 GB

kvctl> limit-percent VLLM_MODEL_2 25
Memory limit for VLLM_MODEL_2 set to 25% (6.0 GB of 24 GB total)

# Verify limits
kvctl> list
IPC Name         Total      Used       Free       Limit      Usage
─────────────────────────────────────────────────────────────────
VLLM_MODEL_1     8.0 GB     0.0 GB     8.0 GB     6.0 GB     0%
VLLM_MODEL_2     6.0 GB     0.0 GB     6.0 GB     6.0 GB     0%

# Watch memory usage in real-time
kvctl> watch -n 2
(Refreshes every 2 seconds...)

# Exit
kvctl> exit
```

## kvtop - Real-Time Monitoring

**kvtop** is a curses-based terminal UI for real-time visualization of KV cache memory usage, similar to `htop`.

### Installation

Included with kvcached:

```bash
pip install kvcached --no-build-isolation
```

### Basic Usage

Launch kvtop:

```bash
kvtop
```

### Command-Line Options

**Syntax**:

```bash
kvtop [ipc_names...] [-r REFRESH] [--refresh REFRESH]
```

**Arguments**:

- `ipc_names` (optional): Specific IPC segments to monitor

**Options**:

- `-r REFRESH` or `--refresh REFRESH`: Refresh interval in seconds (default: 1)

**Examples**:

```bash
# Monitor all IPC segments
kvtop

# Monitor specific segments
kvtop VLLM_MODEL_1 VLLM_MODEL_2

# Custom refresh rate (2 seconds)
kvtop -r 2

# Fast refresh (0.5 seconds)
kvtop --refresh 0.5
```

### Display Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                         kvcached Memory Monitor                  │
│                      Refresh: 1.0s | Press q to quit             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GPU Memory: 24.0 GB Total | 15.2 GB Used | 8.8 GB Free (63%)   │
│  ████████████████████████████████████░░░░░░░░░░░░░░░░░░         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  IPC Segment: VLLM_MODEL_1                                       │
│  Memory: 8.0 GB Total | 4.5 GB Used | 3.5 GB Free (56%)          │
│  Limit: 6.0 GB                                                   │
│  ████████████████████████████████████░░░░░░░░░░░░░░░            │
│                                                                  │
│  IPC Segment: VLLM_MODEL_2                                       │
│  Memory: 6.0 GB Total | 2.1 GB Used | 3.9 GB Free (35%)          │
│  Limit: 6.0 GB                                                   │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│                                                                  │
│  IPC Segment: VLLM_MODEL_3                                       │
│  Memory: 4.0 GB Total | 0.8 GB Used | 3.2 GB Free (20%)          │
│  Limit: None                                                     │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Color-Coded Bars

- **Green** (0-60%): Normal usage
- **Yellow** (60-85%): Moderate usage
- **Red** (85-100%): High usage

### Keyboard Controls

- **q**: Quit kvtop
- **Ctrl+C**: Exit

### Auto-Detection

kvtop automatically detects all active KV cache IPC segments and displays them. No manual configuration needed.

### Example Usage

```bash
# Basic monitoring
kvtop

# Monitor specific models
kvtop VLLM_MODEL_1 VLLM_MODEL_2

# High-frequency monitoring
kvtop -r 0.5
```

### Use Cases

- **Development**: Monitor memory usage during model testing
- **Production**: Real-time visibility into resource utilization
- **Debugging**: Identify memory leaks or unexpected allocations
- **Capacity Planning**: Understand typical memory patterns

## Usage Workflows

### Workflow 1: Setting Up Memory Limits for Multiple Models

**Goal**: Configure memory limits for 3 models sharing a 24GB GPU

```bash
# Launch kvctl
kvctl

# Check current state
kvctl> list

# Allocate memory fairly
kvctl> limit-percent VLLM_MODEL_1 33  # ~8GB
kvctl> limit-percent VLLM_MODEL_2 33  # ~8GB
kvctl> limit-percent VLLM_MODEL_3 33  # ~8GB

# Verify configuration
kvctl> list

# Watch usage
kvctl> watch
```

### Workflow 2: Investigating High Memory Usage

**Goal**: Identify which model is using too much memory

```bash
# Launch kvtop for visual overview
kvtop

# Identify high-usage segment (e.g., VLLM_MODEL_1 at 95%)

# Get detailed info with kvctl
kvctl list VLLM_MODEL_1 --json

# Set a limit to prevent OOM
kvctl limit VLLM_MODEL_1 6G

# Monitor effect
kvtop VLLM_MODEL_1 -r 0.5
```

### Workflow 3: Cleaning Up Orphaned IPC Segments

**Goal**: Remove IPC segments from models that are no longer running

```bash
# List all segments
kvctl list

# Identify orphaned segments (0% usage, no active process)

# Delete orphaned segments
kvctl delete VLLM_OLD_MODEL_1
kvctl delete VLLM_OLD_MODEL_2

# Verify cleanup
kvctl list
```

### Workflow 4: Real-Time Monitoring During Load Testing

**Goal**: Monitor memory behavior under heavy load

```bash
# Terminal 1: Run kvtop
kvtop -r 0.5

# Terminal 2: Run load test
python load_test.py

# Observe memory allocation patterns in kvtop
# Identify any memory spikes or leaks
```

### Workflow 5: Adjusting Limits Based on Usage Patterns

**Goal**: Optimize memory allocation after observing actual usage

```bash
# Initial monitoring (observe for 30+ minutes)
kvtop

# Observations:
# - VLLM_MODEL_1: Peaks at 4GB (limit 8GB) - overallocated
# - VLLM_MODEL_2: Constantly at 7.8GB (limit 8GB) - underallocated
# - VLLM_MODEL_3: Averages 2GB (limit 4GB) - appropriate

# Adjust limits
kvctl limit VLLM_MODEL_1 5G     # Reduce by 3GB
kvctl limit VLLM_MODEL_2 11G    # Increase by 3GB
# VLLM_MODEL_3 unchanged

# Verify new allocation
kvctl list

# Continue monitoring
kvtop
```

## Integration with Backend

### Programmatic Access (Python)

While kvctl and kvtop are CLI tools, you can programmatically interact with IPC segments through kvcached's Python API:

```python
from kvcached import MemoryManager

# Initialize memory manager
mm = MemoryManager()

# List IPC segments
segments = mm.list_ipc_segments()
for name, info in segments.items():
    print(f"{name}: {info['used']} / {info['total']} ({info['usage_percent']}%)")

# Set memory limit
mm.set_limit("VLLM_MODEL_1", size_bytes=4 * 1024**3)  # 4GB

# Set percentage limit
mm.set_limit_percent("VLLM_MODEL_2", percent=30)

# Get specific segment info
info = mm.get_segment_info("VLLM_MODEL_1")
print(f"Usage: {info['usage_percent']}%")

# Delete segment
mm.delete_segment("VLLM_OLD_MODEL")
```

### Scripted Monitoring

Create a monitoring script:

```python
#!/usr/bin/env python3
import subprocess
import json
import time

def get_memory_stats():
    """Get memory stats in JSON format."""
    result = subprocess.run(
        ["kvctl", "list", "--json"],
        capture_output=True,
        text=True
    )
    return json.loads(result.stdout)

def alert_high_usage(threshold=85):
    """Alert if any segment exceeds threshold."""
    stats = get_memory_stats()
    for segment, info in stats.items():
        if info['usage_percent'] > threshold:
            print(f"ALERT: {segment} at {info['usage_percent']}%")
            # Send alert (email, Slack, etc.)

# Monitor every 60 seconds
while True:
    alert_high_usage(threshold=85)
    time.sleep(60)
```

### Dashboard Integration

Export metrics for Prometheus/Grafana:

```python
#!/usr/bin/env python3
from prometheus_client import start_http_server, Gauge
import subprocess
import json
import time

# Define metrics
memory_usage = Gauge('kvcached_memory_usage_bytes', 'KV cache memory usage', ['ipc_segment'])
memory_total = Gauge('kvcached_memory_total_bytes', 'KV cache memory total', ['ipc_segment'])
memory_percent = Gauge('kvcached_memory_usage_percent', 'KV cache memory usage percent', ['ipc_segment'])

def collect_metrics():
    """Collect metrics from kvctl."""
    result = subprocess.run(
        ["kvctl", "list", "--json"],
        capture_output=True,
        text=True
    )
    stats = json.loads(result.stdout)

    for segment, info in stats.items():
        memory_usage.labels(ipc_segment=segment).set(info['used'])
        memory_total.labels(ipc_segment=segment).set(info['total'])
        memory_percent.labels(ipc_segment=segment).set(info['usage_percent'])

if __name__ == '__main__':
    # Start Prometheus exporter
    start_http_server(9090)

    # Collect metrics every 10 seconds
    while True:
        collect_metrics()
        time.sleep(10)
```

### Backend Automation

Automate memory management in sardeenz backend:

```python
class kvcachedMemoryManager:
    """Manage KV cache memory for models."""

    def __init__(self, total_gpu_memory_gb=24):
        self.total_memory = total_gpu_memory_gb
        self.models = {}

    def register_model(self, model_name, ipc_segment, memory_percent):
        """Register a model and set its memory limit."""
        self.models[model_name] = {
            'ipc_segment': ipc_segment,
            'memory_percent': memory_percent
        }

        # Set limit via kvctl
        subprocess.run([
            "kvctl", "limit-percent", ipc_segment, str(memory_percent)
        ])

    def get_usage(self, model_name):
        """Get memory usage for a model."""
        ipc_segment = self.models[model_name]['ipc_segment']

        result = subprocess.run(
            ["kvctl", "list", ipc_segment, "--json"],
            capture_output=True,
            text=True
        )
        stats = json.loads(result.stdout)
        return stats[ipc_segment]

    def cleanup_model(self, model_name):
        """Remove model's IPC segment."""
        ipc_segment = self.models[model_name]['ipc_segment']
        subprocess.run(["kvctl", "delete", ipc_segment])
        del self.models[model_name]

# Usage
manager = kvcachedMemoryManager(total_gpu_memory_gb=24)

# Register models
manager.register_model("llama-3.2-1b", "VLLM_LLAMA", memory_percent=40)
manager.register_model("qwen-0.6b", "VLLM_QWEN", memory_percent=30)

# Check usage
usage = manager.get_usage("llama-3.2-1b")
print(f"Llama usage: {usage['usage_percent']}%")

# Cleanup when done
manager.cleanup_model("llama-3.2-1b")
```

## Best Practices

1. **Set Limits Proactively**: Always set memory limits to prevent OOM errors
2. **Monitor Regularly**: Use kvtop during development and testing
3. **Use Percentage Limits**: More flexible than absolute limits when GPU memory varies
4. **Clean Up**: Delete IPC segments for terminated models
5. **Alert on High Usage**: Implement monitoring scripts with threshold alerts
6. **Log Historical Data**: Export metrics for trend analysis
7. **Test Limits**: Verify limits work as expected before production deployment

## Troubleshooting

### IPC Segment Not Appearing

**Issue**: Model is running but not shown in `kvctl list`

**Solutions**:

- Verify `ENABLE_KVCACHED=true` environment variable is set
- Verify `KVCACHED_AUTOPATCH=1` is set
- Check model logs for kvcached initialization errors
- Ensure vLLM v0.14.1 is being used

### Memory Limit Not Enforced

**Issue**: Model exceeds set memory limit

**Solutions**:

- Limits apply to new allocations, not existing ones
- Restart model after setting limit
- Verify limit with `kvctl list`
- Check for multiple IPC segments for same model

### kvtop Display Issues

**Issue**: kvtop UI is garbled or not rendering correctly

**Solutions**:

- Ensure terminal supports curses (most modern terminals do)
- Resize terminal window
- Try different terminal emulator
- Use `kvctl watch` as alternative

## Command Reference Summary

### kvctl Commands

| Command         | Description                | Example                         |
| --------------- | -------------------------- | ------------------------------- |
| `list`          | List IPC segments          | `list`                          |
| `limit`         | Set absolute memory limit  | `limit VLLM_MODEL_1 4G`         |
| `limit-percent` | Set percentage-based limit | `limit-percent VLLM_MODEL_1 30` |
| `watch`         | Continuously display usage | `watch -n 2`                    |
| `delete`        | Delete IPC segment         | `delete VLLM_MODEL_1`           |
| `shell`         | Enter interactive shell    | `shell`                         |

### kvtop Options

| Option            | Description                  | Example              |
| ----------------- | ---------------------------- | -------------------- |
| `ipc_names`       | Specific segments to monitor | `kvtop VLLM_MODEL_1` |
| `-r`, `--refresh` | Refresh interval in seconds  | `kvtop -r 2`         |

## Related Documentation

- [architecture.md](./architecture.md) - Memory management architecture
- [model-lifecycle.md](./model-lifecycle.md) - Model management workflows
- [configuration.md](./configuration.md) - IPC segment configuration
