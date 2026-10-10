#!/usr/bin/env bash
set -e

LOCKFILE='pnpm-lock.yaml'

# Opt-in: reclaim ble-sidecar/target after a successful rebuild.
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
  echo 'Rust not installed — skipping toolchain update and sidecar rebuild (optional; see docs/development-environment.md#ble-sidecar-optional).'
  return 0
}

# Keep Flatpak offline Electron archives aligned with package.json (CI check:flatpak).
# Idempotent when already in sync; fetches SHASUMS256.txt when Electron moved.
sync_flatpak_electron() {
  if [ ! -f 'scripts/sync-flatpak-electron.mjs' ]; then
    echo 'scripts/sync-flatpak-electron.mjs missing — skipping Flatpak Electron sync.' >&2
    return 0
  fi
  if ! command -v node > /dev/null 2>&1; then
    echo 'Error: node is required to sync Flatpak Electron archives.' >&2
    return 1
  fi
  echo 'Syncing Flatpak Electron vendored archives...'
  node scripts/sync-flatpak-electron.mjs
}

# Rebuild the Bluetooth helper after dependency/toolchain updates
rebuild_ble_sidecar() {
  if [ ! -f 'ble-sidecar/Cargo.toml' ]; then
    return 0
  fi
  if ! command -v cargo > /dev/null 2>&1; then
    echo 'cargo not on PATH — skipping Bluetooth helper rebuild.'
    return 0
  fi
  local sidecar_dir='ble-sidecar'
  echo 'Checking the Bluetooth helper via sidecar build...'
  (cd "${sidecar_dir}" && cargo build --features gatt-ble)
  if [ "${CLEAN_SIDECAR_TARGET}" = '1' ]; then
    echo 'CLEAN_SIDECAR_TARGET=1: removing ble-sidecar/target (next sidecar build will be cold)...'
    (cd "${sidecar_dir}" && cargo clean)
  fi
}

# Test hook: exercise rebuild_ble_sidecar with PATH stubs (no pnpm update).
if [ "${UPDATE_SH_TEST_HOOK:-}" = 'rebuild-only' ]; then
  rebuild_ble_sidecar
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

# Query GitHub PR state for watched upstream PRs (merged|open|closed|unknown).
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

# Warn when a pinned override in pnpm-workspace.yaml is behind a newer major.
# Network-dependent and warn-only: exit 10 means unexplained drift, anything else
# (including offline) is treated as clean. See scripts/check-pinned-majors.mjs.
check_pinned_majors() {
  if ! command -v node > /dev/null 2>&1; then
    echo ''
    echo 'Checking pinned overrides for newer major versions... node missing — skip.'
    return 0
  fi

  local status=0
  node scripts/check-pinned-majors.mjs || status=$?
  if [ "${status}" -eq 10 ]; then
    HAS_WARNING=1
  elif [ "${status}" -ne 0 ]; then
    echo -e "  ${YELLOW}check-pinned-majors exited ${status} — treating as inconclusive.${NC}"
  fi
  return 0
}

# Test hook: exercise check_pinned_majors without running the rest of the update.
if [ "${UPDATE_SH_TEST_HOOK:-}" = 'pinned-majors-only' ]; then
  HAS_WARNING=0
  check_pinned_majors
  printf 'HAS_WARNING=%s\n' "${HAS_WARNING}"
  exit 0
fi

# Warn when an advisory in pnpm-workspace.yaml auditConfig.ignoreGhsas has a patched
# release (or was withdrawn) so the audit exception can be backed out. Warn-only:
# exit 10 means removable, anything else (including offline) is treated as clean.
# See scripts/check-audit-ignores.mjs.
check_audit_ignores() {
  if ! command -v node > /dev/null 2>&1; then
    echo ''
    echo 'Checking pnpm audit ignores for patched releases... node missing — skip.'
    return 0
  fi

  local status=0
  node scripts/check-audit-ignores.mjs || status=$?
  if [ "${status}" -eq 10 ]; then
    HAS_WARNING=1
  elif [ "${status}" -ne 0 ]; then
    echo -e "  ${YELLOW}check-audit-ignores exited ${status} — treating as inconclusive.${NC}"
  fi
  return 0
}

