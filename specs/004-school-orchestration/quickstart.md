# Quickstart: School of Sardeenz (004)

## Development Setup

### Prerequisites
- Existing sardeenz dev environment (Node.js 22, npm workspaces)
- 2+ terminal windows for simulating multi-pod

### Local Multi-Pod Development

Since GPU hardware is typically single-node in dev, use the static peer list fallback:

```bash
# Terminal 1: Pod A (will become leader)
PORT=3000 CLUSTER_PEERS=localhost:3000,localhost:3001 \
  CLUSTER_SECRET=dev-secret-change-me \
  DEV_VIRTUAL_GPU_COUNT=2 \
  npm run dev -w apps/backend

# Terminal 2: Pod B
PORT=3001 CLUSTER_PEERS=localhost:3000,localhost:3001 \
  CLUSTER_SECRET=dev-secret-change-me \
  DEV_VIRTUAL_GPU_COUNT=2 \
  npm run dev -w apps/backend

# Terminal 3: Frontend (connects to leader)
npm run dev -w apps/frontend
```

### Kubernetes Deployment

```yaml
# StatefulSet for stable pod identities
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: sardeenz
spec:
  replicas: 3  # Up to 8
  serviceName: sardeenz-headless
  selector:
    matchLabels:
      app: sardeenz
  template:
    metadata:
      labels:
        app: sardeenz
    spec:
      serviceAccountName: sardeenz
      containers:
        - name: sardeenz
          image: quay.io/rh-aiservices-bu/sardeenz:latest
          ports:
            - containerPort: 3000  # API + Dashboard
              name: http
            - containerPort: 5001  # vLLM port range start
              name: vllm
          env:
            - name: CLUSTER_SECRET
              valueFrom:
                secretKeyRef:
                  name: sardeenz-cluster-secret
                  key: CLUSTER_SECRET
          resources:
            limits:
              nvidia.com/gpu: 1
---
# Headless Service for pod discovery + direct vLLM access
apiVersion: v1
kind: Service
metadata:
  name: sardeenz-headless
spec:
  clusterIP: None
  selector:
    app: sardeenz
  ports:
    - port: 3000
      name: http
    - port: 5001
      name: vllm
---
# Regular Service for external access (load-balanced)
apiVersion: v1
kind: Service
metadata:
  name: sardeenz
spec:
  selector:
    app: sardeenz
  ports:
    - port: 3000
      name: http
---
# RBAC for pod discovery and leader election
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sardeenz
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sardeenz-cluster
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "create", "update", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sardeenz-cluster
subjects:
  - kind: ServiceAccount
    name: sardeenz
roleRef:
  kind: Role
  name: sardeenz-cluster
  apiGroup: rbac.authorization.k8s.io
---
# Cluster secret
apiVersion: v1
kind: Secret
metadata:
  name: sardeenz-cluster-secret
type: Opaque
stringData:
  CLUSTER_SECRET: "generate-a-random-secret-here"
```

## Key Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_PEERS` | (none) | Static peer list fallback: `host1:port,host2:port` |
| `CLUSTER_SECRET` | (none) | Shared HMAC secret for inter-pod auth |
| `CLUSTER_EXPECTED_PODS` | (auto) | Expected cluster size (for quorum calculation) |

## Verification Steps

1. **Pod discovery**: Open dashboard, verify all pods appear in cluster overview
2. **Leader election**: Kill leader pod, verify new leader elected within 30s
3. **Cross-pod routing**: Load model on Pod A, send inference request to Pod B's address
4. **Cross-pod model move**: Move model from Pod A to Pod B via dashboard
5. **Preset scheduling**: Create preset, apply to cluster, verify automatic placement

## New API Endpoints

### Cluster Management (leader only)
- `GET /api/cluster` - Cluster health and status
- `GET /api/cluster/pods` - List all pods with GPU/model details
- `POST /api/cluster/models/load` - Load model on any pod
- `POST /api/cluster/models/:id/unload` - Unload model from any pod
- `POST /api/cluster/models/:id/move` - Cross-pod or intra-pod model move
- `GET /api/cluster/routing-table` - Current routing table
- `POST /api/cluster/presets/:id/apply` - Apply preset with scheduling

### Internal (inter-pod, HMAC-authenticated)
- `POST /internal/heartbeat` - Periodic liveness + state sync
- `GET /internal/state` - Full pod state for sync
- `POST /internal/cluster/event` - Immediate state change notifications
- `POST /internal/models/load` - Remote model load command
- `POST /internal/models/:id/unload` - Remote model unload command
- `GET /internal/models/:id/events` - Remote SSE event relay
