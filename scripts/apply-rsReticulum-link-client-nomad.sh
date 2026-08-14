#!/usr/bin/env bash
# Apply mesh-client rsReticulum LinkClient Nomad overlay for rns-stack local builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-link-client-nomad.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
LINK_CLIENT_RS="${RNS_DIR}/crates/rns-runtime/src/link_client.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

# Upstream has HasPath-gated RecallDestination (a945ba0) but still Deregisters
# announce handlers by aspect. Marker fallback (when reverse-apply misses) is
# the Nomad recall path: RecallDestination without HasPath, await_path, and GC
# with aspect_filter: None. Upstream PR: https://github.com/ratspeak/rsReticulum/pull/14
overlay_already_present() {
  [[ -f "${LINK_CLIENT_RS}" ]] || return 1
  grep -qE 'fn discover_remote_public_key\(' "${LINK_CLIENT_RS}" \
    && grep -qE 'fn gc_closed_announce_handlers\(' "${LINK_CLIENT_RS}" \
    && grep -qE 'const PATH_LOOKUP_TIMEOUT' "${LINK_CLIENT_RS}" \
    && grep -qE 'TransportQuery::RecallDestination' "${LINK_CLIENT_RS}" \
    && grep -qE 'await_path\(' "${LINK_CLIENT_RS}" \
    && grep -qE 'aspect_filter: None' "${LINK_CLIENT_RS}" \
    && ! grep -qE 'TransportQuery::HasPath' "${LINK_CLIENT_RS}"
}

if git -C "${RNS_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1; then
  echo "link-client nomad overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if overlay_already_present; then
  echo "link-client nomad overlay already present on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "link-client-nomad"; then
  exit 0
fi
exit 1
