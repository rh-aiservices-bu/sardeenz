# Feature Specification: Multi-Model Management Platform

**Feature Branch**: `001-multi-model-platform`
**Created**: 2025-11-08
**Status**: Draft
**Input**: User description: "kvcached is a tool to help you launch and run multiple instances of vLLM to serve different Large Language Models. kvcached works from CLI commands, although it may also offer some API endpoints for control. The goal of our new application are multiple: 1) Provide a single endpoint to proxy requests to forward queries to the different vLLM endpoints listening on different ports. 2) Have a controller that you can query through an API to easily launch or stop models with kvcached. 3) Provide an admin UI to see which models are loaded, how much memory they consume, and call the controller API to load/unload models. 4) Package all of this in a single container image for easy deployment on OpenShift."

## Clarifications

### Session 2025-11-11

- Q: Should the controller rebuild its state from running processes on restart, or start fresh and treat all models as stopped? → A: Hybrid - Detect running processes and offer operator controls to adopt or terminate them
- Q: How should clients specify which model to use in inference requests? → A: Body-based - Model ID in request JSON body `{"model": "llama-2-7b", ...}` (matches OpenAI API exactly)
- Q: How should the controller handle concurrent launch requests for the same model? → A: Allow multiple instances of the same model with unique identifiers; proxy should load-balance requests across instances using round-robin
- Q: How should the platform handle inference request logging and history? → A: In-memory ring buffer for recent requests (lost on restart, aligns with stateless PoC design)
- Q: How should the controller handle resource availability when launching models? → A: Pre-launch validation - Check available memory against model requirements before launch, reject if insufficient

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Model Lifecycle Management via Controller API (Priority: P1)

Platform operators need to dynamically launch and stop Large Language Model instances to manage resource usage and respond to changing workload demands. The controller API provides programmatic control over kvcached to start and stop model instances on demand.

**Why this priority**: This is the foundation of the platform. Without the ability to manage model lifecycles, no other functionality can operate. This enables operators to respond to demand, manage costs, and optimize resource allocation.

**Independent Test**: Can be fully tested by calling API endpoints to launch a specific model, verifying the vLLM instance starts and responds to health checks, then calling the stop endpoint and verifying the instance shuts down cleanly. Delivers immediate value by enabling programmatic model management.

**Acceptance Scenarios**:

1. **Given** no models are currently running, **When** operator sends API request to launch a specific model (e.g., "llama-2-7b"), **Then** the system invokes kvcached to start the vLLM instance, returns success status, and the model becomes available on its designated port
2. **Given** a model is currently running, **When** operator sends API request to stop that model, **Then** the system gracefully shuts down the vLLM instance, releases resources, and returns confirmation
3. **Given** operator requests model status, **When** querying the controller API, **Then** system returns current state of all models (running, stopped, starting, stopping) with their port assignments
4. **Given** operator attempts to launch a model that is already running, **When** the launch request is received, **Then** system returns an error indicating the model is already running without creating duplicate instances

---

### User Story 2 - Request Routing via Unified Proxy (Priority: P2)

Application developers and users need to send inference requests to different Large Language Models without managing multiple endpoints or knowing which port each model listens on. The proxy provides a single unified endpoint that intelligently routes requests to the appropriate model instance.

**Why this priority**: This delivers the core user-facing value of the platform. Once models can be managed (P1), users need a simple way to interact with them. This abstracts away the complexity of multiple endpoints and enables seamless multi-model applications.

**Independent Test**: Can be fully tested by starting one or more models via the controller, sending inference requests to the proxy endpoint with model identifiers, and verifying responses come from the correct model instances. Delivers value by simplifying client integration and enabling model selection at runtime.

**Acceptance Scenarios**:

1. **Given** multiple models are running on different ports, **When** user sends inference request to the proxy with model identifier "llama-2-7b", **Then** proxy routes the request to the llama-2-7b instance and returns the model's response
2. **Given** user sends request to proxy for a model that is not running, **When** the request is received, **Then** proxy returns clear error message indicating the model is unavailable with suggestions to check available models
3. **Given** high volume of concurrent requests for different models, **When** requests arrive at the proxy, **Then** each request is routed to the correct model instance without cross-contamination or dropped connections
4. **Given** a model instance becomes unresponsive, **When** proxy attempts to route requests to it, **Then** proxy detects the failure and returns appropriate error response rather than hanging indefinitely

---

### User Story 3 - Monitoring Dashboard (Priority: P3)

Platform operators need visibility into which models are loaded, their resource consumption, and current operational status. The admin UI provides a visual dashboard for monitoring and controlling the model infrastructure without requiring API calls or command-line tools.

**Why this priority**: While the controller API (P1) enables management, a visual interface significantly improves operator experience and reduces cognitive load. This is especially valuable for less technical operators or during incident response when quick visibility is critical.

