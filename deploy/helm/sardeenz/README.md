# sardeenz Helm chart

Deploys [sardeenz](https://github.com/rh-aiservices-bu/sardeenz) — a multi-model
LLM management platform built on vLLM + kvcached — to OpenShift or Kubernetes.

The chart provisions the application StatefulSet (GPU-scheduled), a ConfigMap and
Secret, the model-cache PVC, Services (headless + ClusterIP), an OpenShift Route
(or Kubernetes Ingress), conditional RBAC, and an optional bundled PostgreSQL.

## Install from the chart registry (no clone required)

The chart is published as an OCI artifact alongside the container image:

```bash
# Single-pod, no auth, bundled PostgreSQL — a working quick start
helm install sardeenz \
  oci://quay.io/rh-aiservices-bu/sardeenz-chart \
  --version 0.8.0 \
  --namespace sardeenz --create-namespace
```

> The chart version tracks the application version. Pick the `--version` that
> matches the sardeenz release you want to run.

## Common configurations

### Simple username/password auth

```bash
helm install sardeenz oci://quay.io/rh-aiservices-bu/sardeenz-chart --version 0.8.0 \
  -n sardeenz --create-namespace \
  --set auth.mode=simple \
  --set auth.adminPassword='<password>' \
  --set auth.jwtSecret="$(openssl rand -base64 32)"
```

### OpenShift OAuth

```bash
helm install sardeenz oci://quay.io/rh-aiservices-bu/sardeenz-chart --version 0.8.0 \
  -n sardeenz --create-namespace \
  --set auth.mode=oauth \
  --set auth.oauth.clientId=<id> \
  --set auth.oauth.clientSecret=<secret> \
  --set auth.oauth.issuerUrl=https://oauth-openshift.apps.<cluster> \
  --set auth.oauth.k8sApiUrl=https://api.<cluster>:6443 \
  --set auth.jwtSecret="$(openssl rand -base64 32)" \
  --set auth.apiBaseUrl=https://sardeenz-<namespace>.apps.<cluster>
```

`apiBaseUrl` must match the Route host, which OpenShift auto-generates as
`<release>-<namespace>.<apps-domain>` when `route.host` is unset (e.g.
`sardeenz-sardeenz.apps.<cluster>` for `-n sardeenz`). Confirm with
`oc get route sardeenz -n <namespace>`, and make sure it matches the
`redirectURIs` on your OAuthClient.

OAuth also renders the auth-reviewer RBAC. Bind users to the `sardeenz-admin` /
`sardeenz-admin-readonly` roles separately — see `docs/rbac-setup.md`.

### Multi-pod cluster

```bash
helm upgrade --install sardeenz oci://quay.io/rh-aiservices-bu/sardeenz-chart --version 0.8.0 \
  -n sardeenz \
  --set replicaCount=3 \
  --set cluster.secret="$(openssl rand -hex 32)"
```

`replicaCount` drives both the StatefulSet replicas and `CLUSTER_EXPECTED_PODS`,
and renders the cluster-coordination RBAC (pod discovery + leader-election leases).

### Production secrets (recommended)

Avoid putting secrets in `--set`/values. Pre-create the Secret and reference it:

```bash
oc create secret generic sardeenz-secrets -n sardeenz \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  --from-literal=admin-password='<password>' \
  --from-literal=hf-token="$HF_TOKEN" \
  --from-literal=db-username=sardeenz \
  --from-literal=db-password="$(openssl rand -base64 16)" \
  --from-literal=database-url='postgresql://sardeenz:<password>@sardeenz-postgresql:5432/sardeenz'

helm install sardeenz oci://quay.io/rh-aiservices-bu/sardeenz-chart --version 0.8.0 \
  -n sardeenz --set secrets.existingSecret=sardeenz-secrets
```

The referenced Secret must contain: `jwt-secret`, `admin-password`, `client-id`,
`client-secret`, `issuer-url`, `k8s-api-url`, `inference-api-key`, `hf-token`,
`cluster-secret`, `db-username`, `db-password`, `database-url` (omit keys you
don't use — all are read as optional except `database-url`).

### External database

```bash
--set postgresql.enabled=false \
--set database.url='postgresql://user:pass@db.example.com:5432/sardeenz'
```

### Kubernetes (non-OpenShift) with Ingress

```bash
--set route.enabled=false \
--set ingress.enabled=true \
--set ingress.className=nginx \
--set ingress.host=sardeenz.example.com
```

## Verify

```bash
helm test sardeenz -n sardeenz   # curls /api/health/ready from an in-cluster pod
```

## Key values

| Key | Default | Description |
| --- | --- | --- |
| `replicaCount` | `1` | Pods; also sets `CLUSTER_EXPECTED_PODS`. |
| `image.repository` | `quay.io/rh-aiservices-bu/sardeenz` | Image repo. |
| `image.tag` | `""` | Defaults to chart appVersion. |
| `auth.mode` | `none` | `none` \| `simple` \| `oauth`. |
| `secrets.create` | `true` | Template the Secret from values. |
| `secrets.existingSecret` | `""` | Use a pre-created Secret instead. |
| `database.url` | `""` | External DB; defaults to bundled PostgreSQL. |
| `postgresql.enabled` | `true` | Deploy the bundled PostgreSQL. |
| `gpu.count` | `1` | GPUs requested/limited per pod. |
| `persistence.size` | `100Gi` | Model-cache PVC size (RWX). |
| `route.enabled` | `true` | OpenShift Route. |
| `ingress.enabled` | `false` | Kubernetes Ingress. |
| `rbac.create` | `true` | RBAC (OAuth/cluster roles rendered as needed). |

See [`values.yaml`](./values.yaml) for the fully documented set.

## Maintainers: publishing the chart

Chart version is sourced from `package.json`, keeping it in lockstep with the app.

```bash
make helm-lint            # lint
make helm-template        # render to stdout (ARGS="--set auth.mode=oauth")
make helm-package         # -> dist/charts/sardeenz-chart-<version>.tgz
helm registry login quay.io
make helm-push            # -> quay.io/rh-aiservices-bu/sardeenz-chart:<version>
```
