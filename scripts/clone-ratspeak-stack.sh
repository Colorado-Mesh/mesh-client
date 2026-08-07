#!/usr/bin/env bash
# Clone rsReticulum + rsLXMF + rsNomad + rsLXST + lrgp-rs (float origin/main by default),
# then apply mesh-client overlays for rns-stack sidecar builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Repo-local workspace (gitignored .rsstack/) so upstream mirror checkouts stay clean.
WORKSPACE_ROOT="${WORKSPACE_ROOT:-${REPO_ROOT}/.rsstack}"
# shellcheck source=lib/ratspeak-overlay-apply-list.sh
source "${SCRIPT_DIR}/lib/ratspeak-overlay-apply-list.sh"

RNS_DIR="${WORKSPACE_ROOT}/rsReticulum"
LXMF_DIR="${WORKSPACE_ROOT}/rsLXMF"
NOMAD_DIR="${WORKSPACE_ROOT}/rsNomad"
LXST_DIR="${WORKSPACE_ROOT}/rsLXST"
LRGP_DIR="${WORKSPACE_ROOT}/lrgp-rs"

# So apply-*.sh targets the same siblings as this script (WORKSPACE_ROOT may differ from ..).
export RS_RETICULUM_DIR="${RNS_DIR}"
export RS_LXMF_DIR="${LXMF_DIR}"

# Optional bisect / known-good overrides. Unset or empty → float to origin/main.
RS_RETICULUM_REF="${RS_RETICULUM_REF:-}"
RS_LXMF_REF="${RS_LXMF_REF:-}"
RS_NOMAD_REF="${RS_NOMAD_REF:-}"
RS_LXST_REF="${RS_LXST_REF:-}"
RS_LRGP_REF="${RS_LRGP_REF:-}"

# Last selected ref from ensure_repo (origin/main, origin/master, or pin).
ENSURE_REPO_SELECTED_REF=''

# Format status mode from the ref ensure_repo actually selected.
format_repo_mode() {
  local selected_ref="$1" pin_ref="$2"
  if [[ -n "${pin_ref}" ]]; then
    echo "pinned ${pin_ref:0:12}"
  else
    echo "floated ${selected_ref}"
  fi
}

# Ensure an existing checkout has the correct origin remote and is on the
# requested ref (or floated origin/main). If the directory does not exist, clone it first.
# Sets ENSURE_REPO_SELECTED_REF to the ref that was (or would be) checked out.
ensure_repo() {
  local dir="$1" expected_origin="$2" ref_or_empty="$3" label="$4"
  ENSURE_REPO_SELECTED_REF=''
  if [[ ! -d "${dir}/.git" ]]; then
    git clone "${expected_origin}" "${dir}"
  fi
  local actual_origin
  actual_origin="$(git -C "${dir}" remote get-url origin 2> /dev/null || true)"
  if [[ "${actual_origin}" != "${expected_origin}" ]]; then
    echo "info: ${label} origin is ${actual_origin}; updating to ${expected_origin}"
    git -C "${dir}" remote set-url origin "${expected_origin}"
  fi

  git -C "${dir}" fetch --quiet origin

  local target_ref='' target_sha='' current_head
  current_head="$(git -C "${dir}" rev-parse HEAD 2> /dev/null || true)"

  if [[ -n "${ref_or_empty}" ]]; then
    target_ref="${ref_or_empty}"
    git -C "${dir}" fetch --quiet origin "${ref_or_empty}" 2> /dev/null || true
    target_sha="$(git -C "${dir}" rev-parse --verify "${ref_or_empty}^{commit}" 2> /dev/null || true)"
    if [[ -z "${target_sha}" ]]; then
      # Branch/tag pins often resolve only as origin/<name> after fetch.
      target_sha="$(
        git -C "${dir}" rev-parse --verify "origin/${ref_or_empty}^{commit}" 2> /dev/null || true
      )"
      if [[ -n "${target_sha}" ]]; then
        target_ref="origin/${ref_or_empty}"
      fi
    fi
    if [[ -z "${target_sha}" ]]; then
      echo "error: ${label}: cannot resolve pin ${ref_or_empty:0:12}" >&2
      exit 1
    fi
  else
    # Float to tip of origin/main (fallback: origin/master).
    if git -C "${dir}" rev-parse --verify --quiet 'origin/main' > /dev/null; then
      target_ref='origin/main'
    elif git -C "${dir}" rev-parse --verify --quiet 'origin/master' > /dev/null; then
      target_ref='origin/master'
    else
      echo "error: ${label}: neither origin/main nor origin/master after fetch" >&2
      exit 1
    fi
    target_sha="$(git -C "${dir}" rev-parse --verify "${target_ref}^{commit}")"
  fi

  ENSURE_REPO_SELECTED_REF="${target_ref}"

  if [[ -n "$(git -C "${dir}" status --porcelain)" ]]; then
    # Overlays leave siblings dirty after a successful float — allow that when already
    # on the target tip. Refuse only when checkout would rewrite a dirty tree.
    if [[ "${current_head}" == "${target_sha}" ]]; then
      echo "warning: ${dir} has uncommitted changes; already at ${target_ref} (${target_sha:0:12}), skipping checkout" >&2
      return 0
    fi
    echo "error: ${dir} has uncommitted changes; refuse to float/pin to ${target_ref} (${target_sha:0:12}) from ${current_head:0:12} (stash or reset, then re-run)" >&2
    git -C "${dir}" status --short >&2 || true
    exit 1
  fi

  if [[ "${current_head}" != "${target_sha}" ]]; then
    if [[ -n "${ref_or_empty}" ]]; then
      git -C "${dir}" checkout --quiet "${ref_or_empty}"
    else
      git -C "${dir}" checkout --quiet --detach "${target_ref}"
    fi
  fi
}