**Independent Test**: Can be fully tested by accessing the UI, verifying it displays current model status, resource usage, and provides buttons to load/unload models that invoke the controller API. Delivers value by making system state transparent and operations accessible to broader audience.

**Acceptance Scenarios**:

1. **Given** operator accesses the admin UI, **When** the dashboard loads, **Then** UI displays list of all available models with their current status (running/stopped), memory consumption, and uptime
2. **Given** operator views a stopped model in the UI, **When** operator clicks "Load Model" button, **Then** UI calls the controller API to start the model and updates status in real-time as the model starts
3. **Given** operator views a running model in the UI, **When** operator clicks "Unload Model" button, **Then** UI calls the controller API to stop the model and updates status to show model stopping then stopped
4. **Given** models are actively processing requests, **When** UI auto-refreshes, **Then** dashboard updates resource metrics (memory usage, request count) without requiring manual page refresh
5. **Given** operator attempts to load a model but insufficient resources available, **When** the operation fails, **Then** UI displays clear error message with resource constraints and suggestions

---

### User Story 4 - Container Deployment for OpenShift (Priority: P4)

Platform administrators need to deploy the entire multi-model management platform on OpenShift with minimal configuration and setup complexity. The containerized deployment packages the proxy, controller, and admin UI together with all dependencies.

**Why this priority**: While valuable for production deployment, the platform can be tested and validated without containerization. This priority enables production-ready deployment but doesn't block functionality development or testing.

**Independent Test**: Can be fully tested by deploying the container image to an OpenShift cluster, verifying all components (proxy, controller, UI) are accessible, and validating the platform can manage models within the containerized environment. Delivers value by making production deployment straightforward and repeatable.

**Acceptance Scenarios**:

1. **Given** OpenShift cluster with container runtime, **When** administrator deploys the platform container image, **Then** all components (proxy, controller, UI) start and become accessible through appropriate routes/services
2. **Given** container is deployed, **When** administrator accesses the admin UI through OpenShift route, **Then** UI loads successfully and can communicate with the controller API within the container
3. **Given** platform is running in container, **When** administrator uses controller to launch models, **Then** vLLM instances start within the container environment and are accessible to the proxy
4. **Given** container is restarted, **When** the platform comes back online, **Then** controller detects any orphaned vLLM processes and offers operator controls to adopt or terminate them (hybrid restart approach balancing cloud-native principles with operational flexibility)

---

### Edge Cases

- **Multiple launch requests for same model**: System supports launching multiple instances of the same model with unique identifiers; proxy load-balances requests across instances using round-robin (see FR-004, FR-028)
- **Controller restart with running processes**: System detects orphaned vLLM processes on startup and offers operator controls to adopt or terminate them via API/UI (see FR-027)
- **Out of memory during model launch**: System validates available memory before launching and rejects requests with clear error if insufficient resources (see FR-026)
- **Model crash during request routing**: Proxy detects unresponsive instances and returns timely error response rather than hanging (see FR-012)
- **All model instances stopped**: Proxy returns clear error message indicating no models available with suggestions to check available models (see User Story 2, scenario 2)
- **kvcached CLI unavailable or errors**: Controller returns clear error messages when model operations fail (see FR-007)
- **Port conflicts during launch**: System tracks port assignments and handles conflicts during model startup (see FR-005)
- **Admin UI loses connection to controller**: UI displays connection error and provides retry mechanism
- **Graceful shutdown during active requests**: Platform handles shutdown with hybrid approach to manage running processes and ongoing requests

## Requirements _(mandatory)_

### Functional Requirements

#### Controller API Requirements

- **FR-001**: System MUST provide API endpoint to launch a specified model using kvcached with model identifier
- **FR-002**: System MUST provide API endpoint to stop a running model instance
- **FR-003**: System MUST provide API endpoint to query status of all models (running, stopped, resource usage)
- **FR-004**: System MUST support launching multiple instances of the same model, each with a unique instance identifier
- **FR-005**: System MUST track which port each model instance is listening on
- **FR-006**: System MUST validate that requested models exist before attempting to launch them
- **FR-007**: System MUST return clear error messages when model operations fail

#### Proxy Requirements

