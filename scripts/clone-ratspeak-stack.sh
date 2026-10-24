#!/usr/bin/env bash
# Clone rsReticulum + rsLXMF + rsNomad + rsLXST + lrgp-rs at SHAs resolved from
# the latest published releases (reticulum-sidecar/ratspeak-stack-pins.env,
# refreshed by scripts/sync-ratspeak-releases.mjs), verify each checkout, then
# apply mesh-client overlays for sidecar builds.
set -euo pipefail

# Hooks export their repository/index paths. Nested Git commands must discover
# each dependency's own metadata instead of changing the caller's checkout.
while IFS= read -r rs_stack_git_var; do
  unset "${rs_stack_git_var}"
done < <(git rev-parse --local-env-vars)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Repo-local workspace (gitignored .rsstack/) so upstream mirror checkouts stay clean.
WORKSPACE_ROOT="${WORKSPACE_ROOT:-${REPO_ROOT}/.rsstack}"
PINS_FILE="${REPO_ROOT}/reticulum-sidecar/ratspeak-stack-pins.env"
# shellcheck source=lib/ratspeak-overlay-apply-list.sh
source "${SCRIPT_DIR}/lib/ratspeak-overlay-apply-list.sh"

if [[ ! -r "${PINS_FILE}" ]]; then
  echo "error: Ratspeak stack pin manifest missing: ${PINS_FILE}" >&2
  exit 1
fi
# shellcheck source=../reticulum-sidecar/ratspeak-stack-pins.env
source "${PINS_FILE}"

RNS_DIR="${WORKSPACE_ROOT}/rsReticulum"
LXMF_DIR="${WORKSPACE_ROOT}/rsLXMF"
NOMAD_DIR="${WORKSPACE_ROOT}/rsNomad"
LXST_DIR="${WORKSPACE_ROOT}/rsLXST"
LRGP_DIR="${WORKSPACE_ROOT}/lrgp-rs"

# So apply-*.sh targets the same siblings as this script (WORKSPACE_ROOT may differ from ..).
export RS_RETICULUM_DIR="${RNS_DIR}"
export RS_LXMF_DIR="${LXMF_DIR}"
export RS_NOMAD_DIR="${NOMAD_DIR}"

# Normal, CI, update, and release builds use the reviewed manifest. A developer
# may opt into one or more local bisect refs with
# MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE=1. Overrides are never accepted in CI
# or a release-channel build.
ALLOW_LOCAL_OVERRIDE="${MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE:-}"

