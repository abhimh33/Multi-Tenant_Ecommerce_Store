# System Design & Tradeoffs

> Architecture decisions, failure handling, and production considerations for the Multi-Tenant E-commerce Provisioning Platform.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Why This Stack](#why-this-stack)
3. [Namespace-per-Store Isolation](#namespace-per-store-isolation)
4. [Store Lifecycle State Machine](#store-lifecycle-state-machine)
5. [Idempotency & Failure Handling](#idempotency--failure-handling)
6. [Cleanup & Recovery](#cleanup--recovery)
7. [Production Changes Required](#production-changes-required)
8. [Known Tradeoffs & Accepted Limitations](#known-tradeoffs--accepted-limitations)

---

## Architecture Overview

```
                  ┌──────────────────────────┐
                  │   React Dashboard (SPA)  │
                  └────────────┬─────────────┘
                               │  REST / JWT
                  ┌────────────▼─────────────┐
                  │  Node.js Control Plane    │
                  │  ┌─────────────────────┐  │
                  │  │ Provisioner Service  │  │◄── Orchestrator
                  │  │  ├── Helm Service    │  │
                  │  │  ├── K8s Service     │  │
                  │  │  └── Setup Service   │  │
                  │  ├─────────────────────┤  │
                  │  │ Guardrails           │  │◄── Rate limit, circuit breaker, env validation
                  │  │ Audit Service        │  │◄── Every event logged
                  │  └─────────────────────┘  │
                  └─────┬──────────┬──────────┘
                        │ SQL      │ kubectl / helm
               ┌────────▼───┐  ┌──▼────────────────────────────────┐
               │ PostgreSQL  │  │ Kubernetes Cluster                │
               │ (control    │  │  ┌──────────────────────────────┐ │
               │  plane DB)  │  │  │ ns: store-abc  (WooCommerce) │ │
               └─────────────┘  │  │  WordPress + MariaDB + PVC   │ │
                                │  └──────────────────────────────┘ │
                                │  ┌──────────────────────────────┐ │
                                │  │ ns: store-xyz  (MedusaJS)    │ │
                                │  │  Medusa + PostgreSQL + PVC   │ │
                                │  └──────────────────────────────┘ │
                                └───────────────────────────────────┘
```

The platform has two planes:

| Plane | Purpose | Technology |
|-------|---------|-----------|
| **Control plane** | Manages store lifecycle, auth, audit | Express + PostgreSQL |
| **Data plane** | Runs the actual e-commerce stores | Kubernetes + Helm per namespace |

The control plane never directly handles e-commerce traffic. It uses `helm install/uninstall` and `kubectl exec` to manage stores, keeping concerns cleanly separated.

---

## Why This Stack

### Express + PostgreSQL (Control Plane)

| Decision | Rationale |
|----------|-----------|
| **Express** over Fastify/Hapi | Widest ecosystem, lowest barrier to entry, sufficient for a control plane that sees low-volume API traffic |
| **PostgreSQL** over SQLite/MongoDB | ACID transactions for state changes, proper `WHERE` clause tenant isolation, well-understood failure semantics |
| **Raw SQL** over an ORM | The schema is small (2 tables). Raw queries are transparent, auditable, and avoid ORM abstraction leaks for critical state transitions |

### Helm + Namespace-per-Store (Data Plane)

| Decision | Rationale |
|----------|-----------|
| **Helm** over raw manifests/Kustomize | Templating with `--set engine=X` lets a single chart serve both WooCommerce and MedusaJS. Values files cleanly separate local vs. production config |
| **One namespace per store** over shared namespace | Hard security boundary — NetworkPolicy, ResourceQuota, and LimitRange are scoped per namespace. Deletion is atomic (`kubectl delete namespace`) |
| **kubectl exec** for post-install setup over Helm hooks | Helm post-install Jobs fight with PVC mount timing and container readiness. `kubectl exec` into the running pod is more reliable and debuggable |

### Unified Helm Chart (Both Engines)

A single chart (`helm/ecommerce-store/`) contains both WooCommerce and MedusaJS templates, gated by `{{ if eq .Values.engine "woocommerce" }}`. This was chosen over two separate charts because:

- Shared resources (NetworkPolicy, ResourceQuota, LimitRange, RBAC) are defined once
- The provisioner only needs to know one chart path — the `engine` value selects the template branch
- Easier to keep local/VPS values files consistent

**Tradeoff**: The chart is larger and has templates that are never rendered for a given engine. This is acceptable because Helm rendering is instantaneous and the alternative (chart-per-engine) would double maintenance cost.

---

## Namespace-per-Store Isolation

Each store gets a dedicated Kubernetes namespace: `store-<storeId>`.

```
Namespace: store-ab3f7e
├── Deployment (wordpress or medusa)
├── StatefulSet (mariadb or postgresql)
├── Service (ClusterIP)
├── Ingress (subdomain routing)
├── PersistentVolumeClaim (data persistence)
├── Secret (DB credentials, admin passwords)
├── NetworkPolicy (default-deny ingress except from ingress controller)
├── ResourceQuota (CPU, memory, storage caps)
├── LimitRange (per-container defaults)
└── ServiceAccount + RoleBinding (optional RBAC)
```

**Why not a shared namespace with label selectors?**

- NetworkPolicy in a shared namespace requires complex label-based rules that are easy to misconfigure
- ResourceQuota cannot cap resources per-tenant in a shared namespace
- Deletion in a shared namespace requires individually deleting every resource with a label selector, which is fragile
- Namespace deletion is atomic and handled entirely by Kubernetes garbage collection

**Tradeoff**: More namespaces means more Kubernetes API objects, which adds overhead on very large clusters (1000+ stores). For the expected scale (tens to low hundreds of stores), this is not a concern.

---

## Store Lifecycle State Machine

Every store follows a strict state machine defined in `storeMachine.js`:

```
  requested ──▶ provisioning ──▶ ready ──▶ deleting ──▶ deleted
                     │                        │
                     └──▶ failed ◀────────────┘
                            │
                            └──▶ requested  (retry)
```

### States

| State | Meaning |
|-------|---------|
| `requested` | Store created in DB, provisioning not yet started |
| `provisioning` | Helm install in progress, pods booting, post-install setup running |
| `ready` | All checks passed, store is accessible |
| `failed` | Something went wrong — can be retried or deleted |
| `deleting` | Helm uninstall + namespace cleanup in progress |
| `deleted` | Terminal — all resources removed |

### Key Design Rules

1. **Transitions are the only way to change state.** Every `UPDATE stores SET status = ...` call goes through `assertTransition(from, to)` which validates against the transition map.

2. **Optimistic locking prevents races.** The `updateStore()` function accepts `{ expectedStatus }`. The SQL becomes:
   ```sql
   UPDATE stores SET status = $new WHERE id = $id AND status = $expected
   ```
   If another process changed the status concurrently, the update returns 0 rows and is rejected.

3. **Every transition is audited.** The audit service records `{ storeId, event, previousStatus, newStatus, details }` for every state change.

---

## Idempotency & Failure Handling

### Create Store

1. **Idempotency check**: If a store with the same name + owner already exists and is in `failed` state, the existing record is reused (retry path). If it's `ready`, a `ConflictError` is thrown.

2. **Fire-and-forget provisioning**: The HTTP response returns immediately after creating the DB record in `requested` state. Provisioning runs asynchronously.

3. **Provisioning steps** (each wrapped in `retryWithBackoff`):
   - Create Kubernetes namespace
   - Run `helm install` with engine-specific values
   - Wait for deployment rollout (`kubectl rollout status`)
   - Wait for pod readiness
   - Run post-install setup (`setupWooCommerce` or `setupMedusa`)
   - Transition to `ready`

4. **If any step fails**: The store transitions to `failed` with the error recorded in `error_message`. The user can trigger a retry, which transitions `failed → requested → provisioning` and re-runs the full provisioning pipeline.

### Retry with Exponential Backoff

```
Attempt 1: immediate
Attempt 2: wait ~1s  (base × 2^1 + jitter)
Attempt 3: wait ~2s  (base × 2^2 + jitter)
...up to maxRetries (default: 3)
```

Jitter (±25%) prevents thundering-herd scenarios when multiple stores fail simultaneously.

### Circuit Breaker

External calls to Helm and Kubernetes are wrapped in a circuit breaker:

```
CLOSED ──(failures ≥ threshold)──▶ OPEN ──(timeout expires)──▶ HALF_OPEN
   ▲                                                               │
   └──────────────(test request succeeds)──────────────────────────┘
```

- **CLOSED**: Normal operation, requests pass through
- **OPEN**: All requests fail immediately without calling the external service (fail-fast)
- **HALF_OPEN**: Allows a single test request; if it succeeds → CLOSED, if it fails → OPEN

This prevents the control plane from hammering a down Kubernetes API and allows fast recovery when the cluster comes back.

### Delete Store

Deletion follows a similar pattern:

1. Validate the store can be deleted (`canDelete()` — not already deleted, not provisioning)
2. Transition to `deleting` with optimistic lock
3. Async: Helm uninstall → delete namespace → transition to `deleted`
4. If cleanup fails: transition to `failed` (operator can investigate and retry)

---

## Cleanup & Recovery

### Stuck Store Recovery

On backend startup, the provisioner calls `recoverStuckStores()`:

1. Query all stores in transitional states (`requested`, `provisioning`, `deleting`)
2. For each stuck store:
   - `provisioning` → transition to `failed` (operator retries manually)
   - `requested` → re-trigger provisioning
   - `deleting` → re-trigger deletion

This handles the case where the backend crashed mid-provisioning.

### Namespace as Source of Truth for Cleanup

When deleting, the provisioner:
1. Runs `helm uninstall` (idempotent — succeeds even if release doesn't exist)
2. Deletes the namespace (idempotent — succeeds even if namespace doesn't exist)
3. Only transitions to `deleted` after both succeed

If the namespace was already cleaned up (e.g., manual `kubectl delete ns`), the deletion still succeeds because both operations are no-ops on non-existent resources.

---

## Production Changes Required

Moving from Docker Desktop to a real VPS or cloud environment requires the following changes:

### 1. DNS — Wildcard Domain

| Item | Local | Production |
|------|-------|-----------|
| Domain | `*.localhost` (resolved by browser) | `*.yourdomain.com` (real DNS) |
| DNS record | None needed | Wildcard A record: `*.yourdomain.com → <VPS_IP>` |
| Env var | `STORE_DOMAIN_SUFFIX=.localhost` | `STORE_DOMAIN_SUFFIX=.yourdomain.com` |

### 2. Ingress Controller & TLS

| Item | Local | Production |
|------|-------|-----------|
| Ingress | NGINX Ingress (Docker Desktop) | Traefik (bundled with k3s) |
| TLS | None (HTTP) | cert-manager + Let's Encrypt (`letsencrypt-prod` ClusterIssuer) |
| Values file | `values-local.yaml` | `values-vps.yaml` |

```yaml
# values-vps.yaml already includes:
ingress:
  className: traefik
  tls: true
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
```

### 3. Storage Class

| Item | Local | Production |
|------|-------|-----------|
| Storage class | `hostpath` (Docker Desktop) | `local-path` (k3s) or cloud PVs (`gp3`, `pd-ssd`) |
| Concern | Data lost if node dies | Use replicated storage or scheduled backups |

For serious production use, replace `local-path` with a CSI driver that supports snapshots and replication (e.g., Longhorn for bare-metal k3s, or EBS CSI for EKS).

### 4. Secrets Management

| Item | Local | Production |
|------|-------|-----------|
| DB passwords | Random strings generated at install | External Secrets Operator pulling from Vault/AWS Secrets Manager |
| JWT secret | Hardcoded in `.env` | Injected from secret store, rotated periodically |
| Helm `--set` values | Passwords passed via CLI (redacted in logs) | `--set-file` or external secrets injection |

### 5. Control Plane Database

| Item | Local | Production |
|------|-------|-----------|
| PostgreSQL | Docker container on `localhost:5433` | Managed service (RDS, Cloud SQL) or dedicated server with backups |
| Backups | None | Automated daily backups with point-in-time recovery |
| HA | Single instance | Read replica or streaming replication |

### 6. Backend Process Management

| Item | Local | Production |
|------|-------|-----------|
| Process | `npm run dev` (nodemon) | PM2 with `--max-memory-restart` or systemd unit |
| Scaling | Single instance | Horizontal scaling requires Redis-backed cooldown (see F11) |
| Monitoring | Console logs | Prometheus scraping `/metrics`, Grafana dashboards, alerting on `circuit_breaker_state` |

### 7. RBAC

The Helm chart includes optional RBAC resources (ServiceAccount + ClusterRoleBinding) controlled by `rbac.create`:

```yaml
# values.yaml
rbac:
  create: false    # Local: disabled for simplicity
  
# values-vps.yaml — enable for production:
rbac:
  create: true
```

When enabled, each store namespace gets a dedicated ServiceAccount with least-privilege permissions.

---

## Known Tradeoffs & Accepted Limitations

| ID | Tradeoff | Rationale |
|----|----------|-----------|
| **T1** | No Row-Level Security (RLS) in PostgreSQL | Tenant isolation is enforced at the application layer (`WHERE owner_id = $jwt`). RLS adds defense-in-depth but is unnecessary for a single-backend architecture and complicates migrations. |
| **T2** | In-memory cooldown map | The per-user store creation cooldown uses a `Map()` in the backend process. This works for a single instance but would need Redis for horizontal scaling. |
| **T3** | `requestId` not propagated to async logs | Provisioning is fire-and-forget. The HTTP request ID is not available in async provisioning logs. Correlation is done via `storeId` instead. |
| **T4** | No multi-cluster support | The provisioner targets a single Kubernetes cluster. Multi-region would require a cluster registry and routing layer. |
| **T5** | Single Helm chart for both engines | Increases chart size with unused templates per engine. Chosen over chart-per-engine to reduce maintenance. |
| **T6** | Post-install setup via `kubectl exec` | More brittle than a sidecar/init-container approach but avoids Helm hook timing issues and is easier to debug. |
| **T7** | No store backup/restore | Individual store data is not backed up by the platform. Store-level backup would require PVC snapshots or engine-specific export tools. |
| **T8** | Synchronous Helm CLI calls | The backend shells out to the `helm` binary. A Helm SDK (Go) or gRPC Tiller replacement would be more efficient but adds significant complexity for low-volume operations. |

---

## Summary

The platform prioritizes **operational simplicity** and **correctness** over scalability:

- One namespace per store gives hard isolation boundaries at the infrastructure level
- A strict state machine with optimistic locking prevents corruption from concurrent operations
- Fire-and-forget provisioning with stuck-store recovery handles crash scenarios
- Circuit breakers prevent cascading failures when the cluster is unhealthy
- Every operation is audited with full event history

For production, the main investments are: managed database, wildcard DNS + TLS, and proper secrets management. The architecture scales comfortably to hundreds of stores on a single cluster without significant changes.
