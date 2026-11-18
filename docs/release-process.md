# Release Process

This document describes how maintainers create releases for Mesh-Client.

---

## Overview

A release is a pull request to `main`. `pnpm run release:open` opens it with the version bump and generated release notes; Electron E2E on three operating systems and the release preflight run on it; it merges through the merge queue like any other pull request; and **Cut release** ([`cut-release.yaml`](../.github/workflows/cut-release.yaml)) tags the merged commit after a maintainer approves. Pushing that annotated version tag (`v*`) then triggers:

| Workflow                                            | Purpose                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`release.yaml`](../.github/workflows/release.yaml) | Build macOS/Linux/Windows via `electron-builder` (`--publish never`) and attach to the prepare draft |
| [`flatpak.yaml`](../.github/workflows/flatpak.yaml) | Build Reticulum sidecar + Flatpak bundles (x86_64 and aarch64) and attach them to the same draft     |

Both workflows upload to a **draft** GitHub Release, with the release notes from the tag at the top of its body. A maintainer reviews artifacts and publishes manually when ready.

`prepare-github-release` is the **only** job that creates the draft (`MESH_CLIENT_ALLOW_DRAFT_CREATE=1`). Matrix builds and Flatpak attach with `ci-upload-release-assets.mjs` by `release_id` so parallel jobs cannot fork duplicate drafts. `electron-builder.yml` still sets `releaseType: draft` for local `dist:*:publish` use.

Documentation deploys separately: [`docs.yml`](../.github/workflows/docs.yml) runs on every push to `main` (including the release commit).

### Database schema upgrades

`CURRENT_SCHEMA_VERSION` in [`src/main/db-schema-sync.ts`](../src/main/db-schema-sync.ts) is the on-disk SQLite `user_version` this build supports. Schema upgrades are **one-way**:

- **CI:** `schema-release-compare` (Build Binaries, Build Flatpak, and Release) warns when this build’s schema is newer than the last published release. Test builds also upload a `READ-ME-FIRST-*.md` artifact with the download set.
- **Installers:** when bumped, Windows NSIS shows an advisory MessageBox; macOS/Linux/Flatpak packages may include `SCHEMA-UPGRADE.txt` in app resources.
- **App launch:** if an existing database’s `user_version` is behind this build, Mesh-Client shows a blocking **Quit / Upgrade** dialog **before** running `runSchemaUpgrade`. Quit leaves the database unchanged. Set `MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE=1` to auto-accept (E2E / automation only).
- **Too new:** opening a database upgraded by a newer app with an older build still fails with the existing schema-too-new fatal dialog.

---

## Prerequisites

