# Tasks: Multi-Model Management Platform

**Feature**: 001-multi-model-platform
**Input**: Design documents from `/specs/001-multi-model-platform/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `- [ ] [ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is a monorepo with npm workspaces:

- `apps/backend/` - Fastify backend (Controller + Proxy APIs)
- `apps/frontend/` - React + PatternFly dashboard
- `packages/types/` - Shared TypeScript types
- `packages/utils/` - Shared utilities
- `packages/contracts/` - OpenAPI specifications

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create root workspace structure with apps/ and packages/ directories
- [x] T002 Initialize root package.json with npm workspaces configuration
- [x] T003 [P] Create tsconfig.base.json with strict mode and shared compiler options
- [x] T004 [P] Configure ESLint in .eslintrc.json for TypeScript and React
- [x] T005 [P] Configure Prettier in .prettierrc.json
- [x] T006 [P] Create .gitignore with Node.js, TypeScript, and IDE patterns
- [x] T007 [P] Setup GitHub Actions workflow in .github/workflows/ci.yml for CI/CD

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Shared Packages

- [x] T008 [P] Initialize packages/types workspace with package.json and tsconfig.json
- [x] T009 [P] Initialize packages/utils workspace with package.json and tsconfig.json
- [x] T010 [P] Initialize packages/contracts workspace with package.json
- [x] T011 [P] Create TypeScript enums in packages/types/src/models.ts (ModelStatus, RequestStatus, OperationStatus, OperationType)
- [x] T012 [P] Create ModelConfiguration interface in packages/types/src/models.ts
- [x] T013 [P] Create ModelInstance interface in packages/types/src/models.ts
- [x] T014 [P] Create InferenceRequest interface in packages/types/src/models.ts
- [x] T015 [P] Create ResourceMetrics interface in packages/types/src/models.ts
- [x] T016 [P] Create ControllerOperation interface in packages/types/src/models.ts
- [x] T017 [P] Create API request/response types in packages/types/src/api.ts
- [x] T018 [P] Create TypeBox validation schemas in packages/types/src/validation.ts
- [x] T019 Create index.ts re-exporting all types in packages/types/src/index.ts
- [x] T020 Build packages/types workspace (npm run build -w packages/types)

### Shared Utilities

- [x] T021 [P] Create structured logger utility in packages/utils/src/logger.ts using pino
- [x] T022 [P] Create validation helpers in packages/utils/src/validation.ts
- [x] T023 Create index.ts re-exporting utilities in packages/utils/src/index.ts
- [x] T024 Build packages/utils workspace (npm run build -w packages/utils)

### Backend Foundation

- [x] T025 Initialize apps/backend workspace with package.json and dependencies (fastify, @fastify/oauth2, @fastify/jwt, @fastify/swagger, fastify-metrics, prom-client, @sinclair/typebox)
- [x] T026 Create apps/backend/tsconfig.json extending tsconfig.base.json
- [x] T027 Create environment configuration loader in apps/backend/src/config.ts
- [x] T028 Create Fastify server initialization in apps/backend/src/server.ts with TypeBox type provider
- [x] T029 [P] Create OAuth 2.0 authentication plugin in apps/backend/src/plugins/auth.ts
- [x] T030 [P] Create Swagger/OpenAPI documentation plugin in apps/backend/src/plugins/swagger.ts
- [x] T031 [P] Create Prometheus metrics plugin in apps/backend/src/plugins/metrics.ts
- [x] T032 [P] Create error handling utilities in apps/backend/src/utils/errors.ts
- [x] T033 [P] Create process utilities for subprocess management in apps/backend/src/utils/process.ts
- [x] T034 [P] Create health check endpoint in apps/backend/src/routes/health.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Model Lifecycle Management via Controller API (Priority: P1) 🎯 MVP

**Goal**: Enable operators to dynamically launch and stop Large Language Model instances via API

**Independent Test**: Call API endpoints to launch a specific model, verify vLLM instance starts and responds to health checks, then call stop endpoint and verify instance shuts down cleanly.

### Contract Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T035 [P] [US1] Create contract test configuration for Controller API using Dredd in apps/backend/tests/contract/dredd.config.ts
- [ ] T036 [P] [US1] Create contract test hooks for /api/models/load endpoint in apps/backend/tests/contract/controller-api.hooks.ts
- [ ] T037 [P] [US1] Create contract test hooks for /api/models/{model_path} endpoints in apps/backend/tests/contract/controller-api.hooks.ts

### Integration Tests for User Story 1

- [ ] T038 [P] [US1] Create integration test for model load operation in apps/backend/tests/integration/model-lifecycle.test.ts
- [ ] T039 [P] [US1] Create integration test for model unload operation in apps/backend/tests/integration/model-lifecycle.test.ts
- [ ] T040 [P] [US1] Create integration test for model status query in apps/backend/tests/integration/model-lifecycle.test.ts
- [ ] T041 [P] [US1] Create integration test for health check endpoint in apps/backend/tests/integration/model-lifecycle.test.ts

### Implementation for User Story 1

- [x] T042 [P] [US1] Create in-memory model instance store in apps/backend/src/stores/model-store.ts (Map<string, ModelInstance>)
- [x] T043 [P] [US1] Create in-memory controller operation store in apps/backend/src/stores/operation-store.ts (circular buffer)
- [x] T044 [US1] Implement ModelManager service in apps/backend/src/services/model-manager.ts with launchModel() method
- [x] T045 [US1] Implement vLLM subprocess spawning with kvcached env vars in apps/backend/src/services/model-manager.ts
- [x] T046 [US1] Implement health check polling logic in apps/backend/src/services/model-manager.ts waitForReady() method
- [x] T047 [US1] Implement unloadModel() with graceful shutdown (SIGTERM → SIGKILL) in apps/backend/src/services/model-manager.ts
- [x] T048 [US1] Implement IPC segment cleanup via kvctl in apps/backend/src/services/model-manager.ts
- [x] T049 [US1] Implement getModelStatus() method in apps/backend/src/services/model-manager.ts
- [x] T050 [US1] Implement listModels() method in apps/backend/src/services/model-manager.ts
- [x] T051 [US1] Add port management (next available port allocation) in apps/backend/src/services/model-manager.ts
- [x] T052 [US1] Add Prometheus metrics tracking for model load/unload duration in apps/backend/src/services/model-manager.ts
- [x] T053 [P] [US1] Create MemoryMonitor service in apps/backend/src/services/memory-monitor.ts
- [x] T054 [US1] Implement kvctl list parsing in apps/backend/src/services/memory-monitor.ts getMemoryUsage() method
- [x] T055 [US1] Implement memory limit setting via kvctl in apps/backend/src/services/memory-monitor.ts setMemoryLimits() method
- [x] T056 [US1] Implement resource metrics collection in apps/backend/src/services/memory-monitor.ts collectMetrics() method
- [x] T057 [US1] Create POST /api/models/load endpoint in apps/backend/src/routes/models.ts with admin role enforcement
- [x] T058 [US1] Create DELETE /api/models/:model_path endpoint in apps/backend/src/routes/models.ts with admin role enforcement
- [x] T059 [US1] Create GET /api/models endpoint in apps/backend/src/routes/models.ts with admin-readonly role enforcement
- [x] T060 [US1] Create GET /api/models/:model_path endpoint in apps/backend/src/routes/models.ts with admin-readonly role enforcement
- [x] T061 [US1] Create GET /api/models/:model_path/health endpoint in apps/backend/src/routes/models.ts
- [x] T062 [P] [US1] Create GET /api/memory/usage endpoint in apps/backend/src/routes/memory.ts
- [x] T063 [P] [US1] Create POST /api/memory/limits endpoint in apps/backend/src/routes/memory.ts with admin role enforcement
- [x] T064 [US1] Add request/response schema validation using TypeBox in apps/backend/src/routes/models.ts
- [x] T065 [US1] Add error handling for duplicate model loads (409 Conflict) in apps/backend/src/routes/models.ts
- [x] T066 [US1] Add error handling for model not found (404) in apps/backend/src/routes/models.ts
- [x] T067 [US1] Add structured logging for all model operations in apps/backend/src/routes/models.ts
- [x] T068 [US1] Register model routes in apps/backend/src/server.ts
- [x] T069 [US1] Register memory routes in apps/backend/src/server.ts
- [ ] T070 [US1] Run contract tests and verify they pass (npm run test:contract -w apps/backend)
- [ ] T071 [US1] Run integration tests and verify they pass (npm run test:integration -w apps/backend)

**Checkpoint**: At this point, User Story 1 should be fully functional - operators can load/unload models via API and query status

---

## Phase 4: User Story 2 - Request Routing via Unified Proxy (Priority: P2)

**Goal**: Provide a single unified endpoint that routes inference requests to the appropriate model instance

**Independent Test**: Start one or more models via Controller API, send inference requests to proxy endpoint with model identifiers, verify responses come from correct model instances.

### Contract Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T072 [P] [US2] Create contract test configuration for Proxy API using Dredd in apps/backend/tests/contract/dredd.config.ts
- [ ] T073 [P] [US2] Create contract test hooks for /v1/completions endpoint in apps/backend/tests/contract/proxy-api.hooks.ts
- [ ] T074 [P] [US2] Create contract test hooks for /v1/chat/completions endpoint in apps/backend/tests/contract/proxy-api.hooks.ts

### Integration Tests for User Story 2

- [ ] T075 [P] [US2] Create integration test for non-streaming completion routing in apps/backend/tests/integration/proxy-routing.test.ts
- [ ] T076 [P] [US2] Create integration test for streaming completion routing in apps/backend/tests/integration/proxy-routing.test.ts
- [ ] T077 [P] [US2] Create integration test for chat completion routing in apps/backend/tests/integration/proxy-routing.test.ts
- [ ] T078 [P] [US2] Create integration test for model not loaded error (404) in apps/backend/tests/integration/proxy-routing.test.ts
- [ ] T079 [P] [US2] Create integration test for routing latency (<50ms requirement) in apps/backend/tests/integration/proxy-routing.test.ts

### Implementation for User Story 2

- [x] T080 [P] [US2] Create in-memory inference request store in apps/backend/src/stores/request-store.ts (ring buffer, last 1000 per model)
- [x] T081 [P] [US2] Create in-memory resource metrics store in apps/backend/src/stores/metrics-store.ts (Map<string, ResourceMetrics>)
- [x] T082 [US2] Implement ProxyRouter service in apps/backend/src/services/proxy-router.ts
- [x] T083 [US2] Implement model lookup by model_path in apps/backend/src/services/proxy-router.ts routeRequest() method
- [x] T084 [US2] Implement HTTP connection pooling to vLLM instances in apps/backend/src/services/proxy-router.ts
- [x] T085 [US2] Implement non-streaming request forwarding in apps/backend/src/services/proxy-router.ts forwardRequest() method
- [x] T086 [US2] Implement streaming request forwarding with reply.hijack() in apps/backend/src/services/proxy-router.ts forwardStreamingRequest() method
- [x] T087 [US2] Implement request logging to inference request store in apps/backend/src/services/proxy-router.ts
- [x] T088 [US2] Implement Prometheus metrics for routing latency in apps/backend/src/services/proxy-router.ts
- [x] T089 [US2] Implement Prometheus metrics for active connections per model in apps/backend/src/services/proxy-router.ts
- [x] T090 [US2] Implement Prometheus counter for inference requests in apps/backend/src/services/proxy-router.ts
- [x] T091 [US2] Create POST /v1/completions endpoint in apps/backend/src/routes/proxy.ts (NO auth required)
- [x] T092 [US2] Implement streaming detection (body.stream === true) in apps/backend/src/routes/proxy.ts
- [x] T093 [US2] Implement model identifier extraction from request body in apps/backend/src/routes/proxy.ts
- [x] T094 [US2] Create POST /v1/chat/completions endpoint in apps/backend/src/routes/proxy.ts (NO auth required)
- [x] T095 [US2] Add error handling for model not loaded (404 with available models list) in apps/backend/src/routes/proxy.ts
- [x] T096 [US2] Add error handling for model unreachable (500) in apps/backend/src/routes/proxy.ts
- [x] T097 [US2] Add error handling for vLLM bad response (502) in apps/backend/src/routes/proxy.ts
- [x] T098 [US2] Add request/response schema validation using TypeBox in apps/backend/src/routes/proxy.ts
- [x] T099 [US2] Register proxy routes in apps/backend/src/server.ts
- [ ] T100 [US2] Run contract tests and verify they pass (npm run test:contract -w apps/backend)
- [ ] T101 [US2] Run integration tests and verify they pass (npm run test:integration -w apps/backend)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - users can send inference requests to any loaded model

---

## Phase 5: User Story 3 - Monitoring Dashboard (Priority: P3)

**Goal**: Provide a visual dashboard for operators to monitor and control model infrastructure

**Independent Test**: Access UI, verify it displays current model status, resource usage, and provides buttons to load/unload models that invoke the Controller API.

### Frontend Setup for User Story 3

- [x] T102 [US3] Initialize apps/frontend workspace with Vite and React TypeScript template
- [x] T103 [US3] Install PatternFly 6 dependencies in apps/frontend (�@patternfly/react-core, @patternfly/react-table, @patternfly/react-icons)
- [x] T104 [US3] Install additional dependencies in apps/frontend (react-router-dom, axios)
- [x] T105 [US3] Create apps/frontend/tsconfig.json extending tsconfig.base.json with DOM libs
- [x] T106 [US3] Configure Vite in apps/frontend/vite.config.ts with proxy to backend (/api → localhost:3000)
- [x] T107 [US3] Create environment variables file template in apps/frontend/.env with VITE_API_BASE_URL
- [x] T108 [US3] Import PatternFly base styles in apps/frontend/src/main.tsx

### API Client for User Story 3

- [x] T109 [P] [US3] Create API client service in apps/frontend/src/services/api.ts with axios instance
- [x] T110 [US3] Implement loadModel() method in apps/frontend/src/services/api.ts
- [x] T111 [US3] Implement unloadModel() method in apps/frontend/src/services/api.ts
- [x] T112 [US3] Implement listModels() method in apps/frontend/src/services/api.ts
- [x] T113 [US3] Implement getMemoryUsage() method in apps/frontend/src/services/api.ts
- [x] T114 [US3] Add error handling and response transformation in apps/frontend/src/services/api.ts

### Components for User Story 3

- [x] T115 [P] [US3] Create ModelCard component in apps/frontend/src/components/ModelCard.tsx displaying model info and status
- [x] T116 [P] [US3] Create MemoryChart component in apps/frontend/src/components/MemoryChart.tsx with PatternFly Chart
- [x] T117 [P] [US3] Create LoadModelDialog component in apps/frontend/src/components/LoadModelDialog.tsx with form validation
- [x] T118 [P] [US3] Create MetricsTable component in apps/frontend/src/components/MetricsTable.tsx using PatternFly Table
- [x] T119 [P] [US3] Create StatusBadge component in apps/frontend/src/components/StatusBadge.tsx for model status display

### Pages for User Story 3

- [x] T120 [US3] Create Dashboard page in apps/frontend/src/pages/Dashboard.tsx as main landing page
- [x] T121 [US3] Implement model list display using ModelCard components in apps/frontend/src/pages/Dashboard.tsx
- [x] T122 [US3] Implement memory usage chart using MemoryChart component in apps/frontend/src/pages/Dashboard.tsx
- [x] T123 [US3] Implement "Load Model" button triggering LoadModelDialog in apps/frontend/src/pages/Dashboard.tsx
- [x] T124 [US3] Implement "Unload Model" button with confirmation dialog in apps/frontend/src/pages/Dashboard.tsx
- [x] T125 [US3] Implement auto-refresh every 5 seconds using setInterval in apps/frontend/src/pages/Dashboard.tsx
- [x] T126 [US3] Add error message display using PatternFly Alert in apps/frontend/src/pages/Dashboard.tsx
- [x] T127 [US3] Add loading indicators using PatternFly Spinner in apps/frontend/src/pages/Dashboard.tsx

### App Integration for User Story 3

- [x] T128 [US3] Setup React Router in apps/frontend/src/App.tsx with route for Dashboard
- [x] T129 [US3] Create PatternFly Page layout in apps/frontend/src/App.tsx with navigation
- [x] T130 [US3] Configure development proxy server in apps/frontend/vite.config.ts
- [x] T131 [US3] Build frontend and verify no TypeScript errors (npm run build -w apps/frontend)

**Checkpoint**: All user stories (US1, US2, US3) should now be independently functional - operators can manage models via API or UI, users can send inference requests

---

## Phase 6: User Story 4 - Container Deployment for OpenShift (Priority: P4)

**Goal**: Package the entire platform in a container image for deployment on OpenShift

**Independent Test**: Deploy container image to OpenShift cluster, verify all components are accessible, and validate platform can manage models within containerized environment.

### Container Configuration for User Story 4

- [x] T132 [P] [US4] Create Dockerfile.unified in docker/Dockerfile.unified based on quay.io/vllm/vllm-cuda:0.11.2
- [x] T133 [US4] Add Node.js 22 installation to Dockerfile.unified using nvm
- [x] T134 [US4] Copy monorepo structure to container in Dockerfile.unified
- [x] T135 [US4] Install npm dependencies and build all workspaces in Dockerfile.unified
- [x] T136 [US4] Build frontend and serve via nginx in Dockerfile.unified
- [x] T137 [US4] Configure container entrypoint to start backend server in Dockerfile.unified
- [x] T138 [US4] Add health check for backend and frontend in Dockerfile.unified
- [x] T139 [US4] Set environment variables for kvcached (ENABLE_KVCACHED, KVCACHED_AUTOPATCH) in Dockerfile.unified
- [x] T140 [P] [US4] Create docker-compose.yml in docker/docker-compose.yml for local development
- [x] T141 [US4] Configure service definitions for backend and frontend in docker-compose.yml
- [x] T142 [US4] Add GPU device configuration in docker-compose.yml
- [x] T143 [US4] Add volume mounts for model storage in docker-compose.yml

### OpenShift Deployment for User Story 4

- [x] T144 [P] [US4] Create OpenShift Deployment manifest in deployment/deployment.yaml
- [x] T145 [P] [US4] Create OpenShift Service manifest in deployment/service.yaml
- [x] T146 [P] [US4] Create OpenShift Route manifest in deployment/route.yaml
- [x] T147 [US4] Configure GPU node selector in deployment/deployment.yaml
- [x] T148 [US4] Configure resource requests and limits in deployment/deployment.yaml
- [x] T149 [US4] Configure liveness and readiness probes in deployment/deployment.yaml
- [x] T150 [US4] Add ConfigMap for environment variables in deployment/configmap.yaml
- [x] T151 [US4] Add Secret for OAuth credentials in deployment/secret.yaml (template)

### Container Testing for User Story 4

- [ ] T152 [US4] Build unified container image locally (docker build -f docker/Dockerfile.unified)
- [ ] T153 [US4] Test container locally with GPU access (docker run --gpus all)
- [ ] T154 [US4] Verify backend API accessible from container
- [ ] T155 [US4] Verify frontend UI accessible from container
- [ ] T156 [US4] Test model load/unload within container environment
- [x] T157 [US4] Create deployment guide in docs/deployment.md

**Checkpoint**: All user stories complete - platform can be deployed to OpenShift and fully functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, optimization, and quality improvements

### Documentation

- [ ] T158 [P] Create architecture documentation in docs/architecture.md
- [ ] T159 [P] Create API usage guide in docs/api-guide.md
- [ ] T160 [P] Update README.md with project overview and quickstart
- [ ] T161 [P] Create API examples directory in docs/examples/ with curl commands
- [ ] T162 [P] Update CLAUDE.md with latest project structure

### Testing & Quality

- [ ] T163 [P] Add unit tests for ModelManager service in apps/backend/tests/unit/model-manager.test.ts
- [ ] T164 [P] Add unit tests for MemoryMonitor service in apps/backend/tests/unit/memory-monitor.test.ts
- [ ] T165 [P] Add unit tests for ProxyRouter service in apps/backend/tests/unit/proxy-router.test.ts
- [ ] T166 [P] Add component tests for ModelCard in apps/frontend/tests/components/ModelCard.test.tsx
- [ ] T167 [P] Add component tests for LoadModelDialog in apps/frontend/tests/components/LoadModelDialog.test.tsx
- [ ] T168 Run full test suite and ensure all tests pass (npm run test --workspaces)
- [ ] T169 Run linting and fix issues (npm run lint --workspaces)
- [ ] T170 Run type checking across all workspaces (npm run typecheck)

### Performance & Security

- [ ] T171 [P] Optimize connection pooling configuration for vLLM instances
- [ ] T172 [P] Add request rate limiting to proxy endpoints
- [ ] T173 [P] Implement CORS configuration for frontend
- [ ] T174 [P] Add input sanitization for model paths
- [ ] T175 [P] Review OAuth configuration for production readiness
- [ ] T176 Validate routing latency meets <50ms requirement (load testing)

### Final Validation

- [ ] T177 Run quickstart.md validation end-to-end
- [ ] T178 Verify all success criteria from spec.md are met
- [ ] T179 Create deployment checklist for production

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) completion - BLOCKS all user stories
- **User Stories (Phases 3-6)**: All depend on Foundational (Phase 2) completion
  - User stories CAN proceed in parallel (if team capacity allows)
  - OR sequentially in priority order: US1 (P1) → US2 (P2) → US3 (P3) → US4 (P4)
