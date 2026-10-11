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
