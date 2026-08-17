#!/usr/bin/env bash
set -e

LOCKFILE='pnpm-lock.yaml'

# Opt-in: reclaim reticulum-sidecar/target after a successful rebuild.
# Prefer CLEAN_SIDECAR_TARGET=1; --clean-target also works via
# `pnpm run update -- --clean-target`.
CLEAN_SIDECAR_TARGET="${CLEAN_SIDECAR_TARGET:-0}"
for arg in "$@"; do
  case "${arg}" in
    --clean-target)
      CLEAN_SIDECAR_TARGET=1
      ;;
    *)
      echo "Error: unknown argument: ${arg}" >&2
      echo 'Usage: scripts/update.sh [--clean-target]' >&2
      exit 1
      ;;
  esac
done

# Test hook: exercise arg parsing without running the rest of the update.
if [ "${UPDATE_SH_TEST_HOOK:-}" = 'parse-only' ]; then
  printf 'CLEAN_SIDECAR_TARGET=%s\n' "${CLEAN_SIDECAR_TARGET}"
  exit 0
fi

# Terminal colors
if [ -t 1 ]; then
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''
  YELLOW=''
  BOLD=''
  NC=''
fi

# Get resolved version of a package from pnpm-lock.yaml
# Usage: get_version "<lockfile-key>"
# Example: get_version "@jsr/meshtastic__core" -> "2.6.6"
get_version() {
  local key="$1"
  if [ -z "$key" ]; then
    echo ''
    return 0
  fi
  if ! command -v node > /dev/null 2>&1; then
    echo "Error: node is required to parse ${LOCKFILE}." >&2
    return 1
  fi
  node - "$key" "$LOCKFILE" << 'EOF'
const fs = require('node:fs');

const key = process.argv[2];
const lockfile = process.argv[3];
const lock = fs.readFileSync(lockfile, 'utf8');
const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp(`^  ['"]?${escaped}@([^'":]+)['"]?:`, 'm');
const match = lock.match(re);
process.stdout.write(match?.[1] ?? '');
EOF
}

# Get resolved rustc version (empty if not installed)
get_rustc_version() {
  if command -v rustc > /dev/null 2>&1; then
    rustc --version 2> /dev/null | awk '{print $2}'
  else
    echo ''
  fi
}

# Update Rust toolchain when rustup or Homebrew rust is available
update_rust_toolchain() {
  if command -v rustup > /dev/null 2>&1; then
    echo 'Updating Rust toolchain (rustup update)...'
    rustup update
    return 0
  fi
  if [ "$(uname -s 2> /dev/null || true)" = 'Darwin' ] && command -v brew > /dev/null 2>&1; then
    if brew list rust > /dev/null 2>&1; then
      echo 'rustup not found; upgrading Homebrew rust...'
      brew upgrade rust
      return 0
    fi
  fi
  if command -v cargo > /dev/null 2>&1; then
    echo 'cargo found without rustup — skipping automatic Rust update.'
    echo '  Prefer https://rustup.rs for CI parity, or upgrade via your package manager.'
    return 0
  fi
  echo 'Rust not installed — skipping toolchain update and sidecar rebuild (optional; see docs/development-environment.md#reticulum-sidecar-optional).'
  return 0
}