- **Polish (Phase 7)**: Depends on desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - NO dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational - Integrates with US1 (uses ModelManager) but independently testable
- **User Story 3 (P3)**: Can start after Foundational - Calls APIs from US1 but independently testable
- **User Story 4 (P4)**: Can start after Foundational - Packages US1+US2+US3 but can be tested independently

### Within Each User Story

1. **Contract tests** MUST be written FIRST and FAIL before implementation
2. **Integration tests** MUST be written FIRST and FAIL before implementation
3. **Implementation order**:
   - Stores/data structures
   - Services (business logic)
   - Routes/endpoints
   - Integration and error handling
4. **Validation**: Run tests and verify they pass before moving to next story

### Parallel Opportunities

**Setup Phase (Phase 1):**

- Tasks T003-T007 can run in parallel (different config files)

**Foundational Phase (Phase 2):**

- Packages (T008-T020) can all run in parallel
- Utilities (T021-T024) can run in parallel
- Backend plugins (T029-T031) can run in parallel
- Backend utilities (T032-T034) can run in parallel

**User Story 1 (Phase 3):**

- Contract tests (T035-T037) can run in parallel
- Integration tests (T038-T041) can run in parallel
- Stores (T042-T043) can run in parallel
- Routes (T062-T063 memory endpoints) can run in parallel with model routes

