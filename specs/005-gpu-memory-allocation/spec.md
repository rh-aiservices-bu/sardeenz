# Feature Specification: GPU Memory Allocation Mode

**Feature Branch**: `005-gpu-memory-allocation`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "When loading a model, ability to disable kvcached and instead specify a percentage of GPU memory to consume"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Load a Model Without kvcached (Priority: P1)

As a platform admin, when loading a model I can choose to disable kvcached for that specific model and instead specify a percentage of GPU memory the model should consume. This allows me to control memory allocation directly using vLLM's native `gpu-memory-utilization` parameter, which is useful when I don't need dynamic memory sharing or when I want a model to have a fixed memory footprint.

**Why this priority**: This is the core and only feature — without it, there's nothing to deliver.

**Independent Test**: Can be tested by loading a model with kvcached disabled and a memory percentage set (e.g., 80%), then verifying vLLM launches with the correct `--gpu-memory-utilization` flag and does not use kvcached IPC segments.

**Acceptance Scenarios**:

1. **Given** a GPU with no models loaded, **When** an admin loads a model with kvcached disabled and GPU memory set to 80%, **Then** the model launches with `--gpu-memory-utilization 0.8` and no kvcached IPC segment is configured.
2. **Given** a GPU with a kvcached-managed model already loaded, **When** an admin loads a second model on the same GPU with kvcached disabled, **Then** the system warns that mixing kvcached and non-kvcached models on the same GPU may cause memory conflicts.
3. **Given** a model loaded without kvcached at 90% memory, **When** the admin views the dashboard, **Then** the model's details show that kvcached is disabled and the configured memory percentage.
4. **Given** kvcached is globally disabled in the server configuration, **When** an admin loads a model, **Then** the GPU memory percentage option is available by default.

---

### User Story 2 - Memory Percentage in Dashboard UI (Priority: P1)

As a platform admin, the model loading interface in the dashboard provides a clear option to toggle kvcached on or off for each model, and when kvcached is off, a field to specify the GPU memory percentage. The default behavior remains unchanged (kvcached enabled when available).

**Why this priority**: P1 because the feature is unusable without a way to configure it from the dashboard.

**Independent Test**: Can be tested by opening the model load dialog, toggling kvcached off, setting a memory percentage, and verifying the model loads with the correct settings.

**Acceptance Scenarios**:

1. **Given** the model load dialog is open, **When** kvcached is available on the system, **Then** a toggle is shown defaulting to kvcached enabled, with the memory percentage field hidden.
2. **Given** the model load dialog is open, **When** the admin disables kvcached via the toggle, **Then** a GPU memory percentage field appears with a sensible default (e.g., 90%).
3. **Given** the admin sets GPU memory to a value outside the valid range (e.g., 0% or 150%), **When** they attempt to load the model, **Then** the system rejects the request with a clear validation error.

---

### Edge Cases

- What happens when a model is loaded without kvcached on a GPU that already has a kvcached-managed model? The system should warn about potential memory conflicts since kvcached and fixed allocation use different memory management strategies on the same GPU.
- What happens when GPU memory percentage is set too high and the model fails to load? vLLM will report an out-of-memory error, which should be surfaced to the admin through the existing error reporting mechanism.
- What happens when the admin tries to use GPU memory percentage but kvcached is the only available memory management option? The system should still allow disabling kvcached, falling back to vLLM's native memory management.
- What happens to the `--gpu-memory-utilization` flag if extra args already contain it? Since this flag is currently in the forbidden args list, the system should allow it only when kvcached is explicitly disabled for that model, and the UI-specified percentage should take precedence over any extra args value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The model load request MUST accept an option to disable kvcached for that specific model instance.
- **FR-002**: When kvcached is disabled for a model, the system MUST accept a GPU memory utilization percentage (0-100%) and pass it to vLLM as the `--gpu-memory-utilization` parameter.
- **FR-003**: When kvcached is disabled for a model, the system MUST NOT configure kvcached IPC segments or environment variables for that model's process.
- **FR-004**: The default behavior MUST remain unchanged: kvcached enabled when available on the system.
- **FR-005**: The system MUST warn the admin when loading a non-kvcached model on a GPU that already has kvcached-managed models (or vice versa).
- **FR-006**: The model instance state MUST track whether kvcached is enabled or disabled, and the configured memory percentage when applicable.
- **FR-007**: The dashboard MUST display the memory allocation mode (kvcached or fixed percentage) for each loaded model.
- **FR-008**: The `--gpu-memory-utilization` flag MUST remain forbidden in extra args. The memory percentage MUST only be configurable through the dedicated option when kvcached is disabled.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can load a model without kvcached and with a specific GPU memory percentage in under 1 minute from the dashboard.
- **SC-002**: Models loaded without kvcached correctly use vLLM's native memory management with no kvcached interference.
- **SC-003**: The dashboard clearly distinguishes between kvcached-managed and fixed-percentage models at a glance.
- **SC-004**: Existing model loading behavior is unchanged when the feature is not used — kvcached remains the default.

## Assumptions

- vLLM's `--gpu-memory-utilization` parameter works correctly when kvcached is not active.
- The admin understands the tradeoff: without kvcached, models have a fixed memory footprint and cannot dynamically share GPU memory with other models.
- This feature applies per model instance, not globally — different models on different GPUs can use different memory management modes.
