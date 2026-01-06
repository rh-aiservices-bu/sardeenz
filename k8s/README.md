# Kubernetes/OpenShift Deployment Guide

This directory contains Kubernetes manifests for deploying Sardeenz to OpenShift or vanilla Kubernetes with GPU support.

## Prerequisites

- OpenShift 4.12+ or Kubernetes 1.26+ with GPU operator installed
- NVIDIA GPU nodes with proper taints/labels
- `oc` CLI (OpenShift) or `kubectl` (Kubernetes)
- Access to container registry for pushing images
- OAuth 2.0 provider (optional, for authentication)

## Quick Start

### 1. Build and Push Container Image

```bash
# Build the unified container image
docker build -f docker/Dockerfile.unified -t quay.io/your-org/sardeenz:latest .

# Push to your container registry
docker push quay.io/your-org/sardeenz:latest
```

### 2. Create Namespace

```bash
oc new-project sardeenz
# or
kubectl create namespace sardeenz
```

### 3. Configure OAuth Credentials (Optional)

If using authentication, create the OAuth secret:

```bash
oc create secret generic sardeenz-oauth \
  --from-literal=client-id=$OAUTH_CLIENT_ID \
  --from-literal=client-secret=$OAUTH_CLIENT_SECRET \
  --from-literal=issuer-url=$OAUTH_ISSUER_URL \
  -n sardeenz
```

Or edit `secret.yaml` and replace placeholder values before applying.

### 4. Deploy Using Kustomize

```bash
# Edit kustomization.yaml to set your image registry
# Then apply all resources
oc apply -k k8s/
# or
kubectl apply -k k8s/
```

### 5. Deploy Using Individual Manifests

```bash
# Apply in this order
oc apply -f k8s/pvc.yaml
oc apply -f k8s/configmap.yaml
oc apply -f k8s/secret.yaml  # Skip if using `oc create secret`
oc apply -f k8s/deployment.yaml
oc apply -f k8s/service.yaml
oc apply -f k8s/route.yaml
```

### 6. Verify Deployment

```bash
# Check deployment status
oc get deployment sardeenz -n sardeenz

# Check pod status (should show GPU assigned)
oc get pods -n sardeenz -o wide

# Check logs
oc logs -f deployment/sardeenz -n sardeenz

# Get external URL (OpenShift only)
oc get route sardeenz -n sardeenz -o jsonpath='{.spec.host}'
```

## Manifest Files

### Core Resources

- **`deployment.yaml`** - Main application deployment with GPU resource requests
  - Configured for single replica (GPU constraint)
  - GPU node selector and tolerations
  - Liveness, readiness, and startup probes
  - Environment variables from ConfigMap and Secret

- **`service.yaml`** - ClusterIP service exposing backend (3000) and frontend (80)

- **`route.yaml`** - OpenShift Route for external HTTPS access
  - Edge TLS termination
  - 5-minute timeout for long-running inference

- **`pvc.yaml`** - PersistentVolumeClaim for Hugging Face model cache (100Gi)

- **`configmap.yaml`** - Application configuration (non-sensitive)

- **`secret.yaml`** - OAuth credentials template (sensitive)

- **`kustomization.yaml`** - Kustomize configuration for environment overlays

## Configuration

### Environment Variables

Configured via `configmap.yaml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `3000` | Backend API port |
| `HOST` | `0.0.0.0` | Backend bind address |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `ENABLE_KVCACHED` | `true` | Enable KVCached GPU memory sharing |
| `KVCACHED_AUTOPATCH` | `1` | Auto-patch vLLM for KVCached |
| `VLLM_BASE_PORT` | `12346` | Starting port for vLLM instances |
| `VLLM_MAX_INSTANCES` | `10` | Maximum concurrent model instances |

### Resource Limits

Configured in `deployment.yaml`:

```yaml
resources:
  requests:
    cpu: "2"
    memory: "8Gi"
    nvidia.com/gpu: 1
  limits:
    cpu: "8"
    memory: "32Gi"
    nvidia.com/gpu: 1
