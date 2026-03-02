#!/bin/bash

# Ensure the script stops on any error
set -e

# 1. Check if a version argument was provided
if [ -z "$1" ]; then
  echo "Usage: ./release.sh [patch|minor|major|x.x.x]"
  echo "Example: ./release.sh patch  (1.0.0 -> 1.0.1)"
  exit 1
fi

VERSION_TYPE=$1

# 2. Ensure we are on the main branch and up to date
echo "Checking git status..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: You must be on the main branch to release."
  exit 1
fi

git pull origin main

# 3. Use npm to bump the version (this updates package.json and package-lock.json)
echo "Bumping version..."
NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)

# 4. Commit the version bump
git add package.json package-lock.json
git commit -m "chore: release $NEW_VERSION"

# 5. Create the git tag
echo "Creating tag $NEW_VERSION..."
git tag "$NEW_VERSION"

# 6. Push to GitHub
echo "Pushing to GitHub..."
git push origin main
git push origin "$NEW_VERSION"

echo "--------------------------------------------------------"
echo "Success! $NEW_VERSION has been pushed."
echo "GitHub Actions will now begin building the distributables."
echo "Check progress at: https://github.com/Denver-Mesh/meshtastic-client/actions"
echo "--------------------------------------------------------"
