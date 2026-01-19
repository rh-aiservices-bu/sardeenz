# Kubernetes/OpenShift Deployment Guide

This directory contains Kubernetes manifests for deploying Sardeenz to OpenShift or vanilla Kubernetes with GPU support.

## Prerequisites

- OpenShift 4.12+ or Kubernetes 1.26+ with GPU operator installed
- NVIDIA GPU nodes with proper taints/labels if needed
- `oc` CLI (OpenShift) or `kubectl` (Kubernetes)
- Access to container registry for pushing images (optional, if you want to use your own build)
- OAuth 2.0 provider (optional, for authentication)

## Quick Start

### 1. Build and Push Container Image (Optional)

This step is only required if you want to use your own image instead of the one provided at quay.io/rh-aiservices-bu/sardeenz.

```bash
# Build the unified container image
make build VERSION=x.y.z

# Push to your container registry
make push VERSION=x.y.z

# Or manually with podman:
podman build -f docker/Containerfile -t quay.io/rh-aiservices-bu/sardeenz:x.y.z .
podman push quay.io/rh-aiservices-bu/sardeenz:x.y.z
```

### 2. Create Namespace

```bash
oc new-project sardeenz
# or
kubectl create namespace sardeenz
```

### 3. Configure Deployment, ConfigMap and Secrets

Edit the file `deployment.yaml` and adjust the values as you need, like the number of GPUs you want to allocate to Sardeenz.

Edit the file `configmap.yaml` and adjust the values as you need.

Edit the file `secret.yaml` and adjust the values as you need. They will be applied at step 4.

As an example, the following commands show how to manually create different secrets for different configurations. The created Secrets can help you configure properly `secrets.yaml`.

