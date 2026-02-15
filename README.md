# Multi-Tenant E-commerce Provisioning Platform

A Kubernetes-native platform for provisioning and managing isolated e-commerce stores on demand. Supports **WooCommerce** (WordPress + MariaDB) and **MedusaJS** (Node.js + PostgreSQL) engines.

## Features

- **Multi-engine support**: WooCommerce and MedusaJS
- **Namespace-per-store isolation**: Each store runs in its own Kubernetes namespace
- **Automated provisioning**: Helm-based deployment with engine-conditional rendering
- **Lifecycle management**: State machine for store lifecycle (requested → provisioning → ready → failed/deleted)
- **Tenant isolation**: JWT-based authentication with role-based access control (admin/tenant)
- **Audit logging**: Full event history for every store
- **Automated setup**: Post-provisioning configuration via kubectl exec (WP-CLI for WooCommerce, Medusa CLI for MedusaJS)
- **WooCommerce storefront**: Theme selection (Astra / Storefront), seeded products, Cash-on-Delivery checkout, end-to-end order flow
- **MedusaJS storefront SPA**: Standalone React + Vite + Tailwind CSS storefront consuming Medusa Store API v1 — hero, product catalog, cart drawer, 3-step checkout, order confirmation
- **Per-tenant branding**: Storefronts are configurable per tenant via environment variables (`VITE_STORE_NAME`, `VITE_MEDUSA_BACKEND_URL`)

## System Design & Tradeoffs

See **[SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)** for a detailed write-up covering:

- Architecture choices and rationale (why Express + Helm + namespace-per-store)
- Idempotency, failure handling, and cleanup strategies
- State machine design with optimistic locking
- Circuit breaker and retry-with-backoff patterns
- Production changes required (DNS, TLS, storage, secrets, monitoring)
- Known tradeoffs and accepted limitations

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          User-Facing Layer                             │
│                                                                        │
│   ┌────────────────────────┐     ┌──────────────────────────────────┐  │
│   │   React Dashboard      │     │   MedusaJS Storefront SPA       │  │
│   │   (frontend/)           │     │   (storefront-medusa/)           │  │
│   │                         │     │                                  │  │
│   │  Store CRUD, audit logs │     │  Hero, products, cart drawer,   │  │
│   │  user auth, monitoring  │     │  3-step checkout, order confirm │  │
│   │  :5173                  │     │  React 18 · Tailwind · Vite     │  │
│   └───────────┬─────────────┘     │  :3000 (dev) / nginx (prod)     │  │
│               │                    └──────────┬───────────────────────┘  │
│               │ REST API (JWT)                │ Medusa Store API v1     │
└───────────────┼───────────────────────────────┼──────────────────────────┘
                │                               │
┌───────────────▼───────────────────────────────┼──────────────────────────┐
│            Node.js Control Plane (Backend)    │                          │
│            Express · PostgreSQL · Helm CLI    │                          │
│   ┌──────────────────────────────────────┐    │                          │
│   │ Provisioner · Helm · K8s · Setup    │    │                          │
│   │ State Machine · Audit · Guardrails  │    │                          │
│   │ Circuit Breaker · Retry · Metrics   │    │                          │
│   └──────────────────────────────────────┘    │                          │
│            :3001                              │                          │
└───────────────┬───────────────────────────────┼──────────────────────────┘
                │ kubectl / helm CLI            │
┌───────────────▼───────────────────────────────▼──────────────────────────┐
│                        Kubernetes Cluster                                │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────┐       │
│   │ Namespace: store-abc12345 (WooCommerce)                      │       │
│   │                                                              │       │
│   │  ┌──────────────────┐  ┌────────────────────┐                │       │
│   │  │  WordPress Pod   │  │  MariaDB           │                │       │
│   │  │  WP 6.7 + PHP8.2 │  │  StatefulSet + PVC │                │       │
│   │  │  WooCommerce 9.5 │  │  MariaDB 11.4      │                │       │
│   │  │  Theme: Astra /  │  └────────────────────┘                │       │
│   │  │   Storefront     │                                        │       │
│   │  │  Products + COD  │  Ingress: store-abc12345.localhost     │       │
│   │  └──────────────────┘                                        │       │
│   └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────┐       │
│   │ Namespace: store-xyz98765 (MedusaJS)                         │       │
│   │                                                              │       │
│   │  ┌──────────────────┐  ┌────────────────────┐                │       │
│   │  │  Medusa Pod      │  │  PostgreSQL        │                │       │
│   │  │  v1.20 + Node.js │  │  StatefulSet + PVC │                │       │
│   │  │  Store API v1    │  │  PG 16 Alpine      │                │       │
│   │  └──────────────────┘  └────────────────────┘                │       │
│   │                                                              │       │
│   │  ┌──────────────────┐  Ingress: store-xyz98765.localhost     │       │
│   │  │  Storefront Pod  │  (opt-in, storefront.enabled=true)     │       │
│   │  │  nginx + SPA     │                                        │       │
│   │  └──────────────────┘                                        │       │
│   └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
│   Per-namespace: NetworkPolicy · ResourceQuota · LimitRange              │
└──────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Dashboard (frontend/)** | React 18, Vite, TailwindCSS, React Query, Axios, shadcn/ui |
| **MedusaJS Storefront (storefront-medusa/)** | React 18, Vite, Tailwind CSS, React Router v6, TanStack Query, Lucide icons |
| **Backend** | Node.js 20, Express, PostgreSQL 16, Joi, JWT, Winston, Prometheus metrics |
| **Infrastructure** | Kubernetes, Helm 3, Docker, Nginx Ingress (local) / Traefik (k3s) |
| **WooCommerce Engine** | WordPress 6.7 + PHP 8.2, WooCommerce 9.5.2, MariaDB 11.4, WP-CLI 2.11 |
| **MedusaJS Engine** | Medusa v1.20, Node.js, PostgreSQL 16 Alpine |
| **Testing** | Jest (unit + integration), service containers |
| **CI/CD** | GitHub Actions (lint, test, Helm validation, Docker build) |

## Project Structure

