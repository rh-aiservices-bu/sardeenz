# Implementation Plan: School of Sardeenz

**Branch**: `feat/school-of-sardeenz` | **Date**: 2026-03-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-school-orchestration/spec.md`

## Summary

Multi-pod orchestration for Sardeenz enabling dynamic pod discovery, leader election, centralized management dashboard, distributed inference proxy routing, cross-pod model moves, and declarative preset scheduling across up to 8 pods in a single Kubernetes namespace. Built on top of the existing single-pod architecture with zero overhead when running as a single pod.

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict mode) with Node.js 22.x, ES2022 target
**Primary Dependencies**: Fastify 5.1+, React 18, PatternFly 6, `@kubernetes/client-node` (new), `undici` (built-in Node 22)
**Storage**: SQLite (better-sqlite3) for presets/profiles, in-memory Maps for cluster state and routing table
**Testing**: Vitest (existing), integration tests for cluster communication, contract tests for internal API
**Target Platform**: Kubernetes/OpenShift (primary), Docker Compose / bare-metal (via static peer list)
**Project Type**: Monorepo (npm workspaces) - `apps/backend`, `apps/frontend`, `packages/types`, `packages/utils`
**Performance Goals**: <100ms added routing latency for cross-pod inference (SC-002), <30s pod discovery and leader re-election (SC-003, SC-004)
**Constraints**: Max 8 pods per cluster (SC-006), zero overhead in single-pod mode (FR-018), backward-compatible API
**Scale/Scope**: Up to 8 pods, each with 1+ GPUs, ~10-20 models per pod

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Type Safety & Monorepo | PASS | All new code in TypeScript strict mode. New types in `packages/types`. Workspace protocol maintained. |
| II. Performance-First | PASS | Cross-pod proxy targets <100ms overhead. Direct vLLM port bypass (FR-008). `undici.Pool` for connection management. Local-preferred weighted round-robin. |
| III. API-First Design | PASS | Internal API (`/internal/*`) and cluster admin API (`/api/cluster/*`) both defined as OpenAPI 3.1 contracts before implementation. See `contracts/`. |
| IV. Security by Design | PASS | Inter-pod HMAC-SHA256 authentication (FR-016). Existing dual-auth model (admin JWT + inference API key) preserved. Cluster secret via K8s Secret. |
| V. Container-Native Development | PASS | Designed for StatefulSet deployment. RBAC manifests for pod discovery + Lease election. Headless Service for direct pod addressing. |
| VI. Observability | PASS | Cluster health endpoint (FR-013). Heartbeat logging. Routing decision logging. Per-pod metrics preserved. |
| VII. Simplicity & Pragmatism | PASS | No Raft library (K8s Lease handles consensus). Heartbeat-based state sync (no separate consensus layer). Static peer list for non-K8s (no mDNS). 8-pod cap keeps scheduling simple. |

**Post-Phase 1 Re-check**: All gates remain PASS. The design uses existing patterns (Fastify plugins, in-memory Maps, SQLite, SSE) extended with cluster awareness rather than introducing new frameworks.

## Project Structure

### Documentation (this feature)

```text
specs/004-school-orchestration/
├── plan.md              # This file
├── research.md          # Phase 0: Technology decisions
├── data-model.md        # Phase 1: Entity definitions
├── quickstart.md        # Phase 1: Development setup guide
├── contracts/
│   ├── internal-api.yaml    # Inter-pod communication (HMAC-authenticated)
│   └── cluster-admin-api.yaml  # Cluster management endpoints (JWT-authenticated)
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
apps/backend/src/
├── services/
│   ├── cluster-manager.ts       # NEW: Orchestrates discovery, election, heartbeats
│   ├── peer-discovery.ts        # NEW: PeerDiscovery interface + K8s/Static impls
│   ├── leader-election.ts       # NEW: K8s Lease + heartbeat-based election
│   ├── heartbeat.ts             # NEW: Heartbeat sender/receiver
│   ├── cluster-auth.ts          # NEW: HMAC-SHA256 signing/verification
│   ├── pod-scheduler.ts         # NEW: Preset placement scheduler
│   ├── proxy-router.ts          # EXTEND: Cross-pod routing, undici.Pool mgmt
│   ├── model-manager.ts         # EXTEND: Emit cluster events on load/unload
│   └── model-mover.ts           # EXTEND: Cross-pod move support
├── stores/
│   ├── cluster-routing-store.ts          # NEW: Cluster-wide routing table
│   ├── peer-store.ts                     # NEW: Known peers + health tracking
│   ├── model-configuration-store.ts      # EXTEND: Preset replication, scheduling fields
│   └── memory-profile-store.ts           # EXTEND: GPU type metadata, cross-pod sync
├── routes/
│   ├── cluster.ts               # NEW: /api/cluster/* endpoints
│   ├── internal.ts              # NEW: /internal/* inter-pod endpoints
│   └── proxy.ts                 # EXTEND: Cross-pod forwarding, loop detection
├── plugins/
│   └── cluster-auth.ts          # NEW: Fastify plugin for HMAC verification on /internal/*
├── config.ts                    # EXTEND: CLUSTER_PEERS, CLUSTER_SECRET, CLUSTER_EXPECTED_PODS

packages/types/src/
├── cluster.ts                   # NEW: ClusterState, PeerInfo, HeartbeatMessage, etc.
└── models.ts                    # EXTEND: Add podId to ModelInstance for cluster context

apps/frontend/src/
├── pages/
│   └── ModelManagement.tsx      # EXTEND: Multi-pod view with pod grouping
├── components/
│   ├── ClusterOverview.tsx      # NEW: Pod health/status panel
│   ├── PodSelector.tsx          # NEW: Pod selection for model operations
│   ├── LoadModelDialog.tsx      # EXTEND: Pod target selection
│   ├── MoveModelDialog.tsx      # EXTEND: Cross-pod destination
│   └── ApplyPresetDialog.tsx    # NEW: Preset scheduling with placement preview
├── services/
│   └── api.ts                   # EXTEND: Cluster API endpoints
└── hooks/
    └── useClusterStatus.ts      # NEW: Polling hook for cluster state
```

**Structure Decision**: Extends the existing monorepo structure. No new workspace packages needed. All cluster logic lives in `apps/backend/src/services/` and `apps/backend/src/stores/` following the established pattern. New shared types go in `packages/types/src/cluster.ts`.

## Complexity Tracking

No constitution violations requiring justification. The design stays within existing architectural patterns:
- No new workspace packages (uses existing `packages/types`)
- No new frameworks or consensus libraries
- No new storage backends (SQLite + in-memory Maps)
- No new communication protocols (HTTP + SSE over existing Fastify)
