#!/usr/bin/env bash
# Apply mesh-client rsReticulum BLE RNode pairing-transition reconnect debounce.
# Mid-SMP disconnects ("BLE pairing in progress") used a 1s reconnect that
# re-fired the OS passkey dialog while the user was typing; wait 30s instead.
set -euo pipefail

RS_RETICULUM_REF="${RS_RETICULUM_REF:-6d2b28475321bc15c8f60796513d8878b47ed3ab}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-ble-rnode-pairing-transition-debounce.patch"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"
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

if [[ -f "${BLE_RNODE_RS}" ]] && grep -q 'PAIRING_TRANSITION_RETRY_WAIT' "${BLE_RNODE_RS}"; then
  echo "ble_rnode pairing-transition debounce overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if ! git -C "${RNS_DIR}" diff --quiet || ! git -C "${RNS_DIR}" diff --cached --quiet; then
  echo "warning: ${RNS_DIR} has uncommitted changes; checkout may fail or overwrite work" >&2
fi

apply_patch() {
  git -C "${RNS_DIR}" apply --check "${PATCH_FILE}"
  git -C "${RNS_DIR}" apply "${PATCH_FILE}"
}

if apply_patch 2> /dev/null; then
  echo "applied ${PATCH_FILE} on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if git -C "${RNS_DIR}" apply --check "${PATCH_FILE}" 2>&1 | grep -q 'patch does not apply'; then
  echo "ble_rnode pairing-transition debounce overlay not needed (already upstream or incompatible with current rsReticulum HEAD)"
  exit 0
fi

echo "ble_rnode pairing-transition debounce patch did not apply on current HEAD; checking out pinned ref ${RS_RETICULUM_REF:0:12}"
current_head="$(git -C "${RNS_DIR}" rev-parse HEAD)"
if [[ "${current_head}" != "${RS_RETICULUM_REF}" ]]; then
  git -C "${RNS_DIR}" fetch origin --tags
  git -C "${RNS_DIR}" checkout "${RS_RETICULUM_REF}"
fi

if apply_patch 2> /dev/null; then
  echo "applied ${PATCH_FILE} on rsReticulum @ ${RS_RETICULUM_REF:0:12}"
  exit 0
fi

echo "ble_rnode pairing-transition debounce overlay not needed (already upstream or incompatible with pinned rsReticulum ref)"
exit 0
