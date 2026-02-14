#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Helm Upgrade & Rollback Helper
# Safe upgrade workflow for provisioned store releases.
#
# Usage:
#   ./scripts/helm-upgrade.sh upgrade  <release> <namespace> [values-file]
#   ./scripts/helm-upgrade.sh rollback <release> <namespace> [revision]
#   ./scripts/helm-upgrade.sh history  <release> <namespace>
#   ./scripts/helm-upgrade.sh diff     <release> <namespace> [values-file]
#   ./scripts/helm-upgrade.sh verify   <release> <namespace>
#
# Examples:
#   # Upgrade a store release to new chart version
#   ./scripts/helm-upgrade.sh upgrade store-abc12345 store-abc12345 values-vps.yaml
#
#   # Preview changes without applying
#   ./scripts/helm-upgrade.sh diff store-abc12345 store-abc12345 values-vps.yaml
#
#   # Roll back to the previous revision
#   ./scripts/helm-upgrade.sh rollback store-abc12345 store-abc12345
#
#   # Roll back to a specific revision
#   ./scripts/helm-upgrade.sh rollback store-abc12345 store-abc12345 2
#
#   # View release history
#   ./scripts/helm-upgrade.sh history store-abc12345 store-abc12345
# ──────────────────────────────────────────────────────────────────────────

set -euo pipefail

CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)/helm/ecommerce-store"
DEFAULT_VALUES_FILE="values-local.yaml"
TIMEOUT="${HELM_TIMEOUT:-10m}"

