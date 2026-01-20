# RBAC Setup for sardeenz

This guide explains how to configure Role-Based Access Control (RBAC) for sardeenz when using OAuth authentication with OpenShift.

## Overview

sardeenz uses Kubernetes-native RBAC to control access. When a user authenticates via OAuth:

1. sardeenz queries the Kubernetes LocalSubjectAccessReview API (namespace-scoped)
2. It checks if the user has permissions to access sardeenz roles
3. Based on the RBAC bindings, the user is assigned `admin` and/or `admin-readonly` roles

This approach allows you to manage access via standard OpenShift tooling without restarting sardeenz. All permissions are namespace-scoped, so no cluster-admin is required for deployment.

## What's Included in the Deployment

The deployment manifests in `deployment/` already include:

| Resource                               | File                  | Description                                     |
| -------------------------------------- | --------------------- | ----------------------------------------------- |
| **ServiceAccount**                     | `serviceaccount.yaml` | The `sardeenz` ServiceAccount used by the pod   |
| **sardeenz-admin Role**                | `rbac.yaml`           | Marker role for full admin access               |
| **sardeenz-admin-readonly Role**       | `rbac.yaml`           | Marker role for read-only access                |
| **sardeenz-auth-reviewer Role**        | `rbac.yaml`           | Allows ServiceAccount to check user permissions |
| **sardeenz-auth-reviewer RoleBinding** | `rbac.yaml`           | Binds ServiceAccount to auth-reviewer role      |

