# CI/CD Workflows

Mesh-Client uses GitHub Actions for continuous integration and deployment.

---

## Workflows

| Workflow                 | Trigger                         | Purpose                                                                         |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------- |
| `ci.yaml`                | Push/PR to `main`               | Lint, typecheck, build, Flatpak manifest validation                             |
| `tests.yaml`             | Push/PR to `main`               | Vitest coverage + merge; Reticulum sidecar `llvm-cov` when sidecar paths change |
| `build.yaml`             | Manual `workflow_dispatch`      | Native 3-OS packaging smoke build                                               |
| `reticulum-sidecar.yaml` | Path-filtered push/PR to `main` | Sidecar fmt + Clippy (ubuntu); multi-OS matrix build/test                       |
| `release.yaml`           | Version tags (`v*`)             | Build & publish releases (AppImage/deb/rpm)                                     |
| `flatpak.yaml`           | Version tags (`v*`), manual     | Build Flatpak; publish to release on tags                                       |
| `docs.yml`               | Push to `main`                  | Deploy MkDocs to GitHub Pages                                                   |

---

## CI Build (`ci.yaml`)

Runs on every push and pull request to `main`:

1. Checkout code
2. Setup pnpm
3. Setup Node 22
4. Install dependencies (`pnpm install --frozen-lockfile`)
5. Run lint (`pnpm run lint`)
6. Run typecheck (`pnpm run typecheck`)
7. Run build (`pnpm run build`)
8. Run `yamllint` on workflow/config YAML
9. Run `check:flatpak`, `check:flatpak-offline-pnpm` (needs `flatpak-node-generator`), `desktop-file-validate`, and `appstreamcli validate` on Flatpak metadata

All steps must pass before a PR can be merged.

---

## Tests (`tests.yaml`)

Runs on every push and pull request to `main`:

1. Checkout code, setup pnpm + Node 22, install dependencies
2. **Parallel matrix** — coverage per Vitest project (`renderer-ui`, `renderer-logic`, `main`) with blob reporter (`VITEST_COVERAGE_SHARD=1` skips per-shard threshold checks)
3. **Merge job** — downloads blob artifacts, runs `pnpm run test:coverage:merge` (enforces global coverage thresholds)
4. **`reticulum-sidecar-coverage`** (when `reticulum-sidecar/**` or related scripts change, via `paths-filter`) — clones Ratspeak siblings, runs `cargo llvm-cov --fail-under-lines 45` on ubuntu-latest; uploads `lcov.info` artifact (no Codecov upload on free org plan)
5. Upload Cobertura coverage to GitHub Code Coverage (non-fork PRs / pushes) — Vitest merge job only
6. Upload merged test results artifact (retained 7 days)

SonarQube Cloud uses **Automatic Analysis (Autoscan)** — not GitHub Actions — because the Free plan Sonar Way quality gate includes cognitive-complexity thresholds we cannot customize, and CI scanning would fail PRs on that gate. Keep **Automatic Analysis enabled**. Scope and issue suppressions are configured in `sonar-project.properties` / `.sonarcloud.properties` and (for multicriteria under Autoscan) the SonarCloud project Analysis Scope UI.

Test results are available as a downloadable artifact from the workflow run.

### Reticulum sidecar (`reticulum-sidecar.yaml`)

Path-filtered on `reticulum-sidecar/**` and related scripts:

1. **`lint` job (ubuntu-latest)** — `cargo fmt --check` + `cargo clippy` with `rns-stack,rns-ble,rns-rnode-tcp` (`-D warnings`)
2. **Build matrix** — stub + full-stack `cargo test` and release builds on Linux, macOS, and Windows (including WoA arm64 jobs)

