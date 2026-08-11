# CI/CD Workflows

Mesh-Client uses GitHub Actions for continuous integration and deployment.

---

## Workflows

| Workflow                 | Trigger                                      | Purpose                                                                         |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------- |
| `ci.yaml`                | Push/PR to `main`                            | Lint, typecheck, build, Flatpak manifest validation                             |
| `tests.yaml`             | Push/PR to `main`                            | Vitest coverage + merge; Reticulum sidecar `llvm-cov` when sidecar paths change |
| `e2e.yaml`               | Daily on `main` + manual `workflow_dispatch` | Playwright Electron E2E (unpackaged build, 3-OS; not a PR gate)                 |
| `build.yaml`             | Manual `workflow_dispatch`                   | Native 3-OS packaging smoke build (+ schema compare vs last official)           |
| `reticulum-sidecar.yaml` | Path-filtered push/PR to `main`              | Sidecar fmt + Clippy (ubuntu); multi-OS matrix build/test                       |
| `release.yaml`           | Version tags (`v*`)                          | Build & publish releases (AppImage/deb/rpm)                                     |
| `flatpak.yaml`           | Version tags (`v*`), manual                  | Build Flatpak (+ schema compare vs last official); publish to release on tags   |
| `docs.yml`               | Push to `main`                               | Deploy MkDocs to GitHub Pages                                                   |

---

## CI Build (`ci.yaml`)

Runs on every push and pull request to `main` (and `workflow_dispatch`):

1. Checkout code
2. Setup pnpm
3. Setup Node 22
4. Install dependencies (`pnpm install --frozen-lockfile`)
5. Format check (`pnpm run format:check`)
6. Markdown lint (`pnpm run lint:md`)
7. Run lint (`pnpm run lint`)
8. License check (`pnpm run check:licenses`)
9. actionlint (via `pnpm run setup:actionlint`)
10. `pnpm audit --audit-level=high` (non-blocking warning)
11. Run `yamllint` on workflow/config YAML
12. Run typecheck (`pnpm run typecheck`)
13. Run build (`pnpm run build`)
14. Run `check:flatpak`, `check:flatpak-offline-pnpm` (needs `flatpak-node-generator`), `desktop-file-validate`, and `appstreamcli validate` on Flatpak metadata

All blocking steps must pass before a PR can be merged.

---

## Tests (`tests.yaml`)

Runs on every push and pull request to `main`:

1. Checkout code, setup pnpm + Node 22, install dependencies
2. **Parallel matrix** — coverage per Vitest project (`renderer-ui`, `renderer-logic`, `main`) with blob reporter (`VITEST_COVERAGE_SHARD=1` skips per-shard threshold checks)
3. **Merge job** — downloads blob artifacts, runs `pnpm run test:coverage:merge` (enforces global coverage thresholds)
4. **`reticulum-sidecar-coverage`** (when `reticulum-sidecar/**` or related scripts change, via `paths-filter`) — clones the `.rsstack/` workspace, runs `cargo llvm-cov --fail-under-lines 45` on ubuntu-latest; uploads `lcov.info` artifact (no Codecov upload on free org plan)
5. Upload Cobertura coverage to GitHub Code Coverage (non-fork PRs / pushes) — Vitest merge job only
6. Upload merged test results artifact (retained 7 days)

