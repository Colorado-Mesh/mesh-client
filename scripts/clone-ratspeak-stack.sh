#!/usr/bin/env bash
# Clone rsReticulum (pinned ref + mesh-client patches), rsLXMF, and rsNomad for rns-stack sidecar builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${REPO_ROOT}/.." && pwd)}"

RNS_DIR="${WORKSPACE_ROOT}/rsReticulum"
LXMF_DIR="${WORKSPACE_ROOT}/rsLXMF"
NOMAD_DIR="${WORKSPACE_ROOT}/rsNomad"

# Ensure an existing checkout has the correct origin remote and is on the
# pinned ref.  If the directory does not exist, clone it first.
ensure_repo() {
  local dir="$1" expected_origin="$2" pinned_ref="$3" label="$4"
  if [[ ! -d "${dir}/.git" ]]; then
    git clone "${expected_origin}" "${dir}"
  fi
  local actual_origin
  actual_origin="$(git -C "${dir}" remote get-url origin 2> /dev/null || true)"
  if [[ "${actual_origin}" != "${expected_origin}" ]]; then
    echo "info: ${label} origin is ${actual_origin}; updating to ${expected_origin}"
    git -C "${dir}" remote set-url origin "${expected_origin}"
  fi
  if [[ -n "${pinned_ref}" ]]; then
    local current_head
    current_head="$(git -C "${dir}" rev-parse HEAD 2> /dev/null || true)"
    if [[ "${current_head}" != "${pinned_ref}" ]]; then
      if [[ -n "$(git -C "${dir}" status --porcelain)" ]]; then
        echo "warning: ${dir} has uncommitted changes; skipping pin to ${pinned_ref:0:12}" >&2
      else
        git -C "${dir}" fetch --quiet origin "${pinned_ref}" 2> /dev/null \
          || git -C "${dir}" fetch --quiet origin
        git -C "${dir}" checkout --quiet "${pinned_ref}"
      fi
    fi
  fi
}

ensure_repo "${RNS_DIR}" 'https://github.com/ratspeak/rsReticulum.git' \
  '6d2b28475321bc15c8f60796513d8878b47ed3ab' 'rsReticulum'

"${SCRIPT_DIR}/apply-rsReticulum-packet-tap.sh"
"${SCRIPT_DIR}/apply-rsReticulum-auto-beacon-utun.sh"
"${SCRIPT_DIR}/apply-rsReticulum-link-client-nomad.sh"
"${SCRIPT_DIR}/apply-rsReticulum-rnode-tcp-activity-keepalive.sh"
"${SCRIPT_DIR}/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh"
"${SCRIPT_DIR}/apply-rsReticulum-discovery-announce-egress.sh"

ensure_repo "${LXMF_DIR}" 'https://github.com/ratspeak/rsLXMF.git' \
  '68ad7c835187c052c763bb28c41b04a655f35c64' 'rsLXMF'

"${SCRIPT_DIR}/apply-rsLXMF-propagation-sync-peering.sh"

# Pin rsNomad so CI/release do not float on an unreviewed main tip.
# Override with RS_NOMAD_REF=... or skip with RS_NOMAD_SKIP_PIN=1 (local hardening work).
RS_NOMAD_REF="${RS_NOMAD_REF:-6e3b288fbc6931b1e2633d986cf0d49608d578b7}"

if [[ "${RS_NOMAD_SKIP_PIN:-}" != "1" ]]; then
  ensure_repo "${NOMAD_DIR}" 'https://github.com/Colorado-Mesh/rsNomad.git' "${RS_NOMAD_REF}" 'rsNomad'
else
  ensure_repo "${NOMAD_DIR}" 'https://github.com/Colorado-Mesh/rsNomad.git' '' 'rsNomad'
fi

echo "Ratspeak stack ready: rsReticulum @ $(git -C "${RNS_DIR}" rev-parse --short HEAD), rsLXMF @ $(git -C "${LXMF_DIR}" rev-parse --short HEAD), rsNomad @ $(git -C "${NOMAD_DIR}" rev-parse --short HEAD)"
