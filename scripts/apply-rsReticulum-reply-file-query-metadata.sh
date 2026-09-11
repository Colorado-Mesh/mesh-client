#!/usr/bin/env bash
# Apply mesh-client rsReticulum ReplyFile + LinkClient query metadata overlay.
# Carries ratspeak/rsReticulum#26 on floated origin/main until upstream merges
# (NomadNet /file + /media response Resources).
# Upstream: https://github.com/ratspeak/rsReticulum/pull/26
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-reply-file-query-metadata.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
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

overlay_already_present() {
  [[ -f "${LINK_MANAGER_RS}" ]] || return 1
  grep -qE 'enum RequestOutcome' "${LINK_MANAGER_RS}" \
    && grep -qE 'ReplyFile\s*\{' "${LINK_MANAGER_RS}" \
    && grep -qE 'fn pack_file_name_metadata\(' "${LINK_MANAGER_RS}"
}

if overlay_already_present; then
  echo "reply-file query-metadata overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "reply-file-query-metadata"; then
  exit 0
fi
exit 1
