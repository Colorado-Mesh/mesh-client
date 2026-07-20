#!/usr/bin/env bash
# Apply mesh-client rsReticulum RNode TCP activity-keepalive overlay for rns-stack local builds.
# Mirrors Python RNodeInterface ACTIVITY_KEEPALIVE (detect every 3.5s) so Wi‑Fi RNodes
# do not close the TCP socket at ~ACTIVITY_TIMEOUT (6s).
set -euo pipefail

RS_RETICULUM_REF="${RS_RETICULUM_REF:-6d2b28475321bc15c8f60796513d8878b47ed3ab}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-rnode-tcp-activity-keepalive.patch"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"
RNODE_RS="${RNS_DIR}/crates/rns-interface/src/rnode.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

# Upstream PR: https://github.com/ratspeak/rsReticulum/pull/15
if [[ -f "${RNODE_RS}" ]] && grep -q 'RNODE_TCP_ACTIVITY_KEEPALIVE_MS' "${RNODE_RS}"; then
  echo "rnode TCP activity-keepalive overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
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

echo "rnode TCP activity-keepalive patch did not apply on current HEAD; checking out pinned ref ${RS_RETICULUM_REF:0:12}"
current_head="$(git -C "${RNS_DIR}" rev-parse HEAD)"
if [[ "${current_head}" != "${RS_RETICULUM_REF}" ]]; then
  git -C "${RNS_DIR}" fetch origin --tags
  git -C "${RNS_DIR}" checkout "${RS_RETICULUM_REF}"
fi

# Upstream PR: https://github.com/ratspeak/rsReticulum/pull/15
if [[ -f "${RNODE_RS}" ]] && grep -q 'RNODE_TCP_ACTIVITY_KEEPALIVE_MS' "${RNODE_RS}"; then
  echo "rnode TCP activity-keepalive overlay already present on rsReticulum @ ${RS_RETICULUM_REF:0:12}"
  exit 0
fi

apply_patch
echo "applied ${PATCH_FILE} on rsReticulum @ ${RS_RETICULUM_REF:0:12}"
