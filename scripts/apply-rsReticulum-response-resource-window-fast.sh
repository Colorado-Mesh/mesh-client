#!/usr/bin/env bash
# Apply mesh-client rsReticulum response-Resource WINDOW_MAX_FAST overlay.
# TCP-class RTT never crosses RATE_FAST under WINDOW_MAX_SLOW=10, so Nomad
# /media crawls. Promote inbound response Resources when RTT <= 1s.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-response-resource-window-fast.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
RESOURCE_RS="${RNS_DIR}/crates/rns-protocol/src/resource.rs"
LINK_SESSION_RS="${RNS_DIR}/crates/rns-runtime/src/link_session.rs"

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
  [[ -f "${RESOURCE_RS}" && -f "${LINK_SESSION_RS}" ]] || return 1
  # Full TCP fast-start patch: promote_fast writes WINDOW_MAX_FAST and the
  # inbound response path gates on RTT ≤ 1s. A method declaration + call
  # alone is a partial marker and must not no-op.
  grep -q 'fn promote_fast' "${RESOURCE_RS}" \
    && grep -q 'self.window = WINDOW_MAX_FAST' "${RESOURCE_RS}" \
    && grep -q 'self.window_max = WINDOW_MAX_FAST' "${RESOURCE_RS}" \
    && grep -q 'promote_fast()' "${LINK_SESSION_RS}" \
    && grep -q 'flags.is_response && rtt <= Duration::from_millis(1000)' "${LINK_SESSION_RS}"
}

if overlay_already_present; then
  echo "response-resource-window-fast overlay already applied on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "response-resource-window-fast"; then
  exit 0
fi
exit 1
