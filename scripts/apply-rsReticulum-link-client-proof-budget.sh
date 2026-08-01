#!/usr/bin/env bash
# Cap LinkClient wait_for_proof at establishment_timeout (MeshChat-like TCP fail-fast).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-link-client-proof-budget.patch"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"
LINK_CLIENT_RS="${RNS_DIR}/crates/rns-runtime/src/link_client.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if [[ -f "${LINK_CLIENT_RS}" ]] && grep -q 'proof_budget' "${LINK_CLIENT_RS}"; then
  echo "link-client proof-budget overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if git -C "${RNS_DIR}" apply --check "${PATCH_FILE}" 2> /dev/null; then
  git -C "${RNS_DIR}" apply "${PATCH_FILE}"
  echo "applied ${PATCH_FILE} on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

echo "link-client proof-budget overlay not needed (already upstream or incompatible with current rsReticulum HEAD)"
exit 0
