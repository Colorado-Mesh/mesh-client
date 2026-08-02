#!/usr/bin/env bash
# Apply mesh-client rsReticulum discovery-announce egress overlay for rns-stack builds.
# Registers rnstransport.discovery.interface as a local destination and defers
# Announcer::register until the discoverable interface online latch is true
# (BLE RNode late bring-up). Upstream: https://github.com/ratspeak/rsReticulum/pull/19
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-discovery-announce-egress.patch"
RNS_DIR="${RS_RETICULUM_DIR:-$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum}"
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

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "discovery-announce-egress"; then
  exit 0
fi
exit 1
