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
  grep -E "^  '$1@" "$LOCKFILE" \
    | grep -v '(' \
    | head -1 \
    | sed 's/.*@//; s/.:$//' \
    || echo ""
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
# Format: "lockfile-key:display-name:review-url"
WATCH_ENTRIES=(
  '@jsr/meshtastic__core:@meshtastic/core:https://www.npmjs.com/package/@meshtastic/core'
  '@liamcottle/meshcore.js:@liamcottle/meshcore.js:https://www.npmjs.com/package/@liamcottle/meshcore.js'
)

# --- Snapshot current versions ---
echo 'Snapshotting current dependency versions...'
MESHTASTIC_OLD=$(get_version '@jsr/meshtastic__core')
MESHCORE_OLD=$(get_version '@liamcottle/meshcore.js')

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

# --- Detect and warn on updates ---
HAS_WARNING=0
MESHTASTIC_NEW=$(get_version '@jsr/meshtastic__core')
MESHCORE_NEW=$(get_version '@liamcottle/meshcore.js')

if [ -n "${MESHTASTIC_OLD}" ] && [ "${MESHTASTIC_OLD}" != "${MESHTASTIC_NEW}" ]; then
  warn_box '@meshtastic/core' "${MESHTASTIC_OLD}" "${MESHTASTIC_NEW}" 'https://www.npmjs.com/package/@meshtastic/core'
  HAS_WARNING=1
fi

if [ -n "${MESHCORE_OLD}" ] && [ "${MESHCORE_OLD}" != "${MESHCORE_NEW}" ]; then
  warn_box '@liamcottle/meshcore.js' "${MESHCORE_OLD}" "${MESHCORE_NEW}" 'https://www.npmjs.com/package/@liamcottle/meshcore.js'
  HAS_WARNING=1
fi

if [ "${HAS_WARNING}" -eq 0 ]; then
  echo 'No updates to watched packages — safe to proceed.'
fi
