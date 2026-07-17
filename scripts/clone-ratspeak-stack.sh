#!/usr/bin/env bash
# Clone rsReticulum (pinned ref + mesh-client patches), rsLXMF, and rsNomad for rns-stack sidecar builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${REPO_ROOT}/.." && pwd)}"

RNS_DIR="${WORKSPACE_ROOT}/rsReticulum"
LXMF_DIR="${WORKSPACE_ROOT}/rsLXMF"
NOMAD_DIR="${WORKSPACE_ROOT}/rsNomad"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  git clone https://github.com/ratspeak/rsReticulum.git "${RNS_DIR}"
fi

"${SCRIPT_DIR}/apply-rsReticulum-packet-tap.sh"
"${SCRIPT_DIR}/apply-rsReticulum-auto-beacon-utun.sh"
"${SCRIPT_DIR}/apply-rsReticulum-link-client-nomad.sh"

if [[ ! -d "${LXMF_DIR}/.git" ]]; then
  # Full clone so apply-rsLXMF-* can fall back to RS_LXMF_REF if tip drifts.
  git clone https://github.com/ratspeak/rsLXMF.git "${LXMF_DIR}"
fi

"${SCRIPT_DIR}/apply-rsLXMF-propagation-sync-peering.sh"

if [[ ! -d "${NOMAD_DIR}/.git" ]]; then
  git clone https://github.com/Colorado-Mesh/rsNomad.git "${NOMAD_DIR}"
fi

echo "Ratspeak stack ready: rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD), rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD), rsNomad @ $(git -C "${NOMAD_DIR}" rev-parse --short HEAD)"
