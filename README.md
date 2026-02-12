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

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                React Dashboard (Frontend)           │
│       Store creation, management, audit logs        │
└──────────────────┬──────────────────────────────────┘
                   │ REST API (JWT auth)
┌──────────────────▼──────────────────────────────────┐
│            Node.js Control Plane (Backend)          │
│   Express · PostgreSQL · Kubernetes Client · Helm   │
│   ┌──────────────────────────────────────────────┐  │
│   │ Services: Provisioner · Helm · K8s · Setup  │  │
│   │ State Machine · Audit · Guardrails          │  │
│   └──────────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────────┘
                   │ kubectl / helm CLI
┌──────────────────▼──────────────────────────────────┐
│              Kubernetes Cluster                     │
│   ┌────────────────────────────────────────────┐    │
│   │ Namespace: store-abc12345 (WooCommerce)    │    │
│   │  - WordPress Pod                           │    │
│   │  - MariaDB StatefulSet + PVC               │    │
│   │  - Ingress (store-abc12345.localhost)      │    │
│   └────────────────────────────────────────────┘    │
│   ┌────────────────────────────────────────────┐    │
│   │ Namespace: store-xyz98765 (MedusaJS)       │    │
│   │  - Medusa Pod                              │    │
│   │  - PostgreSQL StatefulSet + PVC            │    │
│   │  - Ingress (store-xyz98765.localhost)      │    │
│   └────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React, Vite, TailwindCSS, React Query, Axios |
| **Backend** | Node.js 20, Express, PostgreSQL, Joi, JWT, Winston |
| **Infrastructure** | Kubernetes, Helm, Docker, Nginx Ingress (local) / Traefik (k3s) |
| **E-commerce Engines** | WordPress + WooCommerce + MariaDB, MedusaJS + PostgreSQL |
| **Testing** | Jest (unit + integration), service containers |

## Project Structure

```
.
├── backend/               # Node.js control plane
│   ├── src/
│   │   ├── controllers/   # HTTP route handlers
│   │   ├── services/      # Business logic (provisioner, helm, k8s, setup, audit)
│   │   ├── middleware/    # Auth, validation, error handling
│   │   ├── db/            # PostgreSQL client, migrations
│   │   └── utils/         # Logger, state machine
│   ├── tests/             # Unit + integration tests
│   ├── Dockerfile
│   └── package.json
├── frontend/              # React dashboard
│   ├── src/
│   │   ├── pages/         # CreateStore, StoreList, StoreDetail, Login, Register
│   │   ├── components/    # UI components (shadcn/ui)
│   │   └── services/      # API client (axios)
│   ├── Dockerfile
│   └── package.json
├── helm/
│   └── ecommerce-store/   # Unified Helm chart
│       ├── templates/
│       │   ├── woocommerce/   # WordPress, MariaDB, Ingress
│       │   └── medusa/        # Medusa, PostgreSQL, Secrets, Ingress
│       ├── values.yaml        # Defaults
│       ├── values-local.yaml  # Docker Desktop overrides
│       └── values-vps.yaml    # K3s production overrides
└── .github/
    └── workflows/
        └── ci.yml         # GitHub Actions CI pipeline
```

## Getting Started

### Prerequisites

- **Docker Desktop** (with Kubernetes enabled) or **k3s/k3d**
- **kubectl** (v1.28+)
- **Helm** (v3.16+)
- **Node.js** (v20+)
- **PostgreSQL** (v16+ for the control plane)

### Local Development Setup

#### 1. Start the Backend (Control Plane)

```bash
cd backend
npm install

# Set up environment variables
cat > .env << EOF
DATABASE_URL=postgres://user:password@localhost:5432/mt_ecommerce
JWT_SECRET=your-secret-key-here
PORT=3001
NODE_ENV=development
EOF

# Run database migrations
npm run db:migrate

# Start the backend
npm run dev
```

#### 2. Start the Frontend

```bash
cd frontend
npm install

# Set API URL (optional, defaults to http://localhost:3001)
echo "VITE_API_URL=http://localhost:3001" > .env

# Start the frontend
npm run dev
```

Visit `http://localhost:5173` and register an admin account.

#### 3. Create a Store

1. Log in to the dashboard
2. Click **"Create Store"**
3. Choose an engine (WooCommerce or MedusaJS)
4. Enter a store name
5. Wait for provisioning to complete
6. Access the store via the provided URLs

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
# Enable Kubernetes in Docker Desktop settings
# Install Nginx Ingress
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml

# The backend will use values-local.yaml automatically for local development
```

### K3s (VPS)

```bash
# Install k3s (comes with Traefik ingress)
curl -sfL https://get.k3s.io | sh -

# Set KUBECONFIG
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# The backend will use values-vps.yaml for VPS deployments
# Configure your domain in values-vps.yaml (ingress.hostSuffix)
```

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
| `MAX_STORES_PER_USER` | Max active stores per tenant | `5` |
| `STORE_CREATION_COOLDOWN_MS` | Cooldown between store creations (ms) | `30000` |
| `PROVISIONING_TIMEOUT_MS` | Max provisioning wait time (ms) | `600000` |
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
| `GET` | `/api/v1/health` | Health check (DB + K8s) |
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
| **Creation cooldown** | Per-user cooldown between store creations (`STORE_CREATION_COOLDOWN_MS`, default 30 s) |
| **Login rate limiter** | Sliding window rate limit on `/auth/login` to prevent brute-force attacks |
| **Circuit breaker** | Wraps Helm/K8s calls; opens after consecutive failures, auto-recovers after a reset timeout |
| **Retry with backoff** | Failed provisioning steps are retried with exponential backoff and jitter |
| **Env validation** | All required environment variables are validated on startup via Joi; missing vars cause a hard abort |
| **Prometheus metrics** | `/metrics` endpoint exposes request counts, latency histograms, active provisioning ops, store totals |
| **Graceful shutdown** | SIGTERM/SIGINT handlers drain HTTP connections, stop provisioning, and close the DB pool |
| **Log redaction** | Helm `--set` args containing passwords/secrets are redacted before debug logging |
| **Helmet + CORS** | HTTP security headers (Helmet) and configurable CORS |

## Known Limitations

These items are documented and accepted trade-offs for the current scope:

| ID | Description | Impact |
|----|-------------|--------|
| **F10** | No PostgreSQL Row-Level Security (RLS) | Tenant isolation is enforced at the application layer (all queries filter by `owner_id`). RLS would add defense-in-depth but is not required for the current single-backend architecture. |
| **F11** | Creation cooldown uses an in-memory `Map` | Works correctly for a single backend instance. A distributed deployment would need Redis or a DB-backed cooldown to prevent cross-instance bypass. |
| **F12** | `requestId` not propagated to async provisioning logs | Provisioning runs as a background fire-and-forget task after the HTTP response; the original request context is not carried into those log entries. |

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

The CI pipeline will automatically validate your changes.
