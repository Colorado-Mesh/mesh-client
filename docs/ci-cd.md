# CI/CD Workflows

Mesh-Client uses GitHub Actions for continuous integration and deployment.

---

## Workflows

| Workflow                      | Trigger                                                        | Purpose                                                                                    |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ci.yaml`                     | Push/PR (`staging`, `main`)/`merge_group`/`workflow_dispatch`  | Lint, typecheck, build, policy scanners, Flatpak manifest validation                       |
| `tests.yaml`                  | Push/PR (`staging`, `main`)/`merge_group`/`workflow_dispatch`  | Vitest coverage + merge; Reticulum sidecar `llvm-cov` when sidecar paths change            |
| `bundle-size.yaml`            | All PRs; `staging`/`main` push, `merge_group`, manual          | Independent production main bundle size regression                                         |
| `codeql.yaml`                 | PR/manual validation; push/merge queue/weekly after activation | Six-language CodeQL; Swift PR input scoping; see [activation](../.github/codeql/README.md) |
| `buttonmash.yaml`             | PR (`staging`, `main`)/`merge_group`/`workflow_dispatch`       | Browser-based chaos testing of the Vite renderer                                           |
| `e2e.yaml`                    | Every PR to `main`, daily on the default branch, manual        | Playwright Electron E2E (unpackaged build, 3-OS) + Release preflight; the Doctor waits     |
| `e2e-meshcore-repeaters.yaml` | Path-filtered PR to `staging` or `main` + manual dispatch      | MeshCore repeater ping/admin Electron E2E (Linux) against the fake radio; not required     |
| `e2e-panels.yaml`             | Path-filtered PR to `staging` or `main` + manual dispatch      | Per-protocol panel matrix Electron E2E (Linux); not required                               |
| `build.yaml`                  | Manual `workflow_dispatch`                                     | Native 3-OS packaging smoke build (+ schema compare vs last official)                      |
| `reticulum-sidecar.yaml`      | Path-filtered PR; push to `staging`, `main`, `v*` tags         | Sidecar fmt + Clippy (ubuntu); multi-OS matrix build/test                                  |
| `promotion-doctor.yaml`       | PR to `main` (`pull_request_target`)                           | Required **Promotion Doctor** check for promotions and hotfixes                            |
| `cut-release.yaml`            | Push to `main`; manual re-run                                  | Tag `vX.Y.Z` when `main` holds a new version, after `release-cut` approval                 |
| `release.yaml`                | Version tags (`v*`)                                            | Build & publish releases (AppImage/deb/rpm)                                                |
| `flatpak.yaml`                | Version tags (`v*`), manual                                    | Build Flatpak (+ schema compare vs last official); publish to release on tags              |
| `docs.yml`                    | Push to `main`; PRs that touch docs                            | Deploy MkDocs to GitHub Pages (strict build on PRs)                                        |
| `third-party-licenses.yaml`   | Path-filtered push to `staging`                                | Regenerate licenses and open a documentation PR using license-only automation              |

---

## CI Build (`ci.yaml`)

Runs on every push, pull request, and merge-queue `merge_group` for `staging` and `main` (and `workflow_dispatch`). Independent lanes start concurrently; only Flatpak waits for change detection:

- **Code quality:** format, markdownlint, license allowlist, actionlint, dependency audit, and yamllint
- **ESLint:** full repository lint, split over four parallel shards (`ESLint (1/4)` to `ESLint (4/4)`). `scripts/ci-eslint-shard.mjs` deals every Git-visible file to exactly one shard and runs ESLint on that list with two workers, using `eslint.ci.config.mjs` to avoid running Prettier again for extensions already covered by the required Code quality job. All type-aware rules and the zero-warning gate remain enabled on every shard. Local development uses the default ESLint config via `pnpm run lint` (single process, raised heap). CI runs the sharded `eslint.ci.config.mjs` pass; release preflight runs `pnpm run lint --concurrency 2 --config eslint.ci.config.mjs` from `scripts/release.sh`. To change the shard count, edit the `shard` list in `ci.yaml`.
- **Typecheck:** `pnpm run typecheck`
- **Application build:** `pnpm run build`
- **Flatpak checks:** only when Flatpak inputs change; runs `check:flatpak`, `check:flatpak-offline-pnpm`, `desktop-file-validate`, and `appstreamcli validate`
- **Policy scanners:** cheap always-on `check:*` set from pre-commit/release (`check:electron-security`, log/XSS/console/IPC/protocol-string gates, and the matching cheap scanners) so `--no-verify` and GitHub-only edits cannot skip them

Each Node lane uses the same pinned Node 22/pnpm setup action and frozen install. Actionlint is downloaded from a fixed release URL and verified against a reviewed per-platform SHA-256 digest before extraction. Yamllint and its transitive dependencies install from exact wheel hashes in `scripts/requirements-yamllint.txt`. The final `Build & Test` job aggregates every lane so the existing required check name remains stable. Superseded runs for the same pull request or ref are cancelled.

---

## Buttonmash (`buttonmash.yaml`)

Runs a bounded, deterministic Buttonmash crawl on pull requests, merge-queue refs, and manual
dispatches. The job starts the Vite renderer in plain-browser development mode, which installs the
repository's no-op `electronAPI` stub. This exercises the UI shell and browser-safe panel behavior
without accessing radios, native dialogs, SQLite, MQTT, or other Electron-only services.

The workflow pins Buttonmash's action commit and npm version, refuses live billing, fails on `high`
or `critical` findings, and uploads both the Buttonmash report and the Vite server log when a run
fails. The detector config ignores the browser stub's expected no-peripheral BLE rejection and two
exact third-party teardown races from `lucide-react-motion` and Leaflet. Native BLE behavior remains
covered outside this stubbed lane, while all other high-severity browser errors remain blocking.
Maps draw without a basemap here: the Electron main process serves the `mesh-tiles:` scheme, so the
renderer skips tiles on the browser bridge instead of logging a failed request for each. The
destructive guard may click the notification-sound **Reset** buttons (`guardrails.destructive.safeNames`), which
only restore that sound's default; every other Reset and Delete control stays blocked.
`guardrails.blockMedia` is off so the run draws text in the bundled IBM Plex fonts the app serves
from its own origin; Buttonmash blocks font and media requests by default. The action and time
budgets live in
[`buttonmash.config.json`](../buttonmash.config.json).

---

## Tests (`tests.yaml`)

Runs on every push, pull request, and merge-queue `merge_group` for `staging` and `main`:

1. **Detect scope:** compare a pull request head with its true merge base and reuse the local staged-test planner to select related paths and Vitest projects.
2. **Pull requests:** run `vitest related` without coverage for the affected project lanes. Shared contracts select all projects. Any Vitest test that names a changed file by its whole repo path (for example `scripts/bundle-size-workflow.test.mjs`, which copies `scripts/esbuild-main-build.mjs`, or a workflow test that reads its YAML) is added with its project, because `vitest related` follows imports only and cannot reach it. Docs-only changes skip Vitest unless such a test names one of the changed files. Paths a test builds from segments are not found; protected events still run the full suite.
3. **Safe fallback:** test infrastructure, dependency manifests, deleted/renamed paths, oversized output, or detector failures run the full matrix.
4. **Protected events:** `merge_group`, pushes to `staging` or `main`, and manual runs always run full coverage across `renderer-ui`, `renderer-logic`, and `main`.
5. **Sharding:** `renderer-ui` runs in four shards; `renderer-logic` and `main` each run once. This applies to both related tests and full coverage. Full runs upload blob reports; related runs write JUnit reports named `junit-<project>-<shard>-<total>.xml` and print results in each shard's log. The existing `Coverage (...)` required checks verify that detection and every shard succeeded.
6. **Merge job:** collect related JUnit reports without checkout, Node/pnpm setup, or dependency installation. Full runs (protected events and PRs that cannot be safely scoped) still run `pnpm run test:coverage:merge` to enforce global thresholds, then append a coverage hotspot summary (`pnpm run coverage:hotspots --md`) to the job step summary.
7. **`reticulum-sidecar-coverage`:** when sidecar paths change, clone the `.rsstack/` workspace, run `cargo llvm-cov --fail-under-lines 45`, and upload `lcov.info`.
8. Upload the `vitest-report` artifact (retained 7 days): separate JUnit files for related shards, including empty shards and available reports from failed runs; one merged `junit.xml` for full runs.

The three `Coverage (...)` job names and `Merge coverage` remain stable for the repository ruleset, including when a project or the whole test matrix has no relevant PR work. Superseded runs for the same pull request or ref are cancelled.

Static analysis on PRs is **CodeQL** (security) plus ESLint, Clippy, and pre-commit `check:*` scanners. AI PR review is **CodeRabbit** (see [CodeRabbit](#coderabbit) below). SonarQube Cloud is not used.

Test results are available as a downloadable artifact from the workflow run.

### Bundle size (`bundle-size.yaml`)

The independent **Main bundle size** check runs on every pull request, including docs-only,
draft, fork and stacked PRs targeting any branch. It runs on opening, new commits, reopening,
edits (including retargeting), and draft/ready transitions, plus `staging` and `main` pushes,
merge queues and manual dispatches. It has no path filter or dependency on related-test selection.

It uses the shared pinned Node/pnpm setup and frozen install, then runs
`pnpm exec vitest run --project main scripts/esbuild-main-build.test.mjs --coverage.enabled=false --reporter=default`.
The job sets `MESHTASTIC_SKIP_ELECTRON_REBUILD=1`, so the frozen install skips the lazy Electron
binary download and `install-app-deps` probe: the check only bundles the main process with esbuild
(`electron` stays external), and a flaky Electron release CDN (e.g. HTTP 504) must not fail it.
This explicitly selects the existing esbuild regression because its string entrypoint is invisible
to Vitest's import-based related selection. The test builds the production minified main process,
checks worker/license artifacts and enforces the strict `MAIN_BUNDLE_SIZE_BUDGET_BYTES` budget
defined in that test. Locally and in pre-commit, the same suite runs via `pnpm run check:main-bundle`
when `src/main/` or the esbuild main-build scripts are staged. An over-budget failure prints
AI-friendly remediation (prefer sibling esbuild entries / externals / metafile analysis; raise
the budget only as a last resort).
An oversized bundle or missing test suite fails; the job writes no coverage/blob/JUnit reports.
The default checkout validates the PR merge ref, with credentials disabled and a read-only token;
it uses no repository secrets or privileged `pull_request_target` execution.

Making this new check required is a separate repository-admin ruleset/branch-protection decision.
The workflow does not change repository security settings. Existing global coverage gates remain.

### Electron E2E (`e2e.yaml`)

Runs on every **pull request to `main`** (promotions and hotfixes), on a **daily schedule** (default branch only, so `staging` once it is the default) and on **manual** `workflow_dispatch`. It is not a required check by name, but the [Promotion Doctor](#promotion-doctor-promotion-doctoryaml) waits for it, so a promotion or hotfix cannot merge until it passes. Feature pull requests to `staging` do not run it:

1. Checkout (`persist-credentials: false`), setup pnpm + Node 22, `node scripts/check-environment.mjs --skip-node-modules`, `pnpm install --frozen-lockfile`, then `pnpm run check:environment` (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`)
2. Linux (`ubuntu-24.04`): install Electron runtime libraries (`libatk-bridge2.0-0t64`, `libgtk-3-0t64`, `libasound2t64`, …) + `xvfb`
3. `pnpm run build` (unpackaged `dist-electron` + renderer)
4. `pnpm run test:e2e` (Linux under `xvfb-run -a`; macOS/Windows plain) — Playwright launches the local Electron binary via `resolveLocalElectronBin()` with an isolated `--user-data-dir`
5. On failure, upload `test-results/` + `playwright-report/` (7-day retention)

