#!/usr/bin/env bash
# Apply mesh-client rsLXMF PropagationClient link-attached TX for rns-stack builds.
# Pins PN-sync Link/Resource packets to the proof interface so pathless Outbound
# does not broadcast onto every iface (including flow-controlled RNodes).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsLXMF-propagation-client-link-attached-tx.patch"
LXMF_DIR="${RS_LXMF_DIR:-${REPO_ROOT}/.rsstack/rsLXMF}"

if [[ ! -d "${LXMF_DIR}/.git" ]]; then
  echo "error: rsLXMF not found at ${LXMF_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsLXMF.git ${LXMF_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

# Exact overlay already applied (complete reverse apply succeeds).
overlay_already_present() {
  git -C "${LXMF_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1
}

if overlay_already_present; then
  echo "propagation-client link-attached TX overlay already present on rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${LXMF_DIR}" "${PATCH_FILE}" "propagation-client-link-attached-tx"; then
  exit 0
fi
exit 1
