#!/usr/bin/env bash
# Ensure Ratspeak overlays required for mesh-client rns-stack builds are applied.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"
LXMF_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsLXMF"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "rsReticulum not found at ${RNS_DIR}; skipping overlay apply (stub build)"
  exit 0
fi

"${SCRIPT_DIR}/apply-rsReticulum-packet-tap.sh"
"${SCRIPT_DIR}/apply-rsReticulum-auto-beacon-utun.sh"
"${SCRIPT_DIR}/apply-rsReticulum-link-client-nomad.sh"
"${SCRIPT_DIR}/apply-rsReticulum-rnode-tcp-activity-keepalive.sh"
"${SCRIPT_DIR}/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh"

if [[ ! -d "${LXMF_DIR}/.git" ]]; then
  echo "rsLXMF not found at ${LXMF_DIR}; skipping lxmf overlay apply"
  exit 0
fi

"${SCRIPT_DIR}/apply-rsLXMF-propagation-sync-peering.sh"