Create the application secret based on your authentication mode. See [Authentication Modes](#authentication-modes) for details.

**For no authentication (AUTH_MODE=none, default):**

```bash
# HuggingFace token (optional, only needed for gated models when downloading from HuggingFace)
oc create secret generic sardeenz-secrets-sample \
  --from-literal=hf-token=$HF_TOKEN \
  -n sardeenz
```

**For simple authentication (AUTH_MODE=simple):**

```bash
oc create secret generic sardeenz-secrets-sample \
  --from-literal=jwt-secret=$(openssl rand -base64 32) \
  --from-literal=admin-password=YOUR_SECURE_PASSWORD \
  --from-literal=hf-token=$HF_TOKEN \
  -n sardeenz
```

**For OAuth 2.0 (AUTH_MODE=oauth):**

```bash
oc create secret generic sardeenz-secrets-sample \
  --from-literal=client-id=$OAUTH_CLIENT_ID \
  --from-literal=client-secret=$OAUTH_CLIENT_SECRET \
  --from-literal=issuer-url=$OAUTH_ISSUER_URL \
  --from-literal=jwt-secret=$(openssl rand -base64 32) \
  --from-literal=k8s-api-url=https://api.cluster.example.com:6443 \
  --from-literal=hf-token=$HF_TOKEN \
  -n sardeenz
```

**Optional: Add inference API key (works with any auth mode):**

```bash
# Add to any of the above commands:
# --from-literal=inference-api-key=YOUR_API_KEY
```

Or edit `secret.yaml` and replace placeholder values before applying.

### 4. Deploy Using Kustomize

```bash
# Edit kustomization.yaml to set your image registry
# Then apply all resources
oc apply -k deployment/
# or
kubectl apply -k deployment/
```

### 5. Deploy Using Individual Manifests

```bash
# Apply in this order
oc apply -f deployment/serviceaccount.yaml  # Required: ServiceAccount for RBAC
oc apply -f deployment/rbac.yaml            # Required: RBAC roles and permissions
oc apply -f deployment/pvc.yaml             # Optional: Only if downloading models from HuggingFace
oc apply -f deployment/pvc-app-data.yaml    # Required: Application data (SQLite, cache)
oc apply -f deployment/configmap.yaml
oc apply -f deployment/secret.yaml          # Skip if using `oc create secret`
oc apply -f deployment/deployment.yaml      # Must be adapted based on storage choices (see Storage section)
oc apply -f deployment/service.yaml
oc apply -f deployment/route.yaml
```

### 6. Configure RBAC (OAuth Mode Only)

If using OAuth authentication (`AUTH_MODE=oauth`), you need to create RoleBindings to grant users access to sardeenz. The deployment manifests create the necessary Roles but not the user/group bindings.

```bash
# Give admin access to specific users
oc adm policy add-role-to-user sardeenz-admin alice@company.com -n sardeenz

# Give read-only access to all authenticated users
oc adm policy add-role-to-group sardeenz-admin-readonly system:authenticated -n sardeenz

# Give admin access to a group
oc adm policy add-role-to-group sardeenz-admin platform-admins -n sardeenz
```

See [RBAC Setup Guide](../docs/rbac-setup.md) for complete configuration options.

### 7. Verify Deployment

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

- **`serviceaccount.yaml`** - ServiceAccount for the sardeenz pod
  - Used for RBAC authorization checks via LocalSubjectAccessReview
  - Required for OAuth authentication mode

- **`rbac.yaml`** - RBAC roles and permissions
  - `sardeenz-admin` Role: Marker for full admin access
  - `sardeenz-admin-readonly` Role: Marker for read-only access
  - `sardeenz-auth-reviewer` Role: Allows ServiceAccount to check user permissions
  - `sardeenz-auth-reviewer` RoleBinding: Binds ServiceAccount to auth-reviewer role
  - See [RBAC Setup Guide](../docs/rbac-setup.md) for creating user/group bindings

- **`deployment.yaml`** - Main application deployment with GPU resource requests
  - Configured for single replica (GPU constraint)
  - GPU node selector and tolerations
  - Liveness, readiness, and startup probes
  - Environment variables from ConfigMap and Secret
  - Uses `sardeenz` ServiceAccount for RBAC

- **`service.yaml`** - ClusterIP service exposing backend (3000) and frontend (80)

- **`route.yaml`** - OpenShift Route for external HTTPS access
  - Edge TLS termination
  - 5-minute timeout for long-running inference

- **`pvc.yaml`** - PersistentVolumeClaim for HuggingFace model cache (100Gi). Optional: only needed if downloading models from HuggingFace. See [Storage Configuration](#storage-configuration).

- **`pvc-app-data.yaml`** - PersistentVolumeClaim for application data (SQLite database, cache)

- **`configmap.yaml`** - Application configuration (non-sensitive)

- **`secret.yaml`** - Secrets template (JWT, OAuth, API keys, HF token)

- **`kustomization.yaml`** - Kustomize configuration for environment overlays

## Configuration

### Environment Variables

#### ConfigMap Variables (configmap.yaml)

| Variable               | Default      | Description                                                                                                                                                    |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `production` | Node.js environment                                                                                                                                            |
| `PORT`                 | `3000`       | Backend API port                                                                                                                                               |
| `HOST`                 | `0.0.0.0`    | Backend bind address                                                                                                                                           |
| `LOG_LEVEL`            | `info`       | Logging level (debug, info, warn, error)                                                                                                                       |
| `AUTH_MODE`            | `none`       | Authentication mode: `none`, `simple`, `oauth`                                                                                                                 |
| `ADMIN_USERNAME`       | `admin`      | Username for simple auth mode                                                                                                                                  |
| `JWT_EXPIRATION_HOURS` | `8`          | JWT token lifetime in hours                                                                                                                                    |
| `API_BASE_URL`         | -            | Base URL for OAuth callbacks (your route URL)                                                                                                                  |
| `ENABLE_KVCACHED`      | `true`       | Enable kvcached GPU memory sharing                                                                                                                             |
| `KVCACHED_AUTOPATCH`   | `1`          | Auto-patch vLLM for kvcached                                                                                                                                   |
| `VLLM_BASE_PORT`       | `12346`      | Starting port for vLLM instances                                                                                                                               |
| `VLLM_MAX_INSTANCES`   | `10`         | Maximum concurrent model instances                                                                                                                             |
| `VLLM_STARTUP_TIMEOUT` | `1800000`    | Model startup timeout in ms (30 min default)                                                                                                                   |
| `LOCAL_MODELS_PATH`    | -            | Path to pre-downloaded models. Set this when using local/mounted models instead of HuggingFace downloads. See [Storage Configuration](#storage-configuration). |
| `DEBUG_STREAMING`      | `false`      | Enable SSE streaming debug logs                                                                                                                                |

#### Secret Variables (secret.yaml)

| Variable            | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `jwt-secret`        | Secret for JWT token signing (required if AUTH_MODE ≠ none)        |
| `admin-password`    | Password for simple auth mode                                      |
| `client-id`         | OAuth client ID                                                    |
| `client-secret`     | OAuth client secret                                                |
| `issuer-url`        | OAuth provider URL                                                 |
| `k8s-api-url`       | Kubernetes API URL for OAuth user info                             |
| `inference-api-key` | API key for `/v1/*` endpoints (optional, separate from admin auth) |
| `hf-token`          | HuggingFace token for gated models                                 |

### Resource Limits

Configured in `deployment.yaml`:

```yaml
resources:
  requests:
    cpu: '2'
    memory: '8Gi'
    nvidia.com/gpu: 1
  limits:
    cpu: '8'
    memory: '32Gi'
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
  nvidia.com/gpu.present: 'true'

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
  feature.node.kubernetes.io/pci-10de.present: 'true' # NVIDIA vendor ID
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
  failureThreshold: 12 # 2 minutes to start

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

Storage requirements depend on how you source your models. Only the Application Data PVC is always required.

### Required Storage

#### Application Data (pvc-app-data.yaml)

- **Name:** `sardeenz-app-data`
- **Size:** 10Gi
- **Access Mode:** ReadWriteOnce
- **Mount Path:** `/opt/app-root/src`
- **Contents:** SQLite database, cache directories, Python venv

**This PVC is always required** for application state persistence.

### Optional Storage

Choose based on your model source strategy:

#### Option A: HuggingFace Model Cache (pvc.yaml)

Use this if you download models from HuggingFace at runtime.

- **Name:** `sardeenz-model-cache`
- **Size:** 100Gi (adjust based on model sizes)
- **Access Mode:** ReadWriteOnce
- **Mount Path:** `/opt/app-root/models` (sets `HF_HOME`)

**Model size reference:**

- 7B models: ~14GB
- 13B models: ~26GB
- 70B models: ~140GB

#### Option B: Local/Pre-downloaded Models

Use this for air-gapped environments or when models are pre-downloaded to shared storage.

- Mount your models directory (hostPath, NFS, or external PVC)
- Set `LOCAL_MODELS_PATH` in ConfigMap to point to the mount path
- No need for `pvc.yaml` if not downloading from HuggingFace

#### Option C: Both Sources

You can use both HuggingFace downloads and local models simultaneously by configuring both storage options.

### Storage Configuration

The `deployment.yaml` must be adapted based on your storage choices. Below are the volume configurations for each scenario.

#### Scenario A: HuggingFace Downloads Only (Default)

This is the default configuration in `deployment.yaml`:

```yaml
volumes:
  - name: huggingface-cache
    persistentVolumeClaim:
      claimName: sardeenz-model-cache
  - name: app-data
    persistentVolumeClaim:
      claimName: sardeenz-app-data

volumeMounts:
  - name: huggingface-cache
    mountPath: /opt/app-root/models
  - name: app-data
    mountPath: /opt/app-root/src
```

**ConfigMap:** Leave `LOCAL_MODELS_PATH` empty.

#### Scenario B: Local Models Only

Remove the HuggingFace cache volume and add your local models mount:

```yaml
volumes:
  - name: local-models
    persistentVolumeClaim:
      claimName: your-models-pvc # Or use hostPath, NFS, etc.
  - name: app-data
    persistentVolumeClaim:
      claimName: sardeenz-app-data

volumeMounts:
  - name: local-models
    mountPath: /mnt/models
    readOnly: true
  - name: app-data
    mountPath: /opt/app-root/src
```

**ConfigMap:** Set `LOCAL_MODELS_PATH: "/mnt/models"`.

**Skip applying `pvc.yaml`** since you're not using HuggingFace downloads.

#### Scenario C: Both Sources

Mount both volumes:

```yaml
volumes:
  - name: huggingface-cache
    persistentVolumeClaim:
      claimName: sardeenz-model-cache
  - name: local-models
    persistentVolumeClaim:
      claimName: your-models-pvc
  - name: app-data
    persistentVolumeClaim:
      claimName: sardeenz-app-data

volumeMounts:
  - name: huggingface-cache
    mountPath: /opt/app-root/models
  - name: local-models
    mountPath: /mnt/models
    readOnly: true
  - name: app-data
    mountPath: /opt/app-root/src
```

**ConfigMap:** Set `LOCAL_MODELS_PATH: "/mnt/models"`.

### Storage Class

To use a specific storage class for any PVC:

```yaml
spec:
  storageClassName: fast-ssd # or 'gp3', 'ocs-storagecluster-ceph-rbd', etc.
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

### Authentication Modes

Sardeenz supports three authentication modes for the admin dashboard, configured via `AUTH_MODE` in the ConfigMap.

#### No Authentication (AUTH_MODE=none)

Default mode. No authentication required for admin dashboard.

- Suitable for development or trusted environments
- Inference endpoints are always accessible
- No secrets required (except optional `hf-token` for gated models)

#### Simple Authentication (AUTH_MODE=simple)

Username/password authentication for admin dashboard.

**Required configuration:**

1. Set `AUTH_MODE: "simple"` in ConfigMap
2. Set `ADMIN_USERNAME` in ConfigMap (default: `admin`)
3. Create secret with `admin-password` and `jwt-secret`

```bash
oc create secret generic sardeenz-secrets \
  --from-literal=jwt-secret=$(openssl rand -base64 32) \
  --from-literal=admin-password=YOUR_SECURE_PASSWORD \
  -n sardeenz
```

#### OAuth 2.0 Authentication (AUTH_MODE=oauth)

Full OAuth 2.0 integration with OpenShift or external providers.

**Required configuration:**

1. Set `AUTH_MODE: "oauth"` in ConfigMap
2. Set `API_BASE_URL` in ConfigMap to your route URL
3. Create OAuth application in your identity provider
4. Set redirect URI to `https://<route-host>/api/auth/callback`
5. Create secret with OAuth credentials

```bash
oc create secret generic sardeenz-secrets \
  --from-literal=client-id=$OAUTH_CLIENT_ID \
  --from-literal=client-secret=$OAUTH_CLIENT_SECRET \
  --from-literal=issuer-url=$OAUTH_ISSUER_URL \
  --from-literal=jwt-secret=$(openssl rand -base64 32) \
  --from-literal=k8s-api-url=https://api.cluster.example.com:6443 \
  -n sardeenz
```

**The application supports:**

- OAuth 2.0 Authorization Code flow
- Manual OAuth configuration (for OpenShift OAuth and other non-OIDC providers)
- JWT token validation
- Role-based access control (admin, admin-readonly)

### Inference API Key (Optional)

Separate from admin authentication. Protects `/v1/*` and `/api/direct/*` endpoints.

- Set `inference-api-key` in the secret
- Clients use `Authorization: Bearer <key>` header (OpenAI API compatible)
- Works with any auth mode (none, simple, oauth)

```bash
# Add to your secret creation command:
--from-literal=inference-api-key=YOUR_API_KEY
```

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
- Model not cached → First download takes longer; ensure HuggingFace cache PVC is configured if downloading models
- kvcached not enabled → Verify `ENABLE_KVCACHED=true` in ConfigMap

### Performance Issues

**Check resource usage:**

```bash
oc adm top pod -l app=sardeenz
```

**Optimize:**

- Increase CPU/memory limits in `deployment.yaml`
- Enable kvcached for better GPU memory sharing
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
oc delete -k deployment/
# or
kubectl delete -k deployment/
```

### Delete Namespace

```bash
oc delete project sardeenz
# or
kubectl delete namespace sardeenz
```

**Note:** This deletes all PVCs including model cache (if configured). Back up data first if needed.

## Multi-Environment Setup

Use Kustomize overlays for dev/staging/prod:

```
deployment/
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
oc apply -k deployment/overlays/prod/
```

## Additional Resources

- [vLLM Documentation](https://docs.vllm.ai/)
- [kvcached Guide](../docs/kvcached/README.md)
- [API Documentation](../docs/api-guide.md)
- [Architecture Overview](../docs/architecture.md)
- [OpenShift GPU Operator](https://docs.openshift.com/container-platform/latest/architecture/nvidia-gpu-architecture-overview.html)
