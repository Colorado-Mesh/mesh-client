#!/usr/bin/env bash
# Cap LinkClient wait_for_proof at establishment_timeout (MeshChat-like TCP fail-fast).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-link-client-proof-budget.patch"
RNS_DIR="${RS_RETICULUM_DIR:-$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum}"
LINK_CLIENT_RS="${RNS_DIR}/crates/rns-runtime/src/link_client.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

short_head() {
  git -C "${RNS_DIR}" rev-parse --short HEAD
}

# Exact overlay already applied (reverse cleanly) — not a lone proof_budget token.
if git -C "${RNS_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1; then
  echo "link-client proof-budget overlay already present on rsReticulum @ $(short_head)"
  exit 0
fi

apply_err="$(mktemp "${TMPDIR:-/tmp}/mesh-proof-budget-apply.XXXXXX")"
trap 'rm -f "${apply_err}"' EXIT

if git -C "${RNS_DIR}" apply --check "${PATCH_FILE}" > "${apply_err}" 2>&1; then
  git -C "${RNS_DIR}" apply "${PATCH_FILE}"
  echo "applied ${PATCH_FILE} on rsReticulum @ $(short_head)"
  exit 0
fi

# Neither reverse nor forward matched. Accept only the full upstream-equivalent data
# flow: proof_budget is capped by establishment_timeout AND passed to wait_for_proof.
if [[ -f "${LINK_CLIENT_RS}" ]] \
  && grep -qE 'let proof_budget\s*=\s*time_remaining\(deadline\)\?\.min\(link\.establishment_timeout\)' "${LINK_CLIENT_RS}" \
  && grep -qE 'wait_for_proof\([^;]*proof_budget' "${LINK_CLIENT_RS}"; then
  echo "link-client proof-budget capability already upstream on rsReticulum @ $(short_head)"
  exit 0
fi

echo "error: link-client proof-budget overlay could not be applied on rsReticulum @ $(short_head)" >&2
echo "error: neither forward apply nor reverse-check matched; git diagnostic:" >&2
cat "${apply_err}" >&2
exit 1