# Rebuild Reticulum sidecar after dependency/toolchain updates
rebuild_reticulum_sidecar() {
  if [ ! -f 'reticulum-sidecar/Cargo.toml' ]; then
    return 0
  fi
  if ! command -v cargo > /dev/null 2>&1; then
    echo 'cargo not on PATH — skipping Reticulum sidecar rebuild.'
    return 0
  fi
  echo 'Preparing rsReticulum, rsLXMF, rsNomad, rsLXST, and lrgp-rs functionality check...'
  local sidecar_dir='reticulum-sidecar'
  # Paths match reticulum-sidecar/Cargo.toml (../.rsstack/* from the sidecar dir).
  local rns_runtime='../.rsstack/rsReticulum/crates/rns-runtime/Cargo.toml'
  local lxmf_core='../.rsstack/rsLXMF/crates/lxmf-core/Cargo.toml'
  local nomad_core='../.rsstack/rsNomad/crates/nomad-core/Cargo.toml'
  local lxst_telephony='../.rsstack/rsLXST/crates/lxst-telephony/Cargo.toml'
  local lrgp_crate='../.rsstack/lrgp-rs/Cargo.toml'
  bash scripts/clone-ratspeak-stack.sh
  local missing_manifest=''
  local manifest
  for manifest in "${rns_runtime}" "${lxmf_core}" "${nomad_core}" "${lxst_telephony}" "${lrgp_crate}"; do
    if [ ! -f "${sidecar_dir}/${manifest}" ]; then
      missing_manifest="${sidecar_dir}/${manifest}"
      break
    fi
  done
  if [ -n "${missing_manifest}" ]; then
    echo "Error: required rs stack manifest missing after preparation: ${missing_manifest}" >&2
    return 1
  fi
  echo 'Checking rsReticulum, rsLXMF, rsNomad, rsLXST, and lrgp-rs via full-feature sidecar build...'
  (cd "${sidecar_dir}" && cargo build --features rns-stack,rns-ble,rns-rnode-tcp)
  if [ "${CLEAN_SIDECAR_TARGET}" = '1' ]; then
    echo 'CLEAN_SIDECAR_TARGET=1: removing reticulum-sidecar/target (next sidecar build will be cold)...'
    (cd "${sidecar_dir}" && cargo clean)
  fi
}

# Test hook: exercise rebuild_reticulum_sidecar with PATH stubs (no pnpm update).
if [ "${UPDATE_SH_TEST_HOOK:-}" = 'rebuild-only' ]; then
  rebuild_reticulum_sidecar
  exit $?
fi

# Print a highlighted warning box for an updated package
warn_box() {
  local pkg="$1" old_ver="$2" new_ver="$3" url="$4"
  local divider='########################################################################'
  local padding='#                                                                      #'

  echo ''
  echo -e "${YELLOW}${divider}${NC}"
  echo -e "${YELLOW}${padding}${NC}"
  echo -e "${YELLOW}#  ${RED}⚠  WARNING:${YELLOW} ${BOLD}${pkg}${NC}${YELLOW} was updated                        #${NC}"
  echo -e "${YELLOW}${padding}${NC}"
  printf "${YELLOW}#     ${NC}${BOLD}%-12s${NC} ${YELLOW}→${NC} ${BOLD}%-12s${NC}${YELLOW}                                  #${NC}\n" "${old_ver}" "${new_ver}"
  echo -e "${YELLOW}${padding}${NC}"
  echo -e "${YELLOW}#  Review changes before committing:                                #${NC}"
  echo -e "${YELLOW}#  ${NC}${url}${YELLOW}  #${NC}"
  echo -e "${YELLOW}${padding}${NC}"
  echo -e "${YELLOW}#  Run manual checks:                                               #${NC}"
  echo -e "${YELLOW}#    pnpm run typecheck && pnpm run lint && pnpm run test:run       #${NC}"
  echo -e "${YELLOW}${padding}${NC}"
  echo -e "${YELLOW}${divider}${NC}"
  echo ''
}

# Query GitHub PR state for ratspeak overlays (merged|open|closed|unknown).
# Uses `gh` when available, otherwise unauthenticated api.github.com.
github_pr_state() {
  local repo="$1" pr="$2"
  local json=''
  if command -v gh > /dev/null 2>&1; then
    json="$(gh api "repos/${repo}/pulls/${pr}" 2> /dev/null || true)"
  elif command -v curl > /dev/null 2>&1; then
    json="$(
      curl -fsSL \
        -H 'Accept: application/vnd.github+json' \
        -H 'User-Agent: mesh-client-update' \
        "https://api.github.com/repos/${repo}/pulls/${pr}" 2> /dev/null || true
    )"
  else
    echo 'unknown'
    return 0
  fi
  if [ -z "${json}" ]; then
    echo 'unknown'
    return 0
  fi
  printf '%s' "${json}" | node -e '
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    if (j.merged === true || j.merged_at) process.stdout.write("merged");
    else if (j.state === "open") process.stdout.write("open");
    else if (j.state === "closed") process.stdout.write("closed");
    else process.stdout.write("unknown");
  } catch {
    process.stdout.write("unknown");
  }
});
' 2> /dev/null || echo 'unknown'
}

