#!/bin/bash

# Ensure the script stops on any error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Function to print colored output
print_header() { echo -e "\n${BOLD}${BLUE}$1${NC}\n"; }
print_success() { echo -e "${GREEN}$1${NC}"; }
print_warning() { echo -e "${YELLOW}$1${NC}"; }
print_error() { echo -e "${RED}$1${NC}"; }

# Hoisted nodeLinker (`pnpm-workspace.yaml`) + `pnpm dedupe --check` is unsafe: the
# check moves packages into node_modules/.ignored (claiming a "different package
# manager") and leaves dangling/missing .bin links (vitest, prettier, eslint).
# Plain `pnpm dedupe` does not do that. Prefer lockfile re-dedupe stability instead.
assert_lockfile_deduped() {
  local before after
  before=$(shasum -a 256 pnpm-lock.yaml | awk '{print $1}')
  pnpm dedupe
  after=$(shasum -a 256 pnpm-lock.yaml | awk '{print $1}')
  if [ "$before" != "$after" ]; then
    print_error "Dependency deduplication check failed. Lockfile changed on re-dedupe; run 'pnpm dedupe' and commit the lockfile."
    return 1
  fi
  return 0
}

# Fail fast if release CLIs were removed/broken (dangling .bin after .ignored moves,
# or bin targets without the execute bit).
assert_release_clis() {
  local missing
  missing=$(
    python3 - << 'PY'
import os
missing = []
for cmd in ("prettier", "vitest", "eslint"):
    link = os.path.join("node_modules", ".bin", cmd)
    if not os.path.lexists(link):
        missing.append(cmd)
        continue
    target = os.path.realpath(link)
    if not os.path.isfile(target) or not os.access(target, os.X_OK):
        missing.append(cmd)
print(" ".join(missing))
PY
  )
  if [ -n "$missing" ]; then
    print_error "Release CLI(s) missing or broken in node_modules/.bin: $missing"
    print_error "With nodeLinker=hoisted, repair with: rm -rf node_modules && pnpm install"
    return 1
  fi
  return 0
}

METAINFO_FILE="flatpak/org.coloradomesh.MeshClient.metainfo.xml"

read_package_version() {
  node -p "require('./package.json').version"
}

assert_release_semver() {
  local version="$1"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid release version \"$version\" — expected X.Y.Z from package.json (never trust pnpm version stdout)."
    return 1
  fi
  return 0
}

sync_metainfo_release() {
  local version="$1"
  local today
  today=$(date +"%Y-%m-%d")
  if [ ! -f "$METAINFO_FILE" ]; then
    print_warning "MetaInfo file missing ($METAINFO_FILE); skipping release entry."
    return 0
  fi
  node scripts/prepend-metainfo-release.mjs "$version" "$today"
}

# Non-interactive confirmations: --yes / -y or MESH_CLIENT_RELEASE_YES=1|true.
confirm_or_yes() {
  local prompt="$1"
  if [ "${RELEASE_YES}" = true ]; then
    print_warning "Non-interactive (--yes): ${prompt} → yes"
    return 0
  fi
  echo ""
  echo -e "${BOLD}${prompt}${NC} [y/N]"
  local reply
  read -r reply
  if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    return 1
  fi
  return 0
}

print_release_usage() {
  echo "Usage: pnpm run release [patch|minor|major|x.x.x|--auto|--finish] [--yes] [--skip-dep-update]"
  echo "       pnpm run release               # Auto-detect from commits"
  echo "       pnpm run release --auto         # Explicit auto-detect"
  echo "       pnpm run release minor          # Force minor release"
  echo "       pnpm run release 2.0.0          # Force specific version"
  echo "       pnpm run release --finish       # Complete mid-release (no re-bump)"
  echo "       pnpm run release --yes          # Skip confirmation prompts"
  echo "       pnpm run release --skip-dep-update  # Skip pnpm update/dedupe"
  echo "       MESH_CLIENT_RELEASE_YES=1 pnpm run release   # Same as --yes"
  echo "       (Bare -- from \`pnpm run release -- …\` is ignored; pnpm 11 forwards it.)"
}