**User Story 2 (Phase 4):**

- Contract tests (T072-T074) can run in parallel
- Integration tests (T075-T079) can run in parallel
- Stores (T080-T081) can run in parallel

**User Story 3 (Phase 5):**

- Components (T115-T119) can run in parallel

**User Story 4 (Phase 6):**

- OpenShift manifests (T144-T146) can run in parallel

**Polish Phase (Phase 7):**

- Documentation (T158-T162) can run in parallel
- Unit tests (T163-T167) can run in parallel
- Performance tasks (T171-T176) can run in parallel

**Cross-Story Parallelism:**

- Once Foundational (Phase 2) completes, US1, US2, US3 can all start in parallel (different team members)

---

## Parallel Example: Foundational Phase

```bash
# All shared package tasks can run together:
Task T008: "Initialize packages/types workspace"
Task T009: "Initialize packages/utils workspace"
Task T010: "Initialize packages/contracts workspace"

# All backend plugins can run together:
Task T029: "Create OAuth 2.0 plugin in apps/backend/src/plugins/auth.ts"
Task T030: "Create Swagger plugin in apps/backend/src/plugins/swagger.ts"
Task T031: "Create Prometheus metrics plugin in apps/backend/src/plugins/metrics.ts"
```

---

## Parallel Example: User Story 1

