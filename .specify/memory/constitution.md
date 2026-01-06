<!--
Sync Impact Report - Constitution v0.0.1
========================================
Version Change: [Template] → 0.0.1 (Initial ratification for PoC phase)

Modified Principles:
- All principles newly defined (replacing template placeholders)

Added Sections:
- Type Safety & Monorepo Structure
- Performance-First
- API-First Design
- Security by Design
- Container-Native Development
- Observability
- Simplicity & Pragmatism
- Documentation Standards
- Development Workflow

Removed Sections:
- Generic template placeholders

Templates Status:
✅ spec-template.md - Reviewed, no updates needed (constitution-agnostic)
✅ plan-template.md - Reviewed, constitution check section aligns
✅ tasks-template.md - Reviewed, aligns with user story approach
⚠️  agent-file-template.md - Not reviewed (not used in workflow)
⚠️  checklist-template.md - Not reviewed (not used in workflow)

Follow-up TODOs:
- None at this time

Notes:
- Initial constitution for PoC phase
- Version 0.0.1 signals early development, allows flexibility before v1.0.0 stability
- All principles tailored to vLLM model management proxy project requirements
-->

# sardeenz Constitution

## Core Principles

### I. Type Safety & Monorepo Structure

**All code MUST use TypeScript with strict mode enabled.** The project MUST be organized as a monorepo using workspaces (npm/pnpm/yarn workspaces) with Node.js 22.

Requirements:

- Workspace structure: `apps/` for applications (backend, frontend), `packages/` for shared libraries
- Shared packages MUST include: types/contracts, validation schemas, utilities
- No `any` types except where absolutely necessary with explicit justification
- Shared types MUST be defined once and imported, never duplicated
- All workspace dependencies MUST use workspace protocol (`workspace:*`)

**Rationale:** TypeScript provides compile-time safety that catches errors before runtime. Monorepo with shared packages ensures type consistency between frontend and backend, eliminates version drift, and simplifies dependency management. Node.js 22 provides modern JavaScript features and performance optimizations.

### II. Performance-First

**The routing proxy MUST introduce minimal overhead.** All architectural decisions affecting the request path MUST consider performance impact.

Requirements:

- Routing logic must be optimized for low latency (no unnecessary async operations in hot path)
- Use streaming where appropriate for proxying inference requests
- Connection pooling for backend vLLM instances
- Health checks must not impact active request routing
- Performance regressions in routing path require explicit justification

**Rationale:** The proxy sits between users and inference engines. Any latency added directly impacts user experience. vLLM inference is already compute-intensive; proxy overhead must be negligible.

### III. API-First Design

**All functionality MUST be exposed via well-defined APIs before UI implementation.** APIs MUST follow REST or tRPC conventions with versioning support.

Requirements:

- OpenAPI 3.x specification for REST endpoints OR tRPC for type-safe RPC
- API versioning strategy (URL path `/api/v1/` or header-based)
- Request/response schemas defined in shared packages
- API contracts MUST be reviewed before implementation
- Breaking changes MUST increment major or minor version appropriately

**Rationale:** API-first ensures the UI is a thin client over robust backend services. This enables alternative clients, automation, and testing. Type-safe contracts prevent runtime errors at API boundaries.

### IV. Security by Design

**Authentication and authorization MUST be enforced for all management operations.** The system MUST integrate with OAuth providers and implement role-based access control (RBAC).

Requirements:

- OAuth 2.0 integration for authentication
- Two roles enforced: `admin` (full access), `admin-readonly` (read-only access)
- Role assignment based on OAuth group membership claims
- All model management APIs (load/unload) require `admin` role
- All endpoints return 401 (unauthenticated) or 403 (unauthorized) appropriately
- Inference routing proxy does NOT require authentication (assumes trusted network or separate gateway handles it)

**Rationale:** Model management is a privileged operation affecting shared GPU resources. RBAC ensures only authorized users can modify system state. OAuth integration enables enterprise SSO workflows.

### V. Container-Native Development

**The application MUST be designed for containerized deployment.** Development, testing, and production MUST use containers as the primary runtime environment.

Requirements:

