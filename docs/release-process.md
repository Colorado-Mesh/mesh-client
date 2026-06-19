# Release Process

This document describes how maintainers create releases for Mesh-Client.

---

## Overview

Releases are automated via the `.github/workflows/release.yaml` workflow. When a version tag is pushed, the workflow builds and publishes binaries for macOS, Linux, and Windows to a **draft** GitHub Release. A maintainer reviews artifacts and publishes the release manually when ready.

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
pnpm run check:i18n
pnpm run test:run
pnpm run build
```

### 2. Update Version

Use the release script, which handles the version bump, MetaInfo update, commit, tag, and push in one step:

```bash
pnpm run release
```

The script auto-detects the bump type (patch / minor / major) from conventional commits since the last tag, confirms with you before applying, and:

1. Bumps `package.json` via `pnpm version`
2. Prepends a new `<release>` entry to `flatpak/org.coloradomesh.MeshClient.metainfo.xml` with today's date
3. Commits `package.json`, `pnpm-lock.yaml`, and the MetaInfo file
4. Creates an annotated git tag
5. Pushes the commit and tag to `origin`

If you need to bump manually instead:

```bash
# Edit package.json version, then:
git add package.json pnpm-lock.yaml
# Also update flatpak/org.coloradomesh.MeshClient.metainfo.xml — add a <release> entry
git add flatpak/org.coloradomesh.MeshClient.metainfo.xml
git commit -m "chore: release v1.2.4"
git tag -a v1.2.4 -m "Release 1.2.4"
```

### 3. Push Tag

`release.sh` pushes automatically. If doing a manual bump, push the commit and tag:

```bash
git push origin main
git push origin v1.2.4
```

### 4. Monitor Workflows

Two workflows trigger automatically when the tag is pushed.

**`release.yaml`** (GitHub → Actions → "Build/Release Electron App"):

- `macos-latest` → builds macOS `.dmg` and `.zip`
- `ubuntu-latest` → builds Linux `.AppImage`, `.deb`, and `.rpm`
- `windows-latest` → builds Windows NSIS installers (x64 + arm64, separate `.exe` files)

**`flatpak.yaml`** (GitHub → Actions → "Build Flatpak"):

- Matrix build inside a Freedesktop 24.08 container using `flatpak-builder` (**x86_64** and **aarch64**)
- Produces `org.coloradomesh.MeshClient-x86_64.flatpak` and `org.coloradomesh.MeshClient-aarch64.flatpak`
- Attaches both bundles to the GitHub Release once `release.yaml` has created the release object

Both workflows must complete before the release is fully populated.

### 5. Verify Release (Draft)

Workflows create the GitHub Release as a **draft** so you can verify artifacts before users see it. The Flatpak publish step must pass `draft: true` to `action-gh-release`; otherwise it auto-publishes an existing draft after attaching bundles.

Once the workflow completes:

1. Go to GitHub → Releases
2. Verify the new **draft** release appears with version tag
3. Verify all platform artifacts are attached:
   - macOS: `.dmg`, `.zip` (x64 and arm64)
   - Linux: `.AppImage`, `.deb`, `.rpm`
   - Linux Flatpak: `org.coloradomesh.MeshClient-x86_64.flatpak` and `org.coloradomesh.MeshClient-aarch64.flatpak` (added by `flatpak.yaml` — may arrive a few minutes after the others)
   - Windows: `Mesh-client Setup {version}.exe` (x64) and `Mesh-client Setup {version}-arm64.exe` (Windows 11 on ARM)
4. Verify release notes are populated (auto-generated from commits)

### 6. Publish the Release

When smoke tests pass and artifacts look correct:

1. Edit the draft release on GitHub to add release notes (if needed):
   - Summary of changes
   - Breaking changes (if any)
   - New features
   - Bug fixes
   - Contributors
2. Click **Publish release** to make it live.

Until you publish, the tag exists but the release stays hidden from the public Releases page.

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

| Platform        | Artifacts                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- |
| macOS (x64)     | `{name}-{version}-mac.zip`, `{name}-{version}.dmg`                                          |
| macOS (arm64)   | `{name}-{version}-arm64-mac.zip`, `{name}-{version}-arm64.dmg`                              |
| Linux           | `{name}-{version}.AppImage`, `{name}-{version}.deb`, `{name}-{version}.rpm`                 |
| Linux (Flatpak) | `org.coloradomesh.MeshClient-x86_64.flatpak`, `org.coloradomesh.MeshClient-aarch64.flatpak` |
| Windows (x64)   | `{name} Setup {version}.exe`                                                                |
| Windows (arm64) | `{name} Setup {version}-arm64.exe` (Windows 11 on ARM — use this, not the x64 installer)    |

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

- [ ] Verify draft release appears on GitHub Releases page
- [ ] Verify all platform artifacts are attached
- [ ] Test download and install on at least one platform
- [ ] Edit release notes if needed
- [ ] **Publish** the draft release on GitHub
- [ ] Update documentation if needed
- [ ] Announce release (Discord, etc.)
- [ ] Close milestone if using GitHub milestones
