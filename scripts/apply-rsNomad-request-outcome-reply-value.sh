#!/usr/bin/env bash
# Migrate rsNomad RequestOutcome::Reply → ReplyBytes and ReplyFile { data, … }
# → ReplyFile { source: Cursor, metadata } for rsReticulum 1.5 ReplyFile API.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsNomad-request-outcome-reply-value.patch"
NOMAD_DIR="${RS_NOMAD_DIR:-${REPO_ROOT}/.rsstack/rsNomad}"
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

if [[ -f "${NODE_RS}" ]] && grep -q 'RequestOutcome::ReplyBytes(' "${NODE_RS}" \
  && grep -q 'Box::new(Cursor::new(' "${NODE_RS}"; then
  echo "request-outcome-reply-value overlay already present on rsNomad @ $(short_head)"
  exit 0
fi

if git -C "${NOMAD_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1; then
  echo "request-outcome-reply-value overlay already applied on rsNomad @ $(short_head)"
  exit 0
fi

apply_ratspeak_overlay_or_die "${NOMAD_DIR}" "${PATCH_FILE}" "request-outcome-reply-value"
