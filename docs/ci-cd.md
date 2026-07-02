# CI/CD Workflows

Mesh-Client uses GitHub Actions for continuous integration and deployment.

---

## Workflows

| Workflow       | Trigger                         | Purpose                                     |
| -------------- | ------------------------------- | ------------------------------------------- |
| `ci.yaml`      | Push/PR to `main`               | Lint, typecheck, build                      |
| `tests.yaml`   | Push/PR to `main`               | Run unit tests, upload results              |
| `release.yaml` | Version tags (`v*`)             | Build & publish releases (AppImage/deb/rpm) |
| `flatpak.yaml` | Push/PR to `main`, tags, manual | Build Flatpak; publish to release on tags   |
| `docs.yml`     | Push to `main`                  | Deploy MkDocs to GitHub Pages               |

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

All steps must pass before a PR can be merged.

---

## Tests (`tests.yaml`)

Runs on every push and pull request to `main`:

1. Checkout code
2. Setup pnpm
3. Setup Node 22
4. Install dependencies
5. Run tests (`pnpm run test:run`)
6. Upload test results artifact (retained 7 days)

Test results are available as a downloadable artifact from the workflow run.

---

## Release (`release.yaml`)

Triggered by pushing a version tag (e.g., `v1.2.3`):

1. Builds for all three platforms in parallel:
   - `macos-latest` → `pnpm run dist:mac:publish`
   - `ubuntu-latest` → `pnpm run dist:linux:publish`
   - `windows-latest` → `pnpm run dist:win:publish`
2. Rebuilds native dependencies (`pnpm run rebuild`)
3. Installs Linux build dependencies (`libudev-dev`, `rpm`)
4. Publishes artifacts to GitHub Releases

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
- Tests (`pnpm run test:run`)

Branch protection is configured to require these checks before merging.

---

## Pre-commit Hook

The pre-commit hook runs additional checks that CI does not:

- Format (`pnpm run format`)
- Log injection check (`pnpm run check:log-injection`)
- URL hostname substring check (`pnpm run check:url-hostname-sanitization`) — mirrors CodeQL `js/incomplete-url-substring-sanitization`
- DB migration check (`pnpm run check:db-migrations`)
- IPC contract check (`pnpm run check:ipc-contract`)
- Security audit (`pnpm audit --audit-level=high`)
- Workflow lint (`actionlint`)

These checks are enforced locally before commits land. CI focuses on build, lint, typecheck, and tests.

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
