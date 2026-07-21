# Release Process

This document describes how maintainers create releases for Mesh-Client.

---

## Overview

Releases are driven by **annotated version tags** (`v*`) on `main`. Pushing a tag triggers:

| Workflow                                            | Purpose                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`release.yaml`](../.github/workflows/release.yaml) | Build and publish macOS, Linux, and Windows installers via `electron-builder`                 |
| [`flatpak.yaml`](../.github/workflows/flatpak.yaml) | Build Reticulum sidecar + Flatpak bundles (x86_64 and aarch64) and attach them to the release |

Both workflows upload to a **draft** GitHub Release. A maintainer reviews artifacts and publishes manually when ready.

`electron-builder.yml` sets `releaseType: draft`, so the Electron jobs also create/update a draft release rather than publishing live immediately.

Documentation deploys separately: [`docs.yml`](../.github/workflows/docs.yml) runs on every push to `main` (including the version-bump commit from `pnpm run release`).

---

## Prerequisites

- Maintainer access to the repository
- On branch **`main`**, up to date with `origin/main`
- Clean working directory (no uncommitted changes)
- For `pnpm run release` pre-flight: **actionlint** and **yamllint** installed (or run `pnpm run setup:actionlint` and install yamllint via pip/brew — see [Development Guide](development-environment.md#8-helper-scripts-auto-install-where-possible))
- For `pnpm run release` pre-flight: **flatpak-node-generator** on `PATH` (same pin as Flatpak CI — see [Building a Flatpak](development-environment.md#building-a-flatpak-linux) / `pnpm run check:flatpak-offline-pnpm` install hint)

---

## Recommended: `pnpm run release`

The release script (`scripts/release.sh`) is the supported maintainer path. It:

1. Verifies you are on `main` and pulls latest
2. Runs **`pnpm update`** and **`pnpm dedupe`** (updates lockfile before the bump)
3. Syncs **`org.coloradomesh.MeshClient.yml`** Electron vendored archives to match `package.json` (`node scripts/sync-flatpak-electron.mjs`)
4. Auto-detects **patch / minor / major** from [Conventional Commits](https://www.conventionalcommits.org/) since the last tag (or accept an explicit bump — see below)
5. Runs **pre-flight validation** (`check:environment`, format, lint, typecheck, **all** `check:*` scanners including path-gated pre-commit ones, **`check:flatpak`**, **`check:flatpak-offline-pnpm`**, **`check:i18n`**, dedupe check, audit, **required** actionlint + yamllint, **full** Vitest via `pnpm run test:run`, Reticulum sidecar `cargo test`)
6. Prints **copy-paste release notes** grouped by feat/fix/other/breaking
7. Bumps `package.json` via `pnpm version`
8. Prepends a `<release>` entry to `flatpak/org.coloradomesh.MeshClient.metainfo.xml`
9. Commits, creates an annotated tag, and pushes **commit + tag** to `origin`

```bash
git checkout main
git pull origin main
pnpm run release        # auto-detect bump from commits since last tag
pnpm run release minor  # force minor
pnpm run release 5.21.0 # force exact version
pnpm run release --auto # explicit auto-detect
```

The script prompts twice (start pre-flight, then confirm after checks pass). **Expect several minutes** for the full validation chain.

**Full suite only:** Release must never use `test:staged`, `test:changed`, or `vitest related`. Pre-commit may run a staged subset for speed; release matches PR CI by running the unrestricted `pnpm run test:run` (`vitest run`) and does not soft-skip actionlint/yamllint when those tools are missing.

If pre-flight fails, fix the issue on `main` and run `pnpm run release` again — do not tag manually until checks pass.

---

## macOS code signing and notarization

Official macOS release artifacts are **Developer ID signed** and **notarized** when repository secrets are configured. [`electron-builder.yml`](../electron-builder.yml) sets `hardenedRuntime: true` and `notarize: true`; electron-builder skips notarization automatically when no signing certificate is available (local/fork builds).

### Required GitHub Actions secrets

Configure these in **Settings → Secrets and variables → Actions** (maintainers only):

| Secret                            | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| **`CSC_LINK`**                    | Base64-encoded `.p12` **Developer ID Application** certificate          |
| **`CSC_KEY_PASSWORD`**            | Password protecting the `.p12` file                                     |
| **`APPLE_ID`**                    | Apple ID email used with App Store Connect / notarytool                 |
| **`APPLE_APP_SPECIFIC_PASSWORD`** | App-specific password for notarytool (not your Apple ID login password) |
| **`APPLE_TEAM_ID`**               | 10-character Team ID from Apple Developer membership                    |

`release.yaml` and `build.yaml` pass these only on **`macos-latest`** matrix legs. **`CSC_IDENTITY_AUTO_DISCOVERY`** is set to `true` when `CSC_LINK` is present; otherwise `false` so electron-builder skips signing gracefully on fork PRs.

### Partial-secret validation

Before the macOS build step, [`release.yaml`](../.github/workflows/release.yaml) runs **Validate macOS signing secrets** when `CSC_LINK` is non-empty on tag releases. If any of `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, or `APPLE_TEAM_ID` is missing, the job **fails early** with a clear list — avoids a signed-but-unnotarized upload that Gatekeeper would reject.

Fork workflows and local `pnpm run dist:mac` without these env vars produce **unsigned** `.dmg` / `.zip` bundles (still validated by `verify-mac-packaging.mjs`). See [CI/CD — macOS packaging verify](ci-cd.md#macos-packaging-verify-verify-mac-packagingmjs).

---

## Manual verification (optional)

If you need to run checks outside `release.sh`:

```bash
pnpm run format:check
pnpm run lint:md
pnpm run lint
pnpm run typecheck
pnpm run check:i18n
pnpm run test:run
pnpm run build
```

For parity with CI packaging smoke tests after a local dist build, see [CI/CD — Release workflow](ci-cd.md#release-releaseyaml).

---

## Manual version bump (fallback)

Only if `pnpm run release` cannot be used:

```bash
# Edit package.json version, then:
git add package.json pnpm-lock.yaml org.coloradomesh.MeshClient.yml
# If electron changed: node scripts/sync-flatpak-electron.mjs
# Add a <release version="…" date="YYYY-MM-DD"/> entry to flatpak/org.coloradomesh.MeshClient.metainfo.xml
git add flatpak/org.coloradomesh.MeshClient.metainfo.xml
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push origin main
git push origin vX.Y.Z
```

---

## Monitor workflows

### `release.yaml` (Build/Release Electron App)

Matrix build jobs:

- **`macos-latest`** → `pnpm run dist:mac:publish`
- **`ubuntu-latest`** → `pnpm run dist:linux:publish` (x64 + arm64 AppImage, `.deb`, `.rpm`)
- **`windows-latest`** → `pnpm run dist:win:publish` (x64 + arm64 NSIS installers)

Each job runs `pnpm install --frozen-lockfile`, `pnpm run rebuild`, then publishes via `electron-builder` using the built-in **`GITHUB_TOKEN`** (exported as `GH_TOKEN` for electron-publish).

After builds finish, **`packaging-smoke`** runs on:

- macOS — `verify-mac-packaging.mjs` (includes bundled Reticulum sidecar in `.app`)
- Linux — `verify-linux-packaging.mjs` plus `test-linux-appimage-reticulum-sidecar.mjs` (extracts x64/arm64 AppImages and asserts sidecar). **`verify-linux-packaging.mjs`** also asserts each `.deb` **Description** field is ASCII-only (no mojibake `??`) via `dpkg-deb -f` — non-ASCII control metadata breaks some package managers and mirrors.
- Windows x64 — NSIS install smoke test (`test-win-nsis-install.mjs`, asserts sidecar after install)
- **`windows-11-arm`** — arm64 NSIS install smoke test with 7z probe (asserts sidecar inside installer payload and after install)

Build jobs also run `verify-reticulum-sidecar-staged.mjs` after staging sidecars and before `electron-builder`.

### `flatpak.yaml` (Build Flatpak)

1. **`reticulum-sidecar`** — builds `mesh-client-reticulum` per arch (x86_64 on `ubuntu-latest`, aarch64 on `ubuntu-24.04-arm`) with full RNS stack features
2. **`flatpak`** — generates offline pnpm sources, builds `org.coloradomesh.MeshClient.flatpak` per arch inside the Flathub freedesktop 24.08 container, smoke-installs the bundle
3. **`publish`** — attaches both `.flatpak` files to the GitHub Release with **`draft: true`** (does not auto-publish an existing draft)

Both tag-triggered workflows must complete before the release is fully populated. Flatpak bundles often arrive a few minutes after the Electron artifacts.

### Reticulum sidecar in installers

- **Flatpak:** sidecar is built in CI and embedded under `resources/reticulum-sidecar/` before `flatpak-builder` runs.
- **macOS / Linux / Windows (Electron):** `release.yaml` / `build.yaml` run `scripts/build-reticulum-sidecar-release.mjs` per platform before `dist:*`, staging per-arch binaries under `resources/reticulum-sidecar/staged/`. The `beforePack` hook in [`electron-builder.yml`](../electron-builder.yml) copies the correct `mesh-client-reticulum` binary into each installer (Windows x64 + arm64, Linux x64 + arm64, macOS arm64). Packaging verify scripts assert the sidecar is present in unpacked bundles.
- **Releases before this pipeline shipped** may show “Reticulum sidecar not built” in packaged installs — upgrade to a release that includes the sidecar or use Flatpak on Linux.
- **Dev builds** use `reticulum-sidecar/target/debug/` instead — see [Reticulum sidecar (optional)](development-environment.md#reticulum-sidecar-optional).

---

## Verify the draft release

1. Go to GitHub → **Releases**
2. Open the new **draft** for the version tag
3. Confirm artifacts:

| Platform      | Artifacts                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------- |
| macOS         | `.dmg` and `.zip` (x64 and arm64)                                                           |
| Linux         | `.AppImage`, `.deb`, `.rpm` (x64 and arm64)                                                 |
| Linux Flatpak | `org.coloradomesh.MeshClient-x86_64.flatpak`, `org.coloradomesh.MeshClient-aarch64.flatpak` |
| Windows x64   | `Mesh-client Setup {version}.exe`                                                           |
| Windows arm64 | `Mesh-client Setup {version}-arm64.exe` (Windows 11 on ARM — not the x64 installer)         |

1. Paste or edit release notes (use the block printed by `pnpm run release`, or GitHub’s generated notes)
2. Optionally smoke-test downloads on one platform per family

Until you click **Publish release**, the tag exists but the release stays hidden from the public Releases page.

---

## Publish the release

When artifacts and notes look correct:

1. Edit the draft if needed (summary, breaking changes, contributors)
2. Click **Publish release**

---

## Version naming

Follow [Semantic Versioning](https://semver.org/):

- **Major (X.0.0):** Breaking changes (`BREAKING CHANGE:` footer or `feat!:` / `fix!:`)
- **Minor (0.X.0):** New features (`feat:`), backward compatible
- **Patch (0.0.X):** Fixes and other conventional commits without `feat:`

`release.sh` applies these rules when auto-detecting the bump.

---

## Post-release checklist

- [ ] Draft release shows all platform artifacts (including both Flatpak arches)
- [ ] Packaging-smoke jobs green in Actions
- [ ] Test download and install on at least one platform
- [ ] **Publish** the draft on GitHub
- [ ] Confirm docs site updated after the version commit landed on `main` ([docs workflow](ci-cd.md#docs-docsyml))
- [ ] Announce (Discord `#mesh-client`, etc.)
- [ ] Close milestone if used

---

## Troubleshooting

### Release workflow fails on one platform

- Inspect the failed job log in Actions
- Platform failures are often native-module or packaging related
- Fix on `main`, then cut a new patch release (`pnpm run release patch`)

### Electron-builder fails to publish

- Confirm the workflow job has `contents: write`
- Publishing uses `GITHUB_TOKEN` as `GH_TOKEN`; forked or restricted workflows may lack upload permission
- **404 uploading to `/releases/{id}/assets`:** parallel `dist:*:publish` jobs raced and created duplicate draft releases. Re-run the failed release workflow after merging the `prepare-github-release` gate (or delete orphan drafts and re-run). Do not PATCH release `tag_name` via API while CI is uploading — that orphans in-flight upload targets.

### Duplicate draft releases for one tag

- Caused when GitHub’s `GET /releases/tags/{tag}` returns **404** while multiple draft releases share the same `tag_name` — parallel `dist:*:publish` jobs each create another draft. `release.yaml` runs `scripts/ci-ensure-github-draft-release.mjs` before builds and again in `finalize-github-release` (list + merge split assets + delete duplicates + set `target_commitish`).
- **Assets spread across duplicates:** CI now merges automatically; for a broken tag outside CI, run `node scripts/consolidate-github-release-duplicates.mjs --tag vX.Y.Z` (requires `GH_TOKEN`), then re-run the release workflow for any missing platform artifacts.
- To recover on a broken tag: consolidate duplicates, keep the draft with merged assets, re-run **Build/Release Electron App** on the tag.
- **Do not force-move the `v*` tag while a release workflow is in progress.** Retagging starts another run and (with workflow concurrency) cancels the in-flight build; smoke jobs also assume a stable workflow `github.sha`.
- **Smoke tests fail with “ref does not point to the expected commit”:** the tag was moved after the workflow started. Re-run failed jobs only after the tag matches the run’s `headSha`, or merge the checkout `ref: ${{ github.sha }}` fix and trigger a fresh tag run.

### Tag already exists

To re-cut the same version (only before wide distribution):

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# Delete the GitHub release if created
# Fix issue, then pnpm run release again or re-tag manually
```

### Build fails due to native modules

```bash
pnpm run rebuild
pnpm run build
```

Release jobs run `pnpm run rebuild` automatically before `dist:*:publish`.

### Flatpak publish did not attach bundles

- Confirm `flatpak.yaml` **`publish`** job ran on the tag (not only manual `workflow_dispatch`)
- The publish step uses `draft: true` so it will not promote a draft to live — it only adds files

---

## Rollback

If a published release has critical issues:

1. Do not delete the release (users may already have downloads)
2. Ship a patch release with the fix
3. Document the known issue in release notes
4. Yank only if caught immediately and distribution was minimal

---

## Manual release (emergency)

If automation fails and you must upload artifacts by hand:

```bash
pnpm run build
pnpm run dist:mac # or dist:linux / dist:win on the target OS
# Optional: node scripts/verify-*-packaging.mjs after dist
```

Upload outputs from `release/` to a manually created GitHub Release. This bypasses CI smoke tests — use only as a last resort.

---

## Related docs

- [CI/CD Workflows](ci-cd.md)
- [Development Guide — packaging scripts](development-environment.md#package-distributables)
- [Flatpak local build](development-environment.md#building-a-flatpak-linux)
