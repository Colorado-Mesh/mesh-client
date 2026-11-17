# Release Process

This document describes how changes reach `main` and how maintainers release Mesh-Client.

---

## Overview

Work lands on `staging`. A promotion pull request carries a tested `staging` snapshot to `main`, and merging a promotion that raises the version releases it.

- **`staging`** holds the next release and is the default branch. It receives feature and fix pull requests (squashed through the merge queue), the version bump, and back-ports from `main`.
- **`main`** holds released code: every promotion and hotfix that has merged. It receives promotion pull requests and `hotfix/*` pull requests, merged with a merge commit only.

From a pull request to a published release:

1. Contributors open pull requests against `staging`. They merge through its squash merge queue.
2. A maintainer runs `pnpm run promotion:open`. It picks the next version from the commit titles since the last release, commits the version bump to `staging`, and opens a pull request titled `Promote staging to main (vX.Y.Z)` with generated release notes.
3. CI, the 3-OS Electron E2E, the release preflight and the **Promotion Doctor** run on that pull request. A maintainer reviews it and merges it with a merge commit.
4. **Cut release** ([`cut-release.yaml`](../.github/workflows/cut-release.yaml)) sees the new version on `main`. After a maintainer approves the `release-cut` environment, it tags the merged commit `vX.Y.Z`, with the release notes as the tag message.
5. The tag starts the two build workflows below. They attach the artifacts to a **draft** GitHub Release, which opens with the release notes.
6. A maintainer reviews the draft and publishes it by hand.

The two build workflows the tag starts:

- [`release.yaml`](../.github/workflows/release.yaml) builds macOS, Linux and Windows with `electron-builder` (`--publish never`) and attaches them to the prepare draft.
- [`flatpak.yaml`](../.github/workflows/flatpak.yaml) builds the Reticulum sidecar and the Flatpak bundles (x86_64 and aarch64) and attaches them to the same draft.

`prepare-github-release` is the **only** job that creates the draft (`MESH_CLIENT_ALLOW_DRAFT_CREATE=1`). Matrix builds and Flatpak attach with `ci-upload-release-assets.mjs` by `release_id` so parallel jobs cannot fork duplicate drafts. `electron-builder.yml` still sets `releaseType: draft` for local `dist:*:publish` use.

Documentation deploys separately: [`docs.yml`](../.github/workflows/docs.yml) runs on every push to `main`, so the published docs follow the released app.

The branch rulesets and the Promotion Doctor's Actions policy that this flow relies on are described in [CI/CD: Merge queue and rulesets](ci-cd.md#merge-queue-and-rulesets).

### Database schema upgrades

`CURRENT_SCHEMA_VERSION` in [`src/main/db-schema-sync.ts`](../src/main/db-schema-sync.ts) is the on-disk SQLite `user_version` this build supports. Schema upgrades are **one-way**:

- **CI:** `schema-release-compare` (Build Binaries, Build Flatpak, and Release) warns when this build’s schema is newer than the last published release. Test builds also upload a `READ-ME-FIRST-*.md` artifact with the download set.
- **Installers:** when bumped, Windows NSIS shows an advisory MessageBox; macOS/Linux/Flatpak packages may include `SCHEMA-UPGRADE.txt` in app resources.
- **App launch:** if an existing database’s `user_version` is behind this build, Mesh-Client shows a blocking **Quit / Upgrade** dialog **before** running `runSchemaUpgrade`. Quit leaves the database unchanged. Set `MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE=1` to auto-accept (E2E / automation only).
- **Too new:** opening a database upgraded by a newer app with an older build still fails with the existing schema-too-new fatal dialog.

---

## Prerequisites