```bash
# Contract tests can all run together:
Task T035: "Contract test config for Controller API"
Task T036: "Contract test hooks for /api/models/load"
Task T037: "Contract test hooks for /api/models/{model_path}"

# Integration tests can all run together:
Task T038: "Integration test for model load"
Task T039: "Integration test for model unload"
Task T040: "Integration test for model status"
Task T041: "Integration test for health check"

# Stores can run together:
Task T042: "Create model instance store"
Task T043: "Create controller operation store"

# Memory endpoints can run in parallel with model routes completion:
Task T062: "Create GET /api/memory/usage endpoint"
Task T063: "Create POST /api/memory/limits endpoint"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete **Phase 1: Setup** (T001-T007)
2. Complete **Phase 2: Foundational** (T008-T034) - CRITICAL - blocks all stories
3. Complete **Phase 3: User Story 1** (T035-T071)
4. **STOP and VALIDATE**:
   - Run contract tests (T070)
   - Run integration tests (T071)
   - Test model load/unload via API manually
5. **Deploy/demo** if ready

**Result**: Operators can programmatically manage model lifecycles - immediate value delivered!

### Incremental Delivery (Recommended)

1. **Foundation** (Phases 1-2) → Infrastructure ready
2. **+ User Story 1** → Test independently → **Deploy MVP** (model management via API)
3. **+ User Story 2** → Test independently → **Deploy v0.2** (inference routing working)
4. **+ User Story 3** → Test independently → **Deploy v0.3** (visual dashboard added)
5. **+ User Story 4** → Test independently → **Deploy v1.0** (production-ready container)
6. **+ Polish** → **Release v1.1** (documentation, optimization, hardening)

Each increment adds value without breaking previous functionality!

### Parallel Team Strategy

With 3 developers after Foundational phase completes:

1. **Team completes Foundation together** (Phases 1-2)
2. **Parallel user story development**:
   - **Developer A**: User Story 1 (T035-T071) - Controller API
   - **Developer B**: User Story 2 (T072-T101) - Proxy API
   - **Developer C**: User Story 3 (T102-T131) - Dashboard UI
3. **Stories integrate cleanly** (US2 uses US1's ModelManager, US3 calls US1's API)
4. **Container team** (Developer A after US1): User Story 4 (T132-T157)
5. **Polish together**: Phase 7 (T158-T179)

---

## Success Criteria Mapping

Tasks are designed to satisfy all success criteria from spec.md:

- **SC-001** (Model loads in <60s): T046 health check polling, T071 integration test
- **SC-002** (Routing overhead <50ms): T079 latency test, T088 metrics, T176 load testing
- **SC-003** (UI updates in <5s): T125 auto-refresh implementation
- **SC-004** (5 concurrent models): T051 port management, T055 memory limits
- **SC-005** (Container deployment <5min): T152-T156 container testing
- **SC-006** (95% success rate): T065-T067 error handling, T168 full test suite
- **SC-007** (Memory tracking): T054 kvctl integration, T056 metrics collection
- **SC-008** (UI-based troubleshooting): T120-T127 dashboard implementation
- **SC-009** (Graceful shutdown <30s): T047 SIGTERM/SIGKILL implementation
- **SC-010** (Load balancing): Future work (round-robin routing)
- **SC-011** (Orphan detection <10s): Future work (startup process detection)
- **SC-012** (Pre-launch validation): Future work (memory availability check)
- **SC-013** (Request ring buffer): T080 inference request store

---

## Notes

- **[P] tasks** = Different files, no dependencies within same phase
- **[Story] label** = Maps task to specific user story for traceability
- Each user story is **independently completable and testable**
- Verify **contract and integration tests FAIL** before implementing
- **Commit** after each logical group of tasks
- Stop at any **checkpoint** to validate story independently
- **MVP** = Phase 1 + Phase 2 + Phase 3 only (US1)
- **Production-ready** = All phases including US4 (container)
