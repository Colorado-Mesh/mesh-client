#!/usr/bin/env bash
# Apply mesh-client rsReticulum AutoInterface beacon overlay for rns-stack local builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch"
RNS_DIR="${RS_RETICULUM_DIR:-$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum}"
AUTO_RS="${RNS_DIR}/crates/rns-interface/src/auto.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

# Upstream merged utun skip + beacon backoff (e.g. f5f04f9+).
if [[ -f "${AUTO_RS}" ]] && grep -q 'beacon_tx_backoff_secs' "${AUTO_RS}"; then
  echo "auto-beacon utun overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "auto-beacon-utun"; then
  exit 0
fi
exit 1