# Allow tests to `source` this script and call ensure_repo without cloning remotes.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0
fi

echo "Preparing Ratspeak stack (rsReticulum/rsLXMF/rsNomad/rsLXST/lrgp-rs float origin/main unless RS_*_REF set)..."
ensure_repo "${RNS_DIR}" 'https://github.com/ratspeak/rsReticulum.git' \
  "${RS_RETICULUM_REF}" 'rsReticulum'
rns_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_RETICULUM_REF}")"

apply_ratspeak_rns_overlays "${SCRIPT_DIR}"

ensure_repo "${LXMF_DIR}" 'https://github.com/ratspeak/rsLXMF.git' \
  "${RS_LXMF_REF}" 'rsLXMF'
lxmf_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_LXMF_REF}")"

apply_ratspeak_lxmf_overlays "${SCRIPT_DIR}"

# Float Colorado-Mesh/rsNomad to origin/main (override via RS_NOMAD_REF above).
ensure_repo "${NOMAD_DIR}" 'https://github.com/Colorado-Mesh/rsNomad.git' "${RS_NOMAD_REF}" 'rsNomad'
nomad_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_NOMAD_REF}")"

# rsLXST (LXST telephony) — required for rns-stack voice; float origin/main unless RS_LXST_REF set.
ensure_repo "${LXST_DIR}" 'https://github.com/ratspeak/rsLXST.git' "${RS_LXST_REF}" 'rsLXST'
lxst_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_LXST_REF}")"

# lrgp-rs (LRGP games) — required for rns-stack games; float origin/main unless RS_LRGP_REF set.
ensure_repo "${LRGP_DIR}" 'https://github.com/ratspeak/lrgp-rs.git' "${RS_LRGP_REF}" 'lrgp-rs'
lrgp_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_LRGP_REF}")"

rns_sha="$(git -C "${RNS_DIR}" rev-parse HEAD)"
lxmf_sha="$(git -C "${LXMF_DIR}" rev-parse HEAD)"
nomad_sha="$(git -C "${NOMAD_DIR}" rev-parse HEAD)"
lxst_sha="$(git -C "${LXST_DIR}" rev-parse HEAD)"
lrgp_sha="$(git -C "${LRGP_DIR}" rev-parse HEAD)"
echo "Ratspeak stack ready: rsReticulum @ ${rns_sha:0:12} (${rns_mode}), rsLXMF @ ${lxmf_sha:0:12} (${lxmf_mode}), rsNomad @ ${nomad_sha:0:12} (${nomad_mode}), rsLXST @ ${lxst_sha:0:12} (${lxst_mode}), lrgp-rs @ ${lrgp_sha:0:12} (${lrgp_mode})"
echo "Ratspeak stack SHAs (full): rsReticulum=${rns_sha} rsLXMF=${lxmf_sha} rsNomad=${nomad_sha} rsLXST=${lxst_sha} lrgp-rs=${lrgp_sha}"