# Reject malformed reviewed pins before any network or checkout operation.
validate_pin() {
  local value="$1" label="$2"
  if [[ ! "${value}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "error: ${label} pin must be a full lowercase 40-character commit SHA" >&2
    exit 1
  fi
}

# Select the reviewed pin unless an explicitly permitted local bisect override is supplied.
select_ref() {
  local env_name="$1" pin="$2" label="$3" supplied
  supplied="${!env_name:-}"
  if [[ -z "${supplied}" || "${supplied}" == "${pin}" ]]; then
    printf '%s' "${pin}"
    return 0
  fi
  if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" || "${MESH_CLIENT_BUILD_CHANNEL:-}" == 'release' ]]; then
    echo "error: ${label}: ${env_name} cannot override the reviewed pin in CI/release" >&2
    exit 1
  fi
  if [[ "${ALLOW_LOCAL_OVERRIDE}" != '1' ]]; then
    echo "error: ${label}: set MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE=1 for a local bisect override" >&2
    exit 1
  fi
  printf '%s' "${supplied}"
}

validate_pin "${RS_RETICULUM_PIN:-}" 'rsReticulum'
validate_pin "${RS_LXMF_PIN:-}" 'rsLXMF'
validate_pin "${RS_NOMAD_PIN:-}" 'rsNomad'
validate_pin "${RS_LXST_PIN:-}" 'rsLXST'
validate_pin "${RS_LRGP_PIN:-}" 'lrgp-rs'

RS_RETICULUM_REF="$(select_ref RS_RETICULUM_REF "${RS_RETICULUM_PIN}" 'rsReticulum')"
RS_LXMF_REF="$(select_ref RS_LXMF_REF "${RS_LXMF_PIN}" 'rsLXMF')"
RS_NOMAD_REF="$(select_ref RS_NOMAD_REF "${RS_NOMAD_PIN}" 'rsNomad')"
RS_LXST_REF="$(select_ref RS_LXST_REF "${RS_LXST_PIN}" 'rsLXST')"
RS_LRGP_REF="$(select_ref RS_LRGP_REF "${RS_LRGP_PIN}" 'lrgp-rs')"

# Last selected ref from ensure_repo.
ENSURE_REPO_SELECTED_REF=''

# Prove the expected origin serves an immutable pin without trusting objects
# already present in the destination checkout. A fresh bare object store keeps
# this compatible with Git versions that predate the refetch option.
verify_origin_serves_pin() {
  local expected_origin="$1" pin="$2" label="$3" proof_dir proof_sha
  proof_dir="$(mktemp -d "${TMPDIR:-/tmp}/mesh-ratspeak-origin-proof.XXXXXX")"
  if ! git init --bare --quiet "${proof_dir}" \
    || ! git -C "${proof_dir}" fetch --quiet "${expected_origin}" "${pin}"; then
    rm -rf -- "${proof_dir}"
    echo "error: ${label}: expected origin cannot serve reviewed pin ${pin}" >&2
    return 1
  fi
  proof_sha="$(git -C "${proof_dir}" rev-parse --verify 'FETCH_HEAD^{commit}' 2> /dev/null || true)"
  rm -rf -- "${proof_dir}"
  if [[ "${proof_sha}" != "${pin}" ]]; then
    echo "error: ${label}: expected origin returned ${proof_sha:-no commit} for reviewed pin ${pin}" >&2
    return 1
  fi
}

# Format status mode from the ref ensure_repo actually selected.
format_repo_mode() {
  local selected_ref="$1" requested_ref="$2" reviewed_pin="${3:-}"
  if [[ -n "${reviewed_pin}" && "${requested_ref}" == "${reviewed_pin}" ]]; then
    echo "latest-release SHA ${reviewed_pin:0:12}"
  else
    echo "local override ${selected_ref:0:12}"
  fi
}

# Ensure an existing checkout has the correct origin remote and is on the
# requested ref. If the directory does not exist, clone it first.
# Sets ENSURE_REPO_SELECTED_REF to the ref that was (or would be) checked out.
ensure_repo() {
  local dir="$1" expected_origin="$2" ref_or_empty="$3" label="$4" reviewed_pin="${5:-}"
  local immutable_pin_mode=0
  if [[ -n "${reviewed_pin}" && "${ref_or_empty}" == "${reviewed_pin}" ]]; then
    immutable_pin_mode=1
  fi
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

  local target_ref='' target_sha='' current_head
  current_head="$(git -C "${dir}" rev-parse HEAD 2> /dev/null || true)"

  if [[ -n "${ref_or_empty}" ]]; then
    target_ref="${ref_or_empty}"
    if [[ "${immutable_pin_mode}" -eq 1 ]]; then
      verify_origin_serves_pin "${expected_origin}" "${reviewed_pin}" "${label}" || exit 1
    fi
    if ! git -C "${dir}" fetch --quiet origin "${ref_or_empty}"; then
      echo "error: ${label}: cannot fetch requested ref ${ref_or_empty}" >&2
      exit 1
    fi
    target_sha="$(git -C "${dir}" rev-parse --verify 'FETCH_HEAD^{commit}' 2> /dev/null || true)"
    if [[ -z "${target_sha}" ]]; then
      echo "error: ${label}: fetched ref did not resolve to a commit" >&2
      exit 1
    fi
    if [[ "${immutable_pin_mode}" -eq 1 && "${target_sha}" != "${reviewed_pin}" ]]; then
      echo "error: ${label}: fetched commit ${target_sha} does not match reviewed pin ${ref_or_empty}" >&2
      exit 1
    fi
  else
    echo "error: ${label}: an immutable source ref is required" >&2
    exit 1
  fi

  ENSURE_REPO_SELECTED_REF="${target_ref}"

  if [[ -n "$(git -C "${dir}" status --porcelain)" ]]; then
    # Overlays leave checkouts dirty after a successful run. Reviewed pins must
    # always start clean; an explicit local override may preserve same-ref work.
    # - Default .rsstack workspace is disposable overlay cache → hard-reset, then checkout
    #   (overlays are re-applied after ensure_repo returns for RNS/LXMF).
    # - External WORKSPACE_ROOT (sibling clones with real WIP) still refuses unless
    #   RS_STACK_DISCARD_DIRTY=1.
    if [[ "${immutable_pin_mode}" -eq 0 && "${current_head}" == "${target_sha}" ]]; then
      echo "warning: ${dir} has uncommitted changes; already at ${target_ref} (${target_sha:0:12}), skipping checkout" >&2
      return 0
    fi
    local discard_dirty=0
    if [[ "${immutable_pin_mode}" -eq 1 && "$(basename "${WORKSPACE_ROOT}")" == '.rsstack' ]]; then
      discard_dirty=1
    elif [[ "${RS_STACK_DISCARD_DIRTY:-}" == '1' ]]; then
      discard_dirty=1
    elif [[ "$(basename "${WORKSPACE_ROOT}")" == '.rsstack' ]]; then
      discard_dirty=1
    fi
    if [[ "${discard_dirty}" -eq 1 ]]; then
      echo "warning: ${dir} has uncommitted changes; discarding to float/pin to ${target_ref} (${target_sha:0:12}) from ${current_head:0:12}" >&2
      git -C "${dir}" reset --hard HEAD > /dev/null
      git -C "${dir}" clean -fd > /dev/null
    else
      echo "error: ${dir} has uncommitted changes; refuse to float/pin to ${target_ref} (${target_sha:0:12}) from ${current_head:0:12} (stash or reset, or set RS_STACK_DISCARD_DIRTY=1)" >&2
      git -C "${dir}" status --short >&2 || true
      exit 1
    fi
  fi

  if [[ "${current_head}" != "${target_sha}" ]]; then
    git -C "${dir}" checkout --quiet --detach "${target_sha}"
  fi

  local verified_head
  verified_head="$(git -C "${dir}" rev-parse --verify HEAD)"
  if [[ "${verified_head}" != "${target_sha}" ]]; then
    echo "error: ${label}: checkout HEAD ${verified_head} does not match fetched commit ${target_sha}" >&2
    exit 1
  fi
}

# Allow tests to `source` this script and call ensure_repo without cloning remotes.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0
fi

echo "Preparing Ratspeak stack from latest-release resolved SHAs..."
ensure_repo "${RNS_DIR}" 'https://github.com/ratspeak/rsReticulum.git' \
  "${RS_RETICULUM_REF}" 'rsReticulum' "${RS_RETICULUM_PIN}"
rns_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_RETICULUM_REF}" "${RS_RETICULUM_PIN}")"

apply_ratspeak_rns_overlays "${SCRIPT_DIR}"

ensure_repo "${LXMF_DIR}" 'https://github.com/ratspeak/rsLXMF.git' \
  "${RS_LXMF_REF}" 'rsLXMF' "${RS_LXMF_PIN}"
lxmf_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_LXMF_REF}" "${RS_LXMF_PIN}")"

