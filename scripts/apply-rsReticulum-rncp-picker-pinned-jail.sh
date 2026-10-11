#!/usr/bin/env bash
# Keep native-picker RNCP fetch jails handle-relative through the final read.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-rncp-picker-pinned-jail.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
RNCP_RS="${RNS_DIR}/crates/rns-runtime/src/rncp.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  exit 1
fi
if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

overlay_already_present() {
  [[ -f "${RNCP_RS}" ]] || return 1
  grep -q 'fn resolve_under_picker_pin' "${RNCP_RS}" \
    && grep -q 'fetch_sink_keeps_handle_alias_after_selected_root_is_replaced' "${RNCP_RS}"
}

if overlay_already_present; then
  echo "rncp-picker-pinned-jail overlay already applied on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "rncp-picker-pinned-jail"