- **FR-008**: System MUST provide a single endpoint that accepts inference requests with model identifiers
- **FR-009**: System MUST route requests to the correct vLLM instance port based on model identifier specified in request JSON body (e.g., `{"model": "llama-2-7b", ...}`)
- **FR-010**: System MUST return appropriate error when requested model is not running
- **FR-011**: System MUST handle concurrent requests to multiple different models without blocking
- **FR-012**: System MUST detect when a model instance becomes unresponsive and return timely error response
- **FR-013**: System MUST preserve request headers and payloads when forwarding to model instances
- **FR-014**: System MUST support OpenAI-compatible API format for inference requests (vLLM's native format)

#### Admin UI Requirements

- **FR-015**: System MUST display list of available models with current status (running/stopped)
- **FR-016**: System MUST display resource consumption metrics for running models (memory usage at minimum)
- **FR-017**: System MUST provide UI controls to load (start) stopped models
- **FR-018**: System MUST provide UI controls to unload (stop) running models
- **FR-019**: System MUST update displayed status in real-time or near-real-time (within 5 seconds)
- **FR-020**: System MUST display clear error messages when operations fail
- **FR-021**: System MUST show loading/progress indicators during model start/stop operations

#### Deployment Requirements

- **FR-022**: System MUST package proxy, controller, and admin UI in a single container image
- **FR-023**: System MUST be deployable on OpenShift without requiring external dependencies outside the container
- **FR-024**: System MUST expose appropriate ports/services for proxy endpoint, controller API, and admin UI
- **FR-025**: System MUST include kvcached and its dependencies within the container

#### Resource Management & Observability Requirements

- **FR-026**: System MUST validate available memory before launching model instances and reject requests if insufficient resources
- **FR-027**: System MUST detect orphaned vLLM processes on controller startup and offer operator controls to adopt or terminate them
- **FR-028**: System MUST load-balance inference requests across multiple instances of the same model using round-robin algorithm
- **FR-029**: System MUST maintain an in-memory ring buffer of recent inference requests for debugging and metrics (lost on restart)

### Key Entities

- **Model Instance**: Represents a running or stopped Large Language Model with attributes including model identifier (e.g., "llama-2-7b"), unique instance identifier (to distinguish multiple instances of the same model), current status (running/stopped/starting/stopping), assigned port number, memory consumption, and start time
- **Model Configuration**: Represents an available model that can be launched, including model identifier, resource requirements, and kvcached launch parameters
- **Inference Request**: Represents a user request for model inference, including target model identifier, input prompt/data, and request metadata
- **Resource Metrics**: Represents current resource usage for a model instance, including memory consumption, CPU usage (if available), request count, response times, and access to in-memory ring buffer of recent requests for debugging
- **Controller Operation**: Represents an administrative action (launch, stop, status query) with operation type, target model, timestamp, and result status

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Operators can launch a new model instance in under 60 seconds from API request to model ready for inference
- **SC-002**: Users can send inference requests through the proxy with routing overhead adding less than 50ms to response time
- **SC-003**: Admin UI updates model status within 5 seconds of actual state changes
- **SC-004**: Platform successfully handles concurrent inference requests to 5 different models without request failures
- **SC-005**: Container deployment completes on OpenShift in under 5 minutes from image pull to all components ready
- **SC-006**: 95% of model launch requests succeed without errors (excluding resource exhaustion scenarios)
- **SC-007**: System accurately tracks and reports memory usage for all running models
- **SC-008**: Operators can identify and resolve issues using admin UI without requiring API documentation or CLI tools
- **SC-009**: Platform handles graceful shutdown of all models in under 30 seconds when container stops
- **SC-010**: System correctly load-balances inference requests across multiple instances of the same model with approximately equal distribution
- **SC-011**: Controller successfully detects and reports orphaned vLLM processes on startup within 10 seconds
- **SC-012**: Pre-launch resource validation correctly prevents model launches when available memory is below required threshold
- **SC-013**: In-memory request ring buffer maintains most recent 1000 requests for debugging without impacting proxy performance

### Assumptions

- kvcached is already installed and available within the container environment or can be packaged with the platform
- vLLM is the inference engine used by kvcached; no other inference engines need support
- OpenShift environment has sufficient resources (memory, CPU, GPU if needed) to run multiple model instances
- Model files are either pre-downloaded within the container or accessible via network storage mounted to the container
- Network latency between proxy and model instances is minimal (same host/container)
- Users of the platform understand basic concepts of Large Language Models and inference
- Admin UI users have appropriate permissions to manage models within their OpenShift namespace
- Platform uses OpenAI-compatible API format (vLLM's native protocol) for all inference requests
- Container uses in-memory storage without external persistence; on restart, controller can detect and adopt orphaned processes (hybrid approach balancing statelessness with operational continuity)

### Dependencies

- kvcached tool must be functional and able to launch vLLM instances
- vLLM instances must expose HTTP/network endpoints for inference requests
- OpenShift cluster must support container deployment with network routing
- Sufficient system resources (memory, CPU, GPU) must be available to run multiple model instances simultaneously

### Out of Scope

The following are explicitly not included in this feature specification:

- Model training or fine-tuning capabilities
- Model file management, upload, or storage
- User authentication and authorization for proxy requests (assumed to be handled at infrastructure level or future feature)
- Multi-tenancy or namespace isolation between different users
- Advanced scheduling or auto-scaling of model instances based on load
- Request queuing or load balancing across multiple instances of the same model
- Billing or usage tracking per user or per model
- Integration with external model registries or catalogs
- GPU allocation and management (assumed handled by kvcached and underlying infrastructure)
- Backup and disaster recovery of platform state
- Performance optimization beyond basic routing functionality
