# Release Process

This document describes how maintainers create releases for Mesh-Client.

---

## Overview

Cut releases from **Actions → Cut release** ([`cut-release.yaml`](../.github/workflows/cut-release.yaml)), which bumps/tags `main`. Pushing an annotated version tag (`v*`) then triggers:

| Workflow                                            | Purpose                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`release.yaml`](../.github/workflows/release.yaml) | Build macOS/Linux/Windows via `electron-builder` (`--publish never`) and attach to the prepare draft |
| [`flatpak.yaml`](../.github/workflows/flatpak.yaml) | Build Reticulum sidecar + Flatpak bundles (x86_64 and aarch64) and attach them to the same draft     |

Both workflows upload to a **draft** GitHub Release. A maintainer reviews artifacts and publishes manually when ready.

`prepare-github-release` is the **only** job that creates the draft (`MESH_CLIENT_ALLOW_DRAFT_CREATE=1`). Matrix builds and Flatpak attach with `ci-upload-release-assets.mjs` by `release_id` so parallel jobs cannot fork duplicate drafts. `electron-builder.yml` still sets `releaseType: draft` for local `dist:*:publish` use.

Documentation deploys separately: [`docs.yml`](../.github/workflows/docs.yml) runs on every push to `main` (including the version-bump commit from `pnpm run release`).

### Database schema upgrades

`CURRENT_SCHEMA_VERSION` in [`src/main/db-schema-sync.ts`](../src/main/db-schema-sync.ts) is the on-disk SQLite `user_version` this build supports. Schema upgrades are **one-way**:

- **CI:** `schema-release-compare` (Build Binaries, Build Flatpak, and Release) warns when this build’s schema is newer than the last published release. Test builds also upload a `READ-ME-FIRST-*.md` artifact with the download set.
- **Installers:** when bumped, Windows NSIS shows an advisory MessageBox; macOS/Linux/Flatpak packages may include `SCHEMA-UPGRADE.txt` in app resources.
- **App launch:** if an existing database’s `user_version` is behind this build, Mesh-Client shows a blocking **Quit / Upgrade** dialog **before** running `runSchemaUpgrade`. Quit leaves the database unchanged. Set `MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE=1` to auto-accept (E2E / automation only).
- **Too new:** opening a database upgraded by a newer app with an older build still fails with the existing schema-too-new fatal dialog.

---

## Prerequisites