commit_tag_and_push_release() {
  local new_version="$1"
  git add package.json pnpm-lock.yaml org.coloradomesh.MeshClient.yml
  [ -f "$METAINFO_FILE" ] && git add "$METAINFO_FILE"
  git commit -m "chore: release $new_version"

  print_header "Creating tag $new_version..."
  git tag -a "$new_version" -m "Release $new_version"

  print_header "Pushing to GitHub..."
  git push origin main
  git push origin "$new_version"

  print_success "--------------------------------------------------------"
  print_success "Success! $new_version has been pushed."
  print_success "GitHub Actions will now begin building the distributables."
  echo "Check progress at: https://github.com/Colorado-Mesh/mesh-client/actions"
  print_warning "Releases are created as drafts — review artifacts, then publish on GitHub."
  print_success "--------------------------------------------------------"
}

# Complete a mid-release bump (package.json already at the new version; no re-bump).
finish_pending_release() {
  print_header "Finishing pending release (no version bump)..."

  local last_tag clean_version new_version last_tag_version
  last_tag=$(git describe --tags --abbrev=0 2> /dev/null || echo "")
  if [ -z "$last_tag" ]; then
    print_error "Error: No tags found. Cannot finish a release without a previous tag."
    exit 1
  fi

  clean_version=$(read_package_version)
  if ! assert_release_semver "$clean_version"; then
    exit 1
  fi
  new_version="v${clean_version}"
  last_tag_version="${last_tag#v}"

  if [ "$clean_version" = "$last_tag_version" ]; then
    print_error "package.json version ($clean_version) equals latest tag ($last_tag). Nothing to finish."
    exit 1
  fi

  if git rev-parse "$new_version" > /dev/null 2>&1; then
    print_error "Tag $new_version already exists. Nothing to finish (or delete the bad tag first)."
    exit 1
  fi

  echo "Verifying Flatpak MetaInfo matches package.json..."
  if ! pnpm run check:flatpak; then
    print_error "MetaInfo does not match package.json."
    print_error "Do NOT re-run \`pnpm run release\` (that would bump again)."
    print_error "Fix flatpak/org.coloradomesh.MeshClient.metainfo.xml top <release version=\"$clean_version\">, then: pnpm run release --finish"
    exit 1
  fi

  generate_release_notes "$last_tag" "$new_version"

  if ! confirm_or_yes "package.json is already at $clean_version. Commit, tag $new_version, and push?"; then
    print_warning "Release finish cancelled."
    exit 0
  fi

  commit_tag_and_push_release "$new_version"
}

# ====================== NEW: Generate nice copy-paste release notes ======================
generate_release_notes() {
  local last_tag="$1"
  local new_version="$2"
  local today=$(date +"%Y-%m-%d")

  print_header "=== COPY-PASTE READY RELEASE NOTES ==="

  cat << EOF
## [$new_version] - $today

### Highlights
- TODO: Write a short 1-2 sentence summary of the most important changes

### What's Changed

EOF

  local commit_logs
  commit_logs=$(git log "$last_tag"..HEAD --pretty=format:"* %s" 2> /dev/null || true)

  # Features
  echo "### Features"
  if printf '%s\n' "$commit_logs" | grep -qE "^\* feat"; then
    printf '%s\n' "$commit_logs" | grep -E "^\* feat" | sed 's/^\* feat[^:]*: /* /'
  else
    echo "*(No new features)*"
  fi

  echo ""
  echo "### Bug Fixes"
  if printf '%s\n' "$commit_logs" | grep -qE "^\* fix"; then
    printf '%s\n' "$commit_logs" | grep -E "^\* fix" | sed 's/^\* fix[^:]*: /* /'
  else
    echo "*(No bug fixes)*"
  fi

  echo ""
  echo "### Other Changes"
  if printf '%s\n' "$commit_logs" | grep -qE "^\* (chore|docs|refactor|test|style|perf|build|ci)"; then
    printf '%s\n' "$commit_logs" \
      | grep -E "^\* (chore|docs|refactor|test|style|perf|build|ci)" \
      | sed 's/^\* [^:]*: /* /'
  else
    echo "*(No other changes)*"
  fi

  echo ""
  echo "### Breaking Changes"
  # Supported type!: / type(scope)!: subjects (via detectReleaseBump.mjs) plus
  # line-anchored BREAKING CHANGE / BREAKING-CHANGE footers.
  local commit_bodies breaking_lines
  commit_bodies=$(git log "$last_tag"..HEAD --pretty=format:"%B" 2> /dev/null || true)
  breaking_lines=$(
    {
      printf '%s\n' "$commit_logs" | node --input-type=module -e "
        import { isSupportedBreakingSubject } from './scripts/detectReleaseBump.mjs';
        let s = '';
        process.stdin.on('data', (d) => { s += d; });
        process.stdin.on('end', () => {
          for (const line of s.split('\\n')) {
            if (line && isSupportedBreakingSubject(line)) process.stdout.write(line + '\\n');
          }
        });
      " || true
      printf '%s\n' "$commit_bodies" | grep -E '^[ \t]*BREAKING[- ]CHANGE[ \t]*:' || true
    } | sed '/^$/d'
  )
  if [ -n "$breaking_lines" ]; then
    printf '%s\n' "$breaking_lines" | sed 's/^/* /' | sed 's/^\* \* /* /'
  else
    echo "*(None)*"
  fi

  echo ""
  echo "### Full Changelog"
  echo "[\`$last_tag...$new_version\`](https://github.com/Colorado-Mesh/mesh-client/compare/$last_tag...$new_version)"

  echo ""
  print_header "========================================"
  echo "-> Copy the text above and paste it into your GitHub Release"
}

