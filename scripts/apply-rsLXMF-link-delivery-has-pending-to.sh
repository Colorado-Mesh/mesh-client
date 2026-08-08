#!/usr/bin/env bash
# Apply mesh-client rsLXMF LinkDeliveryManager::has_pending_to for rns-stack builds.
# Serializes packed Propagated deposits vs a second LinkRequest to the same PN.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsLXMF-link-delivery-has-pending-to.patch"
LXMF_DIR="${RS_LXMF_DIR:-${REPO_ROOT}/.rsstack/rsLXMF}"
LINK_RS="${LXMF_DIR}/crates/lxmf-core/src/link_delivery.rs"

if [[ ! -d "${LXMF_DIR}/.git" ]]; then
  echo "error: rsLXMF not found at ${LXMF_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsLXMF.git ${LXMF_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

overlay_already_present() {
  [[ -f "${LINK_RS}" ]] || return 1
  grep -qE 'fn has_pending_to\(' "${LINK_RS}"
}

if overlay_already_present; then
  echo "link-delivery has_pending_to overlay already present on rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${LXMF_DIR}" "${PATCH_FILE}" "link-delivery-has-pending-to"; then
  exit 0
fi
exit 1
