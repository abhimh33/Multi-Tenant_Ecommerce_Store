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
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:password@localhost:5432/mt_ecommerce` |
| `JWT_SECRET` | Secret for JWT token signing | (required) |
| `PORT` | Backend server port | `3001` |
| `NODE_ENV` | Environment (`development`/`production`) | `development` |
| `KUBECONFIG` | Path to kubeconfig file | `~/.kube/config` |
| `HELM_VALUES_PROFILE` | Helm values profile (`local`/`vps`) | `local` |
| `DOMAIN_SUFFIX` | Store URL suffix | `.localhost` (local) / `.yourdomain.com` (vps) |

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
| `POST` | `/auth/register` | Register a new user (first user is admin) |
| `POST` | `/auth/login` | Login and receive JWT token |
| `POST` | `/stores` | Create a new store |
| `GET` | `/stores` | List stores (tenant-isolated) |
| `GET` | `/stores/:id` | Get store details |
| `DELETE` | `/stores/:id` | Delete a store |
| `POST` | `/stores/:id/retry` | Retry failed provisioning |
| `GET` | `/stores/:id/logs` | Get store audit logs |
| `GET` | `/audit/logs` | Get all audit logs (admin only) |
| `GET` | `/health` | Health check |

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

The CI pipeline will automatically validate your changes.