# Test hook: exercise check_audit_ignores without running the rest of the update.
if [ "${UPDATE_SH_TEST_HOOK:-}" = 'audit-ignores-only' ]; then
  HAS_WARNING=0
  check_audit_ignores
  printf 'HAS_WARNING=%s\n' "${HAS_WARNING}"
  exit 0
fi

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
    echo -e "  ${YELLOW}GitHub API rate limit:${NC} further upstream checks may be incomplete (retry later or use authenticated gh)."
    GITHUB_API_RATE_LIMIT_WARNED=1
    HAS_WARNING=1
  fi
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

# Vendored upstreams (file:<path>@<sha> reviewed-ref format).
# Keep in sync when re-vendoring MECP engine/languages from https://github.com/xiang-dev-1/MECP
MECP_UPSTREAM_WATCH_ENTRIES=(
  'xiang-dev-1/MECP||MECP engine (vendored in renderer)|file:engine/src@1441c5d13bd777e8dac8e12567bbd144b1a73e16'
  'xiang-dev-1/MECP||MECP language packs (vendored in renderer)|file:languages@ee17ef3d58d372d8c5157407c036f846869ab251'
)

# Open MECP upstream PRs carried locally ahead of the languages pin.
# Format: "github-owner/repo|pr-number|display-label|review-url"
# When PR merges: re-vendor languages/, bump MECP_UPSTREAM_WATCH_ENTRIES file:languages@sha, drop entry.
MECP_PR_WATCH_ENTRIES=(
  'xiang-dev-1/MECP|5|M16 medical supply drop|https://github.com/xiang-dev-1/MECP/pull/5'
)

print_upstream_catalog() {
  local entry
  echo 'MECP_UPSTREAM_WATCH_ENTRIES:'
  for entry in "${MECP_UPSTREAM_WATCH_ENTRIES[@]}"; do
    echo "  ${entry}"
  done
  echo 'MECP_PR_WATCH_ENTRIES:'
  for entry in "${MECP_PR_WATCH_ENTRIES[@]}"; do
    echo "  ${entry}"
  done
}

# Shared file:<path>@<sha> watch used by MECP vendored upstreams.
# Returns: 0 = current/skipped, 2 = drift warning emitted, 1 = not a file: ref.
check_vendored_file_watch_entry() {
  local repo="$1" label="$2" reviewed="$3"
  local file_spec file_path file_sha latest_sha short_pin short_latest

  if [[ "${reviewed}" != file:* ]]; then
    return 1
  fi
  file_spec="${reviewed#file:}"
  file_path="${file_spec%@*}"
  file_sha="${file_spec##*@}"
  if [ -z "${file_path}" ] || [ -z "${file_sha}" ] || [ "${file_path}" = "${file_spec}" ]; then
    return 0
  fi
  latest_sha="$(github_file_latest_commit "${repo}" "${file_path}")"
  if [ -z "${latest_sha}" ]; then
    return 0
  fi
  short_pin="${file_sha:0:12}"
  short_latest="${latest_sha:0:12}"
  if commit_shas_equal "${latest_sha}" "${file_sha}"; then
    echo "  ${label}: ${file_path} @ ${short_pin} (reviewed; current)"
    return 0
  fi
  warn_box "${label}" "${short_pin}" "${short_latest}" \
    "https://github.com/${repo}/commits?path=${file_path}"
  echo "  Reason tracked: vendored ${file_path} changed — compare with mesh-client vendored copy"
  HAS_WARNING=1
  return 2
}

check_mecp_upstream() {
  local entry repo stub label reviewed
  local has_upstream_warning=0
  local file_rc

  echo ''
  echo 'Checking MECP upstream vendored engine/languages...'

  for entry in "${MECP_UPSTREAM_WATCH_ENTRIES[@]}"; do
    IFS='|' read -r repo stub label reviewed <<< "${entry}"
    file_rc=0
    check_vendored_file_watch_entry "${repo}" "${label}" "${reviewed}" || file_rc=$?
    if [ "${file_rc}" -eq 2 ]; then
      has_upstream_warning=1
    fi
  done

  if [ "${has_upstream_warning}" -eq 0 ]; then
    echo '  MECP upstream watch complete (reviewed baselines current).'
  fi
}