```

**Adjust based on your workload:**
- Small models (7B): 2 CPU, 8Gi RAM
- Medium models (13B): 4 CPU, 16Gi RAM
- Large models (70B): 8 CPU, 32Gi RAM

### GPU Node Selection

The deployment uses node selectors to target GPU nodes:

```yaml
nodeSelector:
  nvidia.com/gpu.present: "true"

tolerations:
  - key: nvidia.com/gpu
    operator: Exists
    effect: NoSchedule
```

**Verify your GPU nodes have the correct labels:**

```bash
oc get nodes -l nvidia.com/gpu.present=true
```

**If using different labels** (e.g., from Node Feature Discovery), update the node selector:

```yaml
nodeSelector:
  feature.node.kubernetes.io/pci-10de.present: "true"  # NVIDIA vendor ID
```

## Health Checks

The deployment includes three probe types:

1. **Startup Probe** - `/api/health` endpoint, 2-minute startup grace period
2. **Liveness Probe** - `/api/health/live` endpoint, kills unhealthy containers
3. **Readiness Probe** - `/api/health/ready` endpoint, removes from service when not ready

> **Note:** Health check endpoints have quiet logging enabled. Successful requests (2xx) are logged at debug level only to reduce log noise from frequent polling. Errors (4xx/5xx) are always logged at warn/error levels.

**Probe configuration:**

```yaml
startupProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 12  # 2 minutes to start

livenessProbe:
  httpGet:
    path: /api/health/live
    port: 3000
  initialDelaySeconds: 90
  periodSeconds: 30
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/health/ready
    port: 3000
  initialDelaySeconds: 60
  periodSeconds: 10
  failureThreshold: 3
```

## Storage

### Persistent Volume Claim

The deployment requires a PVC for caching Hugging Face models:

- **Name:** `sardeenz-model-cache`
- **Size:** 100Gi (adjust based on model sizes)
- **Access Mode:** ReadWriteOnce
- **Mount Path:** `/root/.cache/huggingface`

**Model size reference:**
- 7B models: ~14GB
- 13B models: ~26GB
- 70B models: ~140GB

**To use a specific storage class:**

```yaml
spec:
  storageClassName: fast-ssd  # or 'gp3', 'ocs-storagecluster-ceph-rbd', etc.
```

## Networking

### Service Ports

- **Backend API:** Port 3000 (Controller API + Proxy)
- **Frontend UI:** Port 80 (nginx serving React app)

### OpenShift Route

The route exposes the frontend (port 80) with:
- Edge TLS termination (automatic certificate)
- HTTP to HTTPS redirect
- 5-minute timeout for long inference requests

**Get external URL:**

```bash
oc get route sardeenz -o jsonpath='{.spec.host}'
```

**Access endpoints:**
- Frontend: `https://<route-host>/`
- Controller API: `https://<route-host>/api/models`
- Inference API: `https://<route-host>/v1/chat/completions`
- Metrics: `https://<route-host>/metrics`

### For Vanilla Kubernetes

Replace `route.yaml` with an Ingress resource:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sardeenz
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - vllm.example.com
      secretName: vllm-tls
  rules:
    - host: vllm.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: sardeenz
                port:
                  number: 80
```

## Security

### OAuth 2.0 Authentication

To enable authentication, configure the OAuth secret and set environment variables:

1. **Create OAuth application** in your identity provider (OpenShift OAuth, Keycloak, etc.)
2. **Set redirect URI** to `https://<route-host>/api/auth/callback`
3. **Create secret** with credentials
4. **Restart deployment** to pick up changes

**The application supports:**
- OAuth 2.0 Authorization Code flow
- Manual OAuth configuration (for OpenShift OAuth and other non-OIDC providers)
- JWT token validation
- Role-based access control (admin, admin-readonly)

### RBAC Roles