**What you need to create:** RoleBindings to grant users/groups access to sardeenz (see [Step 2](#step-2-create-rolebindings)).

## Prerequisites

- OpenShift cluster with OAuth configured
- `oc` CLI with namespace admin permissions (no cluster-admin required)
- sardeenz deployed with `AUTH_MODE=oauth` (using the manifests in `deployment/`)

## Step 1: Create the Roles

> **Note:** If you deployed sardeenz using the manifests in `deployment/`, these Roles are already created by `rbac.yaml`. Skip to [Step 2](#step-2-create-rolebindings).

Create the sardeenz Roles in your deployment namespace. These Roles define "marker" permissions that sardeenz checks via LocalSubjectAccessReview.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sardeenz-admin
  namespace: sardeenz # Change to your namespace
rules:
  - apiGroups: ['sardeenz.rh-aiservices-bu.io']
    resources: ['admin']
    verbs: ['get']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sardeenz-admin-readonly
  namespace: sardeenz # Change to your namespace
rules:
  - apiGroups: ['sardeenz.rh-aiservices-bu.io']
    resources: ['admin-readonly']
    verbs: ['get']
```

Apply with:

```bash
oc apply -f roles.yaml -n sardeenz
```

These are "marker" permissions - the resources don't actually exist. They're only used for LocalSubjectAccessReview authorization checks.

## Step 2: Create RoleBindings

Bind users, groups, or ServiceAccounts to the Roles.

### Give admin access to specific users

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sardeenz-admins
  namespace: sardeenz
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sardeenz-admin
subjects:
  - kind: User
    name: alice@company.com
    apiGroup: rbac.authorization.k8s.io
  - kind: User
    name: bob@company.com
    apiGroup: rbac.authorization.k8s.io
```

Or using the CLI:

```bash
oc adm policy add-role-to-user sardeenz-admin alice@company.com -n sardeenz
oc adm policy add-role-to-user sardeenz-admin bob@company.com -n sardeenz
```

### Give admin access to a group

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sardeenz-admins-group
  namespace: sardeenz
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sardeenz-admin
subjects:
  - kind: Group
    name: platform-admins
    apiGroup: rbac.authorization.k8s.io
```

Or using the CLI:

```bash
oc adm policy add-role-to-group sardeenz-admin platform-admins -n sardeenz
```

### Give read-only access to all authenticated users

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sardeenz-readonly-all
  namespace: sardeenz
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sardeenz-admin-readonly
subjects:
  - kind: Group
    name: system:authenticated
    apiGroup: rbac.authorization.k8s.io
```

Or using the CLI:

```bash
oc adm policy add-role-to-group sardeenz-admin-readonly system:authenticated -n sardeenz
```

### Give read-only access to specific groups

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sardeenz-readonly-teams
  namespace: sardeenz
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sardeenz-admin-readonly
subjects:
  - kind: Group
    name: team-a
    apiGroup: rbac.authorization.k8s.io
  - kind: Group
    name: team-b
    apiGroup: rbac.authorization.k8s.io
```

Or using the CLI:

```bash
oc adm policy add-role-to-group sardeenz-admin-readonly team-a -n sardeenz
oc adm policy add-role-to-group sardeenz-admin-readonly team-b -n sardeenz
```

## Step 3: ServiceAccount Permissions

> **Note:** If you deployed sardeenz using the manifests in `deployment/`, the ServiceAccount (`serviceaccount.yaml`) and auth-reviewer permissions (`rbac.yaml`) are already created. Skip to [Development Mode Setup](#development-mode-setup) if running locally.

sardeenz uses a ServiceAccount to query the LocalSubjectAccessReview API (namespace-scoped). The ServiceAccount needs permission to create LocalSubjectAccessReviews in the sardeenz namespace.

### Create the ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sardeenz
  namespace: sardeenz # Change to your namespace
```

### Create the Role and RoleBinding

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sardeenz-auth-reviewer
  namespace: sardeenz # Change to your namespace
rules:
  - apiGroups: ['authorization.k8s.io']
    resources: ['localsubjectaccessreviews']
    verbs: ['create']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sardeenz-auth-reviewer
  namespace: sardeenz # Change to your namespace
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sardeenz-auth-reviewer
subjects:
  - kind: ServiceAccount
    name: sardeenz
    namespace: sardeenz # Change to your namespace
```

Apply with:

```bash
oc apply -f serviceaccount.yaml -n sardeenz
oc apply -f sa-permissions.yaml -n sardeenz
```

### Use the ServiceAccount in the Deployment

Ensure your Deployment references the ServiceAccount:

```yaml
spec:
  template:
    spec:
      serviceAccountName: sardeenz
      # ... rest of pod spec
```

**Note:** This uses namespace-scoped permissions only - no cluster-admin required for deployment.

## Development Mode Setup

When running sardeenz locally (outside of Kubernetes), you need to provide a ServiceAccount token manually.

### Generate a token for local development

```bash
# Create a long-lived token for the sardeenz ServiceAccount
oc create token sardeenz -n sardeenz --duration=8760h
```

### Set the token in your environment

Add to your `.env` file or export:

```bash
export SERVICE_ACCOUNT_TOKEN="<token from above>"
```

The token will be used instead of the auto-mounted token file.

## Common Operations

### Add a new group (no restart required)

```bash
oc adm policy add-role-to-group sardeenz-admin-readonly new-team -n sardeenz
```

Users in `new-team` can now access sardeenz immediately.

### Remove access

```bash
oc adm policy remove-role-from-user sardeenz-admin alice@company.com -n sardeenz
oc adm policy remove-role-from-group sardeenz-admin-readonly team-a -n sardeenz
```

### View current bindings

```bash
oc get rolebindings -n sardeenz
oc describe rolebinding sardeenz-admins -n sardeenz
```

### Test access (impersonation)

```bash
# Check if a user would have admin access
oc auth can-i get admin.sardeenz.rh-aiservices-bu.io -n sardeenz --as=alice@company.com

# Check if a group would have read-only access
oc auth can-i get admin-readonly.sardeenz.rh-aiservices-bu.io -n sardeenz --as=system:serviceaccount:default:default --as-group=team-a
```

## Role Hierarchy

- **`admin`**: Full access to all sardeenz operations (load/unload models, run benchmarks, change settings)
- **`admin-readonly`**: Read-only access (view models, view benchmarks, view settings)

A user can have both roles. The `admin` role implies full access, so having both is equivalent to just having `admin`.

## Troubleshooting

### User gets "Access denied" after login

1. Check if the Roles exist:

   ```bash
   oc get role sardeenz-admin sardeenz-admin-readonly -n sardeenz
   ```

2. Check if the user has a RoleBinding:

   ```bash
   oc get rolebindings -n sardeenz -o wide
   ```

3. Test access with impersonation:
   ```bash
   oc auth can-i get admin.sardeenz.rh-aiservices-bu.io -n sardeenz --as=user@company.com
   ```

### LocalSubjectAccessReview fails

Check that sardeenz has the correct `K8S_API_URL` configured and can reach the Kubernetes API server. Also verify that the `sardeenz-auth-reviewer` Role and RoleBinding exist in the namespace.

### Namespace mismatch

Ensure the `NAMESPACE` environment variable in sardeenz matches where the Roles and RoleBindings are created.

### Cluster-admins have automatic access

Cluster-admins automatically have sardeenz admin access without needing a RoleBinding. This is expected Kubernetes RBAC behavior—cluster-admin has wildcard permissions on all resources, including sardeenz marker roles (`sardeenz.rh-aiservices-bu.io/admin`).

This is by design. If you need to restrict sardeenz access for cluster-admins, you would need to decouple sardeenz authorization from Kubernetes RBAC.

## Configuration Reference

| Environment Variable    | Default    | Description                                                                        |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `AUTH_MODE`             | `none`     | Set to `oauth` to enable OAuth with RBAC                                           |
| `NAMESPACE`             | `sardeenz` | Kubernetes namespace for RBAC checks                                               |
| `K8S_API_URL`           | (required) | Kubernetes API URL for LocalSubjectAccessReview calls                              |
| `SERVICE_ACCOUNT_TOKEN` | (auto)     | ServiceAccount token for RBAC checks. In K8s, auto-mounted. For dev, set manually. |