# Function to detect version bump from conventional commits (scoped + unscoped).
# Implementation lives in scripts/detectReleaseBump.mjs (unit-tested) so squash
# titles like feat(rrc): … count as minor — the old bash regex missed scopes.
detect_version_bump() {
  local last_tag="$1"
  local current json
  current=$(read_package_version)
  # Avoid a pipe so detector non-zero exits are not masked (no pipefail required here).
  json=$(node scripts/detectReleaseBump.mjs --since "$last_tag" --current "$current") || return 1
  node -e "process.stdout.write(JSON.parse(process.argv[1]).bump)" "$json"
}

# 1. Parse version / finish / non-interactive flags (order-independent).
VERSION_TYPE=""
AUTO_DETECT=false
FINISH_ONLY=false
SKIP_DEP_UPDATE=false
RELEASE_YES=false
if [ "${MESH_CLIENT_RELEASE_YES:-}" = "1" ] || [ "${MESH_CLIENT_RELEASE_YES:-}" = "true" ]; then
  RELEASE_YES=true
fi

POSITIONAL_COUNT=0
for arg in "$@"; do
  case "$arg" in
    # pnpm 11+ forwards the run-script separator: `pnpm run release -- minor`
    # becomes argv `-- minor`. Treat bare `--` as a no-op so CI/docs stay valid.
    --) ;;
    --yes | -y)
      RELEASE_YES=true
      ;;
    --skip-dep-update)
      SKIP_DEP_UPDATE=true
      ;;
    --finish)
      FINISH_ONLY=true
      ;;
    --auto)
      AUTO_DETECT=true
      ;;
    patch | minor | major)
      VERSION_TYPE="$arg"
      POSITIONAL_COUNT=$((POSITIONAL_COUNT + 1))
      ;;
    *)
      if [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        VERSION_TYPE="$arg"
        POSITIONAL_COUNT=$((POSITIONAL_COUNT + 1))
      else
        print_release_usage
        exit 1
      fi
      ;;
  esac
done

if [ "$FINISH_ONLY" = true ] && { [ -n "$VERSION_TYPE" ] || [ "$AUTO_DETECT" = true ]; }; then
  print_error "--finish cannot be combined with a version bump argument."
  print_release_usage
  exit 1
fi

if [ "$AUTO_DETECT" = true ] && [ -n "$VERSION_TYPE" ]; then
  print_error "--auto cannot be combined with patch|minor|major|x.x.x."
  print_release_usage
  exit 1
fi

if [ "$POSITIONAL_COUNT" -gt 1 ]; then
  print_error "Specify at most one of patch|minor|major|x.x.x."
  print_release_usage
  exit 1
fi

if [ "$FINISH_ONLY" = false ] && [ -z "$VERSION_TYPE" ] && [ "$AUTO_DETECT" = false ]; then
  # No bump arg and no --auto → same as historical bare `pnpm run release`.
  AUTO_DETECT=true
fi

# Test hook: dump parsed flags and exit before git/network side effects.
# Block under GitHub Actions unless MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI=1 (unit tests).
# A repo/org Actions variable left at PARSE_ONLY=1 would otherwise green-succeed Cut release.
if [ "${MESH_CLIENT_RELEASE_PARSE_ONLY:-}" = "1" ]; then
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ "${MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI:-}" != "1" ]; then
    print_error "MESH_CLIENT_RELEASE_PARSE_ONLY is a local/test hook and cannot run under GitHub Actions."
    print_error "Unset the variable (Cut release clears it) or set MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI=1 for tests."
    exit 1
  fi
  printf 'RELEASE_YES=%s\n' "$RELEASE_YES"
  printf 'SKIP_DEP_UPDATE=%s\n' "$SKIP_DEP_UPDATE"
  printf 'FINISH_ONLY=%s\n' "$FINISH_ONLY"
  printf 'AUTO_DETECT=%s\n' "$AUTO_DETECT"
  printf 'VERSION_TYPE=%s\n' "$VERSION_TYPE"
  exit 0
