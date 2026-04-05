# Release Process

This document describes how maintainers create releases for Mesh-Client.

---

## Overview

Releases are automated via the `.github/workflows/release.yaml` workflow. When a version tag is pushed, the workflow builds and publishes binaries for macOS, Linux, and Windows to GitHub Releases.

---

## Prerequisites

- Maintainer access to the repository
- `GH_TOKEN` secret configured in repository settings (used by `electron-builder` for publishing)
- Clean working directory (no uncommitted changes)

---

## Release Steps

### 1. Verify Readiness

Ensure all changes for the release are merged to `main`:

```bash
git checkout main
git pull origin main
```

Run the full test suite locally:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test:run
pnpm run build
```

### 2. Update Version

Update the version in `package.json`:

```bash
# For patch release (1.2.3 → 1.2.4)
pnpm version patch

# For minor release (1.2.3 → 1.3.0)
pnpm version minor

# For major release (1.2.3 → 2.0.0)
pnpm version major
```

The `pnpm version` command:

- Updates `package.json` version field
- Creates a git commit with the version bump
- Creates an annotated git tag

Alternatively, manually edit `package.json` and create the tag:

```bash
# Edit package.json, then:
git add package.json
git commit -m "chore: bump version to 1.2.4"
git tag -a v1.2.4 -m "Release 1.2.4"
```

### 3. Push Tag

Push the commit and tag to GitHub:

```bash
git push origin main
git push origin v1.2.4
```

Or push all tags:

```bash
git push origin main --tags
```

### 4. Monitor Workflow

The `release.yaml` workflow will automatically start when the tag is pushed.

Monitor progress at:

- GitHub → Actions → "Build/Release Electron App"

The workflow runs three parallel jobs:

- `macos-latest` → builds macOS `.dmg` and `.zip`
- `ubuntu-latest` → builds Linux `.AppImage`, `.deb`, and `.rpm`
- `windows-latest` → builds Windows `.exe` (NSIS installer)

### 5. Verify Release

Once the workflow completes:

1. Go to GitHub → Releases
2. Verify the new release appears with version tag
3. Verify all platform artifacts are attached:
   - macOS: `.dmg`, `.zip` (x64 and arm64)
   - Linux: `.AppImage`, `.deb`, `.rpm`
   - Windows: `.exe`
4. Verify release notes are populated (auto-generated from commits)

### 6. Publish Release Notes (Optional)

Edit the release on GitHub to add:

- Summary of changes
- Breaking changes (if any)
- New features
- Bug fixes
- Contributors

---

## Version Naming

Follow [Semantic Versioning](https://semver.org/):

- **Major (X.0.0):** Breaking changes
- **Minor (0.X.0):** New features, backward compatible
- **Patch (0.0.X):** Bug fixes, backward compatible

---

## Troubleshooting

### Release workflow fails on one platform

- Check the workflow logs for the failed job
- Platform-specific failures are often related to native modules
- Fix the issue, bump version if needed, and create a new tag

### Electron-builder fails to publish

- Verify `GH_TOKEN` secret is set and valid
- The token needs `repo` scope for the repository
- Check repository settings → Secrets and variables → Actions

### Tag already exists

If you need to re-release the same version:

1. Delete the tag locally: `git tag -d v1.2.4`
2. Delete the tag remotely: `git push origin :refs/tags/v1.2.4`
3. Delete the GitHub release (if created)
4. Create a new tag and push

Note: This should only be done for releases that haven't been widely distributed.

### Build fails due to native modules

Run `pnpm run rebuild` locally to ensure native modules are compiled for Electron:

```bash
pnpm run rebuild
pnpm run build
```

The release workflow includes this step automatically.

---

## Rollback

If a release has critical issues:

1. Do not delete the release (users may have already downloaded it)
2. Create a patch release with the fix
3. Update the release notes to document the known issue
4. Optionally yank the release from GitHub (if caught early enough)

---

## Release Artifacts

The workflow produces the following artifacts:

| Platform      | Artifacts                                                                   |
| ------------- | --------------------------------------------------------------------------- |
| macOS (x64)   | `{name}-{version}-mac.zip`, `{name}-{version}.dmg`                          |
| macOS (arm64) | `{name}-{version}-arm64-mac.zip`, `{name}-{version}-arm64.dmg`              |
| Linux         | `{name}-{version}.AppImage`, `{name}-{version}.deb`, `{name}-{version}.rpm` |
| Windows       | `{name} Setup {version}.exe`                                                |

Artifacts are signed with your developer certificate (macOS/Windows) if configured in `electron-builder` config.

---

## Manual Release (Emergency)

If the workflow fails and needs manual intervention:

```bash
# Build for current platform
pnpm run build
pnpm run dist

# Or for specific platform
pnpm run dist:mac
pnpm run dist:linux
pnpm run dist:win
```

Upload artifacts manually to GitHub Releases, but note that this bypasses the automated workflow and should only be used in emergencies.

---

## Post-Release Checklist

- [ ] Verify release appears on GitHub Releases page
- [ ] Verify all platform artifacts are attached
- [ ] Test download and install on at least one platform
- [ ] Update documentation if needed
- [ ] Announce release (Discord, etc.)
- [ ] Close milestone if using GitHub milestones