Local parity: `pnpm run reticulum:sidecar:clippy:full`, `pnpm run check:reticulum-sidecar` (pre-commit stub). See [development-environment.md](development-environment.md#reticulum-sidecar-optional).

---

## Release (`release.yaml`)

Triggered by pushing a version tag (e.g., `v1.2.3`):

1. **`prepare-github-release`** — creates a single draft GitHub release for the tag (prevents parallel electron-builder jobs from creating duplicate drafts and 404 asset uploads). On `workflow_dispatch`, the tag is resolved in the workflow from `package.json` and passed as `RELEASE_TAG` (not read inside the release API script — avoids CodeQL `js/file-access-to-http`).
2. Builds for all three platforms in parallel (or a filtered subset on `workflow_dispatch`):
   - `macos-latest` → `pnpm run dist:mac:publish`
   - `ubuntu-latest` → `pnpm run dist:linux:publish`
   - `windows-latest` → `pnpm run dist:win:publish`
3. Rebuilds native dependencies (`pnpm run rebuild`)
4. Installs Linux build dependencies (`libudev-dev`, `rpm`)
5. Publishes artifacts to GitHub Releases

Linux packaging smoke (`verify-linux-packaging.mjs`) asserts `.deb` **Description** metadata is ASCII-only. See [Release Process](release-process.md).

See [Release Process](release-process.md) for the maintainer workflow.

---

## Flatpak (`flatpak.yaml`)

Builds Flatpak bundles using [`flatpak/flatpak-github-actions`](https://github.com/flatpak/flatpak-github-actions).

**Triggers:** version tags (`v*`) and manual `workflow_dispatch`.

A matrix builds **x86_64** and **aarch64** in parallel. Both use the same privileged `ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08` container (Flathub remote, `flatpak-builder`, and system-scope runtime installs). **x86_64** runs on `ubuntu-latest`; **aarch64** runs on `ubuntu-24.04-arm` (native ARM runners — not QEMU on bare Ubuntu).

1. Generates `flatpak/generated-sources.json` via `flatpak-node-generator`
2. Builds from `org.coloradomesh.MeshClient.yml` with offline pnpm sources
3. Uploads `org.coloradomesh.MeshClient-{x86_64,aarch64}.flatpak` artifacts

On **version tag pushes**, a `publish` job attaches both bundles to the GitHub Release. aarch64 is the primary ARM Linux install path (release `build.yaml` only produces x86_64 AppImage/deb/rpm).

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
- **Limit:** 10 open PRs maximum

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

| Mode                    | Command prefix                                  | Requires                                      | What it does                                                        |
| ----------------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| **Container** (default) | `pnpm run act:ci`, `act:tests`, …               | Docker + [act](https://github.com/nektos/act) | Runs GitHub Actions jobs inside Linux containers (closest to CI)    |
| **Host / native**       | `pnpm run act:ci:native`, `act:tests:native`, … | Node/pnpm only                                | Runs the same pnpm/cargo steps directly on your machine (no Docker) |

`pnpm run check:environment` warns if Docker or act is missing but does not block commits. Use **native** scripts when Docker Desktop is unavailable or act cannot reach the daemon.

Install act (container mode only):

```bash
# macOS
brew install act

# Linux / Windows
# https://github.com/nektos/act/releases
```

On Windows, use Docker Desktop with the WSL2 backend. On Apple Silicon, act uses `--container-architecture linux/amd64` automatically for x86_64 CI parity.

**Docker Desktop:** `scripts/run-act.mjs` passes `--container-daemon-socket` to act (auto-detects `~/.docker/run/docker.sock` on macOS). If act still cannot connect, set `ACT_DOCKER_SOCKET` to your socket path or use native mode.

### Package scripts

```bash
# One-time (container mode)
pnpm run act:pull-images

# List targets
pnpm run act:list

# PR parity — container (act + Docker)
pnpm run act:ci
pnpm run act:tests
pnpm run act:pr

# PR parity — host (no Docker)
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
- Staged ESLint (`--cache`) + full `typecheck`; always-on cheap `check:*` scanners; path-gated flatpak / DB / IPC / reticulum catalog / sidecar stub checks (sidecar stub also requires `cargo` on `PATH` when sidecar paths are staged; `check:i18n` when English locale staged, else `check:i18n:branch`)
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
- Check that `dist:*:publish` scripts exist in `package.json`

### Docs deployment fails

- Verify `docs/requirements.txt` dependencies are valid
- Check MkDocs configuration in `mkdocs.yml`
- Ensure all referenced doc files exist

---

## Packaging smoke builds (`build.yaml` / `release.yaml`)

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
  - **Electron Framework symlinks** (`Versions/Current`, root `Electron Framework`) remain symlinks — `upload-artifact` dereferences them and breaks the bundle (~3× framework bloat)
  - Thin **MacOS launcher** + full **Electron Framework** binary sizes; bundled **Reticulum sidecar** present
  - CI uploads **DMG/ZIP only** — never raw `Mesh-client.app` (see comment in `release.yaml` **Upload macOS Artifact**)
  - Optional signing env (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_IDENTITY_AUTO_DISCOVERY`) is passed through from workflow secrets on `macos-latest`; verify script does not require them
- `scripts/test-linux-appimage-reticulum-sidecar.mjs` — x64 uses `--appimage-extract`; arm64 on x64 runners uses `unsquashfs` for cross-arch extract
- `scripts/test-win-nsis-install.mjs` — NSIS + 7z sidecar probe on WoA

Local packaging parity: see [development-environment.md](development-environment.md#reticulum-sidecar-optional).
