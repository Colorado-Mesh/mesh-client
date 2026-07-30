#!/usr/bin/env bash
# Apply mesh-client rsReticulum discovery-announce egress overlay for rns-stack builds.
# Registers rnstransport.discovery.interface as a local destination and defers
# Announcer::register until the discoverable interface online latch is true
# (BLE RNode late bring-up). Upstream: https://github.com/ratspeak/rsReticulum/pull/19
set -euo pipefail

RS_RETICULUM_REF="${RS_RETICULUM_REF:-6d2b28475321bc15c8f60796513d8878b47ed3ab}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-discovery-announce-egress.patch"
RNS_DIR="$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum"
RETICULUM_RS="${RNS_DIR}/crates/rns-runtime/src/reticulum.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

overlay_already_present() {
  [[ -f "${RETICULUM_RS}" ]] || return 1
  # Accept extracted helpers (overlay / upstream) or the older inline fix form.
  if grep -qE 'fn take_online_discovery_interfaces\(' "${RETICULUM_RS}" \
    && grep -qE 'fn discovery_local_destination_registration\(' "${RETICULUM_RS}"; then
    return 0
  fi
  grep -qE 'discovery destination registered as local for announce egress' "${RETICULUM_RS}" \
    && grep -qE 'discovery interface online — starting announces' "${RETICULUM_RS}"
}

if overlay_already_present; then
  echo "discovery-announce egress overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
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

echo "discovery-announce egress patch did not apply on current HEAD; checking out pinned ref ${RS_RETICULUM_REF:0:12}"
if [[ -n "$(git -C "${RNS_DIR}" status --porcelain)" ]]; then
  echo "error: ${RNS_DIR} has uncommitted changes; cannot checkout ${RS_RETICULUM_REF:0:12} to apply overlay" >&2
  echo "Stash/commit sibling changes, or ensure the discovery announce fix is already present." >&2
  exit 1
fi
current_head="$(git -C "${RNS_DIR}" rev-parse HEAD)"
if [[ "${current_head}" != "${RS_RETICULUM_REF}" ]]; then
  git -C "${RNS_DIR}" fetch origin --tags
  git -C "${RNS_DIR}" checkout "${RS_RETICULUM_REF}"
fi

if overlay_already_present; then
  echo "discovery-announce egress overlay already present on rsReticulum @ ${RS_RETICULUM_REF:0:12}"
  exit 0
fi

apply_patch
echo "applied ${PATCH_FILE} on rsReticulum @ ${RS_RETICULUM_REF:0:12}"
