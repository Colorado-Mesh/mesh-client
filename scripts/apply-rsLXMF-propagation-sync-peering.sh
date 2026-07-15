#!/usr/bin/env bash
# Apply mesh-client rsLXMF PropagationSyncTask peering/identity overlay for rns-stack builds.
set -euo pipefail

RS_LXMF_REF="${RS_LXMF_REF:-68ad7c835187c052c763bb28c41b04a655f35c64}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsLXMF-propagation-sync-peering.patch"
LXMF_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsLXMF"
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

if [[ -f "${SYNC_RS}" ]] && grep -q 'fn set_local_identity' "${SYNC_RS}"; then
  echo "propagation-sync peering overlay already applied on rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if ! git -C "${LXMF_DIR}" diff --quiet || ! git -C "${LXMF_DIR}" diff --cached --quiet; then
  echo "warning: ${LXMF_DIR} has uncommitted changes; checkout may fail or overwrite work" >&2
fi

apply_patch() {
  git -C "${LXMF_DIR}" apply --check "${PATCH_FILE}"
  git -C "${LXMF_DIR}" apply "${PATCH_FILE}"
}

if apply_patch 2> /dev/null; then
  echo "applied ${PATCH_FILE} on rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD)"
  exit 0
fi

echo "propagation-sync peering patch did not apply on current HEAD; checking out pinned ref ${RS_LXMF_REF:0:12}"
current_head="$(git -C "${LXMF_DIR}" rev-parse HEAD)"
if [[ "${current_head}" != "${RS_LXMF_REF}" ]]; then
  git -C "${LXMF_DIR}" fetch origin --tags
  git -C "${LXMF_DIR}" checkout "${RS_LXMF_REF}"
fi

apply_patch
echo "applied ${PATCH_FILE} on rsLXMF @ ${RS_LXMF_REF:0:12}"
