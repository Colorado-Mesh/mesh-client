#!/usr/bin/env bash
set -e

LOCKFILE='pnpm-lock.yaml'

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
  echo 'Preparing rsReticulum, rsLXMF, and rsNomad functionality check...'
  local sidecar_dir='reticulum-sidecar'
  # Paths match reticulum-sidecar/Cargo.toml (../../rs* from the sidecar dir).
  local rns_runtime='../../rsReticulum/crates/rns-runtime/Cargo.toml'
  local lxmf_core='../../rsLXMF/crates/lxmf-core/Cargo.toml'
  local nomad_core='../../rsNomad/crates/nomad-core/Cargo.toml'
  bash scripts/clone-ratspeak-stack.sh
  local missing_manifest=''
  local manifest
  for manifest in "${rns_runtime}" "${lxmf_core}" "${nomad_core}"; do
    if [ ! -f "${sidecar_dir}/${manifest}" ]; then
      missing_manifest="${sidecar_dir}/${manifest}"
      break
    fi
  done
  if [ -n "${missing_manifest}" ]; then
    echo "Error: required rs stack manifest missing after preparation: ${missing_manifest}" >&2
    return 1
  fi
  echo 'Checking rsReticulum, rsLXMF, and rsNomad via full-feature sidecar build...'
  (cd "${sidecar_dir}" && cargo build --features rns-stack,rns-ble,rns-rnode-tcp)
}

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
# Keep in sync with reticulum-sidecar/patches/*.patch and patches/README.md.
check_ratspeak_patches() {
  # Format: "patch-basename|github-owner/repo|pr-number-or-empty|display-label|review-url"
  local RATSPEAK_PATCH_ENTRIES=(
    'rsReticulum-packet-tap.patch|ratspeak/rsReticulum|10|rsReticulum packet-tap|https://github.com/ratspeak/rsReticulum/pull/10'
    'rsReticulum-auto-beacon-utun.patch|ratspeak/rsReticulum|11|rsReticulum auto-beacon utun|https://github.com/ratspeak/rsReticulum/pull/11'
    'rsReticulum-link-client-nomad.patch|ratspeak/rsReticulum|14|rsReticulum LinkClient Nomad|https://github.com/ratspeak/rsReticulum/pull/14'
    'rsReticulum-rnode-tcp-activity-keepalive.patch|ratspeak/rsReticulum|15|rsReticulum RNode TCP activity keepalive|https://github.com/ratspeak/rsReticulum/pull/15'
    'rsReticulum-ble-rnode-pairing-transition-debounce.patch|ratspeak/rsReticulum||rsReticulum BLE RNode pairing-transition debounce|'
    'rsLXMF-propagation-sync-peering.patch|ratspeak/rsLXMF|4|rsLXMF propagation sync peering|https://github.com/ratspeak/rsLXMF/pull/4'
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
    if [ ! -f "${file}" ]; then
      echo "  ${label}: patch file absent (${patch_base}) — already removed?"
      continue
    fi
    if [ -z "${pr}" ]; then
      echo "  ${label}: local overlay present; no tracked PR — review ${url}"
      echo "    See reticulum-sidecar/patches/README.md (sunset when upstream lands)."
      continue
    fi
    local state
    state="$(github_pr_state "${repo}" "${pr}")"
    case "${state}" in
      merged)
        warn_box "${label} (Ratspeak overlay)" "local patch" "upstream MERGED" "${url}"
        echo "  Reason tracked: ${repo}#${pr} merged — remove ${file} and drop apply steps"
        echo "    (clone-ratspeak-stack.sh / ensure-rsReticulum-patches.sh / apply-*.sh)."
        has_ratspeak_warning=1
        HAS_WARNING=1
        ;;
      open)
        echo "  ${label}: upstream PR still open — ${url}"
        ;;
      closed)
        warn_box "${label} (Ratspeak overlay)" "local patch" "PR closed (not merged?)" "${url}"
        echo "  Reason tracked: ${repo}#${pr} closed without merge — verify overlay still needed."
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

if [ "${HAS_WARNING}" -eq 0 ]; then
  echo 'No updates to watched packages — safe to proceed.'
fi