Static analysis on PRs is **CodeQL** (security) plus ESLint, Clippy, and pre-commit `check:*` scanners. AI PR review is **CodeRabbit** (see [CodeRabbit](#coderabbit) below). SonarQube Cloud is not used.

Test results are available as a downloadable artifact from the workflow run.

### Electron E2E (`e2e.yaml`)

Not a PR gate. Runs on a **daily schedule** (default branch only) and on **manual** `workflow_dispatch`:

1. Checkout (`persist-credentials: false`), setup pnpm + Node 22, `node scripts/check-environment.mjs --skip-node-modules`, `pnpm install --frozen-lockfile`, then `pnpm run check:environment` (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`)
2. Linux (`ubuntu-24.04`): install Electron runtime libraries (`libatk-bridge2.0-0t64`, `libgtk-3-0t64`, `libasound2t64`, …) + `xvfb`
3. `pnpm run build` (unpackaged `dist-electron` + renderer)
4. `pnpm run test:e2e` (Linux under `xvfb-run -a`; macOS/Windows plain) — Playwright launches the local Electron binary via `resolveLocalElectronBin()` with an isolated `--user-data-dir`
5. On failure, upload `test-results/` + `playwright-report/` (7-day retention)

Local: `pnpm run test:e2e:build`. See [development-environment.md](development-environment.md#playwright-electron-e2e).

### Reticulum sidecar (`reticulum-sidecar.yaml`)

Path-filtered on `reticulum-sidecar/**` and related scripts:

1. **`lint` job (ubuntu-latest)** — `cargo fmt --check` + `cargo clippy` with `rns-stack,rns-ble,rns-rnode-tcp` (`-D warnings`)
2. **Build matrix** — stub + full-stack `cargo test` and release builds on Linux, macOS, and Windows (including WoA arm64 jobs)

CI and local **dev** clones float the `.rsstack/` workspace via `scripts/clone-ratspeak-stack.sh` to `origin/main` (overlays must apply; override with `RS_RETICULUM_REF` / `RS_LXMF_REF` / `RS_NOMAD_REF` / `RS_LXST_REF` / `RS_LRGP_REF` for bisect). **Release** packaging (`scripts/build-reticulum-sidecar-release.mjs`) runs the same clone and records the resolved commit SHAs for all five crates in `.rsstack/RESOLVED_SHAS.txt` so artifacts retain the exact source revisions used — pin via `RS_*_REF` when a release must not float.

Local parity: `pnpm run reticulum:sidecar:clippy:full`, `pnpm run check:reticulum-sidecar` (pre-commit full-feature). See [development-environment.md](development-environment.md#reticulum-sidecar-optional).

---

## CodeRabbit

PR review comments come from [CodeRabbit](https://docs.coderabbit.ai/) via [`.coderabbit.yaml`](../.coderabbit.yaml) (quiet profile, path filters, auto-pause after two reviewed commits).

- Prefer opening as a **draft** until the feature diff is ready, then mark ready for review.
- Free plan: about **1 PR review per developer per hour**; each auto-incremental push counts. After auto-pause, request another pass with `@coderabbitai review`.
- Batch actionable findings via the **Prompt for AI Agents** block into one local commit (Autofix requires Pro).
- Check remaining allowance with `@coderabbitai rate limit`.

---

## Release (`release.yaml`)

Triggered by pushing a version tag (e.g., `v1.2.3`):

1. **`schema-release-compare`** — first job; compares this SHA’s `CURRENT_SCHEMA_VERSION` to the last **published** GitHub Release (paginated Releases API; highest semver among non-draft/non-prerelease rows; recovers `vX.Y.Z` from release **name** only when `tag_name` is missing or `untagged-*`), writes the Actions step summary, and uploads a schema readme artifact. Job outputs feed installer notices and the draft release body.
2. **`prepare-github-release`** — **sole** creator of the draft GitHub release for the tag (`MESH_CLIENT_ALLOW_DRAFT_CREATE=1`), exports `release_id` (reconstructed from validated digits before `GITHUB_OUTPUT` — CodeQL `js/http-to-file-access`), then prepends the schema compare note (via `RELEASE_ID`, not List Releases). On `workflow_dispatch`, the tag is resolved in the workflow from `package.json` and passed as `RELEASE_TAG` (not read inside the release API script — avoids CodeQL `js/file-access-to-http`). The schema note is rebuilt from `schema-release-compare` job outputs (`MESH_CLIENT_SCHEMA_*`), not from a downloaded markdown artifact (same CodeQL rule).
3. Installs Linux build dependencies (`libudev-dev`, `rpm`, …) on `ubuntu-latest` runners
4. Rebuilds native dependencies (`pnpm run rebuild`)
5. **Stamp CI build info** — `scripts/ci-write-build-info-env.mjs` writes `MESH_CLIENT_BUILD_INFO` (`buildChannel=release` + tag + Actions `runUrl`) into `$GITHUB_ENV` before `dist:*` so support-bundle `manifest.json` and startup logs identify an official release build (see [Build channel stamp](#build-channel-stamp-test-vs-release)).
6. Builds for all three platforms in parallel (or a filtered subset on `workflow_dispatch`) with **`--publish never`**:
   - `macos-latest` → `pnpm run dist:mac`
   - `ubuntu-latest` → `pnpm run dist:linux`
   - `windows-latest` → `pnpm run dist:win`
7. **`ci-upload-release-assets.mjs`** attaches installers / update metadata to the prepare `release_id` (never `POST /releases`) via `gh api --input` path uploads (avoids CodeQL `js/file-access-to-http` from `readFile` → `fetch`). `finalize-github-release` still consolidates if anything external forked drafts.

Linux packaging smoke (`verify-linux-packaging.mjs`) asserts `.deb` **Description** metadata is ASCII-only. See [Release Process](release-process.md).

See [Release Process](release-process.md) for the maintainer workflow.

---

## Flatpak (`flatpak.yaml`)

Builds Flatpak bundles using [`flatpak/flatpak-github-actions`](https://github.com/flatpak/flatpak-github-actions).

**Triggers:** version tags (`v*`) and manual `workflow_dispatch` (**Build Flatpak (no release)**).

A matrix builds **x86_64** and **aarch64** in parallel. Both use the same privileged `ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08` container (Flathub remote, `flatpak-builder`, and system-scope runtime installs). **x86_64** runs on `ubuntu-latest`; **aarch64** runs on `ubuntu-24.04-arm` (native ARM runners — not QEMU on bare Ubuntu).

1. **`schema-release-compare`** — same compare as Build Binaries / Release; uploads `READ-ME-FIRST-flatpak.md` and feeds `write-schema-upgrade-notice.mjs` so bumped schemas embed `SCHEMA-UPGRADE.txt` under Flatpak `resources/`
2. Builds the Reticulum sidecar on bare Ubuntu runners, then generates `flatpak/generated-sources.json` via `flatpak-node-generator`
3. Stamps CI build info (`test` on dispatch / `release` on tag), builds from `org.coloradomesh.MeshClient.yml` with offline pnpm sources
4. Smoke-installs the unstamped local bundle; on **dispatch only**, renames to `org.coloradomesh.MeshClient-run{N}.flatpak`
5. Uploads `org.coloradomesh.MeshClient.flatpak-{x86_64,aarch64}.flatpak` artifacts (file basename stamped on test builds) plus per-arch `flatpak-schema-warning-*`

On **version tag pushes**, a `publish` job waits for the Electron `prepare-github-release` draft (`ci-wait-github-draft-release.mjs`), then attaches both **clean-named** bundles with `ci-upload-release-assets.mjs` (never creates a release). aarch64 is the primary ARM Linux install path (release `build.yaml` only produces x86_64 AppImage/deb/rpm).

`flatpak/generated-sources.json` is generated automatically in CI by `flatpak-node-generator` before each build — it does not need to be committed to the repo. For local builds, generate it manually; see [development-environment.md](development-environment.md) for steps. If submitting to Flathub's dedicated submission repo, the file must be committed there.

---

## Docs (`docs.yml`)

Deploys documentation to GitHub Pages on every push to `main`:

1. Checkout code
2. Setup Python 3.x
3. Install MkDocs dependencies (`docs/requirements.txt`)
4. Copy `README.md` → `docs/index.md` and `CONTRIBUTING.md` → `docs/contributing.md`
5. Rewrite doc links for MkDocs
6. Deploy with `mkdocs gh-deploy --force`

---

## Dependabot

Automated dependency updates are configured in `.github/dependabot.yml`:

- **Schedule:** Weekly on Saturdays
- **npm dependencies:** Grouped PRs (Electron separate, all other deps together)
- **GitHub Actions:** Grouped into one PR
- **Open PRs:** `open-pull-requests-limit: 0` — Dependabot scans but does **not** open PRs.
  Dependency bumps are applied manually via `pnpm run update` (`scripts/update.sh`), which
  also runs dedupe, Ratspeak overlay PR checks, and an upstream release / new-org-repo watch
  (rsLXST, lrgp-rs, Ratspeak Games-parity when a newer published release exists, LXMFace
  `js/lxmface.js` commit). Sibling **rsReticulum** /
  **rsLXMF** / **rsNomad** / **rsLXST** / **lrgp-rs** float to `origin/main` via
  `clone-ratspeak-stack.sh` (overlays must apply). See AGENTS.md §6.

### Testing Dependabot PRs locally

Use **pnpm** (not npm) to test dependabot PRs:

```bash
git checkout <dependabot-branch>
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:run
```

Do not use `npm install`; it will create a `package-lock.json` and may not respect pnpm's lockfile format.

---

## Running CI Locally with `act`

**Optional tooling:** You can run local CI in two ways:

| Mode                    | Command prefix                                           | Requires                                                        | What it does                                                                  |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Container** (default) | `pnpm run act:ci`, `pnpm run act:tests`, …               | Docker-compatible engine + [act](https://github.com/nektos/act) | Runs GitHub Actions jobs inside Linux containers (closest to CI)              |
| **Host / native**       | `pnpm run act:ci:native`, `pnpm run act:tests:native`, … | Node/pnpm only                                                  | Runs the same pnpm/cargo steps directly on your machine (no container engine) |

Container mode runs GitHub Actions jobs inside Linux containers using a Docker-compatible engine (Podman preferred). Host mode runs the same pnpm/cargo steps directly — use this when no container engine is available or act cannot reach the daemon. `pnpm run check:environment` warns if no container engine or act is missing but does not block commits. Use **native** scripts when no Docker-compatible engine is available or act cannot reach the daemon.

**macOS note:** [Podman Desktop](https://podman.io/) is the preferred Docker-compatible engine for local CI. When Docker compatibility is enabled, Podman exposes a Docker-compatible socket at `/var/run/docker.sock`; pass that path to `act` via `ACT_DOCKER_SOCKET`, or let `act` detect it automatically if Podman created the symlink. If you use Docker Desktop instead, its socket is typically under `~/.docker/run/docker.sock`.

Install act (container mode only):

```bash
# macOS
brew install act

# Linux / Windows
# https://github.com/nektos/act/releases
```

On Windows, Podman Desktop with Docker compatibility is preferred. If you use Docker Desktop instead, use the WSL2 backend. On Apple Silicon, `act` uses `--container-architecture linux/amd64` automatically for x86_64 CI parity.

**Podman:** `scripts/run-act.mjs` passes `--container-daemon-socket` to `act` (auto-detects `/var/run/docker.sock` on macOS). If `act` still cannot connect, set `ACT_DOCKER_SOCKET` to your socket path or use native mode. If you use Docker Desktop instead, its socket is typically under `~/.docker/run/docker.sock`.

### Package scripts

```bash
# One-time (container mode)
pnpm run act:pull-images

# List targets
pnpm run act:list

# PR parity — container (act + Podman/Docker)
pnpm run act:ci
pnpm run act:tests
pnpm run act:pr

# PR parity — host (no container engine)
pnpm run act:ci:native
pnpm run act:tests:native
pnpm run act:pr:native

# Linux packaging
pnpm run act:build:linux        # container
pnpm run act:build:linux:native # host (best on Linux)

# Heavier workflows (container only unless noted)
pnpm run act:reticulum
pnpm run act:reticulum:native # stub sidecar cargo test/build on host
pnpm run act:flatpak          # docker only

# Override mode on one invocation
node scripts/run-act.mjs ci --native
node scripts/run-act.mjs ci --docker
MESH_CLIENT_ACT_MODE=native pnpm run act:ci

# Dry-run passthrough (container mode)
node scripts/run-act.mjs ci -- -n
```

### What runs locally vs native OS only

| Goal                                    | Container (`act:*`)    | Host (`act:*:native`)       | macOS host only        | Windows host only      |
| --------------------------------------- | ---------------------- | --------------------------- | ---------------------- | ---------------------- |
| PR checks (lint / test / build)         | `act:ci` + `act:tests` | `act:ci:native` + `:native` | same                   | same                   |
| Linux installers (AppImage / deb / rpm) | `act:build:linux`      | `act:build:linux:native`    | cross-build may differ | cross-build may differ |
| macOS `.dmg` / `.zip`                   | —                      | —                           | `pnpm run dist:mac`    | —                      |
| Windows `.exe`                          | —                      | —                           | —                      | `pnpm run dist:win`    |
| Flatpak x86_64                          | `act:flatpak`          | use local Flatpak docs      | same                   | same                   |

**Not run locally via act:** `docs.yml` (`mkdocs gh-deploy`), release publish legs, `macos-latest` / `windows-latest` / `windows-11-arm` matrix jobs, and `ubuntu-24.04-arm` Flatpak builds (no faithful local emulation).

Note: The test results artifact upload step is automatically skipped when running under `act` (detected by actor `nektos/act` in [`tests.yaml`](../.github/workflows/tests.yaml)).

---

## Required Status Checks

All PRs to `main` must pass:

- Lint (`pnpm run lint`)
- Typecheck (`pnpm run typecheck`)
- Build (`pnpm run build`)
- Tests with coverage (`pnpm run test:coverage` — same as CI; `locale-quality.test.ts` runs `check:i18n` as part of the Vitest suite)

Branch protection is configured to require these checks before merging.

---

## Pre-commit Hook

The pre-commit hook (`.githooks/pre-commit`) runs checks beyond what GitHub Actions runs directly:

- **Staged-file** Prettier + markdownlint (not a full-tree `pnpm run format` / `lint:md`)
- `pnpm dedupe` when dependency manifests are staged
- `pnpm run i18n:auto-translate` when `en/translation.json` is staged (fills new English keys vs `HEAD`) + re-stages locales
- Staged ESLint (`--cache`) + full `typecheck`; path-gated `typecheck:strict-shared` when shared paths staged; always-on cheap `check:*` scanners; path-gated flatpak / DB / IPC / reticulum catalog / full-feature sidecar checks (sidecar also requires `cargo` on `PATH` when sidecar paths are staged; `check:i18n` when English locale staged, else `check:i18n:branch`)
- Before PR: `pnpm run check:pr` (full lint + typecheck + strict-shared + `test:run` + path-aware sidecar)
- `pnpm audit` only when dependency manifests staged; `actionlint` / `yamllint` only when relevant files are staged
- `pnpm run test:staged` (`scripts/precommit-tests.mjs`: staged-only `vitest related`; full suite when vitest config/setup mocks or dependency manifests change; skip when no source/test staged)

**PR CI** ([`tests.yaml`](../.github/workflows/tests.yaml)) and **`pnpm run release`** always run the **full** Vitest suite (`pnpm run test:run`). Green pre-commit does not replace those gates.

CI focuses on lint, typecheck, build, Flatpak metadata validation, and coverage tests. i18n quality is enforced locally via pre-commit and indirectly in CI through Vitest (`locale-quality.test.ts`).

---

## Troubleshooting

### CI fails but passes locally

- Ensure you're using Node 22 (same as CI)
- Run `pnpm install --frozen-lockfile` to match CI's exact dependency versions
- Check for platform-specific differences (paths, case sensitivity)

### Release workflow fails

- Verify the tag follows semantic versioning (`v1.2.3`)
- Ensure `GH_TOKEN` secret is set in repository settings
- Check that `dist:*` / `dist:*:publish` scripts exist in `package.json` (tag release CI uses `dist:*` + `ci-upload-release-assets.mjs`)

### Docs deployment fails

- Verify `docs/requirements.txt` dependencies are valid
- Check MkDocs configuration in `mkdocs.yml`
- Ensure all referenced doc files exist

---

## Packaging smoke builds (`build.yaml` / `flatpak.yaml` / `release.yaml`)

### Build channel stamp (test vs release)

**Build Binaries** (`build.yaml`), **Release** (`release.yaml`), and **Build Flatpak** (`flatpak.yaml`) run `scripts/ci-write-build-info-env.mjs` before packaging. That writes a JSON `MESH_CLIENT_BUILD_INFO` blob into `$GITHUB_ENV`, which `scripts/esbuild-main-build.mjs` embeds via esbuild `--define` into the main process. Flatpak also writes `flatpak/ci-build-info.json` (gitignored) so the sandbox `pnpm run build` sees the same env.

| Channel   | Workflow                                                | Support-bundle `manifest.json`                            |
| --------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `test`    | Build Binaries (no release); Build Flatpak (no release) | `buildChannel: "test"` + `buildInfo.runUrl` (Actions run) |
| `release` | Build/Release Electron App; Build Flatpak (tag)         | `buildChannel: "release"` + `tag` + `buildInfo.runUrl`    |
| `local`   | unmarked `pnpm run dist` / dev / local Flatpak          | `buildChannel: "local"` only                              |

`appVersion` remains `package.json` semver (unchanged). Use `buildChannel` + `buildInfo.runUrl` when triaging Export for GitHub / Developer zips so a test binary is not mistaken for an official release. Startup logs include a compact fragment (`buildChannel=… run=… runId=… sha=…`).

**Which binary am I running?** If a tester says they downloaded Actions run N but the app reports a different run, open **Export for GitHub** → `manifest.json` → `buildInfo.runUrl` (authoritative), or the `[Startup] runtime … run=…` line in the app log. Same-semver test installers used to share identical filenames across runs; test builds now stamp `-run{N}` into downloadable basenames (see below).

### Test-build installer filenames (`-run{N}`)

**Test / one-off only** — never official GitHub Release assets:

| Workflow       | When                       | Filename stamp                                                                                                                                                                                                                            |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.yaml`   | Always (dispatch-only)     | After `dist:*`, `scripts/rename-test-build-artifacts.mjs` renames AppImage/deb/rpm/DMG/ZIP/Setup under `release/` to include `-run{GITHUB_RUN_NUMBER}` (e.g. `Mesh-client-5.26.0-run214.AppImage`, `Mesh-client Setup 5.26.0-run214.exe`) |
| `flatpak.yaml` | `workflow_dispatch` only   | After in-job smoke, rename to `org.coloradomesh.MeshClient-run{N}.flatpak`, then upload                                                                                                                                                   |
| `flatpak.yaml` | tag `v*` (release publish) | Clean `org.coloradomesh.MeshClient.flatpak` (no `-run{N}`)                                                                                                                                                                                |
| `release.yaml` | tag publish                | Clean electron-builder names (no rename step)                                                                                                                                                                                             |

`packaging-smoke` on Build Binaries downloads **stamped** names (Windows Setup matcher accepts default or `-run{N}`). Flatpak smoke always uses the unstamped local path **before** rename. Manual Flatpak runs use Actions run title **`Build Flatpak (no release)`**; tag runs use **`Build Flatpak`**.

### Schema compare vs last official release

**Build Binaries**, **Build Flatpak**, and **Release** start with a **`schema-release-compare`** job (`scripts/ci-schema-release-compare.mjs`) that:

1. Labels **Build Binaries** / **Build Flatpak (no release)** runs as a **test build** (not an official release) in `$GITHUB_STEP_SUMMARY`
2. Compares this tree’s `CURRENT_SCHEMA_VERSION` to the last published (non-draft) GitHub Release tag
3. Uploads `READ-ME-FIRST-test-build.md` (build) / `READ-ME-FIRST-flatpak.md` (flatpak) / `READ-ME-FIRST-schema.md` (release). **Build Binaries** stages the note into `release/` before platform uploads so `upload-artifact`’s least-common-ancestor stays under `release/` (mixing `release-warnings/` nests installers as `release/release/*.exe` and breaks `packaging-smoke`). Flatpak keeps a separate per-arch `flatpak-schema-warning-*` artifact beside the bundle
4. Exposes `schema_bumped` / `curr_schema` / `prev_schema` / `prev_tag` for packaging

Packaging always runs `scripts/write-schema-upgrade-notice.mjs`. On a schema bump it writes the Windows NSIS MessageBox include and `SCHEMA-UPGRADE.txt` for macOS/Linux/Flatpak (`electron-builder-before-pack.mjs` / Flatpak `resources/` copy). With no bump it still writes a no-op `resources/schema-upgrade-notice.nsh` stub — NSIS `!include` of a missing file is warning 7000, and electron-builder treats warnings as errors.

On first launch after a schema bump against an existing database, the app shows a blocking **Quit / Upgrade** dialog before mutating SQLite (see [Release Process — Database schema upgrades](release-process.md#database-schema-upgrades)).

Linux arm64 cross-builds on Ubuntu 24.04 runners use `scripts/ci-setup-linux-arm64-apt.sh` before `dpkg --add-architecture arm64`. The script pins `Architectures: amd64` only on deb822 stanzas in `ubuntu.sources` that lack an `Architectures` field, writes arm64 ports mirrors as deb822 `arm64.sources` (not legacy `.list`), and is idempotent across workflow re-runs.

Reticulum sidecar staging before `electron-builder`:

- `scripts/build-reticulum-sidecar-release.mjs` — compile/copy sidecar per target OS/arch
- `scripts/verify-reticulum-sidecar-staged.mjs` — size/assert checks
- `scripts/electron-builder-before-pack.mjs` — copy into `resources/reticulum-sidecar/`

Post-build smoke tests:

### macOS packaging verify (`verify-mac-packaging.mjs`)

- **`scripts/verify-mac-packaging.mjs`** — macOS packaging guard (runs after `dist:mac` / `dist:mac:publish` and in `packaging-smoke` on tag releases). Validates:
  - **`.dmg` and `.zip`** artifacts exist under `release/` with minimum size thresholds
  - Bundle layout via **direct `.app`** (local dist), **`ditto -xk` ZIP extract** (CI artifact path — preserves symlinks), and **`hdiutil attach` DMG mount**
  - DMG mount root includes an **`Applications` → `/Applications` symlink** (drag-to-install layout from `electron-builder.yml` `dmg.contents`)
  - **Electron Framework symlinks** (`Versions/Current`, root `Electron Framework`) remain symlinks — `upload-artifact` dereferences them and breaks the bundle (~3× framework bloat)
  - Thin **MacOS launcher** + full **Electron Framework** binary sizes; bundled **Reticulum sidecar** present
  - CI uploads **DMG/ZIP only** — never raw `Mesh-client.app` (see comment in `release.yaml` **Upload macOS Artifact**)
  - Optional signing env (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_IDENTITY_AUTO_DISCOVERY`) is passed through from workflow secrets on `macos-latest`; verify script does not require them
- `scripts/test-linux-appimage-reticulum-sidecar.mjs` — x64 uses `--appimage-extract`; arm64 on x64 runners uses `unsquashfs` for cross-arch extract
- `scripts/test-win-nsis-install.mjs` — NSIS + 7z sidecar probe on WoA

Local packaging parity: see [development-environment.md](development-environment.md#reticulum-sidecar-optional).
