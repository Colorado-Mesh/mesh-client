#!/usr/bin/env bash
# Apply mesh-client rsReticulum BLE RNode flow-control READY timeout overlay.
# When flow_control is on, wait briefly for CMD_READY then release the one-packet
# permit so BLE NUS links that never deliver READY cannot freeze the host TX queue.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-ble-rnode-flow-control-ready-timeout.patch"
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
  grep -qE '^const BLE_FLOW_CONTROL_READY_TIMEOUT:' "${BLE_RNODE_RS}" \
    && grep -qE 'BLE RNode flow-control READY timeout; releasing permit' "${BLE_RNODE_RS}"
}

if overlay_already_present; then
  echo "ble_rnode flow-control READY timeout overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "ble-rnode-flow-control-ready-timeout"; then
  exit 0
fi
exit 1
