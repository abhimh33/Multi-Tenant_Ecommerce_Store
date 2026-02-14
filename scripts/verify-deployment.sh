#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Deployment Verification Script
# Validates that the Multi-Tenant Ecommerce platform is correctly deployed.
#
# Usage:
#   ./scripts/verify-deployment.sh                  # local dev (localhost:3001)
#   ./scripts/verify-deployment.sh https://api.yourdomain.com   # VPS
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed
# ──────────────────────────────────────────────────────────────────────────

set -euo pipefail

API_BASE="${1:-http://localhost:3001}"
PASSED=0
FAILED=0
WARNINGS=0

# Colors (disabled when not a terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'; BOLD='\033[1m'
else
  GREEN=''; RED=''; YELLOW=''; NC=''; BOLD=''
fi

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS + 1)); }

# ── 1. Backend Reachability ───────────────────────────────────────────────
echo -e "\n${BOLD}1. Backend Reachability${NC}"

HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}/api/v1/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  pass "Health endpoint reachable (HTTP $HTTP_CODE)"
else
  fail "Health endpoint unreachable (HTTP $HTTP_CODE)"
fi

# ── 2. Health Endpoint Details ────────────────────────────────────────────
echo -e "\n${BOLD}2. Dependency Health${NC}"

HEALTH_JSON=$(curl -s "${API_BASE}/api/v1/health" 2>/dev/null || echo '{}')

DB_STATUS=$(echo "$HEALTH_JSON" | grep -o '"database":{[^}]*"status":"[^"]*"' | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ "$DB_STATUS" = "healthy" ]; then
  pass "PostgreSQL: healthy"
else
  fail "PostgreSQL: ${DB_STATUS:-unreachable}"
fi

K8S_STATUS=$(echo "$HEALTH_JSON" | grep -o '"kubernetes":{[^}]*"status":"[^"]*"' | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ "$K8S_STATUS" = "healthy" ]; then
  pass "Kubernetes: healthy"
else
  fail "Kubernetes: ${K8S_STATUS:-unreachable}"
fi

# ── 3. Concurrency Stats ─────────────────────────────────────────────────
echo -e "\n${BOLD}3. Concurrency Control${NC}"

CONCURRENCY=$(echo "$HEALTH_JSON" | grep -o '"concurrency":{[^}]*}' || echo '')
if [ -n "$CONCURRENCY" ]; then
  pass "Concurrency stats present in health response"
  MAX_CONCURRENT=$(echo "$CONCURRENCY" | grep -o '"maxConcurrent":[0-9]*' | cut -d: -f2)
  echo "     maxConcurrent=$MAX_CONCURRENT"
else
  fail "Concurrency stats missing from health response"
fi

# ── 4. Liveness Probe ────────────────────────────────────────────────────
echo -e "\n${BOLD}4. Probes${NC}"

LIVE_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}/api/v1/health/live" 2>/dev/null || echo "000")
if [ "$LIVE_CODE" = "200" ]; then
  pass "Liveness probe: OK (/health/live)"
else
  fail "Liveness probe: HTTP $LIVE_CODE"
fi

READY_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}/api/v1/health/ready" 2>/dev/null || echo "000")
if [ "$READY_CODE" = "200" ]; then
  pass "Readiness probe: OK (/health/ready)"
else
  fail "Readiness probe: HTTP $READY_CODE"
fi

# ── 5. Kubernetes Cluster ────────────────────────────────────────────────
echo -e "\n${BOLD}5. Kubernetes Cluster${NC}"

if command -v kubectl &>/dev/null; then
  KUBECTL_VERSION=$(kubectl version --client -o json 2>/dev/null | grep -o '"gitVersion":"[^"]*"' | cut -d'"' -f4)
  pass "kubectl available ($KUBECTL_VERSION)"

  NODES=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [ "$NODES" -gt 0 ]; then
    pass "Cluster has $NODES node(s)"
  else
    fail "No nodes found in cluster"
  fi

  READY_NODES=$(kubectl get nodes --no-headers 2>/dev/null | grep -c ' Ready' || true)
  if [ "$READY_NODES" -eq "$NODES" ]; then
    pass "All $READY_NODES node(s) are Ready"
  else
    warn "$READY_NODES of $NODES node(s) Ready"
  fi
else
  warn "kubectl not found — skipping cluster checks"
fi

