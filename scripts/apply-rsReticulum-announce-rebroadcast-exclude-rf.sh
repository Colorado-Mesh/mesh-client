#!/usr/bin/env bash
# Apply mesh-client rsReticulum announce-rebroadcast RF exclusion overlay.
# Transport-mode announce rebroadcast must not enqueue onto flow-controlled RNodes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-announce-rebroadcast-exclude-rf.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
MOD_RS="${RNS_DIR}/crates/rns-transport/src/actor/mod.rs"

if ! git -C "${RNS_DIR}" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if [[ -f "${MOD_RS}" ]] && grep -q 'fn iface_is_rf_sink' "${MOD_RS}"; then
  echo "announce-rebroadcast-exclude-rf overlay already applied on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "announce-rebroadcast-exclude-rf"; then
  exit 0
fi
exit 1