- Repository admin access. `pnpm run promotion:open` and `pnpm run promotion:backport` push the version bump and back-ports straight to `staging`, which only admins may do (they bypass its ruleset).
- The GitHub CLI signed in (`gh auth status`): the promotion commands open and update pull requests with it.
- A clone whose `origin` remote is `Colorado-Mesh/mesh-client`. Any branch works and the working tree need not be clean: the promotion commands build commits with git plumbing and never touch your checkout or index.
- For the [emergency `pnpm run release` path](#emergency-fallback-pnpm-run-release) only: **actionlint** and **yamllint** installed (or run `pnpm run setup:actionlint` and install yamllint with pip or Homebrew; see the [Development Guide](development-environment.md#8-helper-scripts-auto-install-where-possible)), and **flatpak-node-generator** on `PATH` (same pin as Flatpak CI; see [Building a Flatpak](development-environment.md#building-a-flatpak-linux) and the `pnpm run check:flatpak-offline-pnpm` install hint)

---

## Recommended: promote staging to main

### Open the promotion

```bash
pnpm run promotion:open -- --dry-run    # plan and body only; pushes nothing
pnpm run promotion:open                 # release the next version
pnpm run promotion:open -- --bump minor # or patch, major, or an exact X.Y.Z
pnpm run promotion:open -- --bump none  # promote without releasing
pnpm run promotion:open -- --draft      # open the pull request as a draft
```

It works against `origin` and takes these steps:

1. Fetches `main`, `staging` and the release tags.
2. Stops if `staging` has nothing that `main` lacks.
3. If `main` has a change that `staging` lacks (a hotfix), back-ports it first, as `pnpm run promotion:backport` does (see [Hotfixes](#hotfixes)).
4. Picks the version. The commit titles since the last `vX.Y.Z` tag on `main` decide the bump (see [Version naming](#version-naming)) unless `--bump` overrides it. While a merged release still waits for its tag (its Cut release approval is pending), `main` already carries that version: the new version counts from it, and only the commits `main` does not have yet decide the bump and the release notes.
5. Commits `chore: release vX.Y.Z` to `staging`: the `package.json` version and a new top entry in the Flatpak MetaInfo release list. When `staging` already carries that version from an earlier run, it reuses that commit instead of bumping again.
6. Builds the promotion commit. Its tree is exactly the `staging` tip's tree, and its parents are the `main` tip and the `staging` tip.
7. Pushes it to `release/vX.Y.Z` (`release/promote-staging-YYYY-MM-DD` when nothing releases) and opens the pull request to `main`. When a promotion on a `release/` branch is already open, it updates that pull request instead, on its existing branch, even if the version changed, and closes any other such promotion as superseded. It never writes to a branch outside `release/`.

The pull request body is generated in these sections:

- `## Release notes`: breaking changes, features, fixes and other changes from the commit titles, one line per pull request. This section becomes the tag message and the top of the draft release. Edit it freely, but keep every pull request number: the Promotion Doctor checks that each shipped pull request is listed.
- `## Version`: the previous and next version, and why.
- `## Database schema`: whether `CURRENT_SCHEMA_VERSION` changes. A schema upgrade is one-way, so it must be called out here.
- `## Risk callouts`: changed workflows, dependencies, Reticulum sidecar, native helpers, database code, Flatpak packaging, and release or packaging configuration.
- `## Promotion`: the `main` and `staging` commits it was built from.

### Review and merge

- Pull requests to `main` require the five CI checks and `Promotion Doctor` (see [CI/CD: Merge queue and rulesets](ci-cd.md#merge-queue-and-rulesets)). The 3-OS Electron E2E and the **Release preflight** (`release.sh --preflight-only` on the exact tree that will be tagged) also run on every pull request to `main`. They are not required checks by name; the Doctor requires them instead. It waits until the E2E has run and passed on each of the three operating systems and the preflight has too (a skipped run does not count), and it fails if they or any other check on the pull request fail. Opening, reopening or pushing to a pull request to `main` starts them; retargeting a pull request from `staging` to `main` does not, so close and reopen it after a retarget.
- Merge with **Create a merge commit**, the only method `main` allows. Never squash or rebase a promotion.
- Do not press **Update branch** on a promotion. It puts a new merge commit on top, so the head is no longer a promotion commit and the Doctor fails. When `main` has moved (a hotfix merged), run `pnpm run promotion:open` again: it back-ports the hotfix into `staging`, rebuilds the promotion on the new `main`, and updates the same pull request.
- `staging` may move on while the promotion is in review. The promotion still ships the snapshot it was built from, which is the tree its checks ran on; newer `staging` commits wait for the next promotion. Run `pnpm run promotion:open` again to include them.

### Approve the release tag

Merging starts **Cut release** on `main`:

1. **Plan release tag** (no secrets) tags only when `package.json` holds a version newer than the latest release, `vX.Y.Z` does not exist yet, and the Flatpak MetaInfo top entry matches. Other pushes to `main` stop here, with no approval prompt. The job summary says which case applied.
2. **Tag release** waits for approval in the `release-cut` environment. It then creates the annotated tag `vX.Y.Z` on the merged commit, with the promotion's release notes as the message, and pushes it with `RELEASE_CUT_TOKEN`.

Cut release runs one at a time, in order. A run that waits for approval holds back the runs for later pushes to `main` until it ends, and none of them is dropped; a later run whose version is already tagged stops at its plan job.

If the approval was declined or the job failed, start it again: **Actions > Cut release > Run workflow** on `main` checks the current `main` commit. Do not run `pnpm run release` to recover, because it would bump the version again.

**Protected boundary:** `RELEASE_CUT_TOKEN` lives only in the `release-cut` environment, which accepts only `main` and requires a maintainer's approval. Use a fine-grained PAT (or GitHub App installation token) owned by a repository **admin**, with **contents: write** and **workflows: write**: only admins may create `v*` tags (the release tags ruleset), and a tag pushed with the default `GITHUB_TOKEN` would not start the build workflows. Only the tag job receives the token; it installs nothing and runs no project script.

### Publish

Wait for `release.yaml` and `flatpak.yaml` to attach the artifacts, check the draft ([Verify the draft release](#verify-the-draft-release)), then click **Publish release**.

---

## Hotfixes

A fix for released code that cannot wait for the next promotion goes straight to `main`:

1. Branch from `main` in this repository (not a fork), with a `hotfix/` prefix.
2. Commit the fix. To release it, also bump the version with `pnpm run release:bump` and commit the two files the bump changes. The bump counts from the latest release, or from the version `main` carries while a merged release still waits for its tag, so a hotfix never reuses or lowers that version. It reads `main` from `origin/main`, so fetch first.
3. Open a pull request to `main`. When it releases, give its body a `## Release notes` section: it becomes the tag message and the draft release notes.
4. The Promotion Doctor checks that the branch contains the current `main` and carries no commits that are only on `staging`. When the version changes, it also checks that the version is above the one `main` carries, the MetaInfo entry and the release notes. It waits for the same checks as a promotion, including the 3-OS E2E and the release preflight, so even an urgent hotfix takes as long as those runs. A hotfix opened against `staging` and then retargeted to `main` has neither run until you close and reopen it. In a real emergency, a repository admin can merge past the ruleset.
5. Merge with a merge commit. When the version changed, Cut release tags it as described above.
6. Bring the fix into `staging` with `pnpm run promotion:backport`. It merges `main` into `staging` as a real merge commit. A squashed back-port would leave `main`'s commits outside `staging`'s history and make every later promotion conflict. If you forget, the next `pnpm run promotion:open` back-ports first.

```bash
# 1. Branch from main
git fetch origin
git switch -c hotfix/describe-the-fix origin/main

# 2. To release the fix: bump, then commit the two files
pnpm run release:bump -- patch # or minor, major, or an exact X.Y.Z
git add package.json flatpak/org.coloradomesh.MeshClient.metainfo.xml
git commit -m "chore: release vX.Y.Z"

# 6. After the merge: bring the fix into staging
pnpm run promotion:backport -- --dry-run # show what it would do
pnpm run promotion:backport
```

The back-port resolves one kind of conflict itself. When a hotfix releases while `staging` carries an unreleased version bump, both sides changed the version files: `package.json` keeps the higher version, and the MetaInfo keeps `main`'s released entries below `staging`'s unreleased one. Its output names the files it resolved.

Any other conflict stops the back-port: it changes nothing and lists the conflicting paths. Merge it by hand and push the merge commit to `staging` as an admin (a pull request would be squashed by the merge queue):

```bash
git fetch origin
git switch -c backport/main origin/staging
git merge origin/main -m "chore: back-port main into staging"
# Resolve the conflicts (version files as above), git commit, then:
git push origin HEAD:staging
```

---

## Emergency fallback: `pnpm run release`

`scripts/release.sh` still runs a complete local release when the promotion flow cannot. It releases **`main` as it is**, straight to `main`, without `staging`, a promotion or the Promotion Doctor, so keep it for emergencies:

- Run it only when the version on `main` equals the latest release. It bumps from `package.json`, so on a promotion that merged but was never tagged it would skip a version: re-run Cut release for that case (see [Approve the release tag](#approve-the-release-tag)) or [tag it by hand](#tag-a-merged-release-by-hand).
- Pass `--skip-dep-update`, so the emergency release does not also update dependencies on `main`.
- Afterwards, run `pnpm run promotion:backport` so `staging` gets the release commit. Cut release also runs for the push to `main`; it finds the tag already there and stops at its plan job (if it asks for approval anyway, decline it).

The script:

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
git switch main
git pull origin main
pnpm run release --yes --skip-dep-update patch # emergency release of main as it is
pnpm run promotion:backport                    # afterwards: back-port into staging
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

If pre-flight fails, fix the issue on `main` (as a [hotfix](#hotfixes)) and run it again. Do not tag by hand until the checks pass. Do not set `MESH_CLIENT_RELEASE_PARSE_ONLY` outside tests (a test-only hook; the CI preflight job clears it).

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

| Environment              | Secret(s)                                                                                  | Allowed ref / approval                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **`release`**            | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Protected `v*` tag; no reviewer (the approved cut is the gate)          |
| **`release-cut`**        | `RELEASE_CUT_TOKEN`                                                                        | `main`; required maintainer approval before each release tag            |
| **`license-automation`** | Required `LICENSE_PR_TOKEN` (repo-admin PAT; Contents + PRs write; unattended admin-merge) | `staging`; license-document maintenance only, with no release authority |
| **`release-repair`**     | No custom secret; the workflow uses its job-scoped `GITHUB_TOKEN`                          | `main`; required maintainer approval                                    |

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

## Tag a merged release by hand

If Cut release cannot tag a merged promotion (for example, `RELEASE_CUT_TOKEN` has expired), a repository admin can tag it. The tag push starts the same build workflows:

```bash
git fetch origin main --tags
# origin/main must be the promotion's merge commit:
git log -1 --format='%H %s' origin/main
# notes.md: the promotion's release notes section, without its heading
git tag -a vX.Y.Z --cleanup=verbatim -F notes.md origin/main
git push origin vX.Y.Z
```

`--cleanup=verbatim` keeps the notes' `###` headings, which git would otherwise strip as comments. The draft release then opens with those notes.

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

1. Read the release notes at the top of the draft. They come from the tag message, which Cut release wrote from the promotion's `## Release notes` section; edit them in the draft if needed. A tag from the emergency `pnpm run release` path carries no notes, so paste the block that script printed.
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

Follow [Semantic Versioning](https://semver.org/). Auto-detect is implemented in [`scripts/detectReleaseBump.mjs`](../scripts/detectReleaseBump.mjs) (called from `pnpm run promotion:open`, the Promotion Doctor and `release.sh`; it handles scoped Conventional Commits such as `feat(rrc):`):

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
- [ ] Confirm the docs site updated after the promotion merged into `main` ([docs workflow](ci-cd.md#docs-docsyml))
- [ ] After a hotfix or an emergency release, `staging` has the back-port (`pnpm run promotion:backport`)
- [ ] Announce (Discord `#mesh-client-help`, etc.)
- [ ] Close milestone if used

---

## Troubleshooting

### Promotion Doctor fails

The Doctor's job summary lists each result. Common failures:

| Result                                                                                                               | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Pull request target`                                                                                                | Only promotions and `hotfix/*` branches may target `main`. Retarget the pull request to `staging`.                                                                                                                                                                                                                                                                                                                                         |
| `Promotion commit`, `Built on current main`, `Staging snapshot`, `Superseded`, `Same files as staging`, `Main moved` | `main` moved, `staging` got a newer version bump, or the head was changed by hand. Run `pnpm run promotion:open` again; never press **Update branch**.                                                                                                                                                                                                                                                                                     |
| `Release version`, `Flatpak MetaInfo`                                                                                | The version is already tagged, is not above the version `main` carries while a release waits for its tag, or `package.json` and the MetaInfo top entry disagree. Run `pnpm run promotion:open` again (with `--bump` to choose another version); for a hotfix, run `pnpm run release:bump` again.                                                                                                                                           |
| `Release notes`                                                                                                      | The body lost its `## Release notes` section or a shipped pull request number. Put it back; editing the body runs the Doctor again.                                                                                                                                                                                                                                                                                                        |
| `Database schema`                                                                                                    | The schema changes. Name both schema versions under `## Database schema`.                                                                                                                                                                                                                                                                                                                                                                  |
| `Checks`                                                                                                             | Another check failed, or one was still pending after 150 minutes. The Doctor counts every check on the head, including CodeQL and CodeRabbit. Fix or re-run that check, then re-run the Promotion Doctor job. `No run of Electron E2E or Release preflight` means neither started on the head, as after a retarget to `main`: close and reopen the pull request, or push a commit. `Not started` names a required run that never appeared. |
| `Ready for review`, `Head repository`                                                                                | Mark the draft ready for review. Promotions and hotfixes must come from a branch in this repository, not a fork.                                                                                                                                                                                                                                                                                                                           |
| `Up to date with main`, `No staging work`                                                                            | A hotfix must start from the current `main` and carry no commits that are only on `staging`. Update it from `main`, or cut it again from `main`.                                                                                                                                                                                                                                                                                           |

`Version choice` is a warning only: the commit titles suggest another version than the promotion releases (for example after `--bump`).

### Cut release did not tag

The **Plan release tag** job summary gives the reason: the version is already tagged, `package.json` is not newer than the latest release, or the MetaInfo top entry does not match `package.json`. A push that does not change the version never tags. After a declined approval or a failed tag job, run **Actions > Cut release > Run workflow** on `main`.

### Release workflow fails on one platform

- Inspect the failed job log in Actions
- Platform failures are often native-module or packaging related
- Fix it on `staging` and promote it, or as a [hotfix](#hotfixes) when it cannot wait

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
# Fix it on main as a hotfix (no bump), then re-run Cut release on main
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
