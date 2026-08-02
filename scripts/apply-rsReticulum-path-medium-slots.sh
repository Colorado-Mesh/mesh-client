#!/usr/bin/env bash
# Apply mesh-client rsReticulum multi-path / medium-preference overlay.
# Keeps up to 3 ranked path slots per destination and RF/network preference.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-path-medium-slots.patch"
RNS_DIR="${RS_RETICULUM_DIR:-$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum}"
MARKER="${RNS_DIR}/crates/rns-transport/src/constants.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if [[ -f "${MARKER}" ]] && grep -q 'MAX_PATH_SLOTS' "${MARKER}"; then
  echo "path-medium-slots overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

# Prerequisites (packet-tap, discovery egress, …) must already be applied by
# ensure-rsReticulum-patches.sh / clone-ratspeak-stack.sh before this script.
if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "path-medium-slots"; then
  exit 0
fi
exit 1