# Colors
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'; BOLD='\033[1m'
else
  GREEN=''; RED=''; YELLOW=''; NC=''; BOLD=''
fi

usage() {
  echo "Usage: $0 {upgrade|rollback|history|diff|verify} <release> <namespace> [extra]"
  echo ""
  echo "Commands:"
  echo "  upgrade  <release> <ns> [values-file]   Helm upgrade --install with pre-flight checks"
  echo "  rollback <release> <ns> [revision]       Roll back to previous (or specific) revision"
  echo "  history  <release> <ns>                  Show release revision history"
  echo "  diff     <release> <ns> [values-file]    Dry-run upgrade and show diff (requires helm-diff plugin)"
  echo "  verify   <release> <ns>                  Post-upgrade health verification"
  exit 1
}

[ $# -lt 3 ] && usage

COMMAND="$1"
RELEASE="$2"
NAMESPACE="$3"
EXTRA="${4:-}"

# ── Pre-flight checks ─────────────────────────────────────────────────────
preflight() {
  echo -e "${BOLD}Pre-flight checks for ${RELEASE} in ${NAMESPACE}${NC}"

  # 1. Chart exists
  if [ ! -f "$CHART_DIR/Chart.yaml" ]; then
    echo -e "${RED}✗ Chart not found at $CHART_DIR${NC}"; exit 1
  fi
  echo -e "  ${GREEN}✓${NC} Chart found at $CHART_DIR"

  # 2. Chart lints cleanly
  if ! helm lint "$CHART_DIR" --quiet >/dev/null 2>&1; then
    echo -e "${RED}✗ Chart lint failed${NC}"; exit 1
  fi
  echo -e "  ${GREEN}✓${NC} Chart lint passed"

  # 3. Namespace exists
  if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Namespace $NAMESPACE exists"
  else
    echo -e "  ${YELLOW}⚠${NC} Namespace $NAMESPACE does not exist (will be created)"
  fi

  # 4. Current release status
  CURRENT_STATUS=$(helm status "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "not-installed")
  echo -e "  Current status: ${BOLD}${CURRENT_STATUS}${NC}"

  # 5. Current revision
  CURRENT_REV=$(helm history "$RELEASE" -n "$NAMESPACE" --max 1 -o json 2>/dev/null | grep -o '"revision":[0-9]*' | head -1 | cut -d: -f2 || echo "0")
  echo -e "  Current revision: ${BOLD}${CURRENT_REV}${NC}"
}

# ── Upgrade ───────────────────────────────────────────────────────────────
do_upgrade() {
  local VALUES_FILE="${EXTRA:-$DEFAULT_VALUES_FILE}"
  local VALUES_PATH="$CHART_DIR/$VALUES_FILE"

  preflight

  if [ ! -f "$VALUES_PATH" ]; then
    echo -e "${RED}✗ Values file not found: $VALUES_PATH${NC}"; exit 1
  fi
  echo -e "  ${GREEN}✓${NC} Values file: $VALUES_FILE"

  # Determine the engine from the current release
  ENGINE=$(helm get values "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null | grep -o '"engine":"[^"]*"' | cut -d'"' -f4 || echo "woocommerce")
  echo -e "  Engine: ${BOLD}${ENGINE}${NC}"

  echo ""
  echo -e "${BOLD}Upgrading ${RELEASE} in ${NAMESPACE}...${NC}"
  echo -e "${YELLOW}This will perform a rolling upgrade with --wait.${NC}"
  echo ""

  helm upgrade --install "$RELEASE" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --values "$VALUES_PATH" \
    --set "engine=${ENGINE}" \
    --set "storeId=${RELEASE}" \
    --wait \
    --timeout "$TIMEOUT" \
    --atomic \
    --cleanup-on-fail

  NEW_REV=$(helm history "$RELEASE" -n "$NAMESPACE" --max 1 -o json 2>/dev/null | grep -o '"revision":[0-9]*' | head -1 | cut -d: -f2 || echo "?")
  echo ""
  echo -e "${GREEN}✓ Upgrade complete — revision ${NEW_REV}${NC}"
  echo -e "  Use '${0} verify ${RELEASE} ${NAMESPACE}' to validate."
  echo -e "  Use '${0} rollback ${RELEASE} ${NAMESPACE}' to revert."
}

# ── Rollback ──────────────────────────────────────────────────────────────
do_rollback() {
  local REVISION="${EXTRA:-0}" # 0 = previous revision

  preflight

  echo ""
  if [ "$REVISION" = "0" ]; then
    echo -e "${BOLD}Rolling back ${RELEASE} to previous revision...${NC}"
  else
    echo -e "${BOLD}Rolling back ${RELEASE} to revision ${REVISION}...${NC}"
  fi

  helm rollback "$RELEASE" "$REVISION" \
    --namespace "$NAMESPACE" \
    --wait \
    --timeout "$TIMEOUT"

  NEW_REV=$(helm history "$RELEASE" -n "$NAMESPACE" --max 1 -o json 2>/dev/null | grep -o '"revision":[0-9]*' | head -1 | cut -d: -f2 || echo "?")
  echo ""
  echo -e "${GREEN}✓ Rollback complete — now at revision ${NEW_REV}${NC}"
}

# ── History ───────────────────────────────────────────────────────────────
do_history() {
  echo -e "${BOLD}Release history for ${RELEASE} in ${NAMESPACE}${NC}"
  echo ""
  helm history "$RELEASE" --namespace "$NAMESPACE"
}

# ── Diff ──────────────────────────────────────────────────────────────────
do_diff() {
  local VALUES_FILE="${EXTRA:-$DEFAULT_VALUES_FILE}"
  local VALUES_PATH="$CHART_DIR/$VALUES_FILE"

  preflight

  # Check if helm-diff plugin is installed
  if helm plugin list 2>/dev/null | grep -q 'diff'; then
    echo ""
    echo -e "${BOLD}Diff preview (what would change):${NC}"
    helm diff upgrade "$RELEASE" "$CHART_DIR" \
      --namespace "$NAMESPACE" \
      --values "$VALUES_PATH" \
      --set "storeId=${RELEASE}" || true
  else
    # Fallback to dry-run
    echo ""
    echo -e "${YELLOW}helm-diff plugin not installed — using --dry-run instead${NC}"
    echo -e "Install with: helm plugin install https://github.com/databus23/helm-diff"
    echo ""
    helm upgrade --install "$RELEASE" "$CHART_DIR" \
      --namespace "$NAMESPACE" \
      --values "$VALUES_PATH" \
      --set "storeId=${RELEASE}" \
      --dry-run \
      --debug 2>&1 | head -200
  fi
}

# ── Verify ────────────────────────────────────────────────────────────────
do_verify() {
  echo -e "${BOLD}Post-upgrade verification for ${RELEASE} in ${NAMESPACE}${NC}"
  echo ""

  # 1. Helm release status
  STATUS=$(helm status "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  if [ "$STATUS" = "deployed" ]; then
    echo -e "  ${GREEN}✓${NC} Helm release status: deployed"
  else
    echo -e "  ${RED}✗${NC} Helm release status: $STATUS"
  fi

  # 2. All pods running
  TOTAL_PODS=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  RUNNING_PODS=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -c 'Running' || true)
  COMPLETED_PODS=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -c 'Completed' || true)
  HEALTHY=$((RUNNING_PODS + COMPLETED_PODS))

  if [ "$HEALTHY" -eq "$TOTAL_PODS" ] && [ "$TOTAL_PODS" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} All $TOTAL_PODS pod(s) healthy ($RUNNING_PODS running, $COMPLETED_PODS completed)"
  else
    echo -e "  ${RED}✗${NC} Pod health: $HEALTHY/$TOTAL_PODS healthy"
    kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | while read -r line; do
      echo "     $line"
    done
  fi

  # 3. ResourceQuota
  QUOTA=$(kubectl get resourcequota -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [ "$QUOTA" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} ResourceQuota enforced ($QUOTA quota(s))"
  else
    echo -e "  ${YELLOW}⚠${NC} No ResourceQuota found"
  fi

  # 4. LimitRange
  LR=$(kubectl get limitrange -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LR" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} LimitRange enforced ($LR range(s))"
  else
    echo -e "  ${YELLOW}⚠${NC} No LimitRange found"
  fi

  # 5. Ingress
  INGRESS=$(kubectl get ingress -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [ "$INGRESS" -gt 0 ]; then
    HOSTS=$(kubectl get ingress -n "$NAMESPACE" -o jsonpath='{.items[*].spec.rules[*].host}' 2>/dev/null)
    echo -e "  ${GREEN}✓${NC} Ingress configured: $HOSTS"
  else
    echo -e "  ${YELLOW}⚠${NC} No Ingress found"
  fi

  # 6. NetworkPolicy
  NP=$(kubectl get networkpolicy -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [ "$NP" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} NetworkPolicy enforced ($NP policy/policies)"
  else
    echo -e "  ${YELLOW}⚠${NC} No NetworkPolicy found"
  fi

  # 7. PVCs
  PVCS=$(kubectl get pvc -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  BOUND_PVCS=$(kubectl get pvc -n "$NAMESPACE" --no-headers 2>/dev/null | grep -c 'Bound' || true)
  if [ "$PVCS" -gt 0 ]; then
    if [ "$BOUND_PVCS" -eq "$PVCS" ]; then
      echo -e "  ${GREEN}✓${NC} All $PVCS PVC(s) bound"
    else
      echo -e "  ${YELLOW}⚠${NC} $BOUND_PVCS/$PVCS PVC(s) bound"
    fi
  fi
}

# ── Dispatch ──────────────────────────────────────────────────────────────
case "$COMMAND" in
  upgrade)  do_upgrade ;;
  rollback) do_rollback ;;
  history)  do_history ;;
  diff)     do_diff ;;
  verify)   do_verify ;;
  *)        usage ;;
esac