- Dockerfile(s) based on existing CUDA + vLLM + Python 3.12 base image
- Multi-stage builds for frontend (build stage + nginx/serve) and backend
- Docker Compose for local development (all services: backend, frontend, mock vLLM instances)
- GPU awareness in container configuration (NVIDIA runtime, device requests)
- Container health checks for orchestration (liveness, readiness probes)
- Environment-based configuration (12-factor principles)

**Rationale:** vLLM requires GPU access and specific CUDA/Python environments. Containers ensure consistent environments across development and production. Container-native design simplifies deployment in Kubernetes or similar orchestrators.

### VI. Observability

**The system MUST provide comprehensive observability for operations and debugging.** Metrics, structured logging, and health endpoints are MANDATORY.

Requirements:

- Structured JSON logging (include request IDs, trace context)
- Metrics exposed (Prometheus format recommended): routing latency (p50/p95/p99), active connections per vLLM instance, model load/unload durations
- Health endpoints for backend and each managed vLLM instance
- Error tracking with context (user actions, model states, inference requests)
- Optional: OpenTelemetry tracing for distributed request flows

**Rationale:** Operating a model serving infrastructure requires visibility into performance, errors, and resource utilization. Structured logs enable debugging complex issues. Metrics enable capacity planning and alerting.

### VII. Simplicity & Pragmatism

**Avoid over-engineering.** Implement only what is needed for the current use case. Testing MUST focus on critical paths.

Requirements:

- YAGNI principle: No speculative features or abstractions
- Direct implementations preferred over frameworks unless clear benefit
- Pragmatic testing:
  - MANDATORY: Integration tests for routing logic, model management APIs
  - MANDATORY: Contract tests for API endpoints
  - RECOMMENDED: Unit tests for complex business logic
  - OPTIONAL: Unit tests for simple utilities
- Code complexity requiring additional abstractions MUST be justified in PR reviews
- Refactoring is continuous; premature abstraction is avoided

**Rationale:** This is a PoC project. Rapid iteration and learning are priorities. Over-engineered solutions slow development and add maintenance burden. Tests should provide confidence in critical functionality without becoming a burden.

## Documentation Standards

**All significant features and architectural decisions MUST be documented.**

Requirements:

- README.md with: project overview, quick start, architecture diagram
- API documentation (auto-generated from OpenAPI or tRPC schemas)
- ADRs (Architecture Decision Records) for major technical decisions
- Inline code comments for non-obvious logic (especially routing algorithms)
- Deployment guide: environment variables, container orchestration, GPU setup

**Rationale:** Documentation enables onboarding, troubleshooting, and knowledge sharing. Infrastructure projects have long lifespans; clear docs prevent knowledge loss.

## Development Workflow

**Code quality and consistency are enforced through tooling and process.**

Requirements:

- ESLint + Prettier for TypeScript (consistent formatting, linting rules)
- Pre-commit hooks (lint, type check, format check)
- CI pipeline MUST run: type checking, linting, tests, Docker builds
- Pull request reviews required for changes to routing logic, security, or APIs
- Branch strategy: feature branches, main branch protected
- Semantic versioning for releases: 0.x.y during PoC, 1.0.0+ for production readiness

**Rationale:** Automated tooling catches issues early. Code review provides knowledge sharing and quality gate. Semantic versioning signals stability and compatibility.

## Governance

**This constitution defines non-negotiable principles for the sardeenz project.** Compliance is verified during code reviews and planning.

### Amendment Process

1. Proposed changes MUST be documented with rationale
2. Team discussion and approval required (or project owner if solo)
3. Version bump according to impact:
   - MAJOR: Removing or fundamentally changing a core principle
   - MINOR: Adding new principle or expanding existing guidance
   - PATCH: Clarifications, typo fixes, non-semantic refinements
4. All affected templates and documentation MUST be updated synchronously

### Compliance

- All feature specifications (`spec.md`) MUST align with core principles
- All implementation plans (`plan.md`) include a "Constitution Check" gate
- Violations of NON-NEGOTIABLE principles require explicit justification and approval
- Retrospective reviews SHOULD validate compliance and capture learnings

### Living Document

This constitution evolves with the project. During PoC phase (v0.x.x), amendments are lightweight. After v1.0.0 ratification, amendments require more rigorous review.

**Version**: 0.0.1 | **Ratified**: 2025-11-07 | **Last Amended**: 2025-11-07
