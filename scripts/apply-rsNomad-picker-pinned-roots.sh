#!/usr/bin/env bash
# Keep native-picker Nomad roots handle-relative through storage operations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
# shellcheck source=lib/migrate-picker-pinned-clippy.sh
source "${SCRIPT_DIR}/lib/migrate-picker-pinned-clippy.sh"
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

short_head() {
  git -C "${NOMAD_DIR}" rev-parse --short HEAD
}

overlay_already_present() {
  [[ -f "${PATHS_RS}" && -f "${NODE_RS}" ]] || return 1
  grep -q 'fn is_picker_pinned_path' "${PATHS_RS}" \
    && grep -q 'content_store_sink_keeps_pinned_root_after_path_replacement' "${PATHS_RS}" \
    && grep -q 'pub async fn shutdown' "${NODE_RS}"
}

if git -C "${NOMAD_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1; then
  echo "picker-pinned-roots overlay already applied on rsNomad @ $(short_head)"
  exit 0
fi

if overlay_already_present; then
  if ! grep -q 'clippy does not see needless_bool' "${PATHS_RS}"; then
    migrate_picker_pinned_to_clippy_form "${PATHS_RS}"
    echo "migrated picker-pinned-roots overlay to clippy-safe is_picker_pinned_path on rsNomad @ $(short_head)"
    exit 0
  fi
  echo "picker-pinned-roots overlay already applied on rsNomad @ $(short_head)"
  exit 0
fi

apply_ratspeak_overlay_or_die "${NOMAD_DIR}" "${PATCH_FILE}" "picker-pinned-roots"