- **admin** - Can load/unload models, modify configurations
- **admin-readonly** - Can view models and metrics only

**Configure roles** in your OAuth provider's user claims.

### Pod Security

The deployment runs as root (required for GPU access in some environments). For enhanced security:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
  capabilities:
    drop:
      - ALL
```

**Note:** This may require additional GPU driver configuration.

## Monitoring

### Prometheus Metrics

The application exposes Prometheus metrics at `/metrics`:

```bash
curl https://<route-host>/metrics
```

**Key metrics:**
- `vllm_model_load_duration_seconds` - Model loading time
- `vllm_routing_latency_seconds` - Proxy routing overhead
- `vllm_active_models` - Currently loaded models
- `vllm_inference_requests_total` - Request counter by model and status

### ServiceMonitor (Prometheus Operator)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: sardeenz
spec:
  selector:
    matchLabels:
      app: sardeenz
  endpoints:
    - port: backend
      path: /metrics
      interval: 30s
```

## Troubleshooting

### Pod Not Starting

**Check GPU availability:**

```bash
oc describe node <node-name> | grep nvidia.com/gpu
```

**Check pod events:**

```bash
oc describe pod -l app=sardeenz
```

**Common issues:**
- No GPU nodes available → Scale GPU nodes or adjust node selector
- GPU already allocated → Check for other GPU workloads
- Image pull errors → Verify image name and registry credentials

### Health Check Failures

**Check pod logs:**

```bash
oc logs -f deployment/sardeenz
```

**Common causes:**
- vLLM taking too long to start → Increase `startupProbe.failureThreshold`
- Out of GPU memory → Reduce model size or adjust `VLLM_MAX_INSTANCES`
- Port conflicts → Check `VLLM_BASE_PORT` configuration

### Model Loading Failures

**Check application logs:**

```bash
oc logs deployment/sardeenz | grep -i error
```

**Common causes:**
- Insufficient GPU memory → Unload other models or use smaller models
- Model not cached → First load takes longer, check PVC storage
- KVCached not enabled → Verify `ENABLE_KVCACHED=true` in ConfigMap

### Performance Issues

**Check resource usage:**

```bash
oc adm top pod -l app=sardeenz
```

**Optimize:**
- Increase CPU/memory limits in `deployment.yaml`
- Enable KVCached for better GPU memory sharing
- Use faster storage class for PVC
- Adjust `VLLM_MAX_INSTANCES` based on available GPU memory

## Upgrading

### Rolling Update

```bash
# Update image tag in deployment
oc set image deployment/sardeenz \
  sardeenz=quay.io/your-org/sardeenz:v1.1.0

# Watch rollout
oc rollout status deployment/sardeenz
```

### Recreate Strategy

The deployment uses `Recreate` strategy (not `RollingUpdate`) because:
- GPU resources cannot be shared between old and new pods
- Ensures clean shutdown of vLLM processes
- Prevents port conflicts on GPU device

**Downtime:** ~2-3 minutes during updates

## Cleanup

### Delete All Resources

```bash
oc delete -k k8s/
# or
kubectl delete -k k8s/
```

### Delete Namespace

```bash
oc delete project sardeenz
# or
kubectl delete namespace sardeenz
```

**Note:** This deletes the PVC and model cache. Back up models first if needed.

## Multi-Environment Setup

Use Kustomize overlays for dev/staging/prod:

```
k8s/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml
    │   └── patches/
    ├── staging/
    │   └── kustomization.yaml
    └── prod/
        └── kustomization.yaml
```

**Deploy to production:**

```bash
oc apply -k k8s/overlays/prod/
```

## Additional Resources

- [vLLM Documentation](https://docs.vllm.ai/)
- [KVCached Guide](../docs/kvcached/README.md)
- [API Documentation](../docs/api-guide.md)
- [Architecture Overview](../docs/architecture.md)
- [OpenShift GPU Operator](https://docs.openshift.com/container-platform/latest/architecture/nvidia-gpu-architecture-overview.html)
