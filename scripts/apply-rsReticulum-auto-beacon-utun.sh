#!/usr/bin/env bash
# Apply mesh-client rsReticulum AutoInterface beacon overlay for rns-stack local builds.
set -euo pipefail

RS_RETICULUM_REF="${RS_RETICULUM_REF:-6d2b28475321bc15c8f60796513d8878b47ed3ab}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if ! git -C "${RNS_DIR}" diff --quiet || ! git -C "${RNS_DIR}" diff --cached --quiet; then
  echo "warning: ${RNS_DIR} has uncommitted changes; checkout may fail or overwrite work" >&2
fi

current_head="$(git -C "${RNS_DIR}" rev-parse HEAD)"
if [[ "${current_head}" != "${RS_RETICULUM_REF}" ]]; then
  echo "checking out rsReticulum ${RS_RETICULUM_REF} (was ${current_head:0:12})"
  git -C "${RNS_DIR}" fetch origin --tags
  git -C "${RNS_DIR}" checkout "${RS_RETICULUM_REF}"
fi

git -C "${RNS_DIR}" apply --check "${PATCH_FILE}"
git -C "${RNS_DIR}" apply "${PATCH_FILE}"
echo "applied ${PATCH_FILE} on rsReticulum @ ${RS_RETICULUM_REF}"
