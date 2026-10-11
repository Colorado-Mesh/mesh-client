#!/usr/bin/env bash
# Keep native-picker Nomad roots handle-relative through storage operations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsNomad-picker-pinned-roots.patch"
NOMAD_DIR="${RS_NOMAD_DIR:-${REPO_ROOT}/.rsstack/rsNomad}"
PATHS_RS="${NOMAD_DIR}/crates/nomad-core/src/paths.rs"
NODE_RS="${NOMAD_DIR}/crates/nomad-core/src/node.rs"

if [[ ! -d "${NOMAD_DIR}/.git" ]]; then
  echo "error: rsNomad not found at ${NOMAD_DIR}" >&2
  exit 1
fi
if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

overlay_already_present() {
  [[ -f "${PATHS_RS}" && -f "${NODE_RS}" ]] || return 1
  grep -q 'fn is_picker_pinned_path' "${PATHS_RS}" \
    && grep -q 'content_store_sink_keeps_pinned_root_after_path_replacement' "${PATHS_RS}" \
    && grep -q 'pub async fn shutdown' "${NODE_RS}"
}

if overlay_already_present; then
  echo "picker-pinned-roots overlay already applied on rsNomad @ $(git -C "${NOMAD_DIR}" rev-parse --short HEAD)"
  exit 0
fi

apply_ratspeak_overlay_or_die "${NOMAD_DIR}" "${PATCH_FILE}" "picker-pinned-roots"