- Maintainer access to the repository
- On branch **`main`**, up to date with `origin/main`
- Clean working directory (no uncommitted changes)
- For `pnpm run release` pre-flight: **actionlint** and **yamllint** installed (or run `pnpm run setup:actionlint` and install yamllint via pip/brew — see [Development Guide](development-environment.md#8-helper-scripts-auto-install-where-possible))
- For `pnpm run release` pre-flight: **flatpak-node-generator** on `PATH` (same pin as Flatpak CI — see [Building a Flatpak](development-environment.md#building-a-flatpak-linux) / `pnpm run check:flatpak-offline-pnpm` install hint)

---

## Recommended: Cut release from GitHub Actions

**Preferred path:** Actions → **Cut release** ([`cut-release.yaml`](../.github/workflows/cut-release.yaml)).

1. (Optional) Run once with **dry_run** checked to confirm the computed version in the job summary (`feat(scope):` → minor, etc.).
2. Re-run with dry_run unchecked. Default bump is **auto**; override with `patch` / `minor` / `major` / exact `X.Y.Z` when needed.
3. **skip_dep_update** defaults to **true** — bump dependencies in a normal PR via `pnpm run update` before cutting.
4. The workflow sets `MESH_CLIENT_RELEASE_YES=1` (non-interactive). Locally use `pnpm run release -- --yes` or the same env var.
5. Wait for `release.yaml` + `flatpak.yaml` to attach draft artifacts, then **Publish** on GitHub.

**Secret:** `RELEASE_PUSH_TOKEN` — fine-grained PAT (or GitHub App installation token) owned by a repo **admin** (so the merge-queue ruleset bypass applies), with **contents: write** and **workflows: write**. Plain `GITHUB_TOKEN` cannot trigger tag workflows and cannot push past the ruleset.

Version detection lives in [`scripts/detectReleaseBump.mjs`](../scripts/detectReleaseBump.mjs) (handles scoped Conventional Commits such as `feat(rrc): …`).

---

## Local fallback: `pnpm run release`

Local `scripts/release.sh` remains for emergencies when Actions is unavailable. It:

1. Verifies you are on `main` and pulls latest
2. Runs **`pnpm update`** and **`pnpm dedupe`** (updates lockfile before the bump)
3. Syncs **`org.coloradomesh.MeshClient.yml`** Electron vendored archives to match `package.json` (`node scripts/sync-flatpak-electron.mjs`)
4. Auto-detects **patch / minor / major** via [`detectReleaseBump.mjs`](../scripts/detectReleaseBump.mjs) (scoped Conventional Commits such as `feat(rrc):` count as **minor**) since the last tag (or accept an explicit bump — see below)
5. Runs **pre-flight validation** (`check:environment`, release CLI health, format, lint, typecheck, **all** `check:*` scanners including path-gated pre-commit ones, **`check:flatpak`**, **`check:flatpak-offline-pnpm`**, **`check:i18n`**, lockfile re-dedupe stability (not `pnpm dedupe --check` — that breaks hoisted `node_modules/.bin`), audit, **required** actionlint + yamllint, **full** Vitest via `pnpm run test:run`, Reticulum sidecar `cargo test`)
6. Prints **copy-paste release notes** grouped by feat/fix/other/breaking
7. Bumps `package.json` via `pnpm version`
8. Prepends a `<release>` entry to `flatpak/org.coloradomesh.MeshClient.metainfo.xml`
9. Commits, creates an annotated tag, and pushes **commit + tag** to `origin`

```bash
git checkout main
git pull origin main
pnpm run release                                  # auto-detect bump from commits since last tag
pnpm run release minor                            # force minor
pnpm run release 5.21.0                           # force exact version
pnpm run release --auto                           # explicit auto-detect
pnpm run release --finish                         # complete a mid-release after package.json was already bumped
pnpm run release -- --yes                         # non-interactive (skip both confirmation prompts)
pnpm run release -- --yes --skip-dep-update patch # CI-style: no pnpm update
MESH_CLIENT_RELEASE_YES=1 pnpm run release        # same as --yes (avoids pnpm's own -y)
```

The script prompts twice by default (start pre-flight, then confirm after checks pass). Pass **`-- --yes`** after `pnpm run release` (or set `MESH_CLIENT_RELEASE_YES=1`) to skip those prompts — useful for automation. Use `--` so pnpm does not swallow `-y`/`--yes`. **Expect several minutes** for the full validation chain.

**Full suite only:** Release must never use `test:staged`, `test:changed`, or `vitest related`. Pre-commit may run a staged subset for speed; release matches PR CI by running the unrestricted `pnpm run test:run` (`vitest run`) and does not soft-skip actionlint/yamllint when those tools are missing.

If pre-flight fails, fix the issue on `main` and cut again — do not tag manually until checks pass.

### Mid-release MetaInfo failure

If `package.json` was already bumped but the Flatpak MetaInfo `<release>` entry is wrong/corrupt (or the release commit was blocked by `check:flatpak`):

1. **Do not** re-run `pnpm run release` — that would bump again.
2. Fix the top `<release version="…">` in `flatpak/org.coloradomesh.MeshClient.metainfo.xml` to match `package.json`’s `version`.
3. Complete with `pnpm run release --finish` (commit + tag + push; no version bump, no full preflight replay).

The version written into MetaInfo always comes from `package.json` after `pnpm version` (never from `pnpm version` stdout).

---

## macOS code signing and notarization

Official macOS release artifacts are **Developer ID signed** and **notarized** when repository secrets are configured. [`electron-builder.yml`](../electron-builder.yml) sets `hardenedRuntime: true` and `notarize: true`; electron-builder skips notarization automatically when no signing certificate is available (local/fork builds).

### Required GitHub Actions secrets

Configure these in **Settings → Secrets and variables → Actions** (maintainers only):

| Secret                            | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| **`RELEASE_PUSH_TOKEN`**          | Admin PAT for **Cut release** (contents + workflows); see above         |
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

- **`macos-latest`** → `pnpm run dist:mac` then `ci-upload-release-assets.mjs`
- **`ubuntu-latest`** → `pnpm run dist:linux` (x64 + arm64 AppImage, `.deb`, `.rpm`) then upload
- **`windows-latest`** → `pnpm run dist:win` (x64 + arm64 NSIS installers) then upload

Each job runs `pnpm install --frozen-lockfile`, `pnpm run rebuild`, builds with `--publish never`, then attaches artifacts to the prepare draft with **`GITHUB_TOKEN`** as `GH_TOKEN`.

After builds finish, **`packaging-smoke`** runs on:

- macOS — `verify-mac-packaging.mjs` (includes bundled Reticulum sidecar in `.app`)
- Linux — `verify-linux-packaging.mjs` plus `test-linux-appimage-reticulum-sidecar.mjs` (extracts x64/arm64 AppImages and asserts sidecar). **`verify-linux-packaging.mjs`** also asserts each `.deb` **Description** field is ASCII-only (no mojibake `??`) via `dpkg-deb -f` — non-ASCII control metadata breaks some package managers and mirrors.
- Windows x64 — NSIS install smoke test (`test-win-nsis-install.mjs`, asserts sidecar after install)
- **`windows-11-arm`** — arm64 NSIS install smoke test with 7z probe (asserts sidecar inside installer payload and after install)

Build jobs also run `verify-reticulum-sidecar-staged.mjs` after staging sidecars and before `electron-builder`.

### `flatpak.yaml` (Build Flatpak)

1. **`schema-release-compare`** — compares this SHA’s schema to the last published release; uploads `READ-ME-FIRST-flatpak.md` (included again beside Flatpak Actions artifacts)
2. **`reticulum-sidecar`** — builds `mesh-client-reticulum` per arch (x86_64 on `ubuntu-latest`, aarch64 on `ubuntu-24.04-arm`) with full RNS stack features
3. **`flatpak`** — stamps CI build info, writes schema upgrade notice when bumped, generates offline pnpm sources, builds `org.coloradomesh.MeshClient.flatpak` per arch inside the Flathub freedesktop 24.08 container, smoke-installs the unstamped bundle (manual **Build Flatpak (no release)** dispatch also renames downloadable artifacts to `…-run{N}.flatpak`; tag runs keep clean names)
4. **`publish`** (tag only) — waits for the Electron prepare draft (`ci-wait-github-draft-release.mjs`), then attaches both clean-named `.flatpak` files with `ci-upload-release-assets.mjs` using the shared `release_id` (never creates or publishes a release)

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

### Upload to draft release fails

- Confirm the workflow job has `contents: write` and `RELEASE_ID` is set from `prepare-github-release`
- Uploads use `GITHUB_TOKEN` as `GH_TOKEN` via `ci-upload-release-assets.mjs`; forked or restricted workflows may lack upload permission
- Tag CI builds with `dist:*` (`--publish never`) and attaches by id — do **not** reintroduce `dist:*:publish` in `release.yaml` (electron-builder `POST /releases` forks drafts)

### Duplicate draft releases for one tag

- Historically caused when parallel `dist:*:publish` / softprops jobs each `POST`ed a draft after a List Releases miss. Current CI: only `prepare-github-release` may create (`MESH_CLIENT_ALLOW_DRAFT_CREATE=1`); builds/Flatpak upload by id; Flatpak waits with `ci-wait-github-draft-release.mjs`.
- **Finalize PATCH 403 (`Resource not accessible by integration`):** Actions `GITHUB_TOKEN` cannot PATCH `target_commitish` when the tagged commit differs in `.github/workflows/` from the default branch. Consolidation skips that field. After assets are merged, only metadata PATCH **HTTP 403** is non-fatal; any other status should fail the job and be investigated.
- **Assets still split (external fork):** `finalize-github-release` merges via `ci-ensure-github-draft-release.mjs`; outside CI run `node scripts/consolidate-github-release-duplicates.mjs --tag vX.Y.Z` (requires `GH_TOKEN`).
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

Release jobs run `pnpm run rebuild` automatically before `dist:*`.

### Flatpak publish did not attach bundles

- Confirm `flatpak.yaml` **`publish`** job ran on the tag (not only manual `workflow_dispatch`)
- Publish waits for the prepare draft, then uploads with `ci-upload-release-assets.mjs` + `RELEASE_ID` (it does not create or publish a release)

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
