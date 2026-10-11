#!/usr/bin/env bash
# Apply mesh-client rsReticulum RNCP pre-advertisement admission overlay.
# Keeps blocked, unidentified, oversized, and over-quota inbound Resources
# from being accepted before the application owns their bytes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-rncp-inbound-admission.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
RUNTIME_RS="${RNS_DIR}/crates/rns-runtime/src/rncp.rs"
TOOL_RS="${RNS_DIR}/crates/rns-tools/src/commands/rncp.rs"

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
  [[ -f "${RUNTIME_RS}" && -f "${TOOL_RS}" ]] || return 1
  # Marker checks can mistake a superseded or partially applied overlay for the
  # complete patch. Reverse applicability covers every hunk, including the
  # public API baseline and payload-ack contract.
  git -C "${RNS_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1
}

if overlay_already_present; then
  echo "rncp-inbound-admission overlay already applied on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "rncp-inbound-admission"; then
  exit 0
fi
exit 1