fi

# 2. Ensure we are on the main branch
print_header "Checking git status..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  print_error "Error: You must be on the main branch to release."
  print_error "Current branch: $CURRENT_BRANCH"
  exit 1
fi

if [ "$FINISH_ONLY" = true ]; then
  finish_pending_release
  exit 0
fi

git pull origin main

# 3. Update dependencies (optional skip for CI cut-release / already-updated trees)
if [ "$SKIP_DEP_UPDATE" = true ]; then
  print_warning "Skipping pnpm update/dedupe (--skip-dep-update)."
else
  print_header "Updating dependencies..."
  pnpm update

  # Ensure lockfile is deduped after update
  print_header "Deduplicating dependencies..."
  pnpm dedupe
fi

print_header "Syncing Flatpak Electron vendored archives..."
node scripts/sync-flatpak-electron.mjs

# 4. Get the last tag
LAST_TAG=$(git describe --tags --abbrev=0 2> /dev/null || echo "")
if [ -z "$LAST_TAG" ]; then
  print_error "Error: No tags found. Please create an initial tag first."
  echo "Example: git tag v0.1.0 && git push origin v0.1.0"
  exit 1
fi

# 5. Check if there are commits since last tag
COMMITS_SINCE_TAG=$(git log "$LAST_TAG"..HEAD --oneline 2> /dev/null || echo "")
if [ -z "$COMMITS_SINCE_TAG" ]; then
  print_error "Error: No commits since last tag ($LAST_TAG)."
  echo "Create some commits before releasing."
  exit 1
fi

# 6. Detect or use provided version type
if [ "$AUTO_DETECT" = true ]; then
  DETECTED_BUMP=$(detect_version_bump "$LAST_TAG")
else
  DETECTED_BUMP="provided"
fi

# 7. Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

# 7. Calculate new version preview
if [ -z "$VERSION_TYPE" ]; then
  VERSION_TYPE="$DETECTED_BUMP"
fi

# Preview the new version
if [ "$VERSION_TYPE" = "major" ]; then
  MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  NEW_VERSION_PREVIEW="$((MAJOR + 1)).0.0"
elif [ "$VERSION_TYPE" = "minor" ]; then
  MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
  NEW_VERSION_PREVIEW="$MAJOR.$((MINOR + 1)).0"