```
.
├── SYSTEM_DESIGN.md           # Architecture decisions & tradeoffs
├── docker-compose.dev.yml     # Local PostgreSQL for development
├── backend/                   # Node.js control plane
│   ├── src/
│   │   ├── controllers/       # HTTP route handlers (auth, stores)
│   │   ├── services/          # Business logic
│   │   │   ├── provisionerService.js   # Store lifecycle orchestrator
│   │   │   ├── helmService.js          # Helm CLI wrapper
│   │   │   ├── kubernetesService.js    # K8s namespace/pod management
│   │   │   ├── storeSetupService.js    # WP-CLI / Medusa post-install setup
│   │   │   ├── ingressService.js       # Auto port-forward & hosts file management
│   │   │   ├── auditService.js         # Event audit trail
│   │   │   └── storeRegistry.js        # PostgreSQL store CRUD
│   │   ├── middleware/        # Auth, validation, error handling, rate limiting
│   │   ├── models/            # Store state machine (storeMachine.js)
│   │   ├── db/                # PostgreSQL pool, migrations, seed
│   │   └── utils/             # Logger, circuit breaker, retry, semaphore, metrics, errors
│   ├── tests/                 # Unit + integration tests (Jest)
│   ├── Dockerfile
│   └── package.json
├── frontend/                  # React admin dashboard (port 5173)
│   ├── src/
│   │   ├── pages/             # CreateStore, StoreList, StoreDetail, Login, etc.
│   │   ├── components/ui/     # UI components (shadcn/ui)
│   │   ├── context/           # AuthContext (JWT)
│   │   ├── layouts/           # AuthLayout, DashboardLayout
│   │   └── services/          # API client (axios)
│   ├── Dockerfile
│   └── package.json
├── storefront-medusa/         # MedusaJS storefront SPA (port 3000)
│   ├── src/
│   │   ├── api/               # Medusa Store API v1 client (pure fetch)
│   │   ├── components/
│   │   │   ├── layout/        # Navbar, Footer, CartDrawer, StoreLayout
│   │   │   ├── home/          # Hero, FeaturedProducts, CategoryGrid, PromoBar
│   │   │   └── products/      # ProductCard, ProductGrid, ProductFilter
│   │   ├── context/           # CartContext (localStorage), StoreContext
│   │   ├── pages/             # Home, Products, ProductDetail, Checkout,
│   │   │                      #   OrderConfirmation, Collections
│   │   └── lib/               # Utility helpers (formatPrice, cn, etc.)
│   ├── Dockerfile             # Multi-stage (node build → nginx serve)
│   └── package.json
├── docker/
│   └── medusa/                # Custom Medusa backend Docker image
├── helm/
│   └── ecommerce-store/       # Unified Helm chart
│       ├── templates/
│       │   ├── woocommerce/   # WordPress Deployment, MariaDB StatefulSet, Ingress
│       │   ├── medusa/        # Medusa Deployment, PostgreSQL StatefulSet,
│       │   │                  #   Storefront Deployment/Service (opt-in), Ingress
│       │   ├── network-policy.yaml
│       │   ├── resource-quota.yaml
│       │   └── limit-range.yaml
│       ├── values.yaml        # Defaults
│       ├── values-local.yaml  # Docker Desktop overrides
│       └── values-vps.yaml    # K3s production overrides
├── scripts/
│   ├── verify-deployment.sh   # Deployment verification checklist
│   └── helm-upgrade.sh        # Helm upgrade/rollback helper
└── .github/
    └── workflows/
        └── ci.yml             # GitHub Actions CI pipeline
```

## Getting Started

### Prerequisites

- **Docker Desktop** (with Kubernetes enabled) or **k3s/k3d**
- **kubectl** (v1.28+)
- **Helm** (v3.16+)
- **Node.js** (v20+)
- **PostgreSQL** (v16+ for the control plane)

### Local Development Setup

#### 0. Start PostgreSQL

```bash
# From the project root — starts PostgreSQL 16 on port 5433
docker compose -f docker-compose.dev.yml up -d
```

#### 1. Start the Backend (Control Plane)

```bash
cd backend
npm install

# Copy the example env file and adjust if needed
cp .env.example .env
# Default .env.example already contains the correct DATABASE_URL:
#   DATABASE_URL=postgresql://mtec:mtec_secret@localhost:5433/mtec_control_plane

# Run database migrations
npm run db:migrate

# Seed the admin user (admin@example.com / admin123!)
npm run db:seed

# Start the backend
npm run dev          # Runs on http://localhost:3001
```

#### 2. Start the Frontend

```bash
cd frontend
npm install
npm run dev          # Runs on http://localhost:5173
```

> The Vite dev server proxies `/api` requests to the backend automatically.

#### 3. Enable Kubernetes (Required for Provisioning)

Open Docker Desktop → **Settings → Kubernetes → Enable Kubernetes** and wait for the cluster to start. Then install NGINX Ingress:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
```

#### 4. Create a Store

1. Open `http://localhost:5173` and **register** a new account (the first user becomes admin)
2. Click **"Create Store"**
3. Choose an engine (**WooCommerce** or **MedusaJS**)
4. Enter a store name and submit
5. The dashboard shows provisioning progress in real time
6. Once the status reaches **ready**, click the store to see its details and URLs

#### 5. Place a Test Order (WooCommerce)

After the store reaches **ready** status the automated setup has already installed WooCommerce, the Storefront theme, configured Cash-on-Delivery (COD) payment, and created a **Sample Product ($19.99)**.

1. Open the store URL shown on the dashboard (e.g. `http://store-<id>.localhost:8080`)
2. Browse the shop — you will see the "Sample Product"
3. Click **Add to Cart → View Cart → Proceed to Checkout**
4. Fill in billing details (any dummy data) and choose **Cash on Delivery**
5. Click **Place Order** — you will see an order confirmation with an order number
6. To verify in the admin panel, visit `http://store-<id>.localhost:8080/wp-admin` and go to **WooCommerce → Orders**