# Warn when local Ratspeak overlays may be obsolete after upstream merges.
# Keep patch basenames in sync with scripts/lib/ratspeak-overlay-apply-list.sh
# and reticulum-sidecar/patches/*.patch / patches/README.md.
check_ratspeak_patches() {
  # Format: "patch-basename|github-owner/repo|pr-number-or-empty|display-label|review-url"
  local RATSPEAK_PATCH_ENTRIES=(
    'rsReticulum-packet-tap.patch|ratspeak/rsReticulum|10|rsReticulum packet-tap|https://github.com/ratspeak/rsReticulum/pull/10'
    'rsReticulum-path-medium-slots.patch|ratspeak/rsReticulum||rsReticulum path-medium slots|'
    'rsReticulum-auto-beacon-utun.patch|ratspeak/rsReticulum|11|rsReticulum auto-beacon utun|https://github.com/ratspeak/rsReticulum/pull/11'
    'rsReticulum-link-client-nomad.patch|ratspeak/rsReticulum|14|rsReticulum LinkClient Nomad|https://github.com/ratspeak/rsReticulum/pull/14'
    'rsReticulum-link-client-proof-budget.patch|ratspeak/rsReticulum||rsReticulum LinkClient proof-budget remaining-deadline|'
    'rsReticulum-ble-rnode-pairing-transition-debounce.patch|ratspeak/rsReticulum|20|rsReticulum BLE RNode pairing-transition debounce|https://github.com/ratspeak/rsReticulum/pull/20'
    'rsReticulum-ble-rnode-bond-desync.patch|ratspeak/rsReticulum|21|rsReticulum BLE RNode bond-desync halt + bond-aware reconnect|https://github.com/ratspeak/rsReticulum/pull/21'
    'rsReticulum-discovery-announce-egress.patch|ratspeak/rsReticulum|19|rsReticulum discovery announce egress|https://github.com/ratspeak/rsReticulum/pull/19'
    'rsReticulum-inbound-raw-saturation-log.patch|ratspeak/rsReticulum||rsReticulum inbound-raw saturation log|'
    'rsReticulum-interface-tx-queue-stats.patch|ratspeak/rsReticulum||rsReticulum interface TX queue stats|'
    'rsReticulum-announce-rebroadcast-exclude-rf.patch|ratspeak/rsReticulum||rsReticulum announce rebroadcast exclude RF sinks (ratspeak/rsReticulum#24)|https://github.com/ratspeak/rsReticulum/issues/24'
    'rsLXMF-propagation-sync-peering.patch|ratspeak/rsLXMF|4|rsLXMF propagation sync peering|https://github.com/ratspeak/rsLXMF/pull/4'
    'rsLXMF-propagation-node-policy-setters.patch|ratspeak/rsLXMF|6|rsLXMF PropagationNode policy setters|https://github.com/ratspeak/rsLXMF/pull/6'
    'rsLXMF-propagation-node-deferred-messagestore-load.patch|ratspeak/rsLXMF||rsLXMF PropagationNode deferred messagestore load|'
    'rsLXMF-link-delivery-has-pending-to.patch|ratspeak/rsLXMF||rsLXMF LinkDeliveryManager has_pending_to|'
    'rsLXMF-propagation-client-abort-transfer.patch|ratspeak/rsLXMF||rsLXMF PropagationClient abort_transfer for cancelled Sync|'
  )
  local patches_dir='reticulum-sidecar/patches'
  local has_ratspeak_warning=0

  echo ''
  echo 'Checking Ratspeak overlay patches (rsReticulum / rsLXMF)...'

  if [ ! -d "${patches_dir}" ]; then
    echo "  ${patches_dir} missing — skip."
    return 0
  fi

  # Flag patch files not listed in RATSPEAK_PATCH_ENTRIES (same sync rule as WATCH_ENTRIES).
  local known_basenames=()
  local entry
  for entry in "${RATSPEAK_PATCH_ENTRIES[@]}"; do
    IFS='|' read -r patch_base _rest <<< "${entry}"
    known_basenames+=("${patch_base}")
  done
  local patch_path
  for patch_path in "${patches_dir}"/*.patch; do
    [ -f "${patch_path}" ] || continue
    local base
    base="$(basename "${patch_path}")"
    local found=0
    local known
    for known in "${known_basenames[@]}"; do
      if [ "${known}" = "${base}" ]; then
        found=1
        break
      fi
    done
    if [ "${found}" -eq 0 ]; then
      echo -e "  ${YELLOW}Untracked overlay:${NC} ${base} — add to RATSPEAK_PATCH_ENTRIES in scripts/update.sh"
      has_ratspeak_warning=1
      HAS_WARNING=1
    fi
  done

  for entry in "${RATSPEAK_PATCH_ENTRIES[@]}"; do
    IFS='|' read -r patch_base repo pr label url <<< "${entry}"
    local file="${patches_dir}/${patch_base}"
    local patch_present=0
    if [ -f "${file}" ]; then
      patch_present=1
    fi
    if [ "${patch_present}" -eq 0 ] && [ -z "${pr}" ]; then
      echo "  ${label}: patch file absent (${patch_base}) — already removed?"
      continue
    fi
    if [ "${patch_present}" -eq 1 ] && [ -z "${pr}" ]; then
      echo "  ${label}: local overlay present; no tracked PR — review sunset"
      echo "    See reticulum-sidecar/patches/README.md (sunset when upstream lands)."
      continue
    fi
    local state
    state="$(github_pr_state "${repo}" "${pr}")"
    case "${state}" in
      merged)
        if [ "${patch_present}" -eq 1 ]; then
          warn_box "${label} (Ratspeak overlay)" "local patch" "upstream MERGED" "${url}"
          echo "  Reason tracked: ${repo}#${pr} merged — remove ${file} and drop apply steps"
          echo "    (clone-ratspeak-stack.sh / ensure-rsReticulum-patches.sh / apply-*.sh)."
          has_ratspeak_warning=1
          HAS_WARNING=1
        else
          echo "  ${label}: patch absent and ${repo}#${pr} merged — drop entry from RATSPEAK_PATCH_ENTRIES."
        fi
        ;;
      open)
        if [ "${patch_present}" -eq 1 ]; then
          echo "  ${label}: upstream PR still open — ${url}"
        else
          warn_box "${label} (Ratspeak overlay)" "patch absent" "PR still open" "${url}"
          echo "  Reason tracked: ${repo}#${pr} open but ${patch_base} missing — restore overlay or drop entry."
          has_ratspeak_warning=1
          HAS_WARNING=1
        fi
        ;;
      closed)
        # Still warn when the .patch is already gone so closed-without-merge stays visible
        # until sunset is confirmed and the entry is dropped from RATSPEAK_PATCH_ENTRIES.
        warn_box "${label} (Ratspeak overlay)" "local patch" "PR closed (not merged?)" "${url}"
        if [ "${patch_present}" -eq 1 ]; then
          echo "  Reason tracked: ${repo}#${pr} closed without merge — verify overlay still needed."
        else
          echo "  Reason tracked: ${repo}#${pr} closed without merge; ${patch_base} already absent —"
          echo "    confirm sunset (or restore overlay), then drop entry from RATSPEAK_PATCH_ENTRIES."
        fi
        has_ratspeak_warning=1
        HAS_WARNING=1
        ;;
      *)
        echo "  ${label}: could not query ${repo}#${pr} (install gh or check network) — ${url}"
        ;;
    esac
  done

  if [ "${has_ratspeak_warning}" -eq 0 ]; then
    echo '  Ratspeak overlay check complete (no merge-ready removals detected).'
  fi
}

# GET GitHub API path (gh preferred, curl fallback). Body on stdout.
# Exit 0 = body (may be empty), exit 2 = rate-limit payload detected (empty body).
# Callers must handle exit 2 in the parent shell (command substitution drops side effects).
github_api_get() {
  local api_path="$1"
  local body=''
  if command -v gh > /dev/null 2>&1; then
    body="$(gh api "${api_path}" 2> /dev/null || true)"
  elif command -v curl > /dev/null 2>&1; then
    # Do not use curl -f: rate-limit JSON lives on non-2xx and must be inspectable.
    local resp
    resp="$(
      curl -sSL \
        -H 'Accept: application/vnd.github+json' \
        -H 'User-Agent: mesh-client-update' \
        -w $'\n%{http_code}' \
        "https://api.github.com/${api_path}" 2> /dev/null || true
    )"
    # Strip trailing HTTP status line written by -w; keep error JSON body for detection.
    body="${resp%$'\n'*}"
  else
    printf ''
    return 0
  fi
  if [[ -n "${body}" ]] && printf '%s' "${body}" | grep -qiE 'rate limit exceeded|API rate limit|secondary rate limit'; then
    printf ''
    return 2
  fi
  printf '%s' "${body}"
  return 0
}

warn_github_api_rate_limit_once() {
  if [[ "${GITHUB_API_RATE_LIMIT_WARNED:-0}" != '1' ]]; then
    echo -e "  ${YELLOW}GitHub API rate limit:${NC} further Ratspeak upstream checks may be incomplete (retry later or use authenticated gh)."
    GITHUB_API_RATE_LIMIT_WARNED=1
    HAS_WARNING=1
  fi
}

# Latest release summary: "tag|published_at|first_body_line|four" or empty.
# four is 1 when the published release body mentions Four in a Row.
# /releases/latest ignores drafts and prereleases (in-flight tags/main/RCs).
github_latest_release_summary() {
  local repo="$1"
  local json=''
  local api_rc=0
  json="$(github_api_get "repos/${repo}/releases/latest")" || api_rc=$?
  if [ "${api_rc}" -eq 2 ]; then
    warn_github_api_rate_limit_once
    echo ''
    return 0
  fi
  if [ -z "${json}" ]; then
    echo ''
    return 0
  fi
  printf '%s' "${json}" | node -e '
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    if (j.message === "Not Found" || (!j.tag_name && !j.name)) {
      process.stdout.write("");
      return;
    }
    const tag = String(j.tag_name || j.name || "").replace(/\|/g, "/");
    const published = String(j.published_at || "").slice(0, 10);
    const rawBody = String(j.body || "");
    const body = rawBody.split(/\r?\n/).find((l) => l.trim()) || "";
    const first = body
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\|/g, "/")
      .slice(0, 120);
    const four = /four[\s_-]*in[\s_-]*a[\s_-]*row/i.test(rawBody) ? "1" : "0";
    process.stdout.write(`${tag}|${published}|${first}|${four}`);
  } catch {
    process.stdout.write("");
  }
});
' 2> /dev/null || echo ''
}

# Latest commit SHA that touched path, or empty.
github_file_latest_commit() {
  local repo="$1" file_path="$2"
  local json=''
  local api_rc=0
  json="$(github_api_get "repos/${repo}/commits?path=${file_path}&per_page=1")" || api_rc=$?
  if [ "${api_rc}" -eq 2 ]; then
    warn_github_api_rate_limit_once
    echo ''
    return 0
  fi
  if [ -z "${json}" ]; then
    echo ''
    return 0
  fi
  printf '%s' "${json}" | node -e '
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    if (!Array.isArray(j) || !j[0] || !j[0].sha) {
      process.stdout.write("");
      return;
    }
    process.stdout.write(String(j[0].sha).replace(/\|/g, ""));
  } catch {
    process.stdout.write("");
  }
});
' 2> /dev/null || echo ''
}

# 1 if GitHub compare base...head mentions Four in a Row; else 0.
github_compare_mentions_four_in_a_row() {
  local repo="$1" base="$2" head="$3"
  local json=''
  local api_rc=0
  json="$(github_api_get "repos/${repo}/compare/${base}...${head}")" || api_rc=$?
  if [ "${api_rc}" -eq 2 ]; then
    warn_github_api_rate_limit_once
    echo '0'
    return 0
  fi
  if [ -z "${json}" ]; then
    echo '0'
    return 0
  fi
  printf '%s' "${json}" | node -e '
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    const files = Array.isArray(j.files) ? j.files : [];
    const hay = files
      .map((f) => `${f.filename || ""}\n${f.patch || ""}`)
      .join("\n");
    process.stdout.write(/four[\s_-]*in[\s_-]*a[\s_-]*row/i.test(hay) ? "1" : "0");
  } catch {
    process.stdout.write("0");
  }
});
' 2> /dev/null || echo '0'
}

# Compare published release tags (strip a leading v; case-insensitive).
release_refs_equal() {
  node -e '
const norm = (t) => String(t).trim().replace(/^v/i, "").toLowerCase();
const a = norm(process.argv[1]);
const b = norm(process.argv[2]);
process.exit(a && b && a === b ? 0 : 1);
' "$1" "$2" 2> /dev/null
}

# Compare git SHAs (lowercase hex; prefix match allowed).
commit_shas_equal() {
  node -e '
const norm = (s) => String(s).toLowerCase().replace(/[^0-9a-f]/g, "");
const a = norm(process.argv[1]);
const b = norm(process.argv[2]);
if (!a || !b) process.exit(1);
process.exit(a === b || a.startsWith(b) || b.startsWith(a) ? 0 : 1);
' "$1" "$2" 2> /dev/null
}

# Curated release watch + known org repos (keep in sync when adopting new ratspeak libs).
# Format: "owner/repo|stub-kind-or-empty|display-label|reviewed-ref"
# reviewed-ref: last published GitHub Release tag we reviewed, or
#   file:<path>@<sha> for repos without releases (vendored file commit).
#   Empty = no published release expected yet; tags/main/RCs are ignored.
# stub-kind: games → warn while mesh-client still has sidecar stubs only.
# stub-kind: games-parity → warn only when a published release is newer than reviewed-ref.
# (voice/games stubs cleared after lxst-telephony / lrgp-rs integration; empty stub = informational.)
RATSPEAK_RELEASE_WATCH_ENTRIES=(
  'ratspeak/rsLXST||rsLXST voice (lxst-telephony)|v0.1.2'
  'ratspeak/lrgp-rs||lrgp-rs games (LRGP)|'
  'ratspeak/Ratspeak|games-parity|Ratspeak client (review Games tab parity)|v1.0.25'
  'ratspeak/LXMFace||LXMFace identicons (vendored in renderer)|file:js/lxmface.js@308a729d5bf951880633e5e174b3b7628203106b'
  'ratspeak/Ratspeak||Ratspeak identity vault (vendored in sidecar)|file:crates/ratspeak-runtime/src/vault.rs@19e2a0d19202d4c7562adba79ac706ec352fdb86'
)

RATSPEAK_KNOWN_ORG_REPOS=(
  '.github'
  'C6-Reticulum-ASM'
  'LXMFace'
  'Ratspeak'
  'lrgp-py'
  'lrgp-rs'
  'microReticulum'
  'ratkey'
  'rathole'
  'ratspeak-docs'
  'ratspeak-website'
  'revanity-go'
  'rsCardputer'
  'rsDeck'
  'rsLXMF'
  'rsLXST'
  'rsPager'
  'rsReticulum'
)

print_ratspeak_upstream_catalog() {
  local entry
  echo 'RATSPEAK_RELEASE_WATCH_ENTRIES:'
  for entry in "${RATSPEAK_RELEASE_WATCH_ENTRIES[@]}"; do
    echo "  ${entry}"
  done
  echo 'RATSPEAK_KNOWN_ORG_REPOS:'
  for entry in "${RATSPEAK_KNOWN_ORG_REPOS[@]}"; do
    echo "  ${entry}"
  done
}

# Surface new Ratspeak library releases and brand-new org repos (stack floats via clone).
# Warn only when a published GitHub Release (or vendored file commit) differs from reviewed-ref.
check_ratspeak_upstream() {
  local has_upstream_warning=0
  local entry repo stub label reviewed summary tag published first four url
  local file_spec file_path file_sha latest_sha short_pin short_latest cmp_four

  echo ''
  echo 'Checking Ratspeak upstream published releases and new org repos...'
  echo '  (tags/main/RCs without a GitHub Release are ignored; rsReticulum/rsLXMF float via clone-ratspeak-stack.sh)'

  for entry in "${RATSPEAK_RELEASE_WATCH_ENTRIES[@]}"; do
    IFS='|' read -r repo stub label reviewed <<< "${entry}"
    url="https://github.com/${repo}/releases"

    if [[ "${reviewed}" == file:* ]]; then
      file_spec="${reviewed#file:}"
      file_path="${file_spec%@*}"
      file_sha="${file_spec##*@}"
      if [ -z "${file_path}" ] || [ -z "${file_sha}" ] || [ "${file_path}" = "${file_spec}" ]; then
        continue
      fi
      latest_sha="$(github_file_latest_commit "${repo}" "${file_path}")"
      if [ -z "${latest_sha}" ]; then
        continue
      fi
      short_pin="${file_sha:0:12}"
      short_latest="${latest_sha:0:12}"
      if commit_shas_equal "${latest_sha}" "${file_sha}"; then
        echo "  ${label}: ${file_path} @ ${short_pin} (reviewed; current)"
        continue
      fi
      warn_box "${label}" "${short_pin}" "${short_latest}" \
        "https://github.com/${repo}/commits?path=${file_path}"
      echo "  Reason tracked: vendored ${file_path} changed — compare with src/renderer/lib/reticulum/lxmface.ts"
      has_upstream_warning=1
      HAS_WARNING=1
      continue
    fi

    summary="$(github_latest_release_summary "${repo}")"
    if [ -z "${summary}" ]; then
      if [ -n "${reviewed}" ]; then
        echo "  ${label}: no published GitHub release (reviewed ${reviewed})"
      else
        echo "  ${label}: no published GitHub release"
      fi
      continue
    fi
    IFS='|' read -r tag published first four <<< "${summary}"
    if [ -n "${reviewed}" ] && release_refs_equal "${tag}" "${reviewed}"; then
      echo "  ${label}: ${tag} (${published}; reviewed; current)"
      continue
    fi
    echo "  ${label}: ${tag} (${published}) — ${first}"
    warn_box "${label}" "${reviewed:-none}" "${tag}" "${url}"
    if [ "${stub}" = 'voice' ] || [ "${stub}" = 'games' ]; then
      echo "  Reason tracked: mesh-client still stubs this feature; review integrating ${repo} @ ${tag}"
    elif [ "${stub}" = 'games-parity' ]; then
      echo "  Reason tracked: compare Ratspeak Games tab with mesh-client:"
      echo "    crates/ratspeak-tauri/src/commands/games.rs"
      echo "    dashboard/static/js/games_tab.js"
      echo "    docs/reticulum-games-parity.md"
      cmp_four='0'
      if [ "${four}" != '1' ] && [ -n "${reviewed}" ]; then
        cmp_four="$(github_compare_mentions_four_in_a_row "${repo}" "${reviewed}" "${tag}")"
      fi
      if [ "${four}" = '1' ] || [ "${cmp_four}" = '1' ]; then
        echo "  This published release includes Four in a Row — update Games UI + docs/reticulum-games-parity.md"
      fi
    else
      echo "  Reason tracked: published release is newer than reviewed-ref ${reviewed:-none} — bump the pin after review"
    fi
    has_upstream_warning=1
    HAS_WARNING=1
  done

  local repos_json=''
  local repos_rc=0
  repos_json="$(github_api_get 'orgs/ratspeak/repos?per_page=100&sort=created&direction=desc')" || repos_rc=$?
  if [ "${repos_rc}" -eq 2 ]; then
    warn_github_api_rate_limit_once
  fi
  if [ -z "${repos_json}" ]; then
    echo '  Could not list ratspeak org repos (install gh or check network) — skip new-repo scan.'
  else
    local new_repos
    new_repos="$(
      printf '%s' "${repos_json}" | node -e '
const known = new Set(process.argv.slice(2));
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try {
    const repos = JSON.parse(s);
    if (!Array.isArray(repos)) return;
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const r of repos) {
      const name = String(r.name || "");
      const created = Date.parse(r.created_at || "");
      if (!name || !Number.isFinite(created) || created < cutoff) continue;
      if (known.has(name)) continue;
      process.stdout.write(`${name}\t${String(r.created_at || "").slice(0, 10)}\t${r.html_url || ""}\n`);
    }
  } catch {
    // ignore parse errors
  }
});
' "${RATSPEAK_KNOWN_ORG_REPOS[@]}"
    )"
    if [ -n "${new_repos}" ]; then
      while IFS=$'\t' read -r name created url; do
        [ -n "${name}" ] || continue
        warn_box "ratspeak/${name} (new org repo)" "unknown" "created ${created}" "${url}"
        echo "  Reason tracked: created within ~90 days and not in RATSPEAK_KNOWN_ORG_REPOS — review for mesh-client use"
        has_upstream_warning=1
        HAS_WARNING=1
      done <<< "${new_repos}"
    else
      echo '  No unfamiliar ratspeak org repos created in the last ~90 days.'
    fi
  fi

  if [ "${has_upstream_warning}" -eq 0 ]; then
    echo '  Ratspeak upstream watch complete (reviewed baselines current; no new-repo warnings).'
  fi
}

if [ "${UPDATE_SH_TEST_HOOK:-}" = 'upstream-catalog-only' ]; then
  print_ratspeak_upstream_catalog
  exit 0
fi

# Test hook: exercise check_ratspeak_upstream (fake gh/curl via PATH).
if [ "${UPDATE_SH_TEST_HOOK:-}" = 'upstream-check-only' ]; then
  check_ratspeak_upstream
  exit 0
fi

# --- Guard: must be project root ---
if [ ! -f "${LOCKFILE}" ]; then
  echo "Error: ${LOCKFILE} not found. Run this script from the project root." >&2
  exit 1
fi

# --- Packages to watch ---
# Format: "lockfile-key|display-name|review-url|tracking-reason"
WATCH_ENTRIES=(
  '@jsr/meshtastic__core|@meshtastic/core|https://www.npmjs.com/package/@meshtastic/core|Custom patch (clean BLE disconnect) + upstream may introduce breaking changes'
  '@jsr/meshtastic__transport-web-serial|@jsr/meshtastic__transport-web-serial|https://www.npmjs.com/package/@jsr/meshtastic__transport-web-serial|Custom patch (USB serial clean disconnect)'
  '@liamcottle/meshcore.js|@liamcottle/meshcore.js|https://www.npmjs.com/package/@liamcottle/meshcore.js|Custom patch (protocol fixes) + upstream may introduce breaking changes'
  'usb|usb|https://www.npmjs.com/package/usb|Custom patch (macOS C++17 std compat)'
  'readable-stream|readable-stream|https://www.npmjs.com/package/readable-stream|Custom patch (bundler process/ path compat)'
  'debug|debug|https://www.npmjs.com/package/debug|Custom patch (inlined ms/humanize for bundler compat)'
)

# --- Snapshot old versions ---
echo 'Snapshotting current dependency versions...'
KEYS=()
DISPLAYS=()
URLS=()
REASONS_TEXT=()
OLDS=()
idx=0
for entry in "${WATCH_ENTRIES[@]}"; do
  IFS='|' read -r key display url reason <<< "$entry"
  KEYS[idx]="$key"
  DISPLAYS[idx]="$display"
  URLS[idx]="$url"
  REASONS_TEXT[idx]="$reason"
  ver="$(get_version "$key")"
  OLDS[idx]="$ver"
  echo "  ${display} = ${ver}  (${reason})"
  idx=$((idx + 1))
done

OLD_RUSTC="$(get_rustc_version)"
if [ -n "${OLD_RUSTC}" ]; then
  echo "  rustc = ${OLD_RUSTC}"
fi

# --- Run updates ---
echo ''
echo 'Running pnpm update...'
echo 'Note: with minimumReleaseAge (pnpm-workspace.yaml), pnpm may WARN that a newer'
echo 'version was not selected. That is usually the age gate (not a broken override).'
echo 'Packages published within that window stay held until they mature; re-run later.'
pnpm update

echo ''
echo 'Running pnpm dedupe...'
pnpm dedupe

echo ''
echo 'Running pnpm install...'
pnpm install

echo ''
echo 'Running pnpm prune...'
pnpm prune

HAS_WARNING=0

echo ''
update_rust_toolchain
NEW_RUSTC="$(get_rustc_version)"
if [ -n "${OLD_RUSTC}" ] && [ -n "${NEW_RUSTC}" ] && [ "${OLD_RUSTC}" != "${NEW_RUSTC}" ]; then
  warn_box 'rustc (rustup/brew)' "${OLD_RUSTC}" "${NEW_RUSTC}" 'https://rustup.rs/'
  echo '  Reason tracked: Reticulum sidecar toolchain — run pnpm run reticulum:sidecar:build if rebuild failed'
  HAS_WARNING=1
fi

rebuild_reticulum_sidecar

# --- Detect and warn on watched pnpm packages ---
for i in "${!KEYS[@]}"; do
  key="${KEYS[$i]}"
  display="${DISPLAYS[$i]}"
  url="${URLS[$i]}"
  reason="${REASONS_TEXT[$i]}"
  old="${OLDS[$i]}"
  new=$(get_version "$key")
  if [ -n "$old" ] && [ "$old" != "$new" ]; then
    warn_box "$display" "$old" "$new" "$url"
    echo "  Reason tracked: ${reason}"
    HAS_WARNING=1
  fi
done

check_ratspeak_patches
check_ratspeak_upstream

if [ "${HAS_WARNING}" -eq 0 ]; then
  echo 'No updates to watched packages — safe to proceed.'
fi
