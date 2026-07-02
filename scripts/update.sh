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
  grep -E "^  '?$1@" "$LOCKFILE" \
    | grep -v '(' \
    | head -1 \
    | sed "s/.*@//; s/'//; s/:\$//" \
    || echo ""
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
  echo 'Rebuilding Reticulum sidecar (cargo build)...'
  local sidecar_dir='reticulum-sidecar'
  local rns_runtime='../rsReticulum/crates/rns-runtime/Cargo.toml'
  local lxmf_core='../rsLXMF/crates/lxmf-core/Cargo.toml'
  if [ -f "${sidecar_dir}/${rns_runtime}" ] && [ -f "${sidecar_dir}/${lxmf_core}" ]; then
    (cd reticulum-sidecar && cargo build --features rns-stack,rns-ble)
  else
    (cd reticulum-sidecar && cargo build)
  fi
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
  '@stoprocent/noble|@stoprocent/noble|https://www.npmjs.com/package/@stoprocent/noble|Custom patch (Windows C++ coroutine compat)'
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

if [ "${HAS_WARNING}" -eq 0 ]; then
  echo 'No updates to watched packages — safe to proceed.'
fi