# ── 6. Helm ──────────────────────────────────────────────────────────────
echo -e "\n${BOLD}6. Helm${NC}"

if command -v helm &>/dev/null; then
  HELM_VERSION=$(helm version --short 2>/dev/null | head -1)
  pass "Helm available ($HELM_VERSION)"

  RELEASE_COUNT=$(helm list --all-namespaces -q 2>/dev/null | wc -l | tr -d ' ')
  echo "     $RELEASE_COUNT active Helm release(s)"
else
  warn "helm not found — skipping Helm checks"
fi

# ── 7. Helm Chart Validation ─────────────────────────────────────────────
echo -e "\n${BOLD}7. Helm Chart Lint${NC}"

CHART_PATH="$(cd "$(dirname "$0")/.." && pwd)/helm/ecommerce-store"
if [ -d "$CHART_PATH" ] && command -v helm &>/dev/null; then
  if helm lint "$CHART_PATH" --quiet 2>/dev/null; then
    pass "Chart linting passed"
  else
    fail "Chart lint errors"
  fi

  # Template render test  
  if helm template verify-woo "$CHART_PATH" \
    --set engine=woocommerce --set storeId=verify-woo \
    -f "$CHART_PATH/values-local.yaml" --validate >/dev/null 2>&1; then
    pass "WooCommerce template renders cleanly"
  else
    fail "WooCommerce template render failed"
  fi

  if helm template verify-med "$CHART_PATH" \
    --set engine=medusa --set storeId=verify-med \
    -f "$CHART_PATH/values-local.yaml" --validate >/dev/null 2>&1; then
    pass "MedusaJS template renders cleanly"
  else
    fail "MedusaJS template render failed"
  fi
else
  warn "Helm chart not found at $CHART_PATH — skipping"
fi

# ── 8. Security Headers ──────────────────────────────────────────────────
echo -e "\n${BOLD}8. Security Headers${NC}"

HEADERS=$(curl -sI "${API_BASE}/api/v1/health" 2>/dev/null || echo '')

check_header() {
  local name=$1
  if echo "$HEADERS" | grep -qi "^${name}:"; then
    pass "$name present"
  else
    warn "$name missing"
  fi
}

check_header "X-Content-Type-Options"
check_header "X-Frame-Options"
check_header "Strict-Transport-Security"
check_header "Content-Security-Policy"

# ── 9. Ingress Controller ────────────────────────────────────────────────
echo -e "\n${BOLD}9. Ingress Controller${NC}"

if command -v kubectl &>/dev/null; then
  # Check for nginx or traefik ingress
  NGINX_PODS=$(kubectl get pods -n ingress-nginx --no-headers 2>/dev/null | grep -c 'Running' || true)
  TRAEFIK_PODS=$(kubectl get pods -n kube-system --no-headers 2>/dev/null | grep -c 'traefik' || true)

  if [ "$NGINX_PODS" -gt 0 ]; then
    pass "NGINX Ingress Controller running ($NGINX_PODS pod(s))"
  elif [ "$TRAEFIK_PODS" -gt 0 ]; then
    pass "Traefik Ingress Controller running ($TRAEFIK_PODS pod(s))"
  else
    warn "No ingress controller detected"
  fi
fi

# ── 10. Store Provisioning Smoke Test ────────────────────────────────────
echo -e "\n${BOLD}10. API Endpoint Availability${NC}"

# Check auth endpoints respond (don't actually register/login)
AUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_BASE}/api/v1/auth/login" \
  -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo "000")
# Expect 400 (validation error) or 401 — not 404 or 500
if [ "$AUTH_CODE" = "400" ] || [ "$AUTH_CODE" = "401" ] || [ "$AUTH_CODE" = "422" ]; then
  pass "Auth endpoint responding (HTTP $AUTH_CODE for empty body)"
else
  fail "Auth endpoint unexpected response (HTTP $AUTH_CODE)"
fi

STORES_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}/api/v1/stores" 2>/dev/null || echo "000")
if [ "$STORES_CODE" = "401" ] || [ "$STORES_CODE" = "403" ]; then
  pass "Stores endpoint responding (HTTP $STORES_CODE without auth)"
else
  fail "Stores endpoint unexpected response (HTTP $STORES_CODE)"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo -e "\n${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}Deployment Verification Summary${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}DEPLOYMENT VERIFICATION FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}DEPLOYMENT VERIFICATION PASSED${NC}"
  exit 0
fi
