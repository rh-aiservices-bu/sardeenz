# User Guide

This guide walks you through the sardeenz web dashboard — loading models, monitoring GPUs, running benchmarks, and managing a multi-pod cluster.

**Access:** Open `http://localhost:3000` (or your deployment URL) in a browser.

## Table of Contents

- [Navigation](#navigation)
- [Model Management](#model-management)
  - [GPU Memory Overview](#gpu-memory-overview)
  - [Loading a Model](#loading-a-model)
  - [Model Cards and Table View](#model-cards-and-table-view)
  - [Moving a Model](#moving-a-model)
  - [Sleeping and Waking Models](#sleeping-and-waking-models)
  - [Unloading Models](#unloading-models)
  - [Saving and Loading Configurations](#saving-and-loading-configurations)
- [Chatbot Playground](#chatbot-playground)
- [Model Benchmark](#model-benchmark)
  - [Running a Benchmark](#running-a-benchmark)
  - [Memory Profiles](#memory-profiles)
- [GPU Info](#gpu-info)
- [Settings](#settings)
- [Cluster Mode](#cluster-mode)
  - [Cluster Overview](#cluster-overview)
  - [Pod Selector](#pod-selector)
  - [Split View](#split-view)
  - [Cross-Pod Model Moves](#cross-pod-model-moves)
  - [Cluster-Wide Presets](#cluster-wide-presets)
- [Roles and Permissions](#roles-and-permissions)
- [Troubleshooting](#troubleshooting)

---

## Navigation

The sidebar on the left provides access to all pages:

| Page | Description |
| --- | --- |
| **Model Management** | Load, unload, move models and monitor GPU memory (home page) |
| **Chatbot Playground** | Interactive chat interface for testing loaded models |
| **Model Benchmark** | Performance benchmarking and memory profiling |
| **GPU Info** | Real-time GPU hardware metrics |
| **Settings** | HuggingFace token and platform configuration |

The header toolbar (top right) contains:

- **Theme toggle** — Switch between light and dark mode
- **Operations indicator** — Shows count of active background operations (loads, moves)
- **Notifications** — Click to open the notification drawer
- **User menu** — Displays your username, role, and logout option

---

## Model Management

This is the home page. It shows your GPU memory usage, all loaded models, and controls for loading, moving, and unloading models.

### GPU Memory Overview

The top panel displays a card for each GPU showing:

- A stacked bar chart with per-model memory usage (each model in a different color)
- KV cache breakdown (preallocated / used / free)
- GPU temperature and utilization percentage
- A model legend — click a model name to scroll to its card below

Use the **refresh interval dropdown** (None / 5s / 15s / 30s / 1m) to control auto-refresh.

### Loading a Model

1. Click **Start Model** in the toolbar
2. Choose the model source:
   - **HuggingFace** — Enter a model ID (e.g., `HuggingFaceTB/SmolLM2-135M-Instruct`)
   - **Local Path** — Browse folders on the server to select a model directory
3. Set a **served model name** (auto-filled for HuggingFace models)
4. Set **max tokens** (default 4096)
5. Choose GPU assignment:
   - **Auto** (recommended) — Picks the GPU with the most free memory
   - **Manual** — Select one or more GPUs. Selecting multiple GPUs enables tensor parallelism
6. Optionally enable **sleep mode** to allow putting the model to sleep later
7. Optionally add **extra vLLM arguments** (one per line)
8. Click **Start Model**

The dialog shows a real-time progress bar and live log output. You can click **Run in Background** to dismiss the dialog while loading continues — the operations indicator in the header tracks it.

If loading fails, the dialog shows the error with expanded logs. Click **Try Again** to retry.

### Model Cards and Table View

Loaded models appear below the GPU Memory Overview, grouped by GPU. You can switch between two views using the toolbar toggle:

- **Card view** (default) — One card per model showing name, status, GPU assignment, and memory usage
- **Table view** — Compact sortable table with columns for name, status, GPUs, memory, and actions

Both views support **search** (filter by model name) and **sorting** (by name, status, or memory).

Each model has these action buttons:

| Action | Description |
| --- | --- |
| **Move** | Move the model to a different GPU (or pod in cluster mode) |
| **Sleep** | Suspend the model to free ~90% of its GPU memory (only if sleep mode was enabled at load time) |
| **Wake** | Resume a sleeping model |
| **Unload** | Remove the model from the GPU |
| **View Logs** | Open the model's vLLM log output |

### Moving a Model

1. Click **Move** on a model card
2. Select the target GPU(s) — each GPU shows its free memory and whether it has enough space
3. For tensor parallel models, select the same number of GPUs as the model requires
4. Set the **drain timeout** (default 60s) — how long to wait for active requests to finish before switching
5. Click **Move**

The move uses a blue-green deployment pattern: the model loads on the target GPU first, traffic switches over, then the source is unloaded. If the target load fails, the model stays on the original GPU.

### Sleeping and Waking Models

If a model was loaded with **sleep mode enabled**, you can put it to sleep to free approximately 90% of its GPU memory. The model remains registered but cannot serve requests until woken.

- Click **Sleep** on a model card to suspend it (sleeping models show a moon icon)
- Click **Wake** to resume serving

This is useful for keeping many models loaded while freeing memory for the ones you actively need.

### Unloading Models

- Click **Unload** on a model card to remove a single model
- Click **Unload All** in the toolbar to remove all loaded models (with confirmation)

### Saving and Loading Configurations

You can save a snapshot of your current model setup and restore it later.

**To save:**

1. Click **Save Config** in the toolbar (only available when models are loaded)
2. Enter a name and optional description
3. Click **Save**

The configuration captures each model's path, served name, GPU assignment, max tokens, tensor parallel size, and extra arguments.

**To load:**

1. Click **Load Config** in the toolbar
2. Select a saved configuration from the list
3. Click **Load Configuration**

All current models are unloaded first, then the saved models are loaded in sequence. Models on separate GPUs load in parallel for speed.

---

## Chatbot Playground

An interactive chat interface for testing your loaded models.

**How to use:**

1. The left sidebar lists all running models (auto-refreshes every 5 seconds)
2. Click a model name to open a chat session
3. Type your prompt in the input field and press Send
4. Responses stream in token-by-token

You can open multiple model sessions simultaneously in separate tabs for side-by-side comparison. Sessions persist in your browser across page reloads.

In cluster mode, models are grouped by pod in the sidebar.

---

## Model Benchmark

Tools for measuring model performance and planning GPU memory capacity.

### Running a Benchmark

1. Go to the **Performance** tab
2. Click **New Benchmark**
3. Configure your benchmark:
   - **Name** (optional) — A label for the benchmark run
   - **Mode** — *Isolated* (single model, no contention) or *Contention* (multiple models under parallel load)
   - **Scenarios** — Add one or more test scenarios, each with:
     - Model selection (from running models)
     - Routing mode (Direct or Proxy)
     - Input/output token counts
     - Concurrency level
     - Total and warmup request counts
     - Optional SLA threshold (ms)
4. Click **Run Benchmark**

Results show throughput (requests/sec), latency percentiles (p50, p90, p95, p99), time to first token, and SLA compliance.

Previous benchmark runs are saved and can be viewed or re-run from the benchmark history.

### Memory Profiles

The **Memory Profiles** tab shows the GPU memory footprint of models you've loaded. These profiles are captured automatically when a model finishes loading and are used for pre-load memory checks — the Load Model dialog warns you if a model is unlikely to fit on the selected GPU.

---

## GPU Info

Real-time GPU hardware metrics from NVIDIA drivers.

Each GPU card shows:

- GPU name, temperature, and utilization percentage
- Memory usage (used / total) as a bar chart
- Fan speed, performance state, power draw
- Bus ID and compute mode

The **GPU Processes** table at the bottom lists all processes using GPU memory, with vLLM processes highlighted.

Use the **refresh interval dropdown** to set auto-refresh (5s / 15s / 30s / 1m) or refresh manually.

In cluster mode, use the **pod selector** in the header to view GPUs on different pods.

---

## Settings

### HuggingFace Token

Some models on HuggingFace require authentication (gated models like Llama, Mistral, etc.). To access them:

1. Go to **Settings**
2. Enter your HuggingFace token
3. Click **Test Connection** to verify it works
4. Click **Save Token**

The token is stored at runtime only. For production deployments, set the `HF_TOKEN` environment variable instead.

---

## Cluster Mode

When sardeenz is deployed as a multi-pod cluster (2+ pods), additional features appear throughout the dashboard.

### Cluster Overview

A new card appears at the top of Model Management showing:

- **Cluster health** — Healthy, degraded, or unavailable
- **Pod count** and **total models** loaded across the cluster
- **Per-pod sections** (expandable) showing each pod's status, VRAM usage, loaded models, and whether it's the current leader

### Pod Selector

A dropdown appears in the Model Management toolbar and other pages (GPU Info, Load Model dialog) allowing you to switch which pod you're viewing or targeting.

### Split View

When two or more pods are available, a **Split View toggle** appears. This shows two pods side-by-side, each with its own model list and GPU memory panel — useful for comparing pod utilization or preparing cross-pod moves.

### Cross-Pod Model Moves

To move a model from one pod to another:

1. Click **Move** on a model card
2. In the Move dialog, change the **pod selector** to a different pod
3. The available GPUs update to show the target pod's GPUs
4. Select the target GPU(s) and click **Move**

The model loads on the target pod first, then unloads from the source pod.

### Cluster-Wide Presets

Saving a configuration in cluster mode captures models from all pods. When loading a configuration, you can choose a **placement strategy**:

- **None (manual)** — Models load on their originally saved pod/GPU
- **Balanced** — Spread models evenly across pods
- **Maximize Models** — Pack models onto fewer GPUs to maximize capacity

---

## Roles and Permissions

The dashboard supports role-based access control:

| Role | Capabilities |
| --- | --- |
| **admin** | Full access — load, move, unload models, save configs, run benchmarks, modify settings |
| **admin-readonly** | View-only — can see everything but cannot make changes |

When logged in as read-only, write actions (Start Model, Move, Unload, Save Config, etc.) are disabled with a tooltip explaining why.

Authentication mode is configured by the deployment (`AUTH_MODE` environment variable). See the [Deployment Guide](./deployment.md) for details.

---

## Troubleshooting

### Model loading fails

- **Check the logs** — Expand the log viewer in the Load dialog for the full error
- **Verify the model path** — HuggingFace IDs are case-sensitive
- **Check GPU memory** — The GPU Memory Overview shows available space. If the model is too large, unload or sleep another model first
- **Gated models** — If you see an authentication error, set your HuggingFace token in Settings

### Move fails with "Insufficient GPU Memory"

- Check the free memory on the target GPU in the GPU Memory Overview
- The move dialog shows detailed memory breakdown (needed vs. available per GPU)
- Consider sleeping or unloading a model on the target GPU first

### Models not appearing in Chatbot Playground

- Only models with **running** status appear in the sidebar
- Models that are loading, sleeping, or failed won't show up
- The sidebar auto-refreshes every 5 seconds — wait a moment after loading

### Cluster issues

- **Cluster shows "degraded"** — One or more pods may be unreachable. Check the Cluster Overview for per-pod status
- **Leader changed notification** — Normal during failover. The dashboard automatically redirects to the new leader
- **Pod selector shows a pod as unavailable** — The pod may be restarting or disconnected from the cluster

### GPU Info shows no data

- Ensure the NVIDIA drivers are installed and nvidia-smi works on the host
- In inference-sim mode, GPU Info shows simulated data
