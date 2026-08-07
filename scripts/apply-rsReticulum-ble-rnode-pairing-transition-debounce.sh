#!/usr/bin/env bash
# Apply mesh-client rsReticulum BLE RNode pairing-transition reconnect debounce.
# Mid-SMP disconnects ("BLE pairing in progress") used a 1s reconnect that
# re-fired the OS passkey dialog while the user was typing; wait 30s instead.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-ble-rnode-pairing-transition-debounce.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
BLE_RNODE_RS="${RNS_DIR}/crates/rns-interface/src/ble_rnode.rs"

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
  [[ -f "${BLE_RNODE_RS}" ]] || return 1
  # Require the const declaration and its reconnect use site (not a bare identifier mention).
  grep -qE '^[[:space:]]*const PAIRING_TRANSITION_RETRY_WAIT: u64 = 30;' "${BLE_RNODE_RS}" \
    && grep -qE 'PAIRING_TRANSITION_RETRY_WAIT' "${BLE_RNODE_RS}" \
    && grep -qE 'if pairing_transition \{' "${BLE_RNODE_RS}"
}

if overlay_already_present; then
  echo "ble_rnode pairing-transition debounce overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "ble-rnode-pairing-transition-debounce"; then
  exit 0
fi
exit 1
