# Deployment Guide

This guide covers container building and deployment to OpenShift/Kubernetes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Container Build](#container-build)
- [Local Development](#local-development)
- [OpenShift Deployment](#openshift-deployment)
- [Configuration](#configuration)
- [Health Checks](#health-checks)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 8 cores | 16+ cores |
| **RAM** | 16 GB | 32+ GB |
| **GPU** | NVIDIA with 8GB VRAM | 24GB+ VRAM (A10, A100, H100) |
| **Storage** | 50 GB | 100+ GB SSD |

### Software Requirements

| Software | Version | Purpose |
|----------|---------|---------|
| **Docker** | 24.x+ | Container runtime |
| **NVIDIA Container Toolkit** | 1.14.x+ | GPU access in containers |
| **CUDA** | 12.x | GPU compute |
| **OpenShift** (optional) | 4.12+ | Production orchestration |
| **kubectl** (optional) | 1.28+ | Kubernetes CLI |

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

# Configure Docker to use NVIDIA runtime
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

**Verify GPU Access:**

```bash
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

## Container Build

### Dockerfile Structure

The unified container image includes:
- **Base:** `quay.io/vllm/vllm-cuda:0.11.0` (CUDA 12.x + Python 3.12 + vLLM)
- **Node.js 22.x** (added layer)
- **Backend** (Fastify TypeScript app)
- **Frontend** (React + PatternFly built static assets)

### Build the Container

**From project root:**

```bash
# Build the image
docker build -t sardeenz:latest .

# Tag for registry
docker tag sardeenz:latest quay.io/your-org/sardeenz:latest

# Push to registry
docker push quay.io/your-org/sardeenz:latest
```

**Build with custom vLLM version:**

```bash
docker build \
  --build-arg VLLM_BASE_IMAGE=quay.io/vllm/vllm-cuda:0.12.0 \
  -t sardeenz:custom .
```

### Multi-Stage Build Example

*Note: This is a conceptual Dockerfile structure. Actual implementation may vary.*

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
FROM quay.io/vllm/vllm-cuda:0.11.0

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest

# Install KVCached
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

### Run with Docker Compose

**`docker-compose.yml`:**

```yaml
version: '3.8'

services:
  vllm-stacker:
    image: sardeenz:latest
    ports:
      - "3000:3000"  # Unified API (Controller + Proxy + Frontend)
    environment:
      - NODE_ENV=development
      - ENABLE_KVCACHED=true
      - KVCACHED_AUTOPATCH=1
      - LOG_LEVEL=debug
      - HF_HOME=/opt/app-root/models
      - OAUTH_ENABLED=false  # Disable auth for local dev
    volumes:
      - ./models:/opt/app-root/models  # Mount local models directory for HF cache
      - /tmp/kvcached:/tmp/kvcached  # KVCached IPC directory
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

**Start the stack:**

```bash
docker compose up -d

# View logs
docker compose logs -f

# Stop the stack
docker compose down
```

### Run Standalone Container

```bash
docker run -d \
  --name vllm-stacker \
  --gpus all \
  -p 3000:3000 \
  -e ENABLE_KVCACHED=true \
  -e KVCACHED_AUTOPATCH=1 \
  -e HF_HOME=/opt/app-root/models \
  -v /path/to/models:/opt/app-root/models \
  -v /tmp/kvcached:/tmp/kvcached \
  sardeenz:latest
```

## OpenShift Deployment

### Prerequisites

1. **GPU-enabled OpenShift cluster** with NVIDIA GPU Operator installed
2. **Namespace** with GPU quota allocated
3. **Image registry access** (e.g., Quay.io)
4. **Persistent storage** for model files (optional, can use S3/object storage)

### Deploy with GPU

**1. Create Namespace:**

```bash
oc new-project vllm-stacker
```

**2. Create Deployment:**

**`deployment.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-stacker
  namespace: vllm-stacker
  labels:
    app: vllm-stacker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vllm-stacker
  template:
    metadata:
      labels:
        app: vllm-stacker
    spec:
      containers:
      - name: vllm-stacker
        image: quay.io/your-org/sardeenz:latest
        ports:
        - containerPort: 3000
          name: http
          protocol: TCP
        env:
        - name: NODE_ENV
          value: "production"
        - name: ENABLE_KVCACHED
          value: "true"
        - name: KVCACHED_AUTOPATCH
          value: "1"
        - name: HF_HOME
          value: "/opt/app-root/models"
        - name: SARDEENZ_DB_PATH
          value: "/opt/app-root/src/data/sardeenz.db"
        - name: HF_TOKEN
          valueFrom:
            secretKeyRef:
              name: hf-token
              key: token
              optional: true
        - name: LOG_LEVEL
          value: "info"
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
            memory: "16Gi"
            cpu: "4"
            nvidia.com/gpu: "1"
          limits:
            memory: "32Gi"
            cpu: "8"
            nvidia.com/gpu: "1"
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
        nvidia.com/gpu.present: "true"
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
  name: vllm-stacker
  namespace: vllm-stacker
spec:
  selector:
    app: vllm-stacker
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
  name: vllm-stacker
  namespace: vllm-stacker
spec:
  host: vllm-stacker.apps.your-cluster.com
  to:
    kind: Service
    name: vllm-stacker
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

**5. Create PersistentVolumeClaims:**

Two PVCs are required:
- **Model Cache PVC** (`model-cache-pvc`): Stores downloaded HuggingFace models
- **App Data PVC** (`sardeenz-app-data`): Stores SQLite database and other persistent app data

**Model Cache PVC (`pvc-model-cache.yaml`):**

Models are downloaded from HuggingFace Hub on first load and cached to the PVC. The `HF_HOME` environment variable controls where models are stored.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: model-cache-pvc
  namespace: vllm-stacker
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
  namespace: vllm-stacker
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi  # Small - just for SQLite database
```

> **Note:** 1Gi is sufficient for the SQLite database which stores benchmark results and memory profiles.

**6. Create Secrets:**

```bash
# HuggingFace token (optional, for gated models like Llama, Mistral)
oc create secret generic hf-token \
  --from-literal=token=hf_your_token_here \
  -n vllm-stacker

# OAuth configuration (optional)
oc create secret generic oauth-config \
  --from-literal=issuer-url=https://your-keycloak.com/auth/realms/vllm \
  --from-literal=client-id=vllm-stacker \
  --from-literal=client-secret=your-secret-here \
  -n vllm-stacker
```

**7. Deploy:**

```bash
oc apply -f pvc-model-cache.yaml
oc apply -f pvc-app-data.yaml
oc apply -f deployment.yaml
oc apply -f service.yaml
oc apply -f route.yaml

# Check deployment status
oc get pods -n vllm-stacker -w

# View logs
oc logs -f deployment/vllm-stacker -n vllm-stacker
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

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment mode (`development`, `production`) |
| `PORT` | No | `3000` | Unified API port (Controller + Proxy + Frontend) |
| `HF_HOME` | Yes | - | HuggingFace cache directory for model downloads (e.g., `/opt/app-root/models`) |
| `HF_TOKEN` | No | - | HuggingFace token for accessing gated models (e.g., Llama, Mistral) |
| `SARDEENZ_DB_PATH` | No | `data/sardeenz.db` | SQLite database file path for persistent storage (e.g., `/opt/app-root/src/data/sardeenz.db`) |
| `ENABLE_KVCACHED` | Yes | `true` | Enable KVCached memory sharing |
| `KVCACHED_AUTOPATCH` | No | `1` | Auto-patch vLLM for KVCached |
| `LOG_LEVEL` | No | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `OAUTH_ENABLED` | No | `true` | Enable OAuth authentication |
| `OAUTH_ISSUER_URL` | If OAuth enabled | - | OIDC issuer URL |
| `OAUTH_CLIENT_ID` | If OAuth enabled | - | OAuth client ID |
| `OAUTH_CLIENT_SECRET` | If OAuth enabled | - | OAuth client secret |
| `PROMETHEUS_ENABLED` | No | `true` | Enable Prometheus metrics |
| `MAX_MODELS` | No | `10` | Maximum concurrent models |
| `GPU_MEMORY_RESERVE` | No | `2.0` | GPU memory reserved for CUDA (GB) |

### Configuration File (Future)

*Note: Configuration file support is planned for future releases.*

**`config.yaml`:**

```yaml
server:
  port: 3000  # Unified API port
  routingOverheadTarget: 50  # ms (p95) for proxy routing

auth:
  enabled: true
  provider: oidc
  issuerUrl: https://your-keycloak.com/auth/realms/vllm
  clientId: vllm-stacker

gpu:
  memoryReserve: 2.0  # GB
  maxModels: 5

models:
  path: /models
  preloadOnStartup: []  # Model IDs to preload

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
- `vllm_stacker_models_total{status}` - Total models by status
- `vllm_stacker_gpu_memory_used_bytes{model_id}` - GPU memory per model
- `vllm_stacker_requests_total{model_id,status}` - Request counts
- `vllm_stacker_request_duration_ms{model_id}` - Request latency histogram

**ServiceMonitor (OpenShift):**

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: vllm-stacker
  namespace: vllm-stacker
spec:
  selector:
    matchLabels:
      app: vllm-stacker
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

# Check KVCached status
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

**4. OAuth Authentication Errors**

```bash
# Verify OAuth secret
oc get secret oauth-config -o yaml

# Check issuer URL reachability
oc exec -it <pod-name> -- curl <issuer-url>/.well-known/openid-configuration
```

**Solution:** Verify OAuth configuration and network policies.

### Debug Mode

Enable debug logging:

```bash
oc set env deployment/vllm-stacker LOG_LEVEL=debug
```

View detailed logs:

```bash
oc logs -f deployment/vllm-stacker | jq .
```

---

**See Also:**
- [Architecture](./architecture.md) - System architecture and design
- [API Guide](./api-guide.md) - API usage examples
- [KVCached Documentation](./kvcached/) - GPU memory sharing setup
