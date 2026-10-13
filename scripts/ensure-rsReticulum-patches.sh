#!/usr/bin/env bash
# Ensure Ratspeak overlays required for mesh-client rns-stack builds are applied.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/ratspeak-overlay-apply-list.sh
source "${SCRIPT_DIR}/lib/ratspeak-overlay-apply-list.sh"
RNS_DIR="${RS_RETICULUM_DIR:-${REPO_ROOT}/.rsstack/rsReticulum}"
LXMF_DIR="${RS_LXMF_DIR:-${REPO_ROOT}/.rsstack/rsLXMF}"
NOMAD_DIR="${RS_NOMAD_DIR:-${REPO_ROOT}/.rsstack/rsNomad}"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "rsReticulum not found at ${RNS_DIR}; skipping overlay apply (stub build)"
  exit 0
fi

# Overlays are rebased for the reviewed pins, so they cannot apply on an older
# checkout. Re-pin the disposable .rsstack workspace (never external clones or
# local bisect overrides) through the clone script, which also re-applies overlays.
PINS_FILE="${REPO_ROOT}/reticulum-sidecar/ratspeak-stack-pins.env"
DEFAULT_WORKSPACE="${REPO_ROOT}/.rsstack"
stack_pin_is_stale() {
  local dir="$1" pin="$2" ref="$3" label="$4" head
  [[ -d "${dir}/.git" && -n "${pin}" ]] || return 1
  [[ "${dir}" == "${DEFAULT_WORKSPACE}/${label}" ]] || return 1
  [[ -z "${ref}" || "${ref}" == "${pin}" ]] || return 1
  head="$(git -C "${dir}" rev-parse HEAD 2> /dev/null || true)"
  [[ "${head}" != "${pin}" ]] || return 1
  echo "warning: ${label} stale pin (HEAD ${head:0:12}, pin ${pin:0:12}); re-pinning via clone-ratspeak-stack.sh" >&2
}

if [[ -r "${PINS_FILE}" && "${WORKSPACE_ROOT:-${DEFAULT_WORKSPACE}}" == "${DEFAULT_WORKSPACE}" ]]; then
  # shellcheck source=../reticulum-sidecar/ratspeak-stack-pins.env
  source "${PINS_FILE}"
  stale=0
  stack_pin_is_stale "${RNS_DIR}" "${RS_RETICULUM_PIN:-}" "${RS_RETICULUM_REF:-}" rsReticulum && stale=1
  stack_pin_is_stale "${LXMF_DIR}" "${RS_LXMF_PIN:-}" "${RS_LXMF_REF:-}" rsLXMF && stale=1
  stack_pin_is_stale "${NOMAD_DIR}" "${RS_NOMAD_PIN:-}" "${RS_NOMAD_REF:-}" rsNomad && stale=1
  if [[ "${stale}" -eq 1 ]]; then
    exec bash "${SCRIPT_DIR}/clone-ratspeak-stack.sh"
  fi
fi

apply_ratspeak_overlays_resetting_stale "${RNS_DIR}" apply_ratspeak_rns_overlays "${SCRIPT_DIR}"

if [[ ! -d "${LXMF_DIR}/.git" ]]; then
  echo "rsLXMF not found at ${LXMF_DIR}; skipping lxmf overlay apply"
  exit 0
fi

apply_ratspeak_overlays_resetting_stale "${LXMF_DIR}" apply_ratspeak_lxmf_overlays "${SCRIPT_DIR}"

if [[ ! -d "${NOMAD_DIR}/.git" ]]; then
  echo "rsNomad not found at ${NOMAD_DIR}; skipping nomad overlay apply"
  exit 0
fi

apply_ratspeak_overlays_resetting_stale "${NOMAD_DIR}" apply_ratspeak_nomad_overlays "${SCRIPT_DIR}"