elif [[ "$VERSION_TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VERSION_PREVIEW="$VERSION_TYPE"
else
  # patch
  MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
  PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
  NEW_VERSION_PREVIEW="$MAJOR.$MINOR.$((PATCH + 1))"
fi

# 8. Show summary and prompt for confirmation
print_header "Analyzing commits since $LAST_TAG..."
echo -e "${BOLD}Commits found:${NC}"
echo "$COMMITS_SINCE_TAG" | head -15 | while read -r line; do
  echo "  $line"
done
COMMIT_COUNT=$(echo "$COMMITS_SINCE_TAG" | wc -l | tr -d ' ')
if [ "$COMMIT_COUNT" -gt 15 ]; then
  echo "  ... and $((COMMIT_COUNT - 15)) more"
fi

echo ""
echo -e "${BOLD}Version bump analysis:${NC}"
if [ "$AUTO_DETECT" = true ]; then
  echo "  Auto-detected: $VERSION_TYPE"
else
  echo "  User specified: $VERSION_TYPE"
fi

echo ""
echo -e "${BOLD}Release summary:${NC}"
echo "  Current version: $CURRENT_VERSION"
echo "  New version:     v$NEW_VERSION_PREVIEW"
echo ""

if [ "$VERSION_TYPE" = "major" ]; then
  echo -e "${RED}  -> This is a BREAKING CHANGE release${NC}"
elif [ "$VERSION_TYPE" = "minor" ]; then
  echo -e "${YELLOW}  -> This includes new features${NC}"
else
  echo -e "${GREEN}  -> This is a patch release${NC}"
fi

if ! confirm_or_yes "Continue with pre-flight validation?"; then
  print_warning "Release cancelled."
  exit 0
fi

# 9. PRE-FLIGHT VALIDATION - Run all checks before making any changes
print_header "Running pre-flight validation..."

echo "Checking development environment..."
if ! pnpm run check:environment; then
  print_error "Environment check failed. Fix required failures from 'pnpm run check:environment'."
  exit 1
fi

echo "Verifying release CLIs (prettier/vitest/eslint)..."
if ! assert_release_clis; then
  exit 1
fi

# Check formatting
echo "Checking code formatting..."
if ! pnpm run format:check; then
  print_error "Code formatting check failed. Run 'pnpm run format' to fix."
  exit 1
fi

# Check markdown
echo "Checking markdown formatting..."
if ! pnpm run lint:md; then
  print_error "Markdown lint check failed."
  exit 1
fi

# Lint code
echo "Running ESLint..."
if ! pnpm run lint; then
  print_error "ESLint check failed."
  exit 1
fi

# Type checking
echo "Running TypeScript type checking..."
if ! pnpm run typecheck; then
  print_error "TypeScript type check failed."
  exit 1
fi

# Security / policy scanners — always run the full set on release (pre-commit may
# path-gate some of these; never skip them here).
echo "Running security and policy checks..."
if ! pnpm run check:electron-security; then
  print_error "Electron security check failed."
  exit 1
fi

if ! pnpm run check:log-injection; then
  print_error "Log injection check failed."
  exit 1
fi

if ! pnpm run check:log-service-sinks; then
  print_error "Log service disk sink check failed."
  exit 1
fi

if ! pnpm run check:codeql-extensions; then
  print_error "CodeQL extensions layout check failed."
  exit 1
fi

if ! pnpm run check:insecure-temp-files; then
  print_error "Insecure temporary file check failed."
  exit 1
fi

if ! pnpm run check:db-migrations; then
  print_error "Database migration check failed."
  exit 1
fi

if ! pnpm run check:ipc-contract; then
  print_error "IPC contract check failed."
  exit 1
fi

if ! pnpm run check:reticulum-interface-modes; then
  print_error "Reticulum interface mode catalog check failed."
  exit 1
fi

if ! pnpm run check:pn-hosting-policy; then
  print_error "PN hosting policy catalog check failed."
  exit 1
fi

if ! pnpm run check:reticulum-decommissioned-hubs; then
  print_error "Reticulum decommissioned hub catalog check failed."
  exit 1
fi

if ! pnpm run check:console-log; then
  print_error "console.log policy check failed."
  exit 1
fi

if ! pnpm run check:silent-catches; then
  print_error "Silent catch policy check failed."
  exit 1
fi

if ! pnpm run check:url-hostname-sanitization; then
  print_error "URL hostname sanitization check failed."
  exit 1
fi

if ! pnpm run check:xss-patterns; then
  print_error "XSS pattern check failed."
  exit 1
fi

if ! pnpm run check:protocol-string-gates; then
  print_error "Protocol string gate check failed."
  exit 1
fi

if ! pnpm run check:log-panel-filter; then
  print_error "Log panel filter check failed."
  exit 1
fi

if ! pnpm run check:i18n; then
  print_error "i18n key check failed."
  exit 1
fi

if ! pnpm run check:licenses; then
  print_error "License check failed."
  exit 1
fi

if ! pnpm run check:flatpak; then
  print_error "Flatpak manifest check failed. Run 'node scripts/sync-flatpak-electron.mjs' if Electron drifted."
  exit 1
fi

if ! pnpm run check:flatpak-offline-pnpm; then
  print_error "Flatpak offline pnpm sources check failed (needs flatpak-node-generator; see script output)."
  exit 1
fi

# Dependency checks
# Do NOT use `pnpm dedupe --check` here: with nodeLinker=hoisted it mutates
# node_modules (moves packages to .ignored) and breaks .bin (vitest not found).
echo "Checking dependencies (re-dedupe lockfile stability)..."
if ! assert_lockfile_deduped; then
  exit 1
fi

if ! pnpm audit --audit-level=high; then
  print_error "Security audit failed. Address high-severity vulnerabilities."
  exit 1
fi

# Probe `pnpm version` with trace-deprecation; npm still writes package.json (even with --dry-run), so restore it.
echo "Checking for Node.js deprecation warnings..."
PKG_JSON_BACKUP=$(mktemp)
cp package.json "$PKG_JSON_BACKUP"
DEPRECATION_OUTPUT=$(NODE_OPTIONS="--trace-deprecation" pnpm version "$VERSION_TYPE" --no-git-tag-version 2>&1 || true)
cp "$PKG_JSON_BACKUP" package.json
rm -f "$PKG_JSON_BACKUP"
if echo "$DEPRECATION_OUTPUT" | grep -q "DEP0187"; then
  print_error "Found Node.js deprecation warning about fs.existsSync. This will cause the release to fail."
  print_error "Please fix the deprecation warning before proceeding with release."
  exit 1
fi

# GitHub Actions validation (required — do not soft-skip)
echo "Validating GitHub Actions..."
if ! command -v actionlint > /dev/null 2>&1; then
  print_error "actionlint not found. Install via 'pnpm run setup:actionlint' — release does not skip workflow validation."
  exit 1
fi
if ! actionlint; then
  print_error "GitHub Actions validation failed."
  exit 1
fi

# YAML validation (required — do not soft-skip)
echo "Validating YAML files..."
if ! command -v yamllint > /dev/null 2>&1; then
  print_error "yamllint not found. Install via pip/brew/apt — release does not skip YAML validation."
  exit 1
fi
if ! yamllint -f github -s .; then
  print_error "YAML validation failed."
  exit 1
fi

# Full Vitest suite — never use the pre-commit staged subset or --changed filters here.
# Pre-commit may run a staged subset; release must match PR CI coverage of all tests.
echo "Verifying Vitest CLI before full suite..."
if ! assert_release_clis; then
  exit 1
fi
echo "Running full Vitest suite (pnpm run test:run)..."
if ! pnpm run test:run; then
  print_error "Tests failed."
  exit 1
fi

# Reticulum sidecar (Rust) — required before release; same gate as release/build CI packaging.
if ! command -v cargo > /dev/null 2>&1; then
  print_error "cargo not found. Install Rust (https://rustup.rs/) — Reticulum sidecar tests are required for release."
  exit 1
fi
echo "Running Reticulum sidecar tests..."
if ! pnpm run reticulum:sidecar:test; then
  print_error "Reticulum sidecar tests failed."
  exit 1
fi

print_success "All pre-flight checks passed!"

if ! confirm_or_yes "All validations passed. Proceed with actual release?"; then
  print_warning "Release cancelled after successful validation."
  exit 0
fi

# ====================== Generate release notes ======================
generate_release_notes "$LAST_TAG" "v$NEW_VERSION_PREVIEW"

# 10. Bump version — never use `pnpm version` stdout as the version string (pnpm 11
# prints a multi-line success banner that corrupted Flatpak MetaInfo).
print_header "Bumping version..."
pnpm version "$VERSION_TYPE" --no-git-tag-version > /dev/null
CLEAN_VERSION=$(read_package_version)
if ! assert_release_semver "$CLEAN_VERSION"; then
  exit 1
fi
if [ "$CLEAN_VERSION" != "$NEW_VERSION_PREVIEW" ]; then
  print_error "package.json version ($CLEAN_VERSION) does not match release preview ($NEW_VERSION_PREVIEW)."
  exit 1
fi
NEW_VERSION="v${CLEAN_VERSION}"

# 10a. Prepend a new <release> entry to the Flatpak MetaInfo file
sync_metainfo_release "$CLEAN_VERSION"
print_success "Updated $METAINFO_FILE with release $CLEAN_VERSION"

# 11–13. Commit, tag, push
commit_tag_and_push_release "$NEW_VERSION"
