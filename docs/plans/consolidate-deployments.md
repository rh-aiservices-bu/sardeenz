# Plan: Consolidate Kubernetes Deployment Directories

**Branch:** `feat/consolidate-deployments`
**Status:** Completed

## Background

Two deployment directories exist with overlapping purpose:
- `deploy/kubernetes/` — StatefulSet-based, multi-pod cluster deployment (minimal config)
- `deployment/` — Deployment-based, single-pod deployment (comprehensive config)

The backend auto-detects cluster mode via `KUBERNETES_SERVICE_HOST`. With `replicas: 1`, the single pod becomes leader immediately with zero cluster overhead. A StatefulSet with default `replicas: 1` is the natural unified approach.

## Consolidation Steps

### 1. Use StatefulSet as the workload type
- Replace `deployment/deployment.yaml` (Deployment) with a StatefulSet
- Default `replicas: 1`, document scaling to N
- Keep `strategy: Recreate` equivalent (StatefulSet default is ordered)
- Use `podManagementPolicy: Parallel` for multi-pod scenarios

### 2. Merge ConfigMaps
- Take the comprehensive 19-var config from `deployment/configmap.yaml` as the base
- Add cluster-specific vars (`CLUSTER_EXPECTED_PODS`) with sensible defaults

### 3. Merge RBAC
- Combine both RBAC sets into one file:
  - Cluster coordination: `pods` get/list/watch, `leases` get/create/update/list/watch
  - OAuth support: `localsubjectaccessreviews` create, marker roles for admin/readonly

### 4. Merge Secrets
- Single Secret resource with all keys:
  - `cluster-secret` (HMAC for inter-pod communication)
  - `jwt-secret`, `admin-password` (auth)
  - `client-id`, `client-secret`, `issuer-url`, `k8s-api-url` (OAuth)
  - `inference-api-key` (inference auth)
  - `hf-token` (HuggingFace)

### 5. Keep unique resources from `deployment/`
- `route.yaml` (OpenShift Route with edge TLS)
- `kustomization.yaml` (updated to reference new files)
- `pvc.yaml` + `pvc-app-data.yaml` (static PVCs)
- `serviceaccount.yaml`
- `README.md` (updated for unified deployment)

### 6. Security & scheduling
- Combine security contexts: `runAsNonRoot: true` + `allowPrivilegeEscalation: false`
- Keep GPU nodeSelector (`nvidia.com/gpu.present: 'true'`) and tolerations
- Keep pod anti-affinity for multi-pod GPU distribution
- Keep resource requests + limits from `deployment/`

### 7. Health probes
- Use `/api/health/live` for startup + liveness (more specific than `/api/health`)
- Use `/api/health/ready` for readiness
- Use the more generous startup probe from StatefulSet (30-min grace for large model loads)

### 8. Storage
- Use `volumeClaimTemplates` for per-pod data (replaces `pvc-app-data.yaml`)
- Keep static PVC for shared model cache (`pvc.yaml`)
- Mount paths: `/opt/app-root/models` (models), `/opt/app-root/src` (app data)

### 9. Cleanup
- Remove `deploy/kubernetes/` directory entirely
- Update `docs/deployment.md` to reference only `deployment/`
- Update `CLAUDE.md` references to `deploy/kubernetes/`
- Update any CI/CD or Makefile references

## Key Decisions
- **Single location:** `deployment/` (already has Route, Kustomize, README)
- **Default replicas:** 1 (single-pod, no cluster overhead)
- **Scaling:** Set `replicas: N` and `CLUSTER_EXPECTED_PODS: N` for multi-pod
- **All ports on 3000:** Container only exposes port 3000 (Fastify serves API + frontend SPA)
