# Deployment Guide

This guide covers container building and deployment to OpenShift/Kubernetes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Container Build](#container-build)
- [Local Development](#local-development)
- [OpenShift Deployment](#openshift-deployment)
- [Authentication and RBAC](#authentication-and-rbac)
- [Configuration](#configuration)
- [Health Checks](#health-checks)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Hardware Requirements

| Component   | Minimum              | Recommended                  |
| ----------- | -------------------- | ---------------------------- |
| **CPU**     | 8 cores              | 16+ cores                    |
| **RAM**     | 16 GB                | 32+ GB                       |
| **GPU**     | NVIDIA with 8GB VRAM | 24GB+ VRAM (A10, A100, H100) |
| **Storage** | 50 GB                | 100+ GB SSD                  |

### Software Requirements

| Software                     | Version | Purpose                  |
| ---------------------------- | ------- | ------------------------ |
| **Podman**                   | 4.x+    | Container runtime        |
| **NVIDIA Container Toolkit** | 1.14.x+ | GPU access in containers |
| **CUDA**                     | 12.x    | GPU compute              |
| **OpenShift** (optional)     | 4.12+   | Production orchestration |
| **kubectl** (optional)       | 1.28+   | Kubernetes CLI           |

### GPU Node Setup

**Install NVIDIA Container Toolkit:**

```bash
# Ubuntu/Debian
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Configure Podman to use NVIDIA runtime (via CDI)
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
```

**Verify GPU Access:**

```bash
podman run --rm --device nvidia.com/gpu=all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

## Container Build

### Dockerfile Structure

The unified container image includes:

- **Base:** `quay.io/vllm/vllm-cuda:0.14.1_rhai0` (CUDA 12.x + Python 3.12 + vLLM)
- **Node.js 22.x** (added layer)
- **Backend** (Fastify TypeScript app)
- **Frontend** (React + PatternFly built static assets)

### Build the Container

**From project root:**

```bash
# Build and tag using Makefile (recommended)
make build VERSION=x.y.z
make push VERSION=x.y.z

# Or manually with podman:
podman build -f docker/Containerfile -t quay.io/rh-aiservices-bu/sardeenz:x.y.z .
podman push quay.io/rh-aiservices-bu/sardeenz:x.y.z
```

**Build with custom vLLM version:**

```bash
podman build \
  --build-arg VLLM_BASE_IMAGE=quay.io/vllm/vllm-cuda:0.14.1_rhai0 \
  -f docker/Containerfile \
  -t sardeenz:custom .
```

### Multi-Stage Build Example

_Note: This is a conceptual Dockerfile structure. Actual implementation may vary._

```dockerfile
# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
COPY apps/frontend/package*.json apps/frontend/
RUN npm ci
COPY apps/frontend apps/frontend
COPY packages packages
RUN npm run build -w apps/frontend

# Stage 2: Build backend
FROM node:22-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
COPY apps/backend/package*.json apps/backend/
RUN npm ci --production
COPY apps/backend apps/backend
COPY packages packages
RUN npm run build -w apps/backend

# Stage 3: Final image
FROM quay.io/vllm/vllm-cuda:0.14.1_rhai0

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest

# Install kvcached
RUN pip install kvcached

# Copy built artifacts
WORKDIR /app
COPY --from=backend-builder /app/apps/backend/dist ./backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=frontend-builder /app/apps/frontend/dist ./frontend

# Expose port (unified API - Controller + Proxy + Frontend)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV ENABLE_KVCACHED=true
ENV KVCACHED_AUTOPATCH=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start command
CMD ["node", "backend/index.js"]
```

## Local Development

### Run with Podman Compose

**`podman-compose.yml`:**

```yaml
version: '3.8'

services:
  sardeenz:
    image: sardeenz:latest
    ports:
      - '3000:3000' # Unified API (Controller + Proxy + Frontend)
    environment:
      - NODE_ENV=development
      - ENABLE_KVCACHED=true
      - KVCACHED_AUTOPATCH=1
      - LOG_LEVEL=debug
      - HF_HOME=/opt/app-root/models
      - AUTH_MODE=none # Disable auth for local dev
    volumes:
      - ./models:/opt/app-root/models # Mount local models directory for HF cache
      - /tmp/kvcached:/tmp/kvcached # kvcached IPC directory
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 10s
      retries: 3
```

**Start the stack:**

```bash
podman-compose up -d

# View logs
podman-compose logs -f

# Stop the stack
podman-compose down
```

### Run Standalone Container

```bash
podman run -d \
  --name sardeenz \
  --device nvidia.com/gpu=all \
  -p 3000:3000 \
  -e ENABLE_KVCACHED=true \
  -e KVCACHED_AUTOPATCH=1 \
  -e HF_HOME=/opt/app-root/models \
  -v /path/to/models:/opt/app-root/models \
  -v /tmp/kvcached:/tmp/kvcached \
  quay.io/rh-aiservices-bu/sardeenz:latest
```

## OpenShift Deployment

### Prerequisites

1. **GPU-enabled OpenShift cluster** with NVIDIA GPU Operator installed
2. **Namespace** with GPU quota allocated
3. **Image registry access** (e.g., Quay.io)
4. **Persistent storage** - App Data PVC required for SQLite database; Model Cache PVC optional (only if downloading from HuggingFace)

### Deploy with GPU

**1. Create Namespace:**

```bash
oc new-project sardeenz
```

**2. Create Deployment:**

**`deployment.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sardeenz
  namespace: sardeenz
  labels:
    app: sardeenz
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sardeenz
  template:
    metadata:
      labels:
        app: sardeenz
    spec:
      containers:
        - name: sardeenz
          image: quay.io/your-org/sardeenz:latest
          ports:
            - containerPort: 3000
              name: http
              protocol: TCP
          env:
            - name: NODE_ENV
              value: 'production'
            - name: ENABLE_KVCACHED
              value: 'true'
            - name: KVCACHED_AUTOPATCH
              value: '1'
            - name: HF_HOME
              value: '/opt/app-root/models'
            - name: SARDEENZ_DB_PATH
              value: '/opt/app-root/src/data/sardeenz.db'
            - name: HF_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hf-token
                  key: token
                  optional: true
            - name: LOG_LEVEL
              value: 'info'
            - name: OAUTH_ISSUER_URL
              valueFrom:
                secretKeyRef:
                  name: oauth-config
                  key: issuer-url
            - name: OAUTH_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: oauth-config
                  key: client-id
            - name: OAUTH_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: oauth-config
                  key: client-secret
          resources:
            requests:
              memory: '16Gi'
              cpu: '4'
              nvidia.com/gpu: '1'
            limits:
              memory: '32Gi'
              cpu: '8'
              nvidia.com/gpu: '1'
          volumeMounts:
            - name: model-cache
              mountPath: /opt/app-root/models
            - name: app-data
              mountPath: /opt/app-root/src
            - name: kvcached-ipc
              mountPath: /tmp/kvcached
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
            timeoutSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: model-cache-pvc
        - name: app-data
          persistentVolumeClaim:
            claimName: sardeenz-app-data
        - name: kvcached-ipc
          emptyDir:
            medium: Memory
      securityContext:
        fsGroup: 0
        runAsNonRoot: true
      nodeSelector:
        nvidia.com/gpu.present: 'true'
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
```

**3. Create Service:**

**`service.yaml`:**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: sardeenz
  namespace: sardeenz
spec:
  selector:
    app: sardeenz
  ports:
    - name: http
      port: 3000
      targetPort: 3000
      protocol: TCP
  type: ClusterIP
```

**4. Create Route:**

**`route.yaml`:**

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: sardeenz
  namespace: sardeenz
spec:
  host: sardeenz.apps.your-cluster.com
  to:
    kind: Service
    name: sardeenz
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

**5. Create PersistentVolumeClaims:**

The deployment uses two PVCs. Only the App Data PVC is required:

- **App Data PVC** (`sardeenz-app-data`): **Required.** Stores SQLite database and other persistent app data
- **Model Cache PVC** (`model-cache-pvc`): **Optional.** Stores downloaded HuggingFace models. Only needed if downloading models from HuggingFace at runtime. See [deployment/README.md Storage Configuration](../deployment/README.md#storage-configuration) for alternatives.

**Model Cache PVC (`pvc-model-cache.yaml`):**

Models are downloaded from HuggingFace Hub on first load and cached to the PVC. The `HF_HOME` environment variable controls where models are stored.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: model-cache-pvc
  namespace: sardeenz
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  # storageClassName: ocs-storagecluster-cephfs
```

> **Note:** Use `ReadWriteOnce` for model caching (models are downloaded on demand). Typical model sizes: 7B params ≈ 14GB, 13B ≈ 26GB, 70B ≈ 140GB.

**App Data PVC (`pvc-app-data.yaml`):**

Stores SQLite database (benchmarks, memory profiles) and other persistent application data. The `SARDEENZ_DB_PATH` environment variable controls where the database is stored.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: sardeenz-app-data
  namespace: sardeenz
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi # Small - just for SQLite database
```

> **Note:** 1Gi is sufficient for the SQLite database which stores benchmark results and memory profiles.

**6. Create Secrets:**

```bash
# HuggingFace token (optional, for gated models like Llama, Mistral)
oc create secret generic hf-token \
  --from-literal=token=hf_your_token_here \
  -n sardeenz

# OAuth configuration (optional)
oc create secret generic oauth-config \
  --from-literal=issuer-url=https://your-keycloak.com/auth/realms/vllm \
  --from-literal=client-id=sardeenz \
  --from-literal=client-secret=your-secret-here \
  -n sardeenz
```

**7. Deploy:**

```bash
oc apply -f pvc-app-data.yaml              # Required: application data
oc apply -f pvc-model-cache.yaml           # Optional: only if downloading from HuggingFace
oc apply -f deployment.yaml
oc apply -f service.yaml
oc apply -f route.yaml

# Check deployment status
oc get pods -n sardeenz -w

# View logs
oc logs -f deployment/sardeenz -n sardeenz
```

### Scaling Considerations

**Single Pod Deployment (Current Design):**

- One pod manages all model instances
- Stateless design (no shared state between pods)
- Scale by deploying multiple independent instances

**Future: Multi-Pod Deployment:**

- Shared model registry (e.g., Redis, PostgreSQL)
- Sticky sessions for proxy routing
- Distributed model scheduling

## Authentication and RBAC

Sardeenz supports three authentication modes for the admin dashboard:

| Mode     | Use Case                      | Configuration                                   |
| -------- | ----------------------------- | ----------------------------------------------- |
| `none`   | Development, testing          | No auth required                                |
| `simple` | Single-admin deployments      | Username/password with JWT                      |
| `oauth`  | Enterprise with OpenShift SSO | OpenShift OAuth 2.0 with Kubernetes-native RBAC |

### OpenShift OAuth Setup

For production deployments, OAuth mode integrates with OpenShift's authentication system and uses Kubernetes-native RBAC for role-based access control.

**Key Benefits:**

- **No cluster-admin required** - Deployment only needs namespace-level permissions
- **Dynamic access management** - Add/remove users via RoleBindings without restarting sardeenz
- **Flexible binding** - Assign roles to users, groups, or all authenticated users

#### 1. Create OAuth Client

Register Sardeenz as an OAuth client with OpenShift:

**`oauth-client.yaml`:**

```yaml
apiVersion: oauth.openshift.io/v1
kind: OAuthClient
metadata:
  name: sardeenz
grantMethod: auto
redirectURIs:
  - https://sardeenz.apps.your-cluster.com/api/auth/callback
secret: your-oauth-client-secret
```

```bash
oc apply -f oauth-client.yaml
```

#### 2. Configure Environment Variables

```bash
# Create OAuth secret
oc create secret generic oauth-config \
  --from-literal=issuer-url=https://oauth-openshift.apps.your-cluster.com \
  --from-literal=client-id=sardeenz \
  --from-literal=client-secret=your-oauth-client-secret \
  -n sardeenz

# Create JWT secret
oc create secret generic jwt-config \
  --from-literal=secret=$(openssl rand -base64 32) \
  -n sardeenz
```

Add to deployment (see example in OpenShift Deployment section above).

#### 3. Configure RBAC

Sardeenz uses Kubernetes-native RBAC to control access. Create Roles and RoleBindings to grant users access to the dashboard.

**For complete RBAC configuration instructions, see [RBAC Setup Guide](./rbac-setup.md).**

Quick example - give read-only access to all authenticated users:

```bash
# Apply the sardeenz Roles
oc apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sardeenz-admin-readonly
  namespace: sardeenz
rules:
  - apiGroups: ["sardeenz.rh-aiservices-bu.io"]
    resources: ["admin-readonly"]
    verbs: ["get"]
EOF

# Bind to all authenticated users
oc adm policy add-role-to-group sardeenz-admin-readonly system:authenticated -n sardeenz
```

### Access Denied Handling

When a user authenticates via OAuth but is not bound to either `sardeenz-admin` or `sardeenz-admin-readonly` roles:

1. **Authentication succeeds** - User is verified by OpenShift
2. **Authorization fails** - User lacks required RoleBinding
3. **Access Denied page** - User is redirected to an informative error page

**To grant access:** Create a RoleBinding for the user or their group:

```bash
# Grant full admin access to a user
oc adm policy add-role-to-user sardeenz-admin user@example.com -n sardeenz

# Grant read-only access to a group
oc adm policy add-role-to-group sardeenz-admin-readonly team-name -n sardeenz
```

After creating the RoleBinding, the user can click "Try Again" on the Access Denied page to re-authenticate.

### RBAC Permissions

| Role             | Access Level                                                 |
| ---------------- | ------------------------------------------------------------ |
| `admin`          | Full access - load/unload models, run benchmarks, settings   |
| `admin-readonly` | Read-only - view models, benchmarks, settings (no mutations) |

For detailed RBAC setup including ServiceAccount permissions, see [RBAC Setup Guide](./rbac-setup.md).

For API permissions by role, see [API Guide: RBAC Roles](./api-guide.md#rbac-roles).

## Configuration

### Environment Variables

| Variable               | Required            | Default            | Description                                                                                                                      |
| ---------------------- | ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | No                  | `development`      | Environment mode (`development`, `production`)                                                                                   |
| `PORT`                 | No                  | `3000`             | Unified API port (Controller + Proxy + Frontend)                                                                                 |
| `HF_HOME`              | Yes                 | -                  | HuggingFace cache directory for model downloads (e.g., `/opt/app-root/models`)                                                   |
| `HF_TOKEN`             | No                  | -                  | HuggingFace token for accessing gated models (e.g., Llama, Mistral)                                                              |
| `SARDEENZ_DB_PATH`     | No                  | `data/sardeenz.db` | SQLite database file path for persistent storage (e.g., `/opt/app-root/src/data/sardeenz.db`)                                    |
| `ENABLE_KVCACHED`      | Yes                 | `true`             | Enable kvcached memory sharing                                                                                                   |
| `KVCACHED_AUTOPATCH`   | No                  | `1`                | Auto-patch vLLM for kvcached                                                                                                     |
| `LOG_LEVEL`            | No                  | `info`             | Logging level (`debug`, `info`, `warn`, `error`)                                                                                 |
| `AUTH_MODE`            | No                  | `none`             | Authentication mode: `none` (disabled), `simple` (username/password), `oauth` (OAuth 2.0)                                        |
| `ADMIN_USERNAME`       | No                  | `admin`            | Username for simple auth mode                                                                                                    |
| `ADMIN_PASSWORD`       | If AUTH_MODE=simple | -                  | Password for simple auth mode                                                                                                    |
| `JWT_SECRET`           | If AUTH_MODE!=none  | -                  | Secret for JWT token signing (use strong random value in production)                                                             |
| `JWT_EXPIRATION_HOURS` | No                  | `8`                | JWT token expiration time in hours                                                                                               |
| `OAUTH_ISSUER_URL`     | If AUTH_MODE=oauth  | -                  | OAuth issuer URL (e.g., OpenShift OAuth server URL)                                                                              |
| `K8S_API_URL`          | If AUTH_MODE=oauth  | -                  | Kubernetes API URL for fetching user info                                                                                        |
| `OAUTH_CLIENT_ID`      | If AUTH_MODE=oauth  | `sardeenz`         | OAuth2 client ID                                                                                                                 |
| `OAUTH_CLIENT_SECRET`  | If AUTH_MODE=oauth  | -                  | OAuth2 client secret                                                                                                             |
| `API_BASE_URL`         | If AUTH_MODE=oauth  | -                  | Base URL for OAuth callbacks (e.g., `https://your-domain.com`)                                                                   |
| `INFERENCE_API_KEY`    | No                  | -                  | API key for inference endpoints. When set, `/v1/*` and `/api/direct/*` require `Authorization: Bearer <key>`. OpenAI-compatible. |
| `PROMETHEUS_ENABLED`   | No                  | `true`             | Enable Prometheus metrics                                                                                                        |
| `MAX_MODELS`           | No                  | `10`               | Maximum concurrent models                                                                                                        |
| `GPU_MEMORY_RESERVE`   | No                  | `2.0`              | GPU memory reserved for CUDA (GB)                                                                                                |

### Configuration File (Future)

_Note: Configuration file support is planned for future releases._

**`config.yaml`:**

```yaml
server:
  port: 3000 # Unified API port
  routingOverheadTarget: 50 # ms (p95) for proxy routing

auth:
  enabled: true
  provider: oauth
  issuerUrl: https://oauth-openshift.apps.your-cluster.com
  k8sApiUrl: https://api.your-cluster.com:6443
  clientId: sardeenz

gpu:
  memoryReserve: 2.0 # GB
  maxModels: 5

models:
  path: /models
  preloadOnStartup: [] # Model IDs to preload

logging:
  level: info
  format: json

metrics:
  enabled: true
  port: 9090
```

## Health Checks

### Kubernetes Liveness Probe

Checks if the application is running:

```yaml
livenessProbe:
  httpGet:
    path: /api/health/live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 3
```

**Response (Healthy):**

```json
{
  "status": "alive",
  "timestamp": "2025-11-11T10:00:00Z"
}
```

### Kubernetes Readiness Probe

Checks if the application is ready to serve traffic:

```yaml
readinessProbe:
  httpGet:
    path: /api/health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

**Response (Ready):**

```json
{
  "status": "ready",
  "timestamp": "2025-11-11T10:00:00Z"
}
```

> **Note:** Health check endpoints have quiet logging enabled. Successful requests (2xx) are logged at debug level only to reduce log noise from frequent polling. Errors (4xx/5xx) are always logged at warn/error levels.

## Monitoring

### Prometheus Metrics

Metrics are exposed at `http://localhost:3000/api/v1/metrics` in Prometheus format.

**Key Metrics:**

- `sardeenz_models_total{status}` - Total models by status
- `sardeenz_gpu_memory_used_bytes{model_id}` - GPU memory per model
- `sardeenz_requests_total{model_id,status}` - Request counts
- `sardeenz_request_duration_ms{model_id}` - Request latency histogram

**ServiceMonitor (OpenShift):**

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: sardeenz
  namespace: sardeenz
spec:
  selector:
    matchLabels:
      app: sardeenz
  endpoints:
    - port: controller
      path: /api/v1/metrics
      interval: 30s
```

### Grafana Dashboard

Import dashboard for visualization (ID: TBD, to be published).

**Key Panels:**

- Model instance status (gauge)
- GPU memory usage (time series)
- Request latency (histogram)
- Requests per second (rate)
- Error rate (percentage)

## Troubleshooting

### Common Issues

**1. Pod Stuck in Pending (GPU Not Available)**

```bash
# Check GPU node labels
oc get nodes -l nvidia.com/gpu.present=true

# Check GPU resources
oc describe node <gpu-node-name> | grep nvidia.com/gpu
```

**Solution:** Ensure GPU Operator is installed and nodes have GPU quota.

**2. Model Fails to Load (Insufficient Memory)**

```bash
# Check available GPU memory
oc exec -it <pod-name> -- nvidia-smi

# Check kvcached status
oc exec -it <pod-name> -- kvctl status
```

**Solution:** Reduce `gpuMemoryLimit` or unload other models.

**3. Health Check Failures**

```bash
# Check pod logs
oc logs <pod-name> --tail=100

# Check health endpoint directly
oc exec -it <pod-name> -- curl http://localhost:3000/api/health
```

**Solution:** Check for application errors in logs.

**4. Authentication Errors**

```bash
# Check auth mode
oc exec -it <pod-name> -- env | grep AUTH_MODE

# For OAuth: Verify secret and issuer URL
oc get secret oauth-config -o yaml
oc exec -it <pod-name> -- curl ${K8S_API_URL}/apis/user.openshift.io/v1/users/~

# For simple mode: Verify credentials are set
oc exec -it <pod-name> -- env | grep -E 'ADMIN_USERNAME|ADMIN_PASSWORD'
```

**Solution:** Verify auth configuration matches the `AUTH_MODE` setting.

**5. Authorization Errors (Access Denied)**

If users see the Access Denied page after OAuth login, they have successfully authenticated but are not bound to any sardeenz roles.

```bash
# Check if the Roles exist
oc get role sardeenz-admin sardeenz-admin-readonly -n sardeenz

# Check existing RoleBindings
oc get rolebindings -n sardeenz -o wide

# Test access with impersonation
oc auth can-i get admin.sardeenz.rh-aiservices-bu.io -n sardeenz --as=user@example.com

# Add user to appropriate role
oc adm policy add-role-to-user sardeenz-admin <username> -n sardeenz

# Or add a group
oc adm policy add-role-to-group sardeenz-admin-readonly team-name -n sardeenz
```

**Common issues:**

- **Roles don't exist** → Create Roles first (see [RBAC Setup Guide](./rbac-setup.md#step-1-create-the-roles))
- **No RoleBinding for user/group** → Create RoleBinding with `oc adm policy add-role-to-user` or `add-role-to-group`
- **ServiceAccount token missing** → Check `sardeenz-auth-reviewer` Role/RoleBinding exists
- **K8S_API_URL incorrect** → Verify URL and connectivity from pod

**Solution:** Create a RoleBinding for the user or their group, then have them click "Try Again" on the Access Denied page. See [RBAC Setup Guide](./rbac-setup.md) for complete setup instructions.

### Debug Mode

Enable debug logging:

```bash
oc set env deployment/sardeenz LOG_LEVEL=debug
```

View detailed logs:

```bash
oc logs -f deployment/sardeenz | jq .
```

---

**See Also:**

- [Architecture](./architecture.md) - System architecture and design
- [API Guide](./api-guide.md) - API usage examples
- [RBAC Setup](./rbac-setup.md) - Kubernetes-native RBAC configuration for OAuth
- [kvcached Documentation](./kvcached/) - GPU memory sharing setup
