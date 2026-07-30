#!/usr/bin/env bash
# Apply mesh-client rsReticulum AutoInterface beacon overlay for rns-stack local builds.
set -euo pipefail

RS_RETICULUM_REF="${RS_RETICULUM_REF:-9928abed269a83ec5a7ef165ff1142d938cad706}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"
AUTO_RS="${RNS_DIR}/crates/rns-interface/src/auto.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

# Upstream merged utun skip + beacon backoff (e.g. f5f04f9+).
if [[ -f "${AUTO_RS}" ]] && grep -q 'beacon_tx_backoff_secs' "${AUTO_RS}"; then
  echo "auto-beacon utun overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if ! git -C "${RNS_DIR}" diff --quiet || ! git -C "${RNS_DIR}" diff --cached --quiet; then
  echo "warning: ${RNS_DIR} has uncommitted changes; checkout may fail or overwrite work" >&2
fi

apply_patch() {
  git -C "${RNS_DIR}" apply --check "${PATCH_FILE}"
  git -C "${RNS_DIR}" apply "${PATCH_FILE}"
}

if apply_patch 2> /dev/null; then
  echo "applied ${PATCH_FILE} on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if git -C "${RNS_DIR}" apply --check "${PATCH_FILE}" 2>&1 | grep -q 'patch does not apply'; then
  echo "auto-beacon utun overlay not needed (already upstream or incompatible with current rsReticulum HEAD)"
  exit 0
fi

echo "auto-beacon patch did not apply on current HEAD; checking out pinned ref ${RS_RETICULUM_REF:0:12}"
current_head="$(git -C "${RNS_DIR}" rev-parse HEAD)"
if [[ "${current_head}" != "${RS_RETICULUM_REF}" ]]; then
  git -C "${RNS_DIR}" fetch origin --tags
  git -C "${RNS_DIR}" checkout "${RS_RETICULUM_REF}"
fi

if apply_patch 2> /dev/null; then
  echo "applied ${PATCH_FILE} on rsReticulum @ ${RS_RETICULUM_REF:0:12}"
  exit 0
fi

echo "auto-beacon utun overlay not needed (already upstream or incompatible with pinned rsReticulum ref)"
exit 0