- Maintainer access to the repository, and `gh` signed in (`gh auth status`)
- For `pnpm run release:open`: a clone with `origin` pointing at this repository. The command fetches `main` itself and never touches your checkout, so any branch and a dirty tree are fine.
- For the emergency `pnpm run release`: on branch **`main`**, up to date with `origin/main`, with a clean working directory, plus **actionlint** and **yamllint** installed (or run `pnpm run setup:actionlint` and install yamllint via pip/brew, see [Development Guide](development-environment.md#8-helper-scripts-auto-install-where-possible)) and **flatpak-node-generator** on `PATH` (same pin as Flatpak CI, see [Building a Flatpak](development-environment.md#building-a-flatpak-linux) / `pnpm run check:flatpak-offline-pnpm` install hint)

---

## Release pull requests (recommended)

### 1. Open the release pull request

```bash
pnpm run release:open                 # bump from the commit titles
pnpm run release:open -- --dry-run    # print it all; push nothing
pnpm run release:open -- --bump patch # or minor, major, an exact X.Y.Z
pnpm run release:open -- --draft      # open a draft pull request
```

`release:open` counts the next version from the commit titles on `main` since the latest release tag ([`scripts/detectReleaseBump.mjs`](../scripts/detectReleaseBump.mjs): a `!` after the type, as in `feat!:`, or a `BREAKING CHANGE:` footer is major, `feat:` or `feat(scope):` is minor, anything else patch). It builds one commit on the tip of `main`, `chore: release vX.Y.Z`, that changes only `package.json` and the Flatpak MetaInfo, pushes it as `release/vX.Y.Z` and opens the pull request. The body has the release notes (grouped by breaking, features, fixes, other), the version change and why, the database schema change, and risk callouts for workflows, dependencies, the Reticulum sidecar, native helpers, database code, Flatpak packaging and release configuration.

Run it again whenever `main` has moved: it rebuilds the same pull request on the newer `main` (still one bump commit) and closes any other open release pull request as superseded. When the branch already holds exactly the commit it would build, it pushes nothing and only refreshes the text, so the checks keep their results. When nothing has merged since the last release, it says so and opens nothing.

While a merged release still waits for its tag (the Cut release approval is pending), the next version counts from `main`'s version, and the notes start after that release.

### 2. Let the release gates run

On a release pull request (a `release/*` branch from this repository), [`e2e.yaml`](../.github/workflows/e2e.yaml) runs Electron E2E on Linux, macOS and Windows and the **Release preflight** (the full `release.sh` pre-flight, `--preflight-only`, on a fresh runner), all on the pull request's head commit rather than GitHub's merge of it into `main`. The **Release gates** job sums them up: it is a required check on `main`, and it passes on a release pull request only when all four passed. Other pull requests and merge groups skip E2E, and Release gates passes on them at once. Locally, `pnpm run release --preflight-only` runs the same pre-flight (any branch; no pull, dep update, bump, tag, or push).

Edit the release notes in the pull request body if they need it: Cut release reads the `## Release notes` section when it tags. The `main` ruleset needs an approval of the last push from someone other than the person who made it, so whoever ran `release:open` last cannot approve the release, and each refresh dismisses earlier approvals. Once approved, add the pull request to the merge queue when nothing else is queued ahead of it: anything ahead of it lands on `main` first, and the release then takes the recovery path below.

### 3. Approve the tag

Every push to `main` runs **Cut release**. Its **Plan release tag** job decides whether the commit releases: the `package.json` version is newer than the latest tag, has no tag yet and matches the MetaInfo. For the release commit it then checks that Electron E2E and the release preflight passed on that exact tree, and the **Tag release** job waits for a maintainer's approval in the `release-cut` environment. Approve it to create the annotated tag `vX.Y.Z` with the release notes. Ordinary pushes end at the plan job with no approval prompt.

Then wait for `release.yaml` + `flatpak.yaml` to attach the draft artifacts, check the draft (see [Verify the draft release](#verify-the-draft-release)) and **Publish** it.

### When `main` moves before the release merges

A pull request's checks run before it merges, so they cover the release's tree only while nothing else reaches `main` between `release:open` and the merge. Merge the release pull request soon after its gates pass, and if something else merges first, run `pnpm run release:open` again before merging: the rebuilt pull request runs the gates again on the new tree.

If the release merges anyway after `main` moved, Cut release fails at **Plan release tag** and names the gates that have not passed on the merged tree. Recover with one E2E run on `main`: run **Actions → E2E → Run workflow** on `main`, and when it passes, **Actions → Cut release → Run workflow** on `main` before anything else merges, so both runs see the same commit.

Until then every push to `main` fails the same way, because `main` carries a version with no tag. A tag on the release commit still takes its notes from the release pull request, which was written before the other changes merged, so add those to the notes when you check the draft. (A tag on a later commit builds its notes from the commit titles instead.)

### Hotfixes

A hotfix is an ordinary pull request to `main`. Once it merges, run `pnpm run release:open -- --bump patch` and release it like any other version.

**Protected boundary:** the Plan release tag job holds no secrets (it reads contents, pull requests, check runs and workflow runs). The Tag release job runs in the `release-cut` environment, installs nothing, and is the only place `RELEASE_CUT_TOKEN` appears, for the one `git push` of the tag. Use a fine-grained PAT (or GitHub App installation token) owned by a repo **admin**, with **contents: write** and **workflows: write**: only admins may create `v*` tags (release tags ruleset), and a tag pushed with plain `GITHUB_TOKEN` would not start the tag workflows. Cut release runs one at a time and in order (`queue: max`), so a run waiting for approval never drops a later one.

---

## Emergency fallback: `pnpm run release`

Local `scripts/release.sh` remains for emergencies when Actions is unavailable. It skips the release pull request and its gates and pushes the bump commit and tag straight to `main`, which needs the repository admin bypass. It:

1. Verifies you are on `main` and pulls latest
2. Runs **`pnpm update`** and **`pnpm dedupe`** (updates lockfile before the bump)
3. Syncs **`org.coloradomesh.MeshClient.yml`** Electron vendored archives to match `package.json` (`node scripts/sync-flatpak-electron.mjs`)
4. Auto-detects **patch / minor / major** via [`detectReleaseBump.mjs`](../scripts/detectReleaseBump.mjs) (scoped Conventional Commits such as `feat(rrc):` count as **minor**) since the last tag (or accept an explicit bump — see below)
5. Runs **pre-flight validation** (`check:environment`, release CLI health, format, lint via `pnpm run lint --concurrency 2 --config eslint.ci.config.mjs` (same as `ci.yaml`; Prettier already covered by `format:check`), typecheck, **all** `check:*` scanners including path-gated pre-commit ones, **`check:flatpak`**, **`check:flatpak-offline-pnpm`**, **`check:i18n`**, lockfile re-dedupe stability (not `pnpm dedupe --check` — that breaks hoisted `node_modules/.bin`), audit, **required** actionlint + yamllint, **full** Vitest via `pnpm run test:run`, Reticulum sidecar `cargo test`)
6. Prints **copy-paste release notes** grouped by feat/fix/other/breaking
7. Bumps `package.json` via `pnpm version`
8. Prepends a `<release>` entry to `flatpak/org.coloradomesh.MeshClient.metainfo.xml`
9. Commits, creates an annotated tag, and pushes **commit + tag** to `origin`

```bash
git checkout main
git pull origin main
pnpm run release                               # auto-detect bump from commits since last tag
pnpm run release minor                         # force minor
pnpm run release 5.21.0                        # force exact version
pnpm run release --auto                        # explicit auto-detect
pnpm run release --finish                      # complete a mid-release after package.json was already bumped
pnpm run release --yes                         # non-interactive (skip both confirmation prompts)
pnpm run release --yes --skip-dep-update patch # CI-style: no pnpm update
pnpm run release patch --prepare-only          # validate, commit, and tag without pushing
pnpm run release --push-only                   # push that clean prepared release
MESH_CLIENT_RELEASE_YES=1 pnpm run release     # same as --yes (avoids pnpm's own -y)
# Invalid: --auto cannot be combined with patch|minor|major|x.x.x
# Note: `pnpm run release -- minor` is fine — pnpm 11 forwards bare `--`; release.sh ignores it.
```

The script prompts twice by default (start pre-flight, then confirm after checks pass). Pass **`--yes`** after `pnpm run release` (or set `MESH_CLIENT_RELEASE_YES=1`) to skip those prompts — useful for automation. **`--auto` plus an explicit bump is rejected.** `--push-only` fails closed unless the checkout is clean and the annotated package-version tag points at an exact `chore: release vX.Y.Z` HEAD. **Expect several minutes** for the full validation chain.

**Full suite only:** Release must never use `test:staged`, `test:changed`, or `vitest related`. Pre-commit and pull-request CI may run affected subsets for speed; release matches protected merge-queue CI by running the unrestricted `pnpm run test:run` (`vitest run`) and does not soft-skip actionlint/yamllint when those tools are missing.

If pre-flight fails, fix the issue on `main` and cut again — do not tag manually until checks pass.

### Mid-release MetaInfo failure

If `package.json` was already bumped but the Flatpak MetaInfo `<release>` entry is wrong/corrupt (or the release commit was blocked by `check:flatpak`):

1. **Do not** re-run `pnpm run release` — that would bump again.
2. Fix the top `<release version="…">` in `flatpak/org.coloradomesh.MeshClient.metainfo.xml` to match `package.json`’s `version`.
3. Complete with `pnpm run release --finish` (commit + tag + push; no version bump, no full preflight replay).

The version written into MetaInfo always comes from `package.json` after `pnpm version` (never from `pnpm version` stdout).

---

## macOS code signing and notarization

Official macOS release artifacts require **Developer ID signing** and **notarization**. [`electron-builder.yml`](../electron-builder.yml) sets `hardenedRuntime: true` and `notarize: true`; unsigned local/fork builds remain available.

### Required GitHub Actions secrets

Configure secrets under the named **Settings → Environments** boundary, not at repository scope:

| Environment              | Secret(s)                                                                                  | Allowed ref / approval                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **`release`**            | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Protected `v*` tag; no reviewer (the approved cut is the gate)       |
| **`release-cut`**        | `RELEASE_CUT_TOKEN`                                                                        | `main`; required maintainer approval for release cuts                |
| **`license-automation`** | Required `LICENSE_PR_TOKEN` (repo-admin PAT; Contents + PRs write; unattended admin-merge) | `main`; license-document maintenance only, with no release authority |
| **`release-repair`**     | No custom secret; the workflow uses its job-scoped `GITHUB_TOKEN`                          | `main`; required maintainer approval                                 |

`release.yaml` alone receives the Apple/CSC credentials, and only its **`macos-latest`** matrix leg uses them. `build.yaml` never receives signing secrets and explicitly disables certificate discovery, so arbitrary-ref manual packages remain unsigned. A one-time migration moved these credentials into the protected environments and deleted the legacy repository-wide secrets. No release credential should remain repository-scoped.

### Partial-secret validation

Before every official Electron macOS release build, [`release.yaml`](../.github/workflows/release.yaml) runs **Validate macOS signing secrets**. If any of `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, or `APPLE_TEAM_ID` is missing, the job **fails early** with a clear list.

Fork workflows and local `pnpm run dist:mac` without these env vars produce **unsigned** `.dmg` / `.zip` bundles (still validated by `verify-mac-packaging.mjs`). See [CI/CD — macOS packaging verify](ci-cd.md#macos-packaging-verify-verify-mac-packagingmjs).

---

## Windows signing readiness

Windows NSIS installers are currently **unsigned**. The Windows release job does not pass
signing credentials, and `electron-builder.yml` has no Windows signing provider configured.
Microsoft account approval is a prerequisite for the intended signing service; it does not
configure this repository or prove an installer is signed.

Windows signing is an owner-managed follow-up and **does not block the next release**, per the
maintainer's release decision. Existing unsigned Windows packaging and installation checks remain
the release behavior while Microsoft/provider setup is pending.

When the owner enables Windows signing, use this checklist to verify that work:

- [ ] Confirm the approved Microsoft signing service, account, certificate/profile, and expected
      publisher identity. Record its required configuration without guessing service-specific values.
- [ ] Configure that provider in the protected **`release`** environment and the Windows-only
      official release job. Keep arbitrary-ref `build.yaml`, pull requests, and local unsigned
      builds free of release credentials.
- [ ] Once signing is enabled for official Windows releases, fail that job early when its required
      signing configuration is missing so a provider failure cannot silently ship unsigned files.
- [ ] Sign the application, bundled executable components (including the Reticulum sidecar), and
      both x64 and arm64 NSIS installers. Check the final packaged payload, not just an intermediate
      build directory.
- [ ] Before upload, verify Authenticode signatures, expected publisher, and timestamp on both
      installers and their installed executable payloads. Run the existing x64 and arm64 NSIS
      installation smoke tests against those same artifacts.
- [ ] Validate an update from the currently published unsigned release to the signed build, then
      an update between signed builds. Preserve the exact installer names and `latest.yml` hashes;
      do not sign or otherwise modify an installer after updater metadata is generated.

The current `verify-win-packaging.mjs` checks executable presence/size, bundled sidecar presence,
per-architecture installers, and updater metadata. `test-win-nsis-install.mjs` checks installed
payloads on x64 and arm64. Neither currently verifies Authenticode signatures, publisher identity,
or trusted timestamps. A green packaging job therefore proves packaging readiness only; it does
not establish that Windows artifacts are signed. The signing follow-up remains separate from
approval of the next unsigned Windows release.

---

## Manual verification (optional)

If you need to run checks outside `release.sh`:

```bash
pnpm run format:check
pnpm run lint:md
pnpm run lint --concurrency 2 --config eslint.ci.config.mjs
pnpm run typecheck
pnpm run check:i18n
pnpm run test:run
pnpm run build
```

For parity with CI packaging smoke tests after a local dist build, see [CI/CD — Release workflow](ci-cd.md#release-releaseyaml).

---

## Manual version bump (fallback)

Only if neither `pnpm run release:open` nor `pnpm run release` can be used:

```bash
# Edit package.json version, then:
git add package.json pnpm-lock.yaml org.coloradomesh.MeshClient.yml
# If electron changed: node scripts/sync-flatpak-electron.mjs
# If the electron/pnpm/Node.js major changed: bump electron_N / pnpm_N / nodejs_N in flake.nix
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
- Linux — `verify-linux-packaging.mjs` plus `test-linux-appimage-reticulum-sidecar.mjs` (extracts x64/arm64 AppImages and asserts the Reticulum sidecar **and** that each AppImage’s embedded `app.asar` / `X-AppImage-Version` match `package.json`, so a mislabeled About version cannot ship). **`verify-linux-packaging.mjs`** also asserts each `.deb` **Description** field is ASCII-only (no mojibake `??`) via `dpkg-deb -f` — non-ASCII control metadata breaks some package managers and mirrors.
- Windows x64 — NSIS install smoke test (`test-win-nsis-install.mjs`, asserts sidecar after install)
- **`windows-11-vs2026-arm`** — arm64 NSIS install smoke test with 7z probe (asserts sidecar inside installer payload and after install). Uses GitHub's advance-testing WoA runner ahead of the Sept 2026 VS 2026 rollout on `windows-11-arm`.

Build jobs also run `verify-reticulum-sidecar-staged.mjs` after staging sidecars and before `electron-builder`.

### `flatpak.yaml` (Build Flatpak)

1. **`schema-release-compare`** — compares this SHA’s schema to the last published release; uploads `READ-ME-FIRST-flatpak.md` (included again beside Flatpak Actions artifacts)
2. **`reticulum-sidecar`** — builds `mesh-client-reticulum` per arch (x86_64 on `ubuntu-latest`, aarch64 on `ubuntu-24.04-arm`) with full RNS stack features
3. **`flatpak`** — stamps CI build info, writes schema upgrade notice when bumped, generates offline pnpm sources, builds `org.coloradomesh.MeshClient.flatpak` per arch inside the digest-pinned Flathub freedesktop 24.08 multi-architecture container, smoke-installs the unstamped bundle (manual **Build Flatpak (no release)** dispatch also renames downloadable artifacts to `…-run{N}.flatpak`; tag runs keep clean names)
4. **`publish`** (tag only) — on a bare GitHub runner, signs and verifies source/builder/bundle-digest provenance, waits for the Electron prepare draft (`ci-wait-github-draft-release.mjs`), then attaches both clean-named `.flatpak` files and their Sigstore attestation with `ci-upload-release-assets.mjs` using the shared `release_id` (never creates or publishes a release)

Both tag-triggered workflows must complete before the release is fully populated. Flatpak bundles often arrive a few minutes after the Electron artifacts.

### Reticulum sidecar in installers

- **Flatpak:** sidecar is built in CI and embedded under `resources/reticulum-sidecar/` before `flatpak-builder` runs.
- **macOS / Linux / Windows (Electron):** `release.yaml` / `build.yaml` run `scripts/build-reticulum-sidecar-release.mjs` per platform before `dist:*`, staging per-arch binaries under `resources/reticulum-sidecar/staged/`. The `beforePack` hook in [`electron-builder.yml`](../electron-builder.yml) copies the correct `mesh-client-reticulum` binary into each installer (Windows x64 + arm64, Linux x64 + arm64, macOS x64 + arm64). Packaging verify scripts assert the sidecar is present in unpacked bundles.
- **Releases before this pipeline shipped** may show “Reticulum sidecar not built” in packaged installs — upgrade to a release that includes the sidecar or use Flatpak on Linux.
- **Dev builds** use `reticulum-sidecar/target/debug/` instead — see [Reticulum sidecar (optional)](development-environment.md#reticulum-sidecar-optional).

---

## Verify the draft release

1. Go to GitHub → **Releases**
2. Open the new **draft** for the version tag
3. Confirm the release **tag** is `vX.Y.Z` (not `untagged-*` — a wrong tag breaks the in-app updater footer and AUR/`mesh-client-bin` download URLs). Finalize CI fails if any matching release is still `untagged-*`; if Publish lands on a leftover placeholder, a maintainer must manually dispatch **Repair published release tag** and approve its `release-repair` environment.
4. Confirm artifacts:

| Platform      | Artifacts                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS         | `.dmg` and `.zip` (x64 and arm64)                                                                                                                |
| Linux         | `.AppImage`, `.deb`, `.rpm` (x64 and arm64)                                                                                                      |
| Linux Flatpak | `org.coloradomesh.MeshClient-x86_64.flatpak`, `org.coloradomesh.MeshClient-aarch64.flatpak`, and `mesh-client-flatpak-attestation.sigstore.json` |
| Windows x64   | `Mesh-client-Setup-{version}.exe`                                                                                                                |
| Windows arm64 | `Mesh-client-Setup-{version}-arm64.exe` (Windows 11 on ARM — not the x64 installer)                                                              |

1. Check the release notes at the top of the draft body (they come from the release pull request through the tag), and edit them there if needed. A release cut with the emergency `pnpm run release` has no notes in its tag: paste the block it printed, or GitHub’s generated notes.
2. Optionally smoke-test downloads on one platform per family

Until you click **Publish release**, the tag exists but the release stays hidden from the public Releases page.

`finalize-github-release` runs `scripts/assert-github-release-update-yml.mjs` so every `latest.yml` / `latest-mac.yml` / `latest-linux.yml` / `latest-linux-arm64.yml` `url` is an exact GitHub asset name. Windows Setup names must be hyphenated (`Mesh-client-Setup-{version}.exe`). Spaced names become dotted on upload and the in-app updater 404s.

### Repair Windows updater assets on an already-published release

If `latest.yml` lists hyphenated Setup names but the release only has dotted GitHub names (`Mesh-client.Setup.{version}.exe`):

1. Download the existing x64 and arm64 NSIS binaries from the release (dotted names).
2. Re-upload the **same files** as extra assets named `Mesh-client-Setup-{version}.exe` and `Mesh-client-Setup-{version}-arm64.exe`. Keep the dotted files.
3. Confirm `https://github.com/Colorado-Mesh/mesh-client/releases/download/v{version}/Mesh-client-Setup-{version}.exe` returns 302, not 404.

Example for v5.36.0 (run from a temp dir after `gh auth login`):

```bash
gh release download v5.36.0 --pattern 'Mesh-client.Setup.5.36.0.exe' --pattern 'Mesh-client.Setup.5.36.0-arm64.exe'
mv Mesh-client.Setup.5.36.0.exe Mesh-client-Setup-5.36.0.exe
mv Mesh-client.Setup.5.36.0-arm64.exe Mesh-client-Setup-5.36.0-arm64.exe
gh release upload v5.36.0 Mesh-client-Setup-5.36.0.exe Mesh-client-Setup-5.36.0-arm64.exe
```

v5.36.0 already has both dotted and hyphenated Setup assets (repaired 2026-09-13). Repeat only for an older tag that still 404s. The next tag still needs hyphenated names from CI (`normalize-win-setup-artifact-names.mjs`).

---

## Publish the release

When artifacts and notes look correct:

1. Edit the draft if needed (summary, breaking changes, contributors)
2. Click **Publish release**

---

## Version naming

Follow [Semantic Versioning](https://semver.org/). Auto-detect is implemented in [`scripts/detectReleaseBump.mjs`](../scripts/detectReleaseBump.mjs) (called from `pnpm run release:open` and `release.sh`):

- **Major (X.0.0):** `type!:` / `type(scope)!:`, or a line-anchored `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer in a commit body
- **Minor (0.X.0):** New features (`feat:` or `feat(scope):`), backward compatible
- **Patch (0.0.X):** Fixes and other conventional commits without `feat:`

Release notes “Breaking Changes” use the same subject bang + footer rules (not subject-only).

---

## Post-release checklist

- [ ] Draft release shows all platform artifacts (including both Flatpak arches)
- [ ] Packaging-smoke jobs green in Actions
- [ ] Test download and install on at least one platform
- [ ] **Publish** the draft on GitHub
- [ ] Confirm docs site updated after the version commit landed on `main` ([docs workflow](ci-cd.md#docs-docsyml))
- [ ] Announce (Discord `#mesh-client-help`, etc.)
- [ ] Close milestone if used

---

## Troubleshooting

### Release workflow fails on one platform

- Inspect the failed job log in Actions
- Platform failures are often native-module or packaging related
- Fix on `main`, then release a new patch version (`pnpm run release:open -- --bump patch`)

### Upload to draft release fails

- Confirm the workflow job has `contents: write` and `RELEASE_ID` is set from `prepare-github-release`
- Uploads use `GITHUB_TOKEN` as `GH_TOKEN` via `ci-upload-release-assets.mjs`; forked or restricted workflows may lack upload permission
- Tag CI builds with `dist:*` (`--publish never`) and attaches by id — do **not** reintroduce `dist:*:publish` in `release.yaml` (electron-builder `POST /releases` forks drafts)

### Duplicate draft releases for one tag

- Historically caused when parallel `dist:*:publish` / softprops jobs each `POST`ed a draft after a List Releases miss. Current CI: only `prepare-github-release` may create (`MESH_CLIENT_ALLOW_DRAFT_CREATE=1`); builds/Flatpak upload by id; Flatpak waits with `ci-wait-github-draft-release.mjs`.
- **Draft tag detach (`untagged-*`):** GitHub can leave a draft on `untagged-<hex>` while the annotated `vX.Y.Z` tag still exists (common during the upload window). Prepare asserts/repairs `tag_name` with the release job's scoped `GITHUB_TOKEN`, finalize consolidates again, and both paths **delete orphan `refs/tags/untagged-*`** after a successful repair so Publish cannot rebind to a leftover placeholder. Refs that are still a live release’s `tag_name` (e.g. historical 5.27.0) are never deleted.
- **`finalize-github-release`** runs consolidation then **`ci-verify-github-draft-release.mjs`**, which **fails the workflow** if the draft `tag_name` is still `untagged-*` **or** any matching release for that version is still on an untagged placeholder. Do not publish until that job is green and the draft tag shows `vX.Y.Z`.
- **Manual publish repair:** if a published release still needs repair, dispatch `.github/workflows/repair-published-release-tag.yaml` from `main` with the release tag/name. Its `release-repair` environment requires maintainer approval and then reattaches `vX.Y.Z` via `scripts/repair-published-release-tag.mjs`.
- **Finalize PATCH 403 (`Resource not accessible by integration`):** the release job's scoped `GITHUB_TOKEN` must repair the protected release tag; tag repair must succeed or the verify step fails. Do not restore a repository-wide credential fallback.
- **Assets still split (external fork):** `finalize-github-release` merges via `ci-ensure-github-draft-release.mjs`; outside CI run `node scripts/consolidate-github-release-duplicates.mjs --tag vX.Y.Z` (requires `GH_TOKEN`).
- **Do not force-move the `v*` tag while a release workflow is in progress.** Retagging starts another run and (with workflow concurrency) cancels the in-flight build; smoke jobs also assume a stable workflow `github.sha`.
- **Smoke tests fail with “ref does not point to the expected commit”:** the tag was moved after the workflow started. Re-run failed jobs only after the tag matches the run’s `headSha`, or merge the checkout `ref: ${{ github.sha }}` fix and trigger a fresh tag run.

### Tag already exists

To re-cut the same version (only before wide distribution):

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# Delete the GitHub release if created
# Fix issue, then run Cut release on main (Actions, Cut release, Run workflow) or re-tag manually
```

### Cut release fails at Plan release tag

The plan names the gates that have not passed on the commit's tree, for example `Electron E2E on macOS (no run)`. That happens when a gate failed on the release pull request, or when something else reached `main` between the release pull request's checks and its merge. Run **Actions → E2E → Run workflow** on `main`; when it passes, run **Actions → Cut release → Run workflow** on `main` before anything else merges. See [When `main` moves before the release merges](#when-main-moves-before-the-release-merges).

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
