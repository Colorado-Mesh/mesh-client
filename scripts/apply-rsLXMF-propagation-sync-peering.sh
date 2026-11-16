#!/usr/bin/env bash
# Apply mesh-client rsLXMF PropagationSyncTask peering/identity overlay for rns-stack builds.
# Upstream owns LinkIdentify (set_identity()/send_identify()); this overlay adds
# configure_peering, the empty peering-key stamp before /offer, and sticky
# offer/establish/finish diagnostics. Carries ratspeak/rsLXMF#4 until it merges.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsLXMF-propagation-sync-peering.patch"
LXMF_DIR="${RS_LXMF_DIR:-${REPO_ROOT}/.rsstack/rsLXMF}"
SYNC_RS="${LXMF_DIR}/crates/lxmf-core/src/propagation_sync.rs"

if [[ ! -d "${LXMF_DIR}/.git" ]]; then
  echo "error: rsLXMF not found at ${LXMF_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsLXMF.git ${LXMF_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if [[ -f "${SYNC_RS}" ]] && grep -qE 'fn configure_peering\(' "${SYNC_RS}"; then
  echo "propagation-sync peering/identity capability present on rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${LXMF_DIR}" "${PATCH_FILE}" "propagation-sync-peering"; then
  exit 0
fi
exit 1
