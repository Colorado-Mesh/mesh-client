#!/usr/bin/env bash
# Apply mesh-client rsReticulum inbound-raw saturation log overlay.
# LinkManager try_send drops the *newest* frame when the opportunistic raw channel
# is full; log that instead of silently discarding.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-inbound-raw-saturation-log.patch"
RNS_DIR="${RS_RETICULUM_DIR:-$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum}"
LINK_MANAGER_RS="${RNS_DIR}/crates/rns-runtime/src/link_manager.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if [[ -f "${LINK_MANAGER_RS}" ]] \
  && grep -q 'dropping newest opportunistic packet' "${LINK_MANAGER_RS}"; then
  echo "inbound-raw saturation-log overlay already applied on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "inbound-raw-saturation-log"; then
  exit 0
fi
exit 1
