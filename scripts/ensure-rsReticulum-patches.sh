#!/usr/bin/env bash
# Ensure rsReticulum overlays required for mesh-client rns-stack builds are applied.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "rsReticulum not found at ${RNS_DIR}; skipping overlay apply (stub build)"
  exit 0
fi

"${SCRIPT_DIR}/apply-rsReticulum-packet-tap.sh"
"${SCRIPT_DIR}/apply-rsReticulum-auto-beacon-utun.sh"
"${SCRIPT_DIR}/apply-rsReticulum-link-client-nomad.sh"
