#!/usr/bin/env bash
# Apply mesh-client rsReticulum overlay: bump exact btleplug pin 0.13.4 → 0.13.5.
# mesh-client Windows LoRa GATT (btleplug_win) and rns-interface share crates.io
# btleplug; an exact =0.13.4 pin blocks cargo from resolving 0.13.5.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-btleplug-0.13.5.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
INTERFACE_TOML="${RNS_DIR}/crates/rns-interface/Cargo.toml"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

overlay_already_present() {
  [[ -f "${INTERFACE_TOML}" ]] || return 1
  grep -qE 'btleplug = \{ version = "=0\.13\.5"' "${INTERFACE_TOML}"
}

if overlay_already_present; then
  echo "btleplug 0.13.5 pin overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "btleplug-0.13.5"; then
  exit 0
fi
exit 1