# Track open MECP upstream PRs whose language-pack changes are already vendored locally.
check_mecp_prs() {
  local entry repo pr label url state
  local has_mecp_pr_warning=0

  if [ "${#MECP_PR_WATCH_ENTRIES[@]}" -eq 0 ]; then
    return 0
  fi

  echo ''
  echo 'Checking MECP upstream PRs (local languages may be ahead of pin)...'

  for entry in "${MECP_PR_WATCH_ENTRIES[@]}"; do
    IFS='|' read -r repo pr label url <<< "${entry}"
    if [ -z "${pr}" ]; then
      echo "  ${label}: no PR number — drop stale entry from MECP_PR_WATCH_ENTRIES"
      continue
    fi
    state="$(github_pr_state "${repo}" "${pr}")"
    case "${state}" in
      open)
        echo "  ${label}: upstream PR still open — ${url}"
        echo "    Local languages may diverge from MECP_UPSTREAM_WATCH_ENTRIES pin until merge."
        ;;
      merged)
        warn_box "${label} (MECP upstream PR)" "local ahead of pin" "upstream MERGED" "${url}"
        echo "  Reason tracked: ${repo}#${pr} merged — re-vendor languages/,"
        echo "    bump MECP_UPSTREAM_WATCH_ENTRIES file:languages@sha, drop entry from MECP_PR_WATCH_ENTRIES."
        has_mecp_pr_warning=1
        HAS_WARNING=1
        ;;
      closed)
        warn_box "${label} (MECP upstream PR)" "local change present" "PR closed (not merged?)" "${url}"
        echo "  Reason tracked: ${repo}#${pr} closed without merge — keep local code or revert;"
        echo "    then drop entry from MECP_PR_WATCH_ENTRIES."
        has_mecp_pr_warning=1
        HAS_WARNING=1
        ;;
      *)
        echo "  ${label}: could not query ${repo}#${pr} (install gh or check network) — ${url}"
        ;;
    esac
  done

  if [ "${has_mecp_pr_warning}" -eq 0 ]; then
    echo '  MECP PR watch complete.'
  fi
}

if [ "${UPDATE_SH_TEST_HOOK:-}" = 'upstream-catalog-only' ]; then
  print_upstream_catalog
  exit 0
fi

# Test hook: exercise check_mecp_prs (fake gh via PATH).
if [ "${UPDATE_SH_TEST_HOOK:-}" = 'mecp-prs-only' ]; then
  HAS_WARNING=0
  check_mecp_prs
  printf 'HAS_WARNING=%s\n' "${HAS_WARNING}"
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
  '@jsr/meshtastic__protobufs|@meshtastic/protobufs|https://github.com/meshtastic/protobufs/tags|Schema drift: new enum values (regions, presets, hardware models) and messages need UI + decode review'
  '@jsr/meshtastic__transport-http|@meshtastic/transport-http|https://www.npmjs.com/package/@jsr/meshtastic__transport-http|HTTP transport for Meshtastic; upstream may introduce breaking changes'
  '@liamcottle/meshcore.js|@liamcottle/meshcore.js|https://www.npmjs.com/package/@liamcottle/meshcore.js|Custom patch (protocol fixes) + upstream may introduce breaking changes'
  '@michaelhart/meshcore-decoder|@michaelhart/meshcore-decoder|https://www.npmjs.com/package/@michaelhart/meshcore-decoder|MeshCore packet decoding; wire-format changes affect Sniffer/diagnostics'
  'app-builder-lib|app-builder-lib|https://www.npmjs.com/package/app-builder-lib|Custom patch (macOS CSC_LINK set-key-partition-list keychain password; electron-builder#10101)'
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

echo ''
sync_flatpak_electron

HAS_WARNING=0

echo ''
update_rust_toolchain
NEW_RUSTC="$(get_rustc_version)"
if [ -n "${OLD_RUSTC}" ] && [ -n "${NEW_RUSTC}" ] && [ "${OLD_RUSTC}" != "${NEW_RUSTC}" ]; then
  warn_box 'rustc (rustup/brew)' "${OLD_RUSTC}" "${NEW_RUSTC}" 'https://rustup.rs/'
  echo '  Reason tracked: Bluetooth helper toolchain — run pnpm run ble:sidecar:build if rebuild failed'
  HAS_WARNING=1
fi

rebuild_ble_sidecar

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

check_pinned_majors
check_audit_ignores
check_mecp_upstream
check_mecp_prs

if [ "${HAS_WARNING}" -eq 0 ]; then
  echo 'No updates to watched packages — safe to proceed.'
fi
