# CI/CD Workflows

Mesh-Client uses GitHub Actions for continuous integration and deployment.

---

## Workflows

| Workflow                    | Trigger                         | Purpose                                     |
| --------------------------- | ------------------------------- | ------------------------------------------- |
| `ci.yaml`                   | Push/PR to `main`               | Lint, typecheck, build                      |
| `tests.yaml`                | Push/PR to `main`               | Run unit tests, upload results              |
| `release.yaml`              | Version tags (`v*`)             | Build & publish releases (AppImage/deb/rpm) |
| `flatpak.yaml`              | Push/PR to `main`, tags, manual | Build Flatpak; publish to release on tags   |
| `docs.yml`                  | Push to `main`                  | Deploy MkDocs to GitHub Pages               |
| `dependency-submission.yml` | Push/PR to `main`               | Submit Python deps to dependency graph      |

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

Builds a Flatpak bundle using [`flatpak/flatpak-github-actions`](https://github.com/flatpak/flatpak-github-actions).

**Triggers:** push or PR to `main`, all version tags (`v*`), and manual `workflow_dispatch`.

The job runs inside a privileged `ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08` container, which provides the Freedesktop 24.08 SDK and can fetch Flathub runtimes:

1. Reads `org.coloradomesh.MeshClient.yml` as the manifest
2. Installs runtimes (`org.freedesktop.Platform//24.08`, `org.electronjs.Electron2.BaseApp//24.08`, `org.freedesktop.Sdk.Extension.node22//24.08`)
3. Builds the app offline using `flatpak/generated-sources.json` for pnpm dependencies
4. Uploads `org.coloradomesh.MeshClient.flatpak` as a workflow artifact

On **version tag pushes**, a second `publish` job downloads the artifact and attaches it to the GitHub Release alongside the AppImage/deb/rpm.

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

## Dependency Submission (`dependency-submission.yml`)

Submits Python dependency information to GitHub's dependency graph for security advisories.

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

Install [act](https://github.com/nektos/act) to run GitHub Actions workflows locally:

```bash
# macOS
brew install act

# Linux
# Download from https://github.com/nektos/act/releases
```

Run workflows locally:

```bash
# Run all workflows for push event
act --container-architecture linux/amd64

# Run specific workflow
act -j build
```

The `--container-architecture linux/amd64` flag ensures Linux containers run correctly on macOS/Windows.

Note: The test results artifact upload step is automatically skipped when running under `act` (detected by actor `nektos/act`).

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