> **MedusaJS stores**: The admin panel is available at port 9000 (`/app`). Use the admin credentials shown in the store detail page to log in, create products, and manage orders through the Medusa admin UI.
>
> **MedusaJS Storefront SPA**: A standalone React storefront is available in `storefront-medusa/`. It consumes the Medusa Store API v1 and can be deployed alongside any Medusa store. See the [Storefront section](#medusajs-storefront-spa) below for details.

#### 6. Delete a Store

1. Navigate to the store detail page on the dashboard
2. Click **"Delete Store"** and confirm
3. The platform tears down the Kubernetes namespace, Helm release, and all associated resources

## CI/CD Pipeline

The project includes a GitHub Actions CI pipeline that automatically validates code quality on every push and pull request.

### Pipeline Jobs

| Job | Purpose | Steps |
|-----|---------|-------|
| **Backend** | Lint + Test | Install deps → ESLint → Unit tests → Integration tests (with PostgreSQL service container) |
| **Frontend** | Lint + Build | Install deps → ESLint → Vite build |
| **Helm** | Chart Validation | Lint chart → Template rendering for both engines (WooCommerce + MedusaJS) |
| **Docker** | Build Validation | Build backend and frontend Docker images (no push) |

### Workflow File

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

### Running CI Checks Locally

```bash
# Backend
cd backend
npm ci
npm run lint
npm run test:unit
npm run test:integration  # Requires PostgreSQL running

# Frontend
cd frontend
npm ci
npm run lint
npm run build

# Helm
helm lint helm/ecommerce-store
helm template test-woo helm/ecommerce-store --set engine=woocommerce --set storeId=test-woo
helm template test-medusa helm/ecommerce-store --set engine=medusa --set storeId=test-medusa

# Docker
docker build -t backend:local ./backend
docker build -t frontend:local ./frontend
```

## Testing

```bash
# Backend unit tests
cd backend
npm run test:unit

# Backend integration tests (requires PostgreSQL)
npm run test:integration

# Run all tests
npm test
```

## Deployment

### Docker Desktop (Local)

```bash
# Enable Kubernetes in Docker Desktop → Settings → Kubernetes
# Install NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml

# The backend auto-starts a kubectl port-forward on port 8080 (configurable via INGRESS_PORT)
# Stores will be accessible at http://store-<id>.localhost:8080
# The backend uses values-local.yaml automatically (HELM_VALUES_FILE=values-local.yaml)
```

> **Docker Desktop Note**: On Docker Desktop, the NGINX Ingress controller's LoadBalancer cannot bind to port 80 due to WSL2 networking. The backend automatically manages a `kubectl port-forward` to the ingress controller on port 8080 (configurable via `INGRESS_PORT`). All store URLs include the port automatically. This is handled transparently — no manual steps required.

### K3s (VPS / Production)

```bash
# 1. Install k3s (comes with Traefik ingress & local-path storage)
curl -sfL https://get.k3s.io | sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 2. Install cert-manager for automatic TLS certificates
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# 3. Create a ClusterIssuer for Let's Encrypt
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: you@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: traefik
EOF

# 4. Clone the repo and install backend dependencies
git clone https://github.com/abhimh33/Multi-Tenant_Ecommerce_Store.git
cd Multi-Tenant_Ecommerce_Store/backend
npm ci --production

# 5. Install PostgreSQL (or use a managed service)
sudo apt-get install -y postgresql-16
sudo -u postgres createuser mtec --pwprompt
sudo -u postgres createdb mtec_control_plane --owner=mtec

# 6. Configure the backend
cat > .env << 'EOF'
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://mtec:<password>@localhost:5432/mtec_control_plane
JWT_SECRET=<generate-a-strong-random-secret>
KUBECONFIG=/etc/rancher/k3s/k3s.yaml
HELM_CHART_PATH=../helm/ecommerce-store
HELM_VALUES_FILE=values-vps.yaml
STORE_DOMAIN_SUFFIX=.yourdomain.com
MAX_STORES_PER_USER=5
LOG_LEVEL=info
EOF

# 7. Run migrations and seed the admin user
npm run db:migrate
npm run db:seed

# 8. Start the backend with a process manager
npm install -g pm2
pm2 start src/index.js --name mtec-backend
pm2 save && pm2 startup

# 9. Build and serve the frontend (behind Nginx)
cd ../frontend
npm ci && npm run build
# Copy dist/ to /var/www/mtec-frontend and configure Nginx to serve it
# with a reverse proxy for /api → http://localhost:3001

# 10. Update values-vps.yaml with your domain
#  ingress.hostSuffix: ".yourdomain.com"
#  medusa.image.repository: registry.yourdomain.com/medusa-backend
```

> **DNS**: Create a wildcard DNS record `*.yourdomain.com → <VPS_IP>` so that all store subdomains resolve correctly.

## Environment Variables

### Backend

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | (required) |
| `JWT_SECRET` | Secret for JWT token signing | (required in production) |
| `PORT` | Backend server port | `3001` |
| `NODE_ENV` | Environment (`development`/`production`/`test`) | `development` |
| `KUBECONFIG` | Path to kubeconfig file | `~/.kube/config` |
| `HELM_CHART_PATH` | Relative path to Helm chart | `../helm/ecommerce-store` |
| `HELM_VALUES_FILE` | Helm values file to use | `values-local.yaml` |
| `HELM_BIN` | Full path to Helm binary | `helm` (on PATH) |
| `STORE_DOMAIN_SUFFIX` | Store URL suffix | `.localhost` |
| `INGRESS_PORT` | Port for store ingress access (auto port-forward) | `80` |
| `AUTO_PORT_FORWARD` | Auto-start kubectl port-forward on startup | `false` |
| `AUTO_HOSTS_FILE` | Auto-manage /etc/hosts entries for stores | `true` |
| `MAX_STORES_PER_USER` | Max active stores per tenant | `5` |
| `STORE_CREATION_COOLDOWN_MS` | Cooldown between store creations (ms) | `30000` |
| `PROVISIONING_TIMEOUT_MS` | Max provisioning wait time (ms) | `600000` |
| `PROVISIONING_MAX_CONCURRENT` | Max parallel Helm operations | `3` |
| `PROVISIONING_MAX_QUEUE` | Max pending operations before rejection | `10` |
| `PROVISIONING_QUEUE_TIMEOUT_MS` | Max queue wait time (ms) | `120000` |
| `LOG_LEVEL` | Winston log level | `debug` |

### Frontend

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:3001` |

## API Documentation

### Authentication

All store management endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/register` | Register a new user (first user is admin) |
| `POST` | `/api/v1/auth/login` | Login and receive JWT token |
| `GET` | `/api/v1/auth/me` | Get current user profile |
| `POST` | `/api/v1/stores` | Create a new store |
| `GET` | `/api/v1/stores` | List stores (tenant-isolated) |
| `GET` | `/api/v1/stores/:id` | Get store details |
| `DELETE` | `/api/v1/stores/:id` | Delete a store |
| `POST` | `/api/v1/stores/:id/retry` | Retry failed provisioning |
| `GET` | `/api/v1/stores/:id/logs` | Get store audit logs |
| `GET` | `/api/v1/audit/logs` | Get all audit logs (admin only) |
| `GET` | `/api/v1/health` | Health check (DB + K8s + concurrency stats) |
| `GET` | `/api/v1/health/live` | Liveness probe (always 200 if process alive) |
| `GET` | `/api/v1/health/ready` | Readiness probe (503 during shutdown) |
| `GET` | `/api/v1/metrics` | Prometheus metrics |
| `GET` | `/api/v1/metrics/json` | Metrics in JSON format |

## Tenant Isolation Model

Every API request is scoped to the authenticated user's JWT. Tenant isolation is enforced at multiple levels:

| Layer | Mechanism |
|-------|-----------|
| **API** | All store queries include `WHERE owner_id = $jwt_user_id`; cross-tenant requests return **403 Forbidden** |
| **Kubernetes** | Each store is deployed into its own namespace (`store-<id>`), with a **NetworkPolicy** blocking cross-namespace traffic |
| **RBAC** | Optional Helm-managed `ServiceAccount` + least-privilege `ClusterRole` for the control plane |
| **Helm** | Engine-conditional templates — WooCommerce and Medusa resources never overlap within a release |
| **Admin override** | Users with `role = admin` can view all stores but never bypass deletion ownership checks |

## Guardrails & Production Hardening

| Guardrail | Description |
|-----------|-------------|
| **State machine** | Strict lifecycle transitions (`requested → provisioning → ready → failed → deleting → deleted`) with invalid-transition rejection |
| **Optimistic locking** | State updates use `expectedStatus` to prevent race conditions on concurrent transitions |
| **Store limit** | Configurable per-user store cap (`MAX_STORES_PER_USER`, default 5); excess requests return 429 |
| **Creation cooldown** | Per-user cooldown between store creations (`STORE_CREATION_COOLDOWN_MS`, default 5 min) |
| **Login rate limiter** | Sliding window rate limit on `/auth/login` to prevent brute-force attacks |
| **Account lockout** | 5 failed login attempts → 15-minute account lockout (HTTP 423) |
| **Security audit trail** | All login attempts, lockouts, rate limits, and registrations logged to audit_logs with IP/email |
| **Profanity filter** | Store name validation rejects 35+ offensive words |
| **Circuit breaker** | Wraps Helm/K8s calls; opens after consecutive failures, auto-recovers after a reset timeout |
| **Retry with backoff** | Failed provisioning steps are retried with exponential backoff and jitter |
| **Request timeout** | 30s default for API requests, 10min for provisioning routes |
| **Payload limits** | Request body capped at 256KB to prevent abuse |
| **Env validation** | All required environment variables are validated on startup via Joi; `JWT_SECRET` hard-fail in production/staging |
| **Prometheus metrics** | `/metrics` endpoint (admin-only) exposes request counts, latency histograms, active provisioning ops, store totals, per-step durations, security events |
| **Graceful shutdown** | SIGTERM/SIGINT handlers drain HTTP connections (15s max), stop provisioning, and close the DB pool |
| **In-flight tracking** | Active request counter; returns 503 during shutdown |
| **Crash recovery** | On startup, stores stuck in `requested`/`provisioning` → `failed` (with duration); `deleting` → resumed |
| **Correlation IDs** | HTTP `requestId` propagated through async provisioning workflow for end-to-end traceability |
| **Per-step timing** | Each provisioning step (namespace, helm, pods, engine setup) is individually timed and logged |
| **Provisioning semaphore** | Global concurrency limit on parallel provisions/deletions (`PROVISIONING_MAX_CONCURRENT=3`); excess requests are queued up to `PROVISIONING_MAX_QUEUE=10`, then rejected with 503 |
| **Queue metrics** | Queue depth, wait time histogram, rejection counter, and concurrent-operation gauge exposed via `/metrics` |
| **Duplicate Helm guard** | Before `helm install`, checks `helm status` — skips install if release is already `deployed` (race condition defense) |
| **ResourceQuota check** | After Helm install, verifies namespace-level ResourceQuota and LimitRange are enforced; logs warning if missing |
| **Deletion cleanup** | Helm release existence verified before uninstall; namespace + PVC removal confirmed via polling loop |
| **Security headers** | Helmet with custom CSP, HSTS with preload, X-Frame-Options DENY, strict Referrer-Policy |
| **CORS** | Multi-origin support with credentials in production |
| **Log redaction** | Helm `--set` args containing passwords/secrets are redacted before debug logging |
| **DB hardening** | 30s query/statement timeouts, connection retry with backoff, pool size limits |

## Store Lifecycle

### Provisioning Workflow

When a user creates a store via `POST /api/v1/stores`, the following sequence executes:

```
  HTTP Request                    Database                  Kubernetes
  ──────────                      ────────                  ──────────
  POST /stores ──────────▶ INSERT store (REQUESTED) ──▶ 202 Accepted
                                    │
                                    ▼ (async)
                           UPDATE → PROVISIONING
                                    │
                                    ├──▶ 1. Create namespace
                                    ├──▶ 2. helm upgrade --install
                                    │      (engine-conditional chart)
                                    ├──▶ 3. Wait for deployment rollout
                                    ├──▶ 4. Wait for pod readiness
                                    ├──▶ 5. Post-install setup
                                    │      WooCommerce: wp core install,
                                    │        WooCommerce activate, theme,
                                    │        product seed, COD payment
                                    │      MedusaJS: medusa user create,
                                    │        seed data, admin dashboard
                                    ├──▶ 6. Extract store URL from Ingress
                                    │
                                    ▼
                           UPDATE → READY (with URL)
```

Each step is wrapped in `retryWithBackoff` (3 attempts, exponential delay + jitter) and the global provisioning semaphore (max 3 concurrent operations).

### Deletion Flow

Deleting a store (`DELETE /api/v1/stores/:id`) removes all Kubernetes resources atomically:

1. Validate ownership (tenant owns the store, or admin)
2. Validate state machine allows deletion (`canDelete()`)
3. Transition to `DELETING` with optimistic lock
4. Acquire semaphore slot
5. `helm uninstall <release> -n <namespace>` — idempotent (succeeds even if release doesn't exist)
6. `kubectl delete namespace <namespace>` — idempotent (succeeds even if namespace doesn't exist)
7. Poll for namespace deletion confirmation
8. Transition to `DELETED`

If any step fails, the store transitions to `FAILED` and can be retried or deleted again.

### Idempotent Provisioning

- **Duplicate store names**: If a store with the same name + owner exists in `FAILED` state, the existing record is reused (retry path). If it's `READY`, a `ConflictError` is returned.
- **Duplicate Helm installs**: Before running `helm install`, the provisioner checks `helm status` — if the release is already `deployed`, the install is skipped (race condition defense).
- **Duplicate deletions**: Both `helm uninstall` and namespace deletion are no-ops on non-existent resources.

### Retry & Recovery

| Scenario | Behavior |
|----------|----------|
| **Step failure during provisioning** | Each step retries 3× with exponential backoff (1s → 2s → 4s + jitter). If all retries fail, store transitions to `FAILED`. |
| **Backend crash during provisioning** | On restart, `recoverStuckStores()` finds stores in `PROVISIONING` → marks `FAILED`. Stores in `REQUESTED` → re-triggers provisioning. Stores in `DELETING` → re-triggers deletion. |
| **User retry** | `POST /stores/:id/retry` transitions `FAILED → REQUESTED → PROVISIONING` and re-runs the full pipeline. |
| **Circuit breaker open** | When Helm/K8s calls fail repeatedly, the circuit breaker opens — all new operations fail immediately without calling the external service. After a timeout, one test request is allowed through. |

### ResourceQuota & LimitRange Enforcement

Every provisioned namespace gets a `ResourceQuota` and `LimitRange` applied by Helm:

**ResourceQuota** (per-namespace caps):

| Resource | Default | Local Override | VPS Override |
|----------|---------|---------------|-------------|
| CPU requests | 1 core | 1 core | 1 core |
| CPU limits | 2 cores | 2 cores | 2 cores |
| Memory requests | 1Gi | 1Gi | 1Gi |
| Memory limits | 2Gi | 2Gi | 2Gi |
| PVCs | 5 | 5 | 5 |
| Storage | 10Gi | 5Gi | 20Gi |
| Pods | 10 | 10 | 10 |
| Services | 5 | 5 | 5 |

**LimitRange** (per-container defaults):

| Setting | Default |
|---------|---------|
| Default CPU | 250m |
| Default Memory | 256Mi |
| Default Request CPU | 50m |
| Default Request Memory | 64Mi |
| Max CPU | 1 core |
| Max Memory | 1Gi |
| Min CPU | 10m |
| Min Memory | 16Mi |
| Min PVC | 100Mi |
| Max PVC | 5Gi |

After `helm install`, the provisioner verifies that both `ResourceQuota` and `LimitRange` exist in the namespace and logs a warning if either is missing.

## Observability

### Structured Logging

All log entries use Winston with structured JSON format. Every store lifecycle event is tagged with:
- `storeId` — unique store identifier (correlation across all events)
- `engine` — `woocommerce` or `medusa`
- `phase` — lifecycle step (`namespace_create`, `helm_install`, `pod_readiness`, `engine_setup`, etc.)
- `correlationId` — HTTP `requestId` that initiated the operation (survives async provisioning)
- `durationMs` — per-step execution time

Example log output:
```json
{"level":"info","message":"[lifecycle] Step completed: helm_install","storeId":"store-abc12345","engine":"medusa","phase":"helm_install","correlationId":"req-f7e2b3c4","durationMs":8234}
```

### Prometheus Metrics

Accessible at `GET /api/v1/metrics` (requires admin JWT):

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | method, route, status_code | Total HTTP requests |
| `http_request_duration_ms` | Histogram | method, route | Request latency distribution |
| `stores_total` | Gauge | status | Current store count by status |
| `store_provisioning_duration_ms` | Histogram | engine | Total provisioning time |
| `store_provisioning_step_duration_ms` | Histogram | engine, step | Per-step provisioning time |
| `store_provisioning_failures_total` | Counter | engine, step | Failures by step |
| `active_provisioning_operations` | Gauge | — | In-flight provisioning count |
| `provisioning_concurrent_operations` | Gauge | — | Current parallel Helm operations |
| `provisioning_queue_depth` | Gauge | — | Operations waiting in semaphore queue |
| `provisioning_queue_wait_ms` | Histogram | — | Time spent waiting in queue |
| `provisioning_rejections_total` | Counter | reason | Rejections: `queue_full`, `queue_timeout` |
| `security_events_total` | Counter | event_type | Login, lockout, rate limit events |
| `process_uptime_seconds` | Gauge | — | Process uptime |

### Security Audit Trail

Security events are logged to the same `audit_logs` table as store lifecycle events, visible in the admin audit log page. Events include:

| Event | Trigger | Fields |
|-------|---------|--------|
| `login_success` | Successful authentication | email, IP, userId |
| `login_failed` | Wrong credentials | email, IP |
| `account_locked` | 5+ consecutive failures | email, lockout duration |
| `login_rate_limited` | Rate limit exceeded | email, IP, retry-after |
| `registration` | New user registered | email, IP, userId, role |
| `registration_rate_limited` | Registration rate limit | IP |

## Horizontal Scaling Strategy

The current architecture is designed for single-instance operation (Docker Desktop / single VPS). Here's the documented path to horizontal scaling:

### Stateless JWT Authentication

The backend uses **stateless JWT tokens** for authentication — no server-side session storage. This means:

- **Any API replica can validate any request** — the JWT signature is verified using a shared `JWT_SECRET` environment variable.
- **No sticky sessions required** — a load balancer can round-robin requests freely across replicas.
- **No session store dependency** — Redis/Memcached is not needed for auth (only for rate limiting in multi-instance mode).
- **Token-based scaling**: Deploy N replicas behind a load balancer; set the same `JWT_SECRET` on all instances.

### API Layer (Stateless)

The Express backend is **nearly stateless** — scale horizontally behind a load balancer with these considerations:

| Component | Current | Scaled |
|-----------|---------|--------|
| **Rate limiting** | In-memory (`express-rate-limit`) | Redis store (`rate-limit-redis`) |
| **Account lockout** | In-memory `Map` | Redis or DB-backed lockout table |
| **Creation cooldown** | In-memory `Map` | Redis key with TTL |
| **Session/JWT** | Stateless JWT | No change needed |
| **Provisioning semaphore** | In-memory `Semaphore` | DB advisory locks + leader election |
| **Health probes** | `/health/live` | Use for load balancer health checks |

### Provisioning Concurrency Control

The provisioning system uses a **two-layer concurrency control**:

1. **Global semaphore** (`Semaphore` class): Limits the total number of parallel Helm installs/deletes to `PROVISIONING_MAX_CONCURRENT` (default: 3). Excess requests are queued (up to `PROVISIONING_MAX_QUEUE=10`) and rejected with 503 when the queue is full.
2. **Per-store guard** (`activeOperations` Map): Prevents concurrent operations on the *same* store (e.g., two provisioning attempts for the same store ID).

```
                    ┌─────────────────────┐
                    │  HTTP Request       │
                    │  POST /stores       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  DB: Create record  │
                    │  (REQUESTED state)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
          ┌────────│  Semaphore.acquire() │────────┐
          │ Full   │  maxConcurrent=3     │ OK     │
          │        │  maxQueue=10         │        │
          │        └──────────────────────┘        │
          ▼                                        ▼
  ┌───────────────┐                    ┌───────────────────┐
  │  503 Rejected │                    │  provisionAsync() │
  │  Store→FAILED │                    │  namespace → helm │
  └───────────────┘                    │  → pods → setup   │
                                       │  → READY          │
                                       └───────────────────┘
```

**Environment variables**:
| Variable | Default | Description |
|----------|---------|-------------|
| `PROVISIONING_MAX_CONCURRENT` | 3 | Max parallel Helm operations |
| `PROVISIONING_MAX_QUEUE` | 10 | Max pending operations before rejection |
| `PROVISIONING_QUEUE_TIMEOUT_MS` | 120000 | Max queue wait time (2 min) |

For multi-instance scaling:

1. **DB-level locking**: Use PostgreSQL advisory locks (`pg_advisory_xact_lock(store_id_hash)`) before starting provisioning
2. **Optimistic locking** (already implemented): The `expectedStatus` guard ensures only one instance wins the state transition
3. **Leader election**: For `recoverStuckStores()`, use a Kubernetes lease or DB-based leader election to ensure only one instance runs recovery on startup

### Database

- PostgreSQL supports connection pooling via PgBouncer
- All queries use parameterized queries (no SQL injection risk)
- Schema supports Row-Level Security (RLS) as a future enhancement

### Provisioned Stores

Stores are inherently isolated (1 namespace per store). The Kubernetes cluster itself is the scaling boundary — add nodes to support more concurrent stores.

### Recommended Architecture (2+ Instances)

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │  (Nginx/HAProxy)│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Backend 1│  │ Backend 2│  │ Backend 3│
        │ (Express)│  │ (Express)│  │ (Express)│
        └────┬─────┘  └────┬─────┘  └────┬─────┘
             │              │              │
        ┌────▼──────────────▼──────────────▼────┐
        │           Redis (shared state)         │
        │  Rate limits, lockouts, cooldowns     │
        └────────────────┬───────────────────────┘
                         │
        ┌────────────────▼───────────────────────┐
        │        PostgreSQL (primary)            │
        │  Stores, audit logs, users             │
        │  Advisory locks for provisioning       │
        └────────────────────────────────────────┘
```

## Local-to-VPS Deployment Story

The Helm chart uses **values file separation** to support both local development and production VPS deployment without code changes:

| File | Purpose | Key Differences |
|------|---------|-----------------|
| `values.yaml` | Base defaults | Shared configuration — engine, RBAC, resource quota, limit range |
| `values-local.yaml` | Docker Desktop | `imagePullPolicy: Never`, `.localhost` domains, hostpath storage, relaxed limits |
| `values-vps.yaml` | K3s / production | Real domains, Traefik ingress, cert-manager TLS, `local-path` storage, production resources |

### Values File Difference Matrix

Every deviation from the base `values.yaml` is documented here. The backend selects a values file via the `HELM_VALUES_FILE` environment variable — no code changes required.

| Configuration | `values.yaml` (base) | `values-local.yaml` | `values-vps.yaml` | Rationale |
|--------------|----------------------|---------------------|-------------------|-----------|
| **Ingress class** | `nginx` | `nginx` | `traefik` | k3s ships Traefik; Docker Desktop uses nginx-ingress |
| **Host suffix** | `.localhost` | `.localhost` | `.yourdomain.com` | Wildcard DNS required on VPS |
| **TLS** | `false` | `false` | `true` | cert-manager + Let's Encrypt on VPS |
| **TLS annotations** | — | — | `cert-manager.io/cluster-issuer: letsencrypt-prod` | Automatic certificate provisioning |
| **Network policy** | `true` | `false` | `true` | Docker Desktop CNI may not support NetworkPolicy |
| **Storage class** | `""` (default) | `hostpath` | `local-path` | k3s local-path provisioner vs Docker Desktop hostpath |
| **MariaDB memory** | 256Mi limit | 256Mi limit | 512Mi limit | VPS has more RAM for production workloads |
| **WordPress CPU** | 500m limit | 300m limit | 1 CPU limit | Production WooCommerce needs more CPU |
| **WordPress memory** | 512Mi limit | 384Mi limit | 1Gi limit | Production WP + plugins need headroom |
| **MariaDB disk** | 2Gi | 1Gi | 5Gi | Real stores accumulate product/order data |
| **WordPress disk** | 2Gi | 1Gi | 5Gi | Media uploads need more space |
| **Medusa pull policy** | `Never` | `Never` | `IfNotPresent` | local: prebuilt image; VPS: pulled from registry |
| **Medusa image tag** | `local` | `local` | `latest` | VPS uses registry-pushed images |
| **Quota storage** | 10Gi | 5Gi | 20Gi | VPS stores need more persistent storage |

### Environment Profiles

| Profile | `NODE_ENV` | `HELM_VALUES_FILE` | `STORE_DOMAIN_SUFFIX` | Purpose |
|---------|-----------|--------------------|-----------------------|---------|
| **Development** | `development` | `values-local.yaml` | `.localhost` | Local feature development |
| **Test** | `test` | `values-local.yaml` | `.localhost` | Automated testing (Jest) |
| **Staging** | `staging` | `values-vps.yaml` | `.staging.yourdomain.com` | Pre-production validation |
| **Production** | `production` | `values-vps.yaml` | `.yourdomain.com` | Live deployment |

### Secrets Strategy

The platform handles secrets at three levels:

**1. Control Plane Secrets (Backend `.env`)**

| Secret | Local | VPS / Production |
|--------|-------|-----------------|
| `JWT_SECRET` | `dev-jwt-secret-change-in-production` (default) | **Required** — generate with `openssl rand -base64 48` |
| `DATABASE_URL` | `postgresql://mtec:mtec_secret@localhost:5433/...` | Managed PostgreSQL or systemd-protected local PG |
| Validation | Allows default in dev | `envValidator.js` **hard-fails** if JWT_SECRET is the default |

```bash
# Generate production JWT secret
export JWT_SECRET=$(openssl rand -base64 48)
```

**2. Per-Store Secrets (Helm Kubernetes Secrets)**

Each store gets engine-specific Kubernetes Secrets created by Helm templates:

| Secret | Engine | Contains | Template |
|--------|--------|----------|----------|
| `<store>-mariadb-secret` | WooCommerce | `root-password`, `user-password` | `mariadb/secret.yaml` |
| `<store>-wordpress-secret` | WooCommerce | `admin-password`, `admin-email` | `wordpress/secret.yaml` |
| `<store>-medusa-secret` | MedusaJS | `admin-password`, `jwt-secret`, `cookie-secret` | `medusa/secret.yaml` |
| `<store>-medusa-pg-secret` | MedusaJS | `postgres-password` | `medusa/postgresql-secret.yaml` |

**Production hardening**: Override defaults via `--set` flags during `helm install`:

```bash
helm upgrade --install store-abc ./helm/ecommerce-store \
  --namespace store-abc \
  -f ./helm/ecommerce-store/values-vps.yaml \
  --set storeId=store-abc \
  --set engine=woocommerce \
  --set mariadb.rootPassword=$(openssl rand -base64 24) \
  --set mariadb.password=$(openssl rand -base64 24) \
  --set wordpress.admin.password=$(openssl rand -base64 24)
```

**3. Infrastructure Secrets**

| Secret | Where | Management |
|--------|-------|------------|
| KUBECONFIG | Backend host | File permission `600`, path in `.env` |
| TLS certificates | cert-manager Secrets | Automated renewal via Let's Encrypt |
| Docker registry credentials | `imagePullSecrets` | `kubectl create secret docker-registry` |

**Rotation policy**: JWT_SECRET rotation requires all active tokens to be re-issued. Store secrets can be rotated by running `helm upgrade` with new `--set` values — pods will restart and pick up new Secret mounts.

## Upgrade & Rollback Strategy

### Overview

The platform uses Helm 3's built-in revision tracking for safe upgrades and instant rollbacks of provisioned store releases. Every `helm upgrade` creates a new revision; rolling back restores the exact previous state.

### Upgrade Workflow

```
                    ┌─────────────────────────────┐
                    │  1. Pre-flight              │
                    │  helm lint + template render │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  2. Diff Preview (optional)  │
                    │  helm diff upgrade           │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  3. Upgrade                  │
                    │  helm upgrade --install      │
                    │  --atomic --cleanup-on-fail  │
                    │  --wait --timeout 10m        │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  4. Post-upgrade Verify     │
                    │  Pod health, PVC, Ingress   │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │ PASS                            │ FAIL
              ▼                                 ▼
    ┌──────────────┐                  ┌──────────────────┐
    │  Done ✓      │                  │  helm rollback   │
    │  New revision│                  │  Restore prev.   │
    └──────────────┘                  └──────────────────┘
```

### Using the Upgrade Script

A helper script is provided at `scripts/helm-upgrade.sh`:

```bash
# 1. Preview what will change (dry-run)
./scripts/helm-upgrade.sh diff store-abc12345 store-abc12345 values-vps.yaml

# 2. Perform the upgrade (with --atomic: auto-rollback on failure)
./scripts/helm-upgrade.sh upgrade store-abc12345 store-abc12345 values-vps.yaml

# 3. Verify the upgrade succeeded
./scripts/helm-upgrade.sh verify store-abc12345 store-abc12345

# 4. If verification fails, roll back immediately
./scripts/helm-upgrade.sh rollback store-abc12345 store-abc12345

# 5. View revision history
./scripts/helm-upgrade.sh history store-abc12345 store-abc12345
```

### Manual Upgrade Commands

```bash
# Upgrade a WooCommerce store to new resource limits
helm upgrade store-abc12345 ./helm/ecommerce-store \
  --namespace store-abc12345 \
  -f ./helm/ecommerce-store/values-vps.yaml \
  --set engine=woocommerce \
  --set storeId=store-abc12345 \
  --set wordpress.resources.limits.memory=2Gi \
  --atomic \
  --wait \
  --timeout 10m

# Rollback to the previous revision
helm rollback store-abc12345 0 --namespace store-abc12345 --wait

# Rollback to a specific revision
helm rollback store-abc12345 2 --namespace store-abc12345 --wait
```

### Chart Version Bumping

When modifying the Helm chart:

```bash
# 1. Update Chart.yaml version (SemVer)
#    Increment patch (1.0.0 → 1.0.1) for fixes
#    Increment minor (1.0.0 → 1.1.0) for new features
#    Increment major (1.0.0 → 2.0.0) for breaking changes

# 2. Validate the chart
helm lint ./helm/ecommerce-store
helm template test ./helm/ecommerce-store \
  --set engine=woocommerce --set storeId=test \
  -f ./helm/ecommerce-store/values-local.yaml --validate

# 3. Upgrade existing stores to new chart version
for NS in $(kubectl get ns -l mt-ecommerce/store-id -o name | cut -d/ -f2); do
  echo "Upgrading $NS..."
  ./scripts/helm-upgrade.sh upgrade "$NS" "$NS" values-vps.yaml
done
```

### Rollback Verification

After a rollback, confirm these items:

| Check | Command | Expected |
|-------|---------|----------|
| Release status | `helm status <release> -n <ns>` | `STATUS: deployed` |
| Pods healthy | `kubectl get pods -n <ns>` | All `Running` or `Completed` |
| PVCs bound | `kubectl get pvc -n <ns>` | All `Bound` |
| Ingress host | `kubectl get ingress -n <ns>` | Correct hostname |
| Store reachable | `curl -sI http://<store-host>` | HTTP 200 or 301 |
| DB intact | `kubectl exec <db-pod> -n <ns> -- ...` | Tables/data preserved (PVCs survive rollback) |

> **Important**: PersistentVolumeClaims are **not** deleted during rollback. Data in MariaDB and PostgreSQL is preserved across upgrades and rollbacks. Only the Deployment/StatefulSet spec is reverted.

### Upgrade Safety Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| **Atomic upgrades** | `--atomic` flag: if any resource fails to become healthy, Helm auto-rolls back the entire release |
| **Wait for readiness** | `--wait` flag: Helm blocks until all pods are Ready |
| **Cleanup on failure** | `--cleanup-on-fail` flag: removes newly created resources on failed upgrade |
| **Data preservation** | PVCs use `Retain` delete policy by default — data survives release deletion |
| **Revision history** | Helm stores all revisions — roll back to any previous state |
| **Idempotent installs** | `helm upgrade --install` creates if missing, upgrades if exists |

## Deployment Verification Checklist

A verification script is provided at `scripts/verify-deployment.sh`. Run it against any environment:

```bash
# Local development
./scripts/verify-deployment.sh

# VPS / production
./scripts/verify-deployment.sh https://api.yourdomain.com
```

### Manual Checklist

Use this checklist after any deployment or environment change:

| # | Check | Local | VPS | How to Verify |
|---|-------|-------|-----|---------------|
| 1 | Backend health endpoint | ✓ | ✓ | `curl http://<host>/api/v1/health` → 200 |
| 2 | PostgreSQL connected | ✓ | ✓ | Health response: `database.status = "healthy"` |
| 3 | Kubernetes connected | ✓ | ✓ | Health response: `kubernetes.status = "healthy"` |
| 4 | Liveness probe | ✓ | ✓ | `curl http://<host>/api/v1/health/live` → 200 |
| 5 | Readiness probe | ✓ | ✓ | `curl http://<host>/api/v1/health/ready` → 200 |
| 6 | Concurrency stats | ✓ | ✓ | Health response includes `concurrency.maxConcurrent` |
| 7 | JWT auth works | ✓ | ✓ | Login returns token, protected routes accept Bearer |
| 8 | Store creation | ✓ | ✓ | `POST /stores` returns 202, store ID created |
| 9 | Helm install succeeds | ✓ | ✓ | Store transitions to `provisioning` then `ready` |
| 10 | Ingress reachable | ✓ | ✓ | `curl http://store-<id>.<suffix>` returns content |
| 11 | Store deletion | ✓ | ✓ | `DELETE /stores/:id` removes namespace + release |
| 12 | Metrics endpoint | ✓ | ✓ | `GET /metrics` with admin JWT returns Prometheus text |
| 13 | Security headers | ✓ | ✓ | `curl -I` shows HSTS, CSP, X-Frame-Options |
| 14 | Helm chart lints | ✓ | ✓ | `helm lint ./helm/ecommerce-store` passes |
| 15 | Chart templates render | ✓ | ✓ | `helm template` succeeds for both engines |
| 16 | NetworkPolicy applied | — | ✓ | `kubectl get networkpolicy -n store-*` |
| 17 | ResourceQuota enforced | ✓ | ✓ | `kubectl get resourcequota -n store-*` |
| 18 | TLS certificate issued | — | ✓ | `kubectl get certificate -n store-*` |
| 19 | Graceful shutdown | ✓ | ✓ | Send SIGTERM → logs show drain sequence |
| 20 | Crash recovery | ✓ | ✓ | Kill backend during provisioning → restart marks stuck stores failed |

## Operational Notes

### Process Management (VPS)

```bash
# Install and configure pm2
npm install -g pm2

# Start the backend with restart on crash
pm2 start src/index.js --name mtec-backend \
  --max-memory-restart 512M \
  --kill-timeout 20000 \
  --wait-ready \
  --listen-timeout 10000

# Save the process list for auto-start on reboot
pm2 save
pm2 startup   # Generates a systemd service

# View logs
pm2 logs mtec-backend --lines 100

# Zero-downtime restart (if behind a load balancer)
pm2 reload mtec-backend
```

### Nginx Reverse Proxy (VPS Frontend)

```nginx
# /etc/nginx/sites-available/mtec
server {
    listen 80;
    server_name admin.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name admin.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/admin.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.yourdomain.com/privkey.pem;

    # Frontend SPA (React build)
    root /var/www/mtec-frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API reverse proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;  # Long timeout for provisioning
    }
}
```

### Monitoring & Alerting

| Metric | Alert Threshold | Action |
|--------|----------------|--------|
| `http_requests_total{status_code=~"5.."}` | > 10 in 5 min | Investigate backend errors |
| `provisioning_queue_depth` | > 5 sustained | Scale up or increase `PROVISIONING_MAX_CONCURRENT` |
| `provisioning_rejections_total` | Any increase | Queue is saturated — review concurrent load |
| `store_provisioning_duration_ms` | > 300000 (5 min) | Investigate slow Helm installs |
| `process_uptime_seconds` | Resets frequently | Backend crashing — check logs |
| PostgreSQL connections | > 80% of `DB_POOL_MAX` | Increase pool or add PgBouncer |
| Disk usage (VPS host) | > 80% | Clean old PVCs or expand volume |

### Backup & Recovery

```bash
# Backup control plane database
pg_dump -U mtec mtec_control_plane > backup-$(date +%Y%m%d).sql

# Backup a store's MariaDB (WooCommerce)
kubectl exec -n store-abc $(kubectl get pod -n store-abc -l app.kubernetes.io/name=mariadb -o name) \
  -- mysqldump -u root -p$ROOT_PASSWORD wordpress > store-abc-backup.sql

# Backup a store's PostgreSQL (MedusaJS)
kubectl exec -n store-xyz $(kubectl get pod -n store-xyz -l app.kubernetes.io/name=postgresql -o name) \
  -- pg_dump -U medusa medusa > store-xyz-backup.sql

# Restore control plane
psql -U mtec mtec_control_plane < backup-20260215.sql
```

### Log Aggregation (Production)

In production, pipe Winston JSON logs to a centralized log system:

```bash
# pm2 → journald → Promtail/Loki
pm2 start src/index.js --name mtec-backend --log-type json

# Or direct to file for Filebeat/Fluentd ingestion
pm2 start src/index.js --name mtec-backend \
  --output /var/log/mtec/out.log \
  --error /var/log/mtec/err.log \
  --merge-logs
```

## Known Limitations

These items are documented and accepted trade-offs for the current scope:

| ID | Description | Impact |
|----|-------------|--------|
| **L1** | No PostgreSQL Row-Level Security (RLS) | Tenant isolation is enforced at the application layer (all queries filter by `owner_id`). RLS would add defense-in-depth but is not required for the current single-backend architecture. |
| **L2** | Creation cooldown and rate limiter use in-memory `Map`s | Works correctly for a single backend instance. A distributed deployment would need Redis or a DB-backed store. See [Horizontal Scaling Strategy](#horizontal-scaling-strategy) for the migration path. |
| **L3** | Provisioning semaphore is in-process only | The semaphore limits concurrency within a single Node.js process. Multi-instance deployments would need PostgreSQL advisory locks or a distributed semaphore (Redis/etcd). Documented in [Horizontal Scaling Strategy](#horizontal-scaling-strategy). |
| **L4** | No automated VPS integration tests | Deployment verification (`scripts/verify-deployment.sh`) is manual. A CI stage with k3s-in-Docker (k3d) could automate VPS-like testing but is not yet implemented. |

## MedusaJS Storefront SPA

The `storefront-medusa/` directory contains a **standalone React storefront** designed to work with any Medusa v1.x backend. It is fully decoupled from the control plane and communicates exclusively through the Medusa Store API.

### Pages & Components

| Page | Description |
|------|-------------|
| **Home** | Hero section with stats, featured products grid, collection cards, perks banner + newsletter CTA |
| **Products** | Full catalog with text search, collection/category chip filters, sort dropdown, pagination |
| **Product Detail** | Image gallery with thumbnails, variant option selector, quantity picker, add-to-cart animation, trust badges |
| **Checkout** | 3-step flow: contact/address → shipping method → payment review → place order |
| **Order Confirmation** | Order summary with items, totals, shipping address, payment info |
| **Collections** | Browse all available collections with gradient cards |

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Pure fetch API client** (no Medusa SDK) | Zero vendor lock-in; small bundle; works with any Medusa v1.x backend |
| **Cart in localStorage** | Survives page refreshes; cart ID stored as `medusa_cart_id` and rehydrated from Medusa API on load |
| **Context API** (not Redux) | Sufficient for cart + store state; avoids extra dependency |
| **Tailwind + custom design tokens** | `brand` and `surface` color scales, `Inter` + `Plus Jakarta Sans` fonts for easy per-tenant branding |
| **Env-driven branding** | `VITE_STORE_NAME` and `VITE_MEDUSA_BACKEND_URL` make each deployment tenant-specific |

### Running Locally

```bash
cd storefront-medusa
npm install

# Point to a running Medusa backend (default: http://localhost:9000)
cp .env.example .env
# Edit VITE_MEDUSA_BACKEND_URL if needed

npm run dev    # http://localhost:3000
npm run build  # Production build → dist/ (280KB JS + 38KB CSS)
```

### Docker

```bash
docker build \
  --build-arg VITE_MEDUSA_BACKEND_URL=http://medusa:9000 \
  --build-arg VITE_STORE_NAME="My Store" \
  -t storefront-medusa:latest \
  storefront-medusa/
```

The Dockerfile uses a multi-stage build: Node.js for the Vite build, then nginx to serve the SPA with API proxy and proper client-side routing fallback.

### Helm Integration

The storefront can be deployed alongside a Medusa store by enabling it in `values.yaml`:

```yaml
storefront:
  enabled: true
  image:
    repository: storefront-medusa
    tag: latest
  storeName: "My Store"
```

This creates a `Deployment` + `Service` for the storefront pod within the same store namespace. The ingress routing (`/` → storefront, `/store/*` → Medusa API) is a planned enhancement.

## Roadmap

### Gen AI Orchestration (Planned)

The provisioning infrastructure is designed to support **AI-driven store creation**. A Gen AI orchestration layer will allow users to describe their desired store configuration in natural language, and the platform will automatically translate that into provisioning parameters, engine selection, and post-setup customization — eliminating manual input entirely.

The current architecture (state machine, Helm abstraction, multi-engine support, concurrency semaphore) has been designed with this extensibility in mind.

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

The CI pipeline will automatically validate your changes.
