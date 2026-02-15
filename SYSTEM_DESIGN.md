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
7. [Concurrency Controls](#concurrency-controls)
8. [Security Posture](#security-posture)
9. [Observability & Monitoring](#observability--monitoring)
10. [Scaling Model](#scaling-model)
11. [Production Environment Differences](#production-environment-differences)
12. [Known Tradeoffs & Accepted Limitations](#known-tradeoffs--accepted-limitations)

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           User-Facing Layer                               │
│                                                                           │
│  ┌─────────────────────────────┐     ┌──────────────────────────────────┐ │
│  │   React Dashboard (SPA)     │     │   MedusaJS Storefront (SPA)     │ │
│  │   frontend/ · :5173         │     │   storefront-medusa/ · :3000    │ │
│  │                              │     │                                  │ │
│  │  Store CRUD, audit logs,    │     │  Hero, product catalog, cart    │ │
│  │  user auth, monitoring      │     │  drawer, 3-step checkout, order │ │
│  │  React · shadcn/ui · Axios  │     │  React 18 · Tailwind · Vite    │ │
│  └──────────────┬──────────────┘     │  Pure fetch Medusa Store API v1 │ │
│                 │                     └────────────────┬─────────────────┘ │
│                 │ REST API (JWT)                       │ Medusa Store API  │
└─────────────────┼─────────────────────────────────────┼───────────────────┘
                  │                                     │
┌─────────────────▼─────────────────────────────────────┼───────────────────┐
│              Node.js Control Plane · :3001             │                   │
│  ┌──────────────────────────────────────────────┐     │                   │
│  │ Provisioner Service (Orchestrator)           │     │                   │
│  │  ├── Helm Service    (helm upgrade --install)│     │                   │
│  │  ├── K8s Service     (namespace, readiness)  │     │                   │
│  │  └── Setup Service   (WP-CLI / Medusa CLI)   │     │                   │
│  ├──────────────────────────────────────────────┤     │                   │
│  │ Guardrails: rate limit, circuit breaker,     │     │                   │
│  │   env validation, optimistic locking         │     │                   │
│  │ Ingress Service: auto port-forward,          │     │                   │
│  │   hosts file management (Docker Desktop)     │     │                   │
│  │ State Machine: requested → provisioning →    │     │                   │
│  │   ready → deleting → deleted (+ failed)      │     │                   │
│  │ Audit Service: every event logged            │     │                   │
│  │ Prometheus Metrics: /metrics endpoint        │     │                   │
│  └──────────────────────────────────────────────┘     │                   │
└─────┬──────────────┬──────────────────────────────────┼───────────────────┘
      │ SQL           │ kubectl / helm                   │
┌─────▼────────┐  ┌───▼─────────────────────────────────▼───────────────────┐
│ PostgreSQL   │  │              Kubernetes Cluster                          │
│ (control     │  │                                                          │
│  plane DB)   │  │  ┌────────────────────────────────────────────────────┐  │
│  PG 16       │  │  │  Namespace: store-abc12345 (WooCommerce)          │  │
│  port 5433   │  │  │                                                    │  │
└──────────────┘  │  │  ┌──────────────────┐  ┌───────────────────────┐  │  │
                  │  │  │ WordPress Pod     │  │ MariaDB StatefulSet   │  │  │
                  │  │  │ WP 6.7 · PHP 8.2  │  │ MariaDB 11.4 + PVC   │  │  │
                  │  │  │ WooCommerce 9.5.2 │  └───────────────────────┘  │  │
                  │  │  │ Theme: Astra /    │                             │  │
                  │  │  │  Storefront       │  Ingress: *.localhost       │  │
                  │  │  │ Products + COD    │  NetworkPolicy · Quota      │  │
                  │  │  └──────────────────┘                              │  │
                  │  └────────────────────────────────────────────────────┘  │
                  │                                                          │
                  │  ┌────────────────────────────────────────────────────┐  │
                  │  │  Namespace: store-xyz98765 (MedusaJS)             │  │
                  │  │                                                    │  │
                  │  │  ┌──────────────────┐  ┌───────────────────────┐  │  │
                  │  │  │ Medusa Pod        │  │ PostgreSQL            │  │  │
                  │  │  │ v1.20 · Node.js   │  │ StatefulSet + PVC    │  │  │
                  │  │  │ Store API v1      │  │ PG 16 Alpine         │  │  │
                  │  │  └──────────────────┘  └───────────────────────┘  │  │
                  │  │                                                    │  │
                  │  │  ┌──────────────────┐  Ingress: *.localhost       │  │
                  │  │  │ Storefront Pod   │  NetworkPolicy · Quota      │  │
                  │  │  │ nginx + React SPA│  (opt-in: storefront.       │  │
                  │  │  └──────────────────┘    enabled=true)            │  │
                  │  └────────────────────────────────────────────────────┘  │
                  │                                                          │
                  │  Per-namespace: NetworkPolicy · ResourceQuota ·          │
                  │                 LimitRange · Secrets · PVCs              │
                  └──────────────────────────────────────────────────────────┘
```

The platform has three layers:

| Layer | Purpose | Technology |
|-------|---------|-----------|
| **User-facing** | Admin dashboard + customer-facing storefront | React Dashboard (shadcn/ui), MedusaJS Storefront SPA (Tailwind) |
| **Control plane** | Manages store lifecycle, auth, audit, metrics | Express + PostgreSQL + Helm CLI + kubectl |
| **Data plane** | Runs the actual e-commerce stores | Kubernetes namespaces with engine-specific pods, databases, and ingress |

The control plane never directly handles e-commerce traffic. It uses `helm install/uninstall` and `kubectl exec` to manage stores, keeping concerns cleanly separated.

The MedusaJS Storefront SPA (`storefront-medusa/`) is a fully decoupled React application that communicates directly with a Medusa backend's Store API v1. It can be deployed standalone (for development) or as an optional nginx pod within the store's namespace (for production, via `storefront.enabled=true` in Helm values).

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

## Concurrency Controls

The platform enforces concurrency limits at two layers to prevent resource exhaustion and race conditions.

### Global Provisioning Semaphore

A `Semaphore` class (`utils/semaphore.js`) limits the total number of parallel Helm install/uninstall operations:

```
                    ┌─────────────────────┐
                    │  Provision Request  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
          ┌────────│  Semaphore.acquire() │────────┐
          │ Full   │  maxConcurrent = 3   │ OK     │
          │        │  maxQueue = 10       │        │
          │        │  timeout = 120s      │        │
          │        └──────────────────────┘        │
          ▼                                        ▼
  ┌───────────────┐                    ┌───────────────────┐
  │  503 Rejected │                    │  Proceed with     │
  │  Store→FAILED │                    │  Helm operation   │
  └───────────────┘                    └───────────────────┘
```

**Design decisions:**
- `maxConcurrent=3` (configurable via `PROVISIONING_MAX_CONCURRENT`) — chosen because Helm operations are CPU-heavy and I/O-bound; 3 parallel installs saturate a typical single-node cluster
- `maxQueue=10` (configurable via `PROVISIONING_MAX_QUEUE`) — queued requests wait for a slot; excess requests are rejected immediately with 503 to provide backpressure
- `acquireTimeout=120s` (configurable via `PROVISIONING_QUEUE_TIMEOUT_MS`) — prevents indefinite waiting
- The `drain()` method rejects all queued waiters during graceful shutdown

### Per-Store Operation Guard

An `activeOperations` Map in the provisioner prevents concurrent operations on the same store (e.g., two users triggering provision + delete simultaneously). If a store ID is already in the map, the second operation is rejected.

### Optimistic Locking (Database Level)

All state transitions use `WHERE status = $expectedStatus` in the UPDATE query. If another process changed the store's status concurrently, the UPDATE returns 0 rows and the operation is rejected with a `ConflictError`. This is the final safety net against race conditions.

### Metrics

Concurrency is fully observable via four Prometheus metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `provisioning_concurrent_operations` | Gauge | Current active Helm operations |
| `provisioning_queue_depth` | Gauge | Requests waiting for a semaphore slot |
| `provisioning_queue_wait_ms` | Histogram | Time spent waiting in the queue |
| `provisioning_rejections_total` | Counter | Rejections by reason (`queue_full`, `queue_timeout`) |

---

## Security Posture

Security is enforced at every layer — API, application, infrastructure, and network.

### Authentication & Authorization

| Layer | Mechanism |
|-------|-----------|
| **Identity** | JWT tokens signed with `HS256` (`JWT_SECRET`). Stateless — any replica can verify. |
| **Role model** | Two roles: `admin` (all stores, audit logs, metrics) and `tenant` (own stores only). |
| **Middleware chain** | `authenticateToken` → verify signature → lookup user → check `isActive` → attach `req.user`. |
| **Authorization** | `requireRole('admin')` on sensitive routes. All store queries filter by `WHERE owner_id = $jwt_user_id`. |

### Brute-Force Protection

| Guard | Configuration | Scope |
|-------|--------------|-------|
| **Login rate limiter** | 10 attempts per 15-min window | Keyed by `IP:email` |
| **Account lockout** | 5 consecutive failures → 15-min lockout (HTTP 423) | Per email address |
| **Registration limiter** | 5 registrations per 1 hour | Per IP address |
| **Store creation cooldown** | 30s between creations per user (admin bypasses) | Per user ID |
| **Store limit** | Max 5 active stores per user | Per user ID |

All security events are recorded in the audit trail and increment `security_events_total`.

### Input Validation

- Request bodies validated with Joi schemas (`middleware/validators.js`)
- Store names validated against a 35+ word profanity filter
- Payloads capped at 256KB (`express.json({ limit: '256kb' })`)
- Request timeout: 30s default, 10min for provisioning routes
- Engine validation: only `woocommerce` and `medusa` are accepted

### Infrastructure Security

| Layer | Mechanism |
|-------|-----------|
| **Namespace isolation** | Each store in its own K8s namespace — hard resource boundary |
| **NetworkPolicy** | Default-deny ingress; allow only from ingress controller on 80/443; egress blocks private IP ranges (prevents cross-tenant traffic via internal IPs) |
| **ResourceQuota** | Per-namespace CPU (2 cores), memory (2Gi), storage (10Gi), pod (10), PVC (5) caps |
| **LimitRange** | Per-container defaults (250m/256Mi), min (10m/16Mi), max (1 CPU/1Gi) — prevents noisy-neighbor over-allocation |
| **Kubernetes Secrets** | DB passwords, admin credentials, JWT secrets stored as K8s Secrets (base64-encoded, not plaintext in manifests) |
| **RBAC** | Optional ServiceAccount + least-privilege ClusterRole per store namespace |
| **Helm log redaction** | `--set` args containing `password`, `secret` are redacted before debug logging |

### HTTP Security Headers

Applied globally via Helmet middleware:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` |

### Secrets Strategy

Secrets are managed at three levels:

1. **Control plane** (`.env`): `JWT_SECRET`, `DATABASE_URL`. The env validator hard-fails in production/staging if `JWT_SECRET` is the default placeholder value.
2. **Per-store** (Helm Secrets): MariaDB root/user passwords, WordPress admin password, Medusa JWT/cookie secrets, PostgreSQL password. Generated via `randAlphaNum` in templates or overridable via `--set`.
3. **Infrastructure**: `KUBECONFIG` (file permissions `600`), TLS certs (cert-manager), Docker registry creds (`imagePullSecrets`).

---

## Observability & Monitoring

### Structured Logging

All logs use Winston with JSON format. Every store lifecycle event includes:

```json
{
  "level": "info",
  "message": "[lifecycle] Step completed: helm_install",
  "storeId": "store-abc12345",
  "engine": "medusa",
  "phase": "helm_install",
  "correlationId": "req-f7e2b3c4",
  "durationMs": 8234
}
```

- `correlationId` — the HTTP `requestId` that triggered the operation, propagated through all async provisioning steps
- `durationMs` — per-step execution time for performance analysis
- `phase` — one of: `namespace_create`, `helm_install`, `pod_readiness`, `engine_setup`, `url_extraction`, `finalize`

### Prometheus Metrics

A custom Prometheus-compatible collector (no external dependencies) exposes 13 metrics at `GET /api/v1/metrics`:

| Category | Metrics |
|----------|---------|
| **HTTP** | `http_requests_total` (counter), `http_request_duration_ms` (histogram) |
| **Stores** | `stores_total` (gauge by status), `store_provisioning_duration_ms` (histogram) |
| **Provisioning** | `active_provisioning_operations`, `store_provisioning_step_duration_ms`, `store_provisioning_failures_total` |
| **Concurrency** | `provisioning_concurrent_operations`, `provisioning_queue_depth`, `provisioning_queue_wait_ms`, `provisioning_rejections_total` |
| **Security** | `security_events_total` (by event type) |
| **System** | `process_uptime_seconds` |

### Health Probes

Three endpoints designed for Kubernetes integration:

| Endpoint | Purpose | Checks | Failure Response |
|----------|---------|--------|------------------|
| `GET /health` | Comprehensive status | DB connectivity + latency, K8s connectivity + latency, concurrency stats | 503 `degraded` |
| `GET /health/live` | Liveness probe | None (always 200 if process alive) | — |
| `GET /health/ready` | Readiness probe | DB connectivity, shutdown state | 503 during graceful shutdown |

The `/health/ready` endpoint returns `503` when `process.exitCode` is set (SIGTERM received), allowing load balancers to drain connections before the process exits.

### Audit Trail

Every store lifecycle event and security event is persisted to the `audit_logs` PostgreSQL table:

| Field | Description |
|-------|-------------|
| `store_id` | Store affected (null for auth events) |
| `event` | Event type (`store_created`, `login_success`, `login_failed`, `account_locked`, etc.) |
| `details` | JSON payload with event-specific data |
| `created_at` | Timestamp |

The audit log is queryable via `GET /api/v1/audit/logs` (admin) and `GET /api/v1/stores/:id/logs` (owner).

---

## Scaling Model

### Current Architecture (Single Instance)

The platform is designed for single-instance operation, sufficient for tens to low hundreds of stores:

```
┌──────────┐     ┌──────────┐     ┌──────────────────────┐
│ Frontend │────▶│ Backend  │────▶│ Kubernetes Cluster   │
│ (SPA)    │     │ (Express)│     │ (Docker Desktop/k3s) │
└──────────┘     └────┬─────┘     └──────────────────────┘
                      │
                 ┌────▼─────┐
                 │PostgreSQL│
                 └──────────┘
```

- **Stateless JWT** — any replica can validate tokens; no session store
- **In-memory state** — rate limits, lockouts, cooldowns, and the provisioning semaphore live in-process
- **Single Helm CLI** — one `helm install/uninstall` at a time per slot

### Horizontal Scaling Path

For multi-instance deployment:

| Component | Current (In-Memory) | Scaled (Distributed) |
|-----------|--------------------|--------------------|
| Rate limiting | `express-rate-limit` | Redis store (`rate-limit-redis`) |
| Account lockout | `Map` | Redis or DB table |
| Creation cooldown | `Map` | Redis key with TTL |
| Provisioning semaphore | `Semaphore` class | PostgreSQL advisory locks + leader election |
| Stuck-store recovery | Runs on every startup | K8s Lease or DB-based leader election |

The optimistic locking on state transitions already works across multiple instances — only one UPDATE will succeed when two instances race.

### Kubernetes as the Scaling Boundary

Provisioned stores scale independently from the control plane. Each store runs in its own namespace with ResourceQuota — adding more stores means adding cluster nodes, not backend instances. The control plane only orchestrates; it does not handle e-commerce traffic.

---

## Production Environment Differences

Moving from Docker Desktop to a real VPS or cloud environment requires changes across six areas.

### 1. DNS — Wildcard Domain

| Item | Local | Production |
|------|-------|-----------|
| Domain | `*.localhost` (resolved by browser) | `*.yourdomain.com` (real DNS) |
| DNS record | None needed | Wildcard A record: `*.yourdomain.com → <VPS_IP>` |
| Env var | `STORE_DOMAIN_SUFFIX=.localhost` | `STORE_DOMAIN_SUFFIX=.yourdomain.com` |

### 2. Ingress Controller & TLS

| Item | Local | Production |
|------|-------|-----------|
| Ingress | NGINX Ingress (Docker Desktop) | Traefik (bundled with k3s) || Ingress access | Auto port-forward on port 8080 (`AUTO_PORT_FORWARD=true`) | Direct LoadBalancer on port 80/443 (`AUTO_PORT_FORWARD=false`, `INGRESS_PORT=80`) || TLS | None (HTTP) | cert-manager + Let's Encrypt (`letsencrypt-prod` ClusterIssuer) |
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
| **T9** | Auto port-forward for local ingress | Docker Desktop's WSL2 networking prevents the NGINX Ingress controller's LoadBalancer from binding to port 80. The backend auto-starts a `kubectl port-forward` on a configurable port (default 8080) and generates store URLs with the port included. This is a local-dev workaround — production deployments with real DNS and a cloud LoadBalancer set `INGRESS_PORT=80` and `AUTO_PORT_FORWARD=false`. |

---

## Summary

The platform prioritizes **operational simplicity** and **correctness** over premature scalability:

- **Isolation**: One namespace per store provides hard security boundaries via NetworkPolicy, ResourceQuota, and LimitRange
- **Correctness**: A strict state machine with optimistic locking prevents corruption from concurrent operations
- **Resilience**: Fire-and-forget provisioning with stuck-store recovery handles crash scenarios; circuit breakers prevent cascading failures
- **Concurrency**: A two-layer semaphore + per-store guard limits parallel operations with full observability via Prometheus metrics
- **Security**: JWT auth, brute-force protection, input validation, and infrastructure-level network isolation
- **Observability**: Structured logging with correlation IDs, 13 Prometheus metrics, three health probe endpoints, and a persistent audit trail
- **Auditability**: Every lifecycle event and security event is recorded with timestamps and details

For production deployment, the main investments are: managed PostgreSQL, wildcard DNS + TLS (cert-manager), proper secrets management, and Redis for distributed rate limiting. The architecture scales comfortably to hundreds of stores on a single cluster without structural changes.
