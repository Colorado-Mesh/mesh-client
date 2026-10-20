#!/usr/bin/env bash
# Apply mesh-client rsReticulum slow-RF announce filter overlay.
# Non-standard policy (default on, toggle via TransportQuery::SetSlowRfAnnounceFilter):
# unsolicited internet-learned announces are not queued onto <=10 kbps RF interfaces;
# local + RF/internal-learned destinations and attached cached path responses still pass.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/apply-ratspeak-overlay.sh
source "${SCRIPT_DIR}/lib/apply-ratspeak-overlay.sh"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-slow-rf-announce-filter.patch"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
ACTOR_RS="${RNS_DIR}/crates/rns-transport/src/actor/mod.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  echo "Clone: git clone https://github.com/ratspeak/rsReticulum.git ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

if [[ -f "${ACTOR_RS}" ]] \
  && grep -q 'slow_rf_announce_filter_enabled' "${ACTOR_RS}" \
  && grep -q 'SetSlowRfAnnounceFilter' "${RNS_DIR}/crates/rns-transport/src/messages.rs" \
  && grep -q 'DropAnnounceQueue {' "${RNS_DIR}/crates/rns-transport/src/messages.rs"; then
  echo "slow-rf-announce-filter overlay already applied on rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD)"
  exit 0
fi

if apply_ratspeak_overlay_or_die "${RNS_DIR}" "${PATCH_FILE}" "slow-rf-announce-filter"; then
  exit 0
fi
exit 1
