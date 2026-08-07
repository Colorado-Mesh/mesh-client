#!/usr/bin/env bash
# Apply mesh-client rsLXMF deferred messagestore load for rns-stack builds.
# Adds PropagationNode::with_storage_unloaded + load_messagestore_from_disk so
# live attach / RRC can become ready before scanning a large PN store.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsLXMF-propagation-node-deferred-messagestore-load.patch"
LXMF_DIR="${RS_LXMF_DIR:-${REPO_ROOT}/.rsstack/rsLXMF}"
NODE_RS="${LXMF_DIR}/crates/lxmf-core/src/propagation_node.rs"

if [[ ! -d "${LXMF_DIR}/.git" ]]; then
  echo "error: rsLXMF not found at ${LXMF_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsLXMF.git ${LXMF_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

overlay_already_present() {
  [[ -f "${NODE_RS}" ]] || return 1
  grep -qE 'fn with_storage_unloaded\(' "${NODE_RS}" \
    && grep -qE 'fn load_messagestore_from_disk\(' "${NODE_RS}"
}

if overlay_already_present; then
  echo "propagation-node deferred messagestore load overlay already present on rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${LXMF_DIR}" "${PATCH_FILE}" "propagation-node-deferred-messagestore-load"; then
  exit 0
fi
exit 1
