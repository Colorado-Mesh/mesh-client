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

# Pin rsNomad so CI/release do not float on an unreviewed main tip.
# Override with RS_NOMAD_REF=... or skip with RS_NOMAD_SKIP_PIN=1 (local hardening work).
RS_NOMAD_REF="${RS_NOMAD_REF:-6e3b288fbc6931b1e2633d986cf0d49608d578b7}"

if [[ ! -d "${NOMAD_DIR}/.git" ]]; then
  git clone https://github.com/Colorado-Mesh/rsNomad.git "${NOMAD_DIR}"
fi

if [[ "${RS_NOMAD_SKIP_PIN:-}" != "1" ]]; then
  current_nomad="$(git -C "${NOMAD_DIR}" rev-parse HEAD)"
  if [[ "${current_nomad}" != "${RS_NOMAD_REF}" ]]; then
    if [[ -n "$(git -C "${NOMAD_DIR}" status --porcelain)" ]]; then
      echo "warning: ${NOMAD_DIR} has uncommitted changes; skipping pin to ${RS_NOMAD_REF:0:12}" >&2
    else
      git -C "${NOMAD_DIR}" fetch --quiet origin "${RS_NOMAD_REF}" 2> /dev/null \
        || git -C "${NOMAD_DIR}" fetch --quiet origin
      git -C "${NOMAD_DIR}" checkout --quiet "${RS_NOMAD_REF}"
    fi
  fi
fi

echo "Ratspeak stack ready: rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD), rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD), rsNomad @ $(git -C "${NOMAD_DIR}" rev-parse --short HEAD)"
