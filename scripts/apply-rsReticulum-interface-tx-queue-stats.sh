#!/usr/bin/env bash
# Apply mesh-client rsReticulum interface TX queue stats overlay.
# Exposes host outbound mpsc fill (tx_queue_used / tx_queue_max) on GetInterfaceStats.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-interface-tx-queue-stats.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
MESSAGES_RS="${RNS_DIR}/crates/rns-transport/src/messages.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if [[ -f "${MESSAGES_RS}" ]] \
  && grep -q 'pub tx_queue_used: u64' "${MESSAGES_RS}" \
  && grep -q 'pub tx_queue_max: u64' "${MESSAGES_RS}"; then
  echo "interface-tx-queue-stats overlay already applied on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "interface-tx-queue-stats"; then
  exit 0
fi
exit 1
