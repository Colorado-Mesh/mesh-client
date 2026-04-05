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

  # Features
  echo "### Features"
  if git log "$last_tag"..HEAD --pretty=format:"* %s" | grep -qE "^\* feat"; then
    git log "$last_tag"..HEAD --pretty=format:"* %s" | grep -E "^\* feat" | sed 's/^\* feat[^:]*: /* /'
  else
    echo "*(No new features)*"
  fi

  echo ""
  echo "### Bug Fixes"
  if git log "$last_tag"..HEAD --pretty=format:"* %s" | grep -qE "^\* fix"; then
    git log "$last_tag"..HEAD --pretty=format:"* %s" | grep -E "^\* fix" | sed 's/^\* fix[^:]*: /* /'
  else
    echo "*(No bug fixes)*"
  fi

  echo ""
  echo "### Other Changes"
  if git log "$last_tag"..HEAD --pretty=format:"* %s" | grep -qE "^\* (chore|docs|refactor|test|style|perf|build|ci)"; then
    git log "$last_tag"..HEAD --pretty=format:"* %s" \
      | grep -E "^\* (chore|docs|refactor|test|style|perf|build|ci)" \
      | sed 's/^\* [^:]*: /* /'
  else
    echo "*(No other changes)*"
  fi

  echo ""
  echo "### Breaking Changes"
  if git log "$last_tag"..HEAD --pretty=format:"* %s" | grep -qE "(BREAKING CHANGE|!)"; then
    git log "$last_tag"..HEAD --pretty=format:"* %s" | grep -E "(BREAKING CHANGE|!)" | sed 's/^/* /'
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

# Function to detect version bump from conventional commits
detect_version_bump() {
  local last_tag="$1"
  local commits
  commits=$(git log "$last_tag"..HEAD --pretty=format:"%s%n%b" 2> /dev/null || echo "")

  if [ -z "$commits" ]; then
    echo "none"
    return
  fi

  local has_breaking=false
  local has_feat=false
  local has_other=false

  if echo "$commits" | grep -q "BREAKING CHANGE:"; then
    has_breaking=true
  fi

  if echo "$commits" | grep -qE "^(feat|fix|chore|docs|refactor|test|style|perf|build|ci)!\s*:"; then
    has_breaking=true
  fi

  if echo "$commits" | grep -qE "^feat\s*:"; then
    has_feat=true
  fi

  if echo "$commits" | grep -qE "^(feat|fix|chore|docs|refactor|test|style|perf|build|ci)\s*:"; then
    has_other=true
  fi

  if [ "$has_breaking" = true ]; then
    echo "major"
  elif [ "$has_feat" = true ]; then
    echo "minor"
  elif [ "$has_other" = true ]; then
    echo "patch"
  else
    echo "patch"
  fi
}

# 1. Check if a version argument was provided or auto-detect
VERSION_TYPE=""
AUTO_DETECT=false

if [ -z "$1" ] || [ "$1" = "--auto" ]; then
  AUTO_DETECT=true
elif [ "$1" = "patch" ] || [ "$1" = "minor" ] || [ "$1" = "major" ]; then
  VERSION_TYPE="$1"
elif [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  VERSION_TYPE="$1"
else
  echo "Usage: ./release.sh [patch|minor|major|x.x.x|--auto]"
  echo "       ./release.sh                    # Auto-detect from commits"
  echo "       ./release.sh --auto             # Explicit auto-detect"
  echo "       ./release.sh minor              # Force minor release"
  echo "       ./release.sh 2.0.0              # Force specific version"
  exit 1
fi

# 2. Ensure we are on the main branch and up to date
print_header "Checking git status..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  print_error "Error: You must be on the main branch to release."
  print_error "Current branch: $CURRENT_BRANCH"
  exit 1
fi

git pull origin main

# 3. Update dependencies
print_header "Updating dependencies..."
pnpm update

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

echo ""
echo -e "${BOLD}Continue with release?${NC} [y/N]"
read -r CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  print_warning "Release cancelled."
  exit 0
fi

# ====================== Generate release notes ======================
generate_release_notes "$LAST_TAG" "v$NEW_VERSION_PREVIEW"

# 9. Bump version
print_header "Bumping version..."
NEW_VERSION=$(pnpm version "$VERSION_TYPE" --no-git-tag-version)

# 10. Commit the version bump
git add package.json pnpm-lock.yaml
git commit -m "chore: release $NEW_VERSION"

# 11. Create the git tag
print_header "Creating tag $NEW_VERSION..."
git tag "$NEW_VERSION"

# 12. Push to GitHub
print_header "Pushing to GitHub..."
git push origin main
git push origin "$NEW_VERSION"

print_success "--------------------------------------------------------"
print_success "Success! $NEW_VERSION has been pushed."
print_success "GitHub Actions will now begin building the distributables."
echo "Check progress at: https://github.com/Colorado-Mesh/mesh-client/actions"
print_success "--------------------------------------------------------"