A separate **Release preflight** job (`ubuntu-latest`) runs `pnpm run release -- --preflight-only` with the `setup-node-pnpm` + `setup-release-toolchain` composites, stopping before any bump, tag, or push. On a promotion it checks the exact tree that merging will tag; daily it catches release-only breakage that a warm local checkout hides. Its ESLint step matches the CI lint job (`--concurrency 2 --config eslint.ci.config.mjs`) after `format:check`, so type-aware lint does not OOM on the runner.

Local: `pnpm run test:e2e:build`. See [development-environment.md](development-environment.md#playwright-electron-e2e).

### MeshCore repeater E2E (`e2e-meshcore-repeaters.yaml`)

Runs `e2e/meshcore-repeater-admin.spec.ts` (repeater Ping, Status, Neighbors and login against the fake MeshCore radio in `e2e/fixtures/meshcore-repeater-radio.ts`) on pull requests to `staging` or `main` that touch MeshCore ping or repeater code, so a change that breaks pings fails on its own PR instead of in the next daily run.

- **Paths:** `useMeshcoreRuntime.ts`, `src/renderer/lib/meshcore*.ts`, `src/renderer/lib/meshcore/**`, `src/renderer/hooks/meshcore/**`, `RepeatersPanel.tsx`, `src/shared/meshcorePathHash.ts`, the meshcore.js patch, the spec, its fixture, `e2e/electronApp.ts`, `playwright.config.ts` and the workflow. Changes to unit test files alone do not trigger it.
- **Steps:** Linux only (`ubuntu-24.04`): the shared `setup-node-pnpm` action, the same Electron runtime libraries as the Linux leg of `e2e.yaml`, `pnpm run build`, then the spec under `xvfb-run -a`. Playwright artifacts are uploaded on failure.
- **Not required:** it skips on other PRs and does not run on `merge_group`, so it must not be added to the ruleset.
- `scripts/e2e-meshcore-repeaters-workflow.test.mjs` checks that every path pattern matches a file, that the files earlier ping fixes changed are covered, and that the Electron library list matches `e2e.yaml`.

### Panel matrix E2E (`e2e-panels.yaml`)

Runs `e2e/panelMatrix.spec.ts` (every rail section and sub-tab for Meshtastic, MeshCore and Reticulum, plus a connected MeshCore leg) on pull requests to `staging` or `main` that touch renderer shell or panel wiring, so a panel that throws on mount fails on its own PR instead of in the next daily run.

- **Paths:** `App.tsx`, lazy panel registries, `src/renderer/components/**`, `appTabMappings.ts` / `navSections.ts` / `panelLauncher.ts` / `tabSlotIds.ts`, the matrix spec and anchors, `e2e/electronApp.ts`, the MeshCore radio fixture, `playwright.config.ts` and the workflow. Changes to unit test files alone do not trigger it.
- **Steps:** Linux only (`ubuntu-24.04`): same setup and Electron libraries as the repeater workflow, `pnpm run build`, then the matrix under `xvfb-run -a`. Playwright artifacts are uploaded on failure.
- **Not required:** it skips on other PRs and does not run on `merge_group`, so it must not be added to the ruleset.
- `scripts/e2e-panels-workflow.test.mjs` checks that every path pattern matches a file and that the Electron library list matches `e2e.yaml`.

### Reticulum sidecar (`reticulum-sidecar.yaml`)

Path-filtered on `reticulum-sidecar/**` and related scripts:

1. **`lint` job (ubuntu-latest)** — `cargo fmt --check` + `cargo clippy` with `rns-stack,rns-ble,rns-rnode-tcp` (`-D warnings`)
2. **Build matrix** — stub + full-stack `cargo test` and release builds on Linux, macOS, and Windows. The WoA arm64 jobs cross-compile release binaries on Windows x64 runners; the Windows x64 matrix jobs run the corresponding host tests once.

The full-stack matrix and the two WoA jobs cache Cargo downloads and compiled dependencies with `Swatinem/rust-cache`, separately by job, target triple, and Rust toolchain. The cache is restored after cloning the current Ratspeak sources, applying overlays, and selecting the toolchain. The sidecar workspace crate is excluded, so every run still invokes Cargo to rebuild changed path dependencies and the executable. Host tests run on cache hits as well as misses; a cache miss performs a normal build. Release optimization and linking still run, so warm jobs retain some compilation cost.

CI, local **dev**, and release packaging clone the `.rsstack/` workspace through `scripts/clone-ratspeak-stack.sh` at the reviewed full SHAs in `reticulum-sidecar/ratspeak-stack-pins.env`. The script verifies each fetched commit and clean checkout before overlays or Cargo run; CI and release-channel builds reject ref overrides. A local bisect requires both the relevant `RS_*_REF` and `MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE=1`. Open upstream feature PRs needed before they land on `main` (e.g. [rsReticulum#26](https://github.com/ratspeak/rsReticulum/pull/26) ReplyFile, [rsLXMF#7](https://github.com/ratspeak/rsLXMF/pull/7) multi-file attachments) are carried as overlays under `reticulum-sidecar/patches/` and tracked by `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`. Packaging also records the verified SHAs in `.rsstack/RESOLVED_SHAS.txt` beside each artifact. The repo-root `flake.nix` fetches the same pins with `builtins.fetchTree` and applies overlays from `scripts/lib/ratspeak-overlay-apply-list.sh`. `scripts/flake-stack-pins.test.mjs`, selected by `scripts/precommit-tests.mjs` whenever those inputs change, keeps the flake from drifting. No workflow evaluates or builds the flake. See [development-environment.md](development-environment.md#nix-nixos-and-macos).

Local parity: `pnpm run reticulum:sidecar:clippy:full`, `pnpm run check:reticulum-sidecar` (pre-commit full-feature). See [development-environment.md](development-environment.md#reticulum-sidecar-optional).

---

## CodeRabbit

PR review comments come from [CodeRabbit](https://docs.coderabbit.ai/) via [`.coderabbit.yaml`](../.coderabbit.yaml) (quiet profile, path filters, auto-pause after two reviewed commits).

- It reviews pull requests to the default branch and to `staging` (`reviews.auto_review.base_branches`). Once `staging` is the default branch, promotion pull requests to `main`, which repeat reviewed work, are not reviewed again.
- Prefer opening as a **draft** until the feature diff is ready, then mark ready for review.
- Free plan: about **1 PR review per developer per hour**; each auto-incremental push counts. After auto-pause, request another pass with `@coderabbitai review`.
- Batch actionable findings via the **Prompt for AI Agents** block into one local commit (Autofix requires Pro).
- Check remaining allowance with `@coderabbitai rate limit`.

---

## Promotions (`pnpm run promotion:open`)

Work merges into `staging`; `main` only takes promotions and `hotfix/*` pull requests. The maintainer flow (opening a promotion, hotfixes, back-ports, the release tag) is in the [Release Process](release-process.md#recommended-promote-staging-to-main). What CI sees:

- A promotion pull request's head is a merge commit whose parents are the `main` tip and a `staging` snapshot, and whose tree is exactly that snapshot's. Its branch is `release/vX.Y.Z` (or `release/promote-staging-YYYY-MM-DD` when nothing releases) and its title starts with `Promote staging to main`.
- Pull requests to `main` run `ci.yaml`, `tests.yaml`, `codeql.yaml`, `buttonmash.yaml`, `bundle-size.yaml`, the 3-OS `e2e.yaml` with its release preflight, and the Promotion Doctor.
- `main` accepts merge commits only, so a promotion keeps both parents when it merges and the next promotion starts from the snapshot it shipped.

### Promotion Doctor (`promotion-doctor.yaml`)

The required **Promotion Doctor** check on every pull request to `main`. It runs [`scripts/promotion-doctor.mjs`](../scripts/promotion-doctor.mjs):

- **Trigger and trust:** `pull_request_target` on `main` (`opened`, `reopened`, `synchronize`, `edited`, `ready_for_review`); a newer run cancels the older one for the same pull request. It checks out the trusted base commit with `persist-credentials: false`, fetches the pull request head as data only, installs nothing, and runs with read-only permissions (`contents`, `pull-requests`, `checks`, `statuses`) and no secrets. Because the workflow comes from the base branch, a change to the Doctor takes effect only after it merges into `main`.
- **Trigger policy:** from December 2, 2026, GitHub's default Actions event policy blocks `pull_request_target` in public repositories, which would leave this required check unreported. The repository policy in [`.github/actions-policies/promotion-doctor.json`](../.github/actions-policies/promotion-doctor.json) allows that event for this workflow only (commands under [Applying / updating the rulesets](#applying--updating-the-rulesets)). Its event rule is an allowlist, so a trigger added to the workflow must be added to the policy too; `scripts/branch-rulesets.test.mjs` checks that they match.
- **What it checks:** before `staging` exists it passes with a note. A title starting with `Promote staging to main` gets the promotion checks: a head from this repository that is not a draft; two parents, the live `main` tip and a `staging` snapshot that `main` lacks and that no newer version bump on `staging` has superseded; the same tree as that snapshot; a version that is unchanged (no release) or new and untagged, with a matching Flatpak MetaInfo entry; every shipped pull request listed under `## Release notes`; a schema change named under `## Database schema`. A `hotfix/*` branch gets the hotfix checks: built on the current `main`, no commits that are only on `staging`, and the MetaInfo entry and release notes when it changes the version. Anything else fails and asks for a retarget to `staging`.
- **Waiting:** it then waits for every other check run and commit status on the head, polling every 30 seconds for up to 150 minutes (the job itself times out at 170), and fails if one fails or the time runs out. That includes the 3-OS E2E, the release preflight, CodeQL and CodeRabbit. Afterwards it reads `main` again and fails if `main` moved meanwhile. Editing the pull request body runs it again.
- **Local, read-only:** `pnpm run promotion:doctor -- --pr <number>` prints the same report using your `gh` token. Add `--require-green-checks` to include the other checks, and `--wait-for-checks` to wait for pending ones.

### Cut release (`cut-release.yaml`)

Runs on every push to `main` and on manual dispatch:

1. **Plan release tag** (`contents: read`, `pull-requests: read`, no secrets) runs [`scripts/release-tag-plan.mjs`](../scripts/release-tag-plan.mjs). It tags only when `package.json` holds a version newer than the latest `vX.Y.Z` tag, that tag does not exist yet, and the Flatpak MetaInfo top entry matches. The notes are the `## Release notes` section of the pull request whose merge produced the commit, or are generated from commit titles when there is none.
2. **Tag release** runs only when the plan says so, in the `release-cut` environment (maintainer approval). It creates the annotated tag with the notes as its message (`--cleanup=verbatim`, so markdown headings survive) and pushes only the tag, with `RELEASE_CUT_TOKEN` through a temporary askpass helper. It installs nothing.

Ordinary pushes to `main` end at the plan job without an approval prompt. Manual dispatch checks the current `main` commit again, for example after a declined approval. The tag push starts `release.yaml` and `flatpak.yaml`.

---

## Release (`release.yaml`)

Triggered by pushing a version tag (e.g., `v1.2.3`):

1. **`schema-release-compare`** — first job; compares this SHA’s `CURRENT_SCHEMA_VERSION` to the last **published** GitHub Release (paginated Releases API; highest semver among non-draft/non-prerelease rows; recovers `vX.Y.Z` from release **name** only when `tag_name` is missing or `untagged-*`), writes the Actions step summary, and uploads a schema readme artifact. Job outputs feed installer notices and the draft release body.
2. **`prepare-github-release`** — **sole** creator of the draft GitHub release for the protected tag (`MESH_CLIENT_ALLOW_DRAFT_CREATE=1`), exports `release_id` (reconstructed from validated digits before `GITHUB_OUTPUT` — CodeQL `js/http-to-file-access`), then prepends the schema compare note (via `RELEASE_ID`, not List Releases) and, above it, the release notes from the tag's annotation (written by Cut release from the promotion's `## Release notes`), replacing the draft's placeholder line. The tag is resolved in the workflow from `package.json` and passed as `RELEASE_TAG` (not read inside the release API script — avoids CodeQL `js/file-access-to-http`). The schema note is rebuilt from `schema-release-compare` job outputs (`MESH_CLIENT_SCHEMA_*`), not from a downloaded markdown artifact (same CodeQL rule).
3. Installs Linux build dependencies (`libudev-dev`, `rpm`, …) on `ubuntu-latest` runners
4. Rebuilds native dependencies (`pnpm run rebuild`)
5. **Stamp CI build info** — `scripts/ci-write-build-info-env.mjs` writes `MESH_CLIENT_BUILD_INFO` (`buildChannel=release` + tag + Actions `runUrl`) into `$GITHUB_ENV` before `dist:*` so support-bundle `manifest.json` and startup logs identify an official release build (see [Build channel stamp](#build-channel-stamp-test-vs-release)).
6. Builds for all three platforms in parallel with **`--publish never`**:
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

A matrix builds **x86_64** and **aarch64** in parallel. Both use the same privileged `ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08@sha256:66eb59fd5d923833e8e4142f60e542156aad4b8b1d5db38149d814c659e274bc` multi-architecture OCI index (Flathub remote, `flatpak-builder`, and system-scope runtime installs). **x86_64** runs on `ubuntu-latest`; **aarch64** runs on `ubuntu-24.04-arm` (native ARM runners — not QEMU on bare Ubuntu). Update that digest only after reviewing the upstream image and confirming the replacement index contains both `linux/amd64` and `linux/arm64`; keep the workflow, `scripts/flatpak-builder-provenance.mjs`, and `scripts/run-act.mjs` in sync.

1. **`schema-release-compare`** — same compare as Build Binaries / Release; uploads `READ-ME-FIRST-flatpak.md` and feeds `write-schema-upgrade-notice.mjs` so bumped schemas embed `SCHEMA-UPGRADE.txt` under Flatpak `resources/`
2. Builds the Reticulum sidecar on bare Ubuntu runners, then generates `flatpak/generated-sources.json` via `flatpak-node-generator`
3. Stamps CI build info (`test` on dispatch / `release` on tag), builds from `org.coloradomesh.MeshClient.yml` with offline pnpm sources
4. Smoke-installs the unstamped local bundle; on **dispatch only**, renames to `org.coloradomesh.MeshClient-run{N}.flatpak`
5. Uploads `org.coloradomesh.MeshClient.flatpak-{x86_64,aarch64}.flatpak` artifacts (file basename stamped on test builds) plus per-arch `flatpak-schema-warning-*`

On **version tag pushes**, a bare `publish` job signs a custom Sigstore attestation that binds both final bundle SHA-256 digests to the source commit and reviewed builder image. It independently verifies the signer workflow, source SHA/ref, predicate, and both digests before waiting for the Electron `prepare-github-release` draft (`ci-wait-github-draft-release.mjs`) and attaching the **clean-named** bundles plus attestation with `ci-upload-release-assets.mjs` (never creates a release). aarch64 is the primary ARM Linux install path (release `build.yaml` only produces x86_64 AppImage/deb/rpm).

`flatpak/generated-sources.json` is generated automatically in CI by `flatpak-node-generator` before each build — it does not need to be committed to the repo. For local builds, generate it manually; see [development-environment.md](development-environment.md) for steps. If submitting to Flathub's dedicated submission repo, the file must be committed there.

---

## Third-party licenses (`third-party-licenses.yaml`)

After merges to `staging` that change `package.json`, `pnpm-lock.yaml`, the Reticulum sidecar's Cargo files or Ratspeak pins, the generator script, or this workflow (dependency changes land on `staging`, so the regenerated document ships with the next promotion):

1. Checkout with `persist-credentials: false` (avoids Duplicate Authorization with create-pull-request)
2. Setup pnpm + Node 22
3. Install dependencies (`pnpm install --frozen-lockfile`)
4. Audit licenses (`pnpm run check:licenses`)
5. Regenerate `docs/third-party-licenses.md` (`pnpm run docs:licenses`)
6. Open a PR via `peter-evans/create-pull-request` when the file changed (branch `chore/third-party-licenses-<run_id>`)
7. Admin-merge that docs-only PR with `LICENSE_PR_TOKEN` (no maintainer review)

**Authority:** the `license-automation` environment accepts only `staging` and has no required reviewers. It has no release, signing, or release-cut credentials. Direct pushes to `staging` remain blocked by its merge-queue ruleset, so the job opens a PR to `staging` restricted to `docs/third-party-licenses.md` and admin-merges it. Environment secret **`LICENSE_PR_TOKEN` is required** for that path: a repo-admin fine-grained PAT (Contents + Pull requests write). Falling back to `GITHUB_TOKEN` leaves PRs stuck on the merge-queue review / unattributed-change gate (see #1311). The file is already validated in-job (`check:licenses`, `docs:licenses`, Rust stub refuse) before merge.

---

## Docs (`docs.yml`)

Builds the documentation site with `mkdocs build --strict` on pull requests to any branch that touch `docs/**`, `README.md`, `CONTRIBUTING.md`, `mkdocs.yml`, or the MkDocs scripts. On every push to `main` it builds the site the same way and deploys it to GitHub Pages, so the published docs follow the released app rather than `staging`:

1. Check out the code with full history (`fetch-depth: 0`) so the git-revision-date plugin can show "last updated" dates
2. Set up Node 22 and Python 3.14 (pinned, not `3.x`: `pyyaml==6.0.3` in `docs/requirements.txt` has no Python 3.15 wheel and the install is `--only-binary`)
3. Install MkDocs dependencies (`docs/requirements.txt`)
4. Run `node scripts/prepare-mkdocs.mjs`, which generates `docs/contributing.md` from `CONTRIBUTING.md`, plus `docs/install.md` and `docs/features.md` from the `<!-- docs-site:… -->` markers in `README.md`. It also rewrites repository-relative links for the site. These generated pages are gitignored.
5. Run `mkdocs build --strict`
6. Deploy with `mkdocs gh-deploy --force` (push to `main` only)

The landing page `docs/index.md` is written by hand and is not copied from the README. Locally, `pnpm run docs:build` and `pnpm run docs:serve` run the same prepare step first.

---

## Dependabot

Automated dependency updates are configured in `.github/dependabot.yml`:

- **Branch:** Dependabot follows the default branch, so after the switch it scans and targets `staging`. `dependabot.yml` sets no `target-branch`.
- **Schedule:** Weekly on Saturdays
- **npm dependencies:** Grouped PRs (Electron separate, all other deps together)
- **GitHub Actions:** Grouped into one PR
- **Open PRs:** `open-pull-requests-limit: 0` — Dependabot scans but does **not** open PRs.
  Dependency bumps are applied manually via `pnpm run update` (`scripts/update.sh`), which
  also runs dedupe, Ratspeak overlay PR checks
  ([rsReticulum#26](https://github.com/ratspeak/rsReticulum/pull/26) ReplyFile and
  [rsLXMF#7](https://github.com/ratspeak/rsLXMF/pull/7) multi-file attachments are overlays
  on the reviewed pins — see `reticulum-sidecar/patches/README.md`), and an upstream
  release / new-org-repo watch (rsLXST, lrgp-rs, Ratspeak Games-parity when a newer published
  release exists, LXMFace `js/lxmface.js` commit). Sibling **rsReticulum** /
  **rsLXMF** / **rsNomad** / **rsLXST** / **lrgp-rs** use the committed full SHAs in
  `reticulum-sidecar/ratspeak-stack-pins.env`; dependency updates require a reviewed pin change.
- **Electron / pnpm / Node.js major bumps** also require the matching nixpkgs attribute
  (`electron_<major>`, `pnpm_<major>`, `nodejs_<major>`) in `flake.nix`, plus
  `nix flake update` when the locked nixpkgs lacks it. Otherwise
  `scripts/flake-stack-pins.test.mjs` fails the full suite.

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

Docker `pnpm run act:ci` runs the real `ci.yaml` work jobs (`quality`, `lint`, `typecheck`, `app-build`, `policy-scanners`) in sequence. It does **not** invoke the `Build & Test` aggregator (`build`) — that job only checks sibling results on GitHub so the required check name stays stable. Path-filtered Flatpak checks are not part of container `act:ci` (native `act:ci:native` still runs them; or change Flatpak inputs and use the `flatpak` job / `act:flatpak`).

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
# act:ci runs quality / lint / typecheck / app-build / policy-scanners
# (not the GitHub-only Build & Test aggregator job)
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

**Not run locally via act:** `docs.yml` (`mkdocs gh-deploy`), release publish legs, `macos-latest` / `windows-latest` / `windows-11-vs2026-arm` matrix jobs, and `ubuntu-24.04-arm` Flatpak builds (no faithful local emulation).

Note: The test results artifact upload step is automatically skipped when running under `act` (detected by actor `nektos/act` in [`tests.yaml`](../.github/workflows/tests.yaml)).

---

## Pipeline status (issue #378)

| Area                                             | Status                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| PR lint / typecheck / build / tests              | Done (`ci.yaml`, `tests.yaml`)                                                       |
| CodeQL / CodeRabbit                              | Done (CodeQL default setup until [advanced activation](../.github/codeql/README.md)) |
| Tag → draft multi-OS + Flatpak + packaging smoke | Done (`release.yaml`, `flatpak.yaml`, `build.yaml`)                                  |
| Promotion + release tag on merge                 | Done (`pnpm run promotion:open`, Promotion Doctor, `cut-release.yaml`)               |
| Emergency local release                          | `scripts/release.sh` (`--yes` for non-interactive)                                   |
| Manual draft **Publish** on GitHub               | Intentional (human review of artifacts)                                              |
| Dep bumps                                        | Manual (`pnpm run update`; Dependabot PRs disabled)                                  |
| Merge queue + required status checks             | Done (`staging` merge queue; `main` promotions ruleset **20821455**; see below)      |
| E2E                                              | Every PR to `main`, daily, manual; the Promotion Doctor waits for it                 |

---

## Merge queue and rulesets

Two **repository rulesets** (not classic branch protection) protect the long-lived branches. Both require a pull request with **at least one approving review**, require **strict** status checks (they must pass on an up-to-date head, or on the merge group), block force-pushes and branch deletion, and let repository admins bypass them.

- **`staging`**: ruleset `staging merge queue` ([`staging-merge-queue.json`](../.github/rulesets/staging-merge-queue.json)). Pull requests merge by squash (or rebase) through the merge queue and require the five checks below.
- **`main`**: ruleset `main promotions` ([`main-promotions.json`](../.github/rulesets/main-promotions.json)), live id **20821455**. Pull requests merge with a merge commit only, with no merge queue, and require the five checks below plus `Promotion Doctor`.

`main` has no merge queue. A promotion must land as the exact two-parent commit its checks ran on, and `Promotion Doctor` runs on `pull_request_target`, never on `merge_group`, so a queue would wait for it forever.

### Required check names (always-on)

Only checks that report on every pull request (and, on `staging`, every `merge_group` run) are required:

| Check name                       | Workflow                |
| -------------------------------- | ----------------------- |
| `Build & Test`                   | `ci.yaml`               |
| `Coverage (renderer-ui)`         | `tests.yaml`            |
| `Coverage (renderer-logic)`      | `tests.yaml`            |
| `Coverage (main)`                | `tests.yaml`            |
| `Merge coverage`                 | `tests.yaml`            |
| `Promotion Doctor` (`main` only) | `promotion-doctor.yaml` |

Each required check is pinned with `integration_id` **15368** (GitHub Actions) in both ruleset files. `Promotion Doctor` reports on the pull request head from its `pull_request_target` run, under the same GitHub Actions app.

**Do not** add these as required (they skip or are not PR/`merge_group` gates and would stall the queue):

- `Reticulum sidecar coverage` (path-filtered)
- `fmt + clippy` / sidecar build matrix (`reticulum-sidecar.yaml`, path-filtered)
- CodeQL `Analyze (*)` — **default setup does not run on `merge_group`**. The advanced workflow supports merge groups after [activation](../.github/codeql/README.md), but no CodeQL ruleset requirement is added by that migration.
- E2E, packaging smoke, Flatpak, release jobs (including the path-filtered `Repeater E2E (Linux)` and `Panel matrix E2E (Linux)`). On pull requests to `main`, the Promotion Doctor already waits for the 3-OS E2E and the release preflight.

`ci.yaml` and `tests.yaml` both listen for `merge_group` so the queue’s temporary ref re-runs the same gates.

### Bypass actors

- **Repository admins** (`RepositoryRole` id 5): the version bump and back-port pushes to `staging` (`pnpm run promotion:open`, `pnpm run promotion:backport`), emergency merges, and the local `pnpm run release` fallback (a direct push of the release commit and tag to `main`)

GitHub Actions **cannot** be added as a bypass actor on this organization (“must be part of the ruleset source or owner organization”). [`third-party-licenses.yaml`](../.github/workflows/third-party-licenses.yaml) therefore opens a documentation PR through the separate, staging-only `license-automation` environment instead of pushing to `staging` or using release credentials.

**Pull request gate:** one approving review, **dismiss stale reviews on push**, and **require last push approval** so an approved PR cannot enter the merge queue after unreviewed follow-up commits.

### Applying / updating the rulesets

Canonical JSON lives in `.github/rulesets/`. Vitest contract: `scripts/branch-rulesets.test.mjs` (merge methods, pinned checks, review gates, and the `Promotion Doctor` name matching its workflow job). After changing a file, **PUT the live ruleset** or drift will remain until someone syncs:

```bash
# main: existing ruleset 20821455
gh api repos/Colorado-Mesh/mesh-client/rulesets/20821455 \
  --method PUT \
  --input .github/rulesets/main-promotions.json

# staging: look the id up by name
RULESET_ID="$(gh api repos/Colorado-Mesh/mesh-client/rulesets \
  --jq '.[] | select(.name == "staging merge queue") | .id')"
gh api "repos/Colorado-Mesh/mesh-client/rulesets/${RULESET_ID}" \
  --method PUT \
  --input .github/rulesets/staging-merge-queue.json
```

The Promotion Doctor's Actions policy lives in `.github/actions-policies/promotion-doctor.json`. After changing it, update the live policy the same way:

```bash
POLICY_ID="$(gh api repos/Colorado-Mesh/mesh-client/actions/policies \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  --jq '.policies[]
    | select(.name == "Allow the Promotion Doctor trigger") | .id')"
gh api "repos/Colorado-Mesh/mesh-client/actions/policies/${POLICY_ID}" \
  --method PUT -H "X-GitHub-Api-Version: 2026-03-10" \
  --input .github/actions-policies/promotion-doctor.json
```

To create a ruleset or the policy where it does not exist yet, POST the same file to `repos/Colorado-Mesh/mesh-client/rulesets` or `repos/Colorado-Mesh/mesh-client/actions/policies` (the policy call takes the same `X-GitHub-Api-Version` header). A second POST of the policy is refused with `Name must be unique`. The rest of the switch to this flow (creating `staging`, allowing merge commits, making `staging` the default branch, moving the `license-automation` deployment branch to `staging`) was a one-time change, listed in the pull request that added the flow.

`gh api --input` can hit HTTP/2 content-length issues on create; if that fails, POST the JSON body with Python `urllib` (same payload).

The `staging` merge queue depends on the `merge_group` triggers in `ci.yaml` and `tests.yaml`. Keep them: a queue without them leaves its required checks pending forever.

Release tags have a separate active **`release tags`** ruleset. Its canonical JSON is [`.github/rulesets/release-tags.json`](../.github/rulesets/release-tags.json): only repository administrators may create, update, or delete `v*` tags, and `release.yaml` rejects any tag whose ref is not protected. Keep the live ruleset synchronized after editing the JSON:

```bash
RULESET_ID="$(gh api repos/Colorado-Mesh/mesh-client/rulesets \
  --jq '.[] | select(.name == "release tags" and .target == "tag") | .id')"
gh api "repos/Colorado-Mesh/mesh-client/rulesets/${RULESET_ID}" \
  --method PUT \
  --input .github/rulesets/release-tags.json
```

Privileged workflows are additionally restricted by protected environments: `release` accepts only protected `v*` tags (the release tags ruleset limits tag creation to admins, so the approved tag job is the human gate); `release-cut` accepts `main`, requires maintainer approval, and contains `RELEASE_CUT_TOKEN`; `release-repair` accepts `main` and requires maintainer approval; `license-automation` accepts `staging` and holds only `LICENSE_PR_TOKEN`. Release credentials live only in these environments; none are repository-scoped.

---

## Required Status Checks

Pull requests and merge-queue groups for `staging`, and pull requests to `main`, must pass the **required check names** listed above (`main` also requires `Promotion Doctor`). Those jobs cover:

- Lint, format, markdown, licenses, actionlint, yamllint (`pnpm run lint` and related steps in `ci.yaml`)
- Cheap always-on policy scanners (`check:electron-security`, log/XSS/console/IPC/protocol-string gates, and the matching cheap `check:*` set)
- Typecheck and build (`pnpm run typecheck`, `pnpm run build`)
- Affected Vitest tests on pull requests; full Vitest with global coverage thresholds on `merge_group`, `staging` and `main` pushes, and manual runs

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

**PR CI** ([`tests.yaml`](../.github/workflows/tests.yaml)) selects merge-base-related Vitest work and fails closed to the full suite when scoping is unsafe. The merge queue and **`pnpm run release`** always run full Vitest; green pre-commit does not replace those gates.

CI focuses on lint, typecheck, build, cheap always-on policy scanners, Flatpak metadata validation, and coverage tests. i18n quality is enforced locally via pre-commit and indirectly in CI through Vitest (`locale-quality.test.ts`).

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

`build.yaml` and `release.yaml` call `packaging-sidecars.yaml` to build the x64 and ARM64 Reticulum sidecars in parallel on separate runners (job UI: **Stage Reticulum**). Each OS runs the full-feature host tests once in its native architecture job. Release platform selection applies to both the sidecar and Electron matrices. Packaging starts after the selected sidecars succeed, so a failed build or test blocks the installers.

The sidecars reach the packaging jobs as tar archives from the same workflow run (`ci-reticulum-staged-{platform}-{arch}` — internal handoff only; not installer downloads). Tar preserves Unix executable permissions; each architecture also carries its own `RESOLVED_SHAS.txt` for the freshly cloned Ratspeak sources. The download action verifies that both platform binaries are staged before Electron packaging. Installer names, signing, updater metadata, and the four packaging smoke jobs remain the same. The existing `reticulum-sidecar.yaml` checks remain independent.

**Actions artifact zip names (installer downloads):** Release keeps `mesh-client-{macos|linux|windows}-{sha}`. Build Binaries (always `workflow_dispatch`) uses the same names with a `test-` prefix (`test-mesh-client-…`) so testers can tell them apart from official packaging runs. Filenames _inside_ those zips still get `-run{N}` on Build Binaries (see below).

Local `node scripts/build-reticulum-sidecar-release.mjs --platform win32|linux|darwin` still runs host tests and builds both architectures. `--arch x64|arm64` selects one target; CI uses `--skip-tests` only for the cross-build whose host tests run in the native job. Parallel jobs reduce elapsed build time but need more concurrent runners; queue delays can reduce the gain.

Packaging sidecars cache Cargo dependencies with `Swatinem/rust-cache`, separately by target triple, runner OS/architecture, and Rust toolchain. The packaging key is separate from validation jobs. The sidecar workspace crate and Cargo-installed tools are excluded. Every run still clones the current Ratspeak sources, applies overlays, runs the native host tests, and builds/stages the selected target; a cache hit never skips those steps. Missing caches fall back to a normal build.

To test sidecar staging or compare cold and warm cache timings without building installers or publishing a release, run **Packaging sidecars** manually and select `all`, `mac`, `linux`, or `win`. It uses the same jobs as Build Binaries and Release and uploads only the staged sidecar artifacts.

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
| `build.yaml`   | Always (dispatch-only)     | After `dist:*`, `scripts/rename-test-build-artifacts.mjs` renames AppImage/deb/rpm/DMG/ZIP/Setup under `release/` to include `-run{GITHUB_RUN_NUMBER}` (e.g. `Mesh-client-5.26.0-run214.AppImage`, `Mesh-client-Setup-5.26.0-run214.exe`) |
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

Linux arm64 cross-builds on Ubuntu 24.04 runners use `scripts/ci-setup-linux-arm64-apt.sh` before `dpkg --add-architecture arm64`. The script pins `Architectures: amd64` only on deb822 stanzas in `ubuntu.sources` that lack an `Architectures` field, writes arm64 ports mirrors as deb822 `arm64.sources` (not legacy `.list`), enables scoped `APT::Get::Allow-Downgrades` when runner amd64 packages outpace `ports.ubuntu.com` arm64 builds (multiarch cross-deps otherwise abort apt), and is idempotent across workflow re-runs.

Reticulum sidecar staging before `electron-builder`:

- `scripts/build-reticulum-sidecar-release.mjs` — compile/copy sidecar per target OS/arch
- `scripts/verify-reticulum-sidecar-staged.mjs` — size/assert checks
- `scripts/electron-builder-before-pack.mjs` — copy into `resources/reticulum-sidecar/`

Post-build smoke tests:

### macOS packaging verify (`verify-mac-packaging.mjs`)

- **`scripts/verify-mac-packaging.mjs`** — macOS packaging guard (runs after `dist:mac` / `dist:mac:publish` and in `packaging-smoke` on tag releases). Validates:
  - **Both x64 and arm64** `.dmg` / `.zip` artifacts under `release/` (path or file-name markers), each above minimum size
  - Bundle layout via **direct `.app`** (every complete on-disk bundle), **`ditto -xk` ZIP extract for every ZIP**, and **`hdiutil attach` for every DMG** (not only the largest archive)
  - DMG mount root includes an **`Applications` → `/Applications` symlink** and **`IMPORTANT-Read-Me.txt`** (7-Zip / bad ZIP extract warning; prefer DMG or [Keka](https://www.keka.io/en/)) — drag-to-install layout from `electron-builder.yml` `dmg.contents`
  - **Electron Framework symlinks** (`Versions/Current`, root `Electron Framework`) remain symlinks — `upload-artifact` dereferences them and breaks the bundle (~3× framework bloat)
  - **Squirrel / Mantle / ReactiveObjC** framework symlinks and binaries (7-Zip flattening breaks Squirrel at launch)
  - Staged **`00-READ-ME-BEFORE-EXTRACTING-macOS-ZIP.txt`** uploaded beside macOS ZIP/DMG on GitHub Releases
  - Thin **MacOS launcher** + full **Electron Framework** binary sizes; bundled **Reticulum sidecar** present with **CPU arch** asserted via `scripts/binary-arch.mjs` (`lipo` / PE / ELF) against the archive’s labeled arch (launcher + Electron Framework lipo checks remain separate)
  - **Developer ID–signed builds:** `codesign --verify --deep --strict` on the finished `.app` (DMG mount / ZIP extract / on-disk), `xcrun stapler validate` (stapled notarization ticket), and Developer ID plus `codesign --verify --strict` checks on the bundled Reticulum sidecar. Unsigned or ad-hoc local `dist:mac` builds use optional mode; release workflow jobs and `dist:mac:publish` require the exact `APPLE_TEAM_ID` for both binaries before any upload.
  - CI uploads **DMG/ZIP only** — never raw `Mesh-client.app` (see comment in `release.yaml` **Upload macOS Artifact**)
  - Official tag releases receive signing values only from the protected `release` environment on `macos-latest`; manual `build.yaml` packaging is always unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Layout checks do not require credentials, but signed release builds must pass the codesign/stapler gate above
- `scripts/test-linux-appimage-reticulum-sidecar.mjs` — x64 uses `--appimage-extract`; arm64 on x64 runners uses `unsquashfs` for cross-arch extract; also asserts each AppImage’s embedded `app.asar` version and `X-AppImage-Version` match `package.json`, and that the **bundled sidecar** ELF arch matches the image (AppImage runtime ELF host-matching is separate from sidecar arch)
- **`scripts/test-linux-appimage-launch.mjs`** — headless launch smoke that proves the packaged Linux AppImage actually **boots and loads the renderer**, not just that its files are well-formed or that the main process wrote a log line. Shared wait/assert logic lives in **`scripts/packaged-launch-smoke.mjs`** (`launchAndAssert`); this script remains the Linux caller (sandbox flags + `MESH_CLIENT_DISABLE_GPU`). Runs under `xvfb-run` in the `packaging-smoke` Linux leg (`build.yaml` / `release.yaml`), with a 5-minute step timeout. Extracts the AppImage (the file listing is kept out of the CI log unless extraction fails), launches its `AppRun` with `MESH_CLIENT_DISABLE_GPU=1`, `--no-sandbox --disable-setuid-sandbox`, and a throwaway `--user-data-dir`, then asserts the process stays alive past a startup threshold with no crash exit, that `mesh-client.log` contains a renderer-loaded signal (`[Startup] renderer loaded:` after the final `loadURL` resolves; URL-intent and early renderer console lines do not count), and that the log and captured stderr have no renderer-gone, failed-load, or child-process-gone lines (those paths block on an error dialog, so the process can stay alive). Only the **native-arch** AppImage is launched (a cross-arch runtime cannot execute on the runner; that image is still covered by the sidecar extract smoke above). If no AppImage matches the host architecture, the smoke exits non-zero. The step **gates** `build.yaml` and `release.yaml`. Requires `xvfb` + Electron runtime libs (`libnss3`, `libgtk-3-0t64`, `libgbm1`, `libasound2t64`, …), installed by `scripts/ci-install-linux-appimage-smoke-deps.sh` from the Linux smoke step in both workflows.
- **`scripts/test-mac-app-launch.mjs`** — launch smoke for the packaged macOS `.app` from the **host-arch ZIP** only (release/`packaging-smoke` on `release.yaml`; not `build.yaml`, whose mac artifacts are unsigned). Spawns `Contents/MacOS/Mesh-client` directly (not `open -n`) via `packaged-launch-smoke.mjs`. On failure, writes diagnostics to fixed `$RUNNER_TEMP/mesh-client-mac-launch-diagnostics/` (CI) or a unique mkdtemp under `os.tmpdir()` locally. Optional local keep: `MESH_CLIENT_KEEP_TEMP=1`.
- **`scripts/test-win-nsis-install.mjs`** — silent NSIS install + size/sidecar asserts; WoA adds `--probe-7z`. Both `build.yaml` and `release.yaml` packaging-smoke Windows legs pass **`--launch`** so the installed `Mesh-client.exe` must boot and load the renderer. Install/launch diagnostics use fixed names under `$RUNNER_TEMP` in CI (`mesh-client-install-${arch}.log`, `mesh-client-win-${arch}-launch-diagnostics/**`); locally a single mkdtemp root hosts the same relative layout. Sidecar CPU arch is asserted via `binary-arch.mjs` (PE).

Local packaging parity: see [development-environment.md](development-environment.md#reticulum-sidecar-optional).