apply_ratspeak_lxmf_overlays "${SCRIPT_DIR}"

# Use the reviewed Colorado-Mesh/rsNomad pin (local bisect override above).
ensure_repo "${NOMAD_DIR}" 'https://github.com/Colorado-Mesh/rsNomad.git' \
  "${RS_NOMAD_REF}" 'rsNomad' "${RS_NOMAD_PIN}"
nomad_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_NOMAD_REF}" "${RS_NOMAD_PIN}")"

apply_ratspeak_nomad_overlays "${SCRIPT_DIR}"

# rsLXST (LXST telephony) — required for rns-stack voice.
ensure_repo "${LXST_DIR}" 'https://github.com/ratspeak/rsLXST.git' \
  "${RS_LXST_REF}" 'rsLXST' "${RS_LXST_PIN}"
lxst_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_LXST_REF}" "${RS_LXST_PIN}")"

# lrgp-rs (LRGP games) — required for rns-stack games.
ensure_repo "${LRGP_DIR}" 'https://github.com/ratspeak/lrgp-rs.git' \
  "${RS_LRGP_REF}" 'lrgp-rs' "${RS_LRGP_PIN}"
lrgp_mode="$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_LRGP_REF}" "${RS_LRGP_PIN}")"

rns_sha="$(git -C "${RNS_DIR}" rev-parse HEAD)"
lxmf_sha="$(git -C "${LXMF_DIR}" rev-parse HEAD)"
nomad_sha="$(git -C "${NOMAD_DIR}" rev-parse HEAD)"
lxst_sha="$(git -C "${LXST_DIR}" rev-parse HEAD)"
lrgp_sha="$(git -C "${LRGP_DIR}" rev-parse HEAD)"
echo "Ratspeak stack ready: rsReticulum @ ${rns_sha:0:12} (${rns_mode}), rsLXMF @ ${lxmf_sha:0:12} (${lxmf_mode}), rsNomad @ ${nomad_sha:0:12} (${nomad_mode}), rsLXST @ ${lxst_sha:0:12} (${lxst_mode}), lrgp-rs @ ${lrgp_sha:0:12} (${lrgp_mode})"
echo "Ratspeak stack SHAs (full): rsReticulum=${rns_sha} rsLXMF=${lxmf_sha} rsNomad=${nomad_sha} rsLXST=${lxst_sha} lrgp-rs=${lrgp_sha}"
# Record the verified SHAs alongside every packaged artifact.
{
  echo "rsReticulum=${rns_sha}"
  echo "rsLXMF=${lxmf_sha}"
  echo "rsNomad=${nomad_sha}"
  echo "rsLXST=${lxst_sha}"
  echo "lrgp-rs=${lrgp_sha}"
} > "${WORKSPACE_ROOT}/RESOLVED_SHAS.txt"
