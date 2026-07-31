# Development Environment Setup

This guide covers local development setup for Mesh Client (Meshtastic, MeshCore, and Reticulum), including cloning, prerequisites, and test harness tooling. For runtime errors, connection issues, and packaged-app problems, see [troubleshooting.md](troubleshooting.md).

## Shared Requirements and Tooling

These requirements apply to all platforms.

### 1) Required software

- Git
- Node.js **22.13.0+** and pnpm **11+** (`package.json` `engines`; the repo pins **`packageManager`** to a specific pnpm release — use [Corepack](https://nodejs.org/api/corepack.html) when available, or `npm install -g corepack@latest` / `npm install -g pnpm@<pin>` on Node 25+ where Corepack is not bundled). `pnpm install` fails on engine mismatch. After pulling a pnpm major bump, `preinstall` and `pnpm run dev` print an upgrade banner with the exact install command if your local pnpm is too old or the wrong major.
- [CI](https://github.com/Colorado-Mesh/mesh-client/blob/main/.github/workflows/ci.yaml) uses Node 22
- Python 3 + `pip` (needed for MkDocs documentation build and yamllint)

Verify:

```bash
git --version
node --version
pnpm --version
```

### Environment check

Run the automated checklist after cloning (works before pnpm is installed):

```bash
node scripts/check-environment.mjs # before pnpm install
pnpm install
pnpm run check:environment # re-check after install
pnpm run dev
```

**Required** checks (must pass): Git, Node.js, pnpm, `node_modules`, and platform-native build tools (Xcode CLT on macOS, `g++`/`make` on Linux, MSVC `cl` on Windows).

**Optional** checks (warnings only): Python/pip, Rust, actionlint, yamllint, a Docker-compatible container engine (Podman preferred), act, and Linux `dialout` group membership. For local CI you can use **container mode** (`pnpm run act:ci` — act + Podman/Docker) or **host mode** (`pnpm run act:ci:native` — no container engine). Fix optional items when you need docs builds, pre-commit hooks, Reticulum sidecar work, local CI parity, or USB serial on Linux.

Use the printed `→` hints and `setup:*` scripts (`setup:build-deps`, `setup:actionlint`, `setup:dialout`) to fix failures. See [Helper scripts (auto-install where possible)](#8-helper-scripts-auto-install-where-possible) below.

### MkDocs (documentation) tooling

Docs are built with MkDocs Material.

1. Create and activate a local virtual environment (recommended on macOS/Homebrew Python because of PEP 668 externally managed environments):
   - macOS/Linux:
     - `python3 -m venv .venv`
     - `source .venv/bin/activate`
   - Windows PowerShell:
     - `py -3 -m venv .venv`
     - `.\.venv\Scripts\Activate.ps1`
2. Install the docs dependencies:
   - `pnpm run docs:install`
   - or (manual): `python3 -m pip install -r docs/requirements.txt`
3. Build locally:
   - `pnpm run docs:build`
4. Preview locally:
   - `pnpm run docs:serve`

If `pnpm run docs:install` fails with `externally-managed-environment`, activate `.venv` and rerun.

### 2) Clone and install

```bash
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
node scripts/check-environment.mjs # optional but recommended on first clone
pnpm install
pnpm run check:environment # re-check after install
```

If you are updating from an older clone, use a clean install when troubleshooting native module issues:

```bash
rm -rf node_modules package-lock.json
pnpm install
```

### 3) Run the app

- Dev mode (hot reload): `pnpm run dev`
- Production-like local start: `pnpm start`

### Reticulum sidecar (optional)

Reticulum/LXMF runs in a separate Rust binary (`mesh-client-reticulum`) spawned by the Electron main process. The MIT TypeScript layers talk to it over localhost HTTP/WS only. You only need this when working on the **Reticulum** protocol tab.

#### Installing Rust

**Recommended: [rustup](https://rustup.rs/)** — matches [CI](.github/workflows/reticulum-sidecar.yaml) and `pnpm run update`:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env" # or open a new terminal
rustc --version
cargo --version
```

**macOS Homebrew alternative:** `brew install rust` works for local `cargo build`, but CI uses rustup. **Do not install both** rustup and Homebrew `rust` on the same machine — they can fight over `rustc`/`cargo` on your `PATH`. Pick one:

| Approach               | Install                         | Update                                          |
| ---------------------- | ------------------------------- | ----------------------------------------------- |
| **rustup (preferred)** | [rustup.rs](https://rustup.rs/) | `rustup update` (also run by `pnpm run update`) |
| **Homebrew**           | `brew install rust`             | `brew upgrade rust`                             |

If you use Homebrew only, `pnpm run update` will try `brew upgrade rust` when rustup is absent. For cross-target builds (WoA, Linux glibc) and toolchain pins, prefer rustup.

Linux and Windows: use rustup; on Windows you may also need [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the C++ workload (same as native Node modules).

[`reticulum-sidecar/rust-toolchain.toml`](../reticulum-sidecar/rust-toolchain.toml) pins **`stable`** and installs `clippy`, `rustfmt`, and `llvm-tools-preview` on the first `cargo` command run inside `reticulum-sidecar/` (rustup auto-install). When `cargo` is on your `PATH` **and** sidecar-related paths are staged, pre-commit runs `pnpm run check:reticulum-sidecar` (full-feature fmt + Clippy + test with `rns-stack,rns-ble,rns-rnode-tcp` — no coverage).

#### Build the sidecar

From the repo root:

```bash
pnpm run reticulum:sidecar:build
```

This writes `reticulum-sidecar/target/debug/mesh-client-reticulum` (macOS/Linux) or `.exe` on Windows.

When sibling checkouts `../rsReticulum`, `../rsLXMF`, and `../rsNomad` exist, the build script applies required rsReticulum overlays automatically (`scripts/ensure-rsReticulum-patches.sh`) before compiling with `rns-stack,rns-ble,rns-rnode-tcp`. See [`reticulum-sidecar/patches/README.md`](../reticulum-sidecar/patches/README.md) for overlay details.

**First run in Electron dev:** **Reticulum** → **Connection** → **Start stack** will run `cargo build` automatically if that binary is missing (first compile can take a few minutes). Pre-build with the command above to avoid waiting on the first click.

#### Run and verify

```bash
# Optional: run sidecar standalone (port 19437)
pnpm run reticulum:sidecar:dev

# Health check (standalone or after Start stack in the app)
curl -s http://127.0.0.1:19437/api/v1/status
# → {"status":"ok",...}
```

In Electron dev: open the **Reticulum** protocol pill (amber) → **Connection** → **Start stack**. Then use **Network** for identity (generate/import) and **Connection** for interfaces (add, edit, delete). Dev builds resolve the binary from `reticulum-sidecar/target/debug/mesh-client-reticulum`.

#### Keep Rust and the sidecar current

`pnpm run update` updates Node dependencies **and**, when `cargo` is available:

1. Runs `rustup update` (or `brew upgrade rust` if you use Homebrew rust without rustup)
2. Rebuilds the sidecar with `cargo build` in `reticulum-sidecar/`

**Scope:** `pnpm update` / `pnpm-lock.yaml` changes are **repo-local** (commit the lockfile on your branch). The sidecar rebuild writes only to gitignored `reticulum-sidecar/target/`. **Rust toolchain updates are not repo-scoped** — `rustup update` refreshes the toolchain in your user profile (`~/.rustup`, `~/.cargo/bin`), shared by any Rust project on the machine. The committed [`rust-toolchain.toml`](../reticulum-sidecar/rust-toolchain.toml) selects `stable` and required components for this crate; rustup applies it when you build or lint inside `reticulum-sidecar/`.

By default, `pnpm run update` keeps `reticulum-sidecar/target/` so the next Electron **Start stack** or `reticulum:sidecar:build` stays warm. After a verify-and-walk-away run (or when reclaiming disk — often ~2–3G), opt in to a full `cargo clean` after a successful rebuild:

```bash
# Preferred
CLEAN_SIDECAR_TARGET=1 pnpm run update

# Equivalent flag (pnpm forwards args after --)
pnpm run update -- --clean-target

# Ad hoc anytime (does not run update)
pnpm run reticulum:sidecar:clean
```

Skip cleanup while iterating on sidecar Rust or Reticulum in Electron — the next build will be cold (several minutes).

#### Lint and coverage (sidecar)

| Command                                  | When                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `pnpm run check:reticulum-sidecar`       | Pre-commit full-feature fmt + Clippy + test (when `cargo` on `PATH`) |
| `pnpm run reticulum:sidecar:clippy:full` | Before PR when editing `reticulum-sidecar/**`                        |
| `pnpm run reticulum:sidecar:coverage`    | Optional local HTML report (`cargo install cargo-llvm-cov`)          |

CI: full-feature lint in [`reticulum-sidecar.yaml`](../.github/workflows/reticulum-sidecar.yaml); line-coverage threshold in [`tests.yaml`](../.github/workflows/tests.yaml) when sidecar paths change (not pre-commit).

#### Further reading

- Optional full RNS stack: [`reticulum-sidecar/README.md`](../reticulum-sidecar/README.md) (`rns-stack` Cargo feature)
- Architecture: [docs/reticulum.md](reticulum.md)
- HTTP contract: [docs/reticulum-sidecar-ipc.md](reticulum-sidecar-ipc.md)
- Won't start / health timeout: [troubleshooting.md#reticulum-sidecar-wont-start-or-health-poll-times-out](troubleshooting.md#reticulum-sidecar-wont-start-or-health-poll-times-out)

Windows ARM64 release builds use a dedicated `aarch64-pc-windows-msvc` CI job (see `.github/workflows/reticulum-sidecar.yaml`).

### Common pnpm commands

Use these from the repository root:

```bash
# App run/build
pnpm run dev
pnpm start
pnpm run build

# Platform packaging (binary artifacts in release/)
pnpm run dist:mac
pnpm run dist:linux
pnpm run dist:win

# Quality checks
pnpm run check:environment
pnpm run test:run
pnpm run test:coverage
pnpm run lint
pnpm run typecheck
pnpm run format:check
pnpm run check:i18n

# Maintenance
pnpm run update
pnpm run clean

# Reticulum sidecar (optional; requires Rust)
pnpm run reticulum:sidecar:build
pnpm run reticulum:sidecar:dev
pnpm run check:reticulum-sidecar
pnpm run reticulum:sidecar:clippy:full
pnpm run reticulum:sidecar:coverage

# Docs
pnpm run docs:install
pnpm run docs:build
pnpm run docs:serve
```

### All Scripts Reference

Complete reference of all pnpm scripts in [`package.json`](../package.json), organized by category.

#### Build

| Script                   | Description                                                                    |
| ------------------------ | ------------------------------------------------------------------------------ |
| `build`                  | Full production build: main (minified) + preload + renderer                    |
| `build:main`             | Build main process (no minify) → `dist-electron/main/index.js`                 |
| `build:main:prod`        | Build main process (minified) → `dist-electron/main/index.js`                  |
| `build:main:meta`        | Build main with metadata JSON (no minify) → `dist-electron/main/metafile.json` |
| `build:main:minify-meta` | Build main with metadata JSON (minified) → `dist-electron/main/meta.json`      |
| `build:main:size`        | Print main bundle size                                                         |
| `build:preload`          | Build preload script → `dist-electron/preload/index.js`                        |
| `build:renderer`         | Build renderer (React app) via Vite → `dist/`                                  |

#### Run

| Script              | Description                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| `dev`               | Hot-reload dev mode: main/preload watch + Vite dev server + Electron              |
| `start`             | Production-like local start: `build` then Electron with security warnings enabled |
| `electron:open`     | Launch Electron (requires prior build)                                            |
| `trace-deprecation` | Run with Node `--trace-deprecation` enabled                                       |

#### Package (distributables)

| Script               | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `dist`               | Build for current platform → `release/`                                      |
| `dist:mac`           | Build macOS .dmg + .zip + verify packaging (`verify-mac-packaging.mjs`)      |
| `dist:mac:publish`   | Build macOS and upload to release server                                     |
| `dist:linux`         | Build Linux x64 + arm64 (.AppImage, .deb, .rpm) + verify packaging           |
| `dist:linux:publish` | Build Linux and upload to release server                                     |
| `dist:win`           | Build Windows .exe installer (hoisted install workaround) + verify packaging |
| `dist:win:publish`   | Build Windows and upload to release server                                   |

`dist:mac`, `dist:linux`, and `predist` run `dedupe:dist` before packaging. `dist:win` uses `scripts/dist-win-hoisted-install.mjs` and restores `node_modules` afterward.

#### Building a Flatpak (Linux)

Flatpak builds use `flatpak-builder` directly (not a pnpm script) and require a one-time local setup. The GitHub Actions workflow (`flatpak.yaml`) handles this in CI automatically; the steps below are for local iteration.

**1. Install system tools (Debian/Ubuntu)**

```bash
sudo apt install flatpak flatpak-builder elfutils
```

**1. Install system tools (Fedora)**

```bash
sudo dnf install flatpak flatpak-builder elfutils
```

**2. Add Flathub and install runtimes** (one-time, ~500 MB)

```bash
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub org.freedesktop.Platform//24.08
flatpak install --user -y flathub org.freedesktop.Sdk//24.08
flatpak install --user -y flathub org.freedesktop.Sdk.Extension.node22//24.08
flatpak install --user -y flathub org.electronjs.Electron2.BaseApp//24.08
```

**3. Generate offline pnpm sources** (re-run whenever `pnpm-lock.yaml` changes)

```bash
# Prefer the CI pin with --force-reinstall (images may preinstall an older 0.1.0).
# See scripts/flatpakPnpmStoreVersion.mjs FLATPAK_NODE_GENERATOR_GIT.
pip install --force-reinstall --no-cache-dir \
  "git+https://github.com/flatpak/flatpak-builder-tools@ac5a296ac6111aa2319daf532f609a067b88d8a9#subdirectory=node"
# Must match package.json packageManager major (pnpm 11 → v11). Generator defaults to v10.
PNPM_MAJOR="$(node -p "require('./package.json').packageManager.match(/^pnpm@(\\d+)/)[1]")"
STORE_VERSION="v${PNPM_MAJOR}"
flatpak-node-generator pnpm pnpm-lock.yaml \
  --pnpm-store-version "$STORE_VERSION" \
  -o flatpak/generated-sources.json
```

`flatpak/generated-sources.json` is generated automatically in the `flatpak.yaml` CI workflow and does not need to be committed. For local builds you generate it manually as shown above; the file is only required locally and in a Flathub submission repo.

**PR-cycle offline check** (not pre-commit): after installing `flatpak-node-generator`, run `pnpm run check:flatpak-offline-pnpm` to assert the workflow passes the correct `--pnpm-store-version` and that generated sources cover lockfile tarballs (catches `ERR_PNPM_NO_OFFLINE_TARBALL`). CI / `act:pr` / `release.sh` run this automatically.

Offline install inside the Flatpak sandbox uses `scripts/flatpak-pnpm-install.mjs`, which retries transient `@jsr/_tmp_*` rename races (same root cause as Windows `dist:win` hoisted installs).

**3b. Bundle Reticulum sidecar** (required for Reticulum tab in the Flatpak; CI does this automatically)

The manifest copies `resources/` into the app, including `resources/reticulum-sidecar/mesh-client-reticulum`. Before `flatpak-builder`, build the sidecar and install the binary there:

```bash
pnpm run reticulum:sidecar:build
install -Dm755 reticulum-sidecar/target/debug/mesh-client-reticulum \
  resources/reticulum-sidecar/mesh-client-reticulum
```

For a release-quality local Flatpak, use `cargo build --release` with `rns-stack,rns-ble,rns-rnode-tcp` (see [Reticulum sidecar](#reticulum-sidecar-optional)).

**4. Build and install locally**

```bash
flatpak-builder --user --install --force-clean build-dir org.coloradomesh.MeshClient.yml
```

This installs the app into your user Flatpak store.

**5. Run**

```bash
flatpak run org.coloradomesh.MeshClient
```

**6. Produce a `.flatpak` bundle** (for sharing without a repo)

```bash
flatpak build-bundle ~/.local/share/flatpak/repo \
  org.coloradomesh.MeshClient.flatpak \
  org.coloradomesh.MeshClient stable
```

Installing a `.flatpak` file creates a one-off remote named like `meshclient-origin` (not `flathub`); that is expected. The ref branch is `stable` (release CI sets this; older artifacts used `master`). Version is shown in MetaInfo / `flatpak info`, not in the remote name.

**Reinstall after downloading a new bundle**

```bash
flatpak uninstall --user org.coloradomesh.MeshClient
flatpak install --user ./org.coloradomesh.MeshClient-aarch64.flatpak
flatpak run org.coloradomesh.MeshClient
```

**Runtime issues** (GPU, VMware guests): see [Flatpak: `vmwgfx: driver missing` (VMware on macOS)](troubleshooting.md#flatpak-vmwgfx-driver-missing-vmware-on-macos).

**Launch failures on Arch/CachyOS Wayland**: see [Flatpak: immediate exit on Arch / CachyOS / Wayland (#598)](troubleshooting.md#flatpak-immediate-exit-on-arch--cachyos--wayland-598).

**Lint the manifest** before submitting to Flathub:

```bash
flatpak run --command=flatpak-builder-lint org.freedesktop.Sdk \
  manifest org.coloradomesh.MeshClient.yml
```

#### Test

| Script          | Description                            |
| --------------- | -------------------------------------- |
| `test`          | Run tests in watch mode (Vitest)       |
| `test:run`      | Run tests once (CI mode)               |
| `test:coverage` | Run tests once with V8 coverage report |
| `test:verbose`  | Run tests with verbose output          |

#### Lint / Format

| Script         | Description                                        |
| -------------- | -------------------------------------------------- |
| `lint`         | Run ESLint (type-aware, zero warnings)             |
| `lint:fix`     | Run ESLint with auto-fix                           |
| `lint:md`      | Run markdownlint-cli2 on all `.md` files           |
| `format`       | Format all code via Prettier + sort `package.json` |
| `format:check` | Check formatting without fixing                    |

#### Typecheck

| Script                    | Description                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `typecheck`               | TypeScript check: renderer + main process                                                                 |
| `typecheck:strict-shared` | Strict TypeScript (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) for `src/shared`            |
| `check:pr`                | PR-parity local gate: lint + typecheck + strict-shared + full `test:run` (+ sidecar if branch touches it) |

#### Quality checks

| Script                                | Description                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `check:codeql-extensions`             | Verify CodeQL extension allowlist for custom queries                   |
| `check:console-log`                   | Fail on bare `console.log` in production paths                         |
| `check:db-migrations`                 | Verify SQLite migrations are valid                                     |
| `check:electron-security`             | Verify Electron security settings (CSP, sandbox, etc.)                 |
| `check:environment`                   | Verify local dev prerequisites (run after clone)                       |
| `check:flatpak`                       | Lint Flatpak manifest and wrapper scripts                              |
| `check:flatpak-offline-pnpm`          | PR/release offline Flatpak pnpm store vN + lockfile coverage           |
| `check:i18n`                          | Verify English keys, unused keys, and locale quality rules             |
| `check:i18n:branch`                   | Run i18n quality checks on keys new/changed vs `HEAD` only             |
| `check:insecure-temp-files`           | Predictable `os.tmpdir()` writes (CodeQL `js/insecure-temporary-file`) |
| `check:ipc-contract`                  | Verify IPC channel contracts between main/preload/renderer             |
| `check:licenses`                      | Summarize dependency licenses (`license-checker-rseidelsohn`)          |
| `check:log-injection`                 | Detect unsanitized user data in log calls                              |
| `check:log-panel-filter`              | Verify log panel filter wiring                                         |
| `check:log-service-sinks`             | Verify log service sink configuration                                  |
| `check:protocol-string-gates`         | Enforce protocol capability gates over string compares                 |
| `check:reticulum-decommissioned-hubs` | Keep TS/Rust decommissioned hub lists aligned                          |
| `check:reticulum-interface-modes`     | Keep TS/Rust Reticulum interface-mode catalogs aligned                 |
| `check:reticulum-sidecar`             | Full-feature `cargo fmt` + Clippy + test (skips when `cargo` missing)  |
| `check:silent-catches`                | Detect empty or unlogged catch blocks                                  |
| `check:url-hostname-sanitization`     | Verify URL hostname sanitization helpers                               |
| `check:xss-patterns`                  | Detect risky DOM/HTML sink patterns                                    |

#### Documentation

| Script         | Description                         |
| -------------- | ----------------------------------- |
| `docs:install` | Install MkDocs Python dependencies  |
| `docs:build`   | Build static docs to `site/`        |
| `docs:serve`   | Serve docs locally with live reload |

#### CI (act)

| Script                   | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `act:ci`                 | Run Linux CI workflow via act + containers (Podman preferred) |
| `act:ci:native`          | Run CI checks on the host (no container engine)               |
| `act:tests`              | Run tests workflow via act + containers                       |
| `act:tests:native`       | Run `test:coverage` on the host                               |
| `act:pr`                 | Run `act:ci` then `act:tests` (container)                     |
| `act:pr:native`          | Run native CI + tests on the host                             |
| `act:build:linux`        | Run `build.yaml` ubuntu leg via act + containers              |
| `act:build:linux:native` | Run `dist:linux` on the host                                  |
| `act:reticulum`          | Reticulum sidecar Linux jobs via act                          |
| `act:reticulum:native`   | Reticulum sidecar stub `cargo test` / build on the host       |
| `act:flatpak`            | Flatpak x86_64 workflow via act (slow; privileged)            |
| `act:pull-images`        | Pre-pull Docker images for act (container mode)               |
| `act:list`               | List container and native act targets                         |

#### Setup / helpers

| Script                          | Description                                                    |
| ------------------------------- | -------------------------------------------------------------- |
| `clean`                         | Remove `dist-electron`, `dist`, and `node_modules`             |
| `dedupe:dist`                   | Dedupe dependency tree before packaging (`predist` hook)       |
| `i18n:auto-translate`           | Machine-translate missing locale keys (MyMemory default)       |
| `i18n:prune-unused`             | Remove orphaned translation keys from locale files             |
| `rebuild`                       | Rebuild native Node modules for Electron                       |
| `release`                       | Maintainer release script (`scripts/release.sh`)               |
| `reticulum:sidecar:build`       | Build debug `mesh-client-reticulum` (requires `cargo`)         |
| `reticulum:sidecar:clippy`      | Clippy stub build (`-D warnings`)                              |
| `reticulum:sidecar:clippy:full` | Clippy with `rns-stack,rns-ble,rns-rnode-tcp`                  |
| `reticulum:sidecar:coverage`    | Optional HTML coverage via `cargo llvm-cov` (no CI threshold)  |
| `reticulum:sidecar:dev`         | Run sidecar standalone on `127.0.0.1:19437`                    |
| `reticulum:sidecar:fmt`         | `cargo fmt` in `reticulum-sidecar/`                            |
| `reticulum:sidecar:fmt:check`   | `cargo fmt --check`                                            |
| `reticulum:sidecar:test`        | Full-feature `cargo test` (clones Ratspeak siblings if needed) |
| `reticulum:sidecar:test:full`   | Alias for `reticulum:sidecar:test`                             |
| `setup:actionlint`              | Install actionlint for GitHub workflow linting                 |
| `setup:build-deps`              | Install native build dependencies                              |
| `setup:dialout`                 | Add user to dialout group for serial port access (Linux)       |
| `update`                        | Update pnpm deps, Rust toolchain (rustup), rebuild sidecar     |

#### Lifecycle (automatic)

| Script        | Description                                                           |
| ------------- | --------------------------------------------------------------------- |
| `preinstall`  | Require pnpm 11+ (`check-package-manager.mjs`) then `only-allow pnpm` |
| `postinstall` | Rebuild native Node modules for Electron + apply pnpm patches         |
| `prepare`     | Enable git hooks (`core.hooksPath = .githooks`)                       |
| `predist`     | Run `dedupe:dist` before `dist` packaging                             |

`postinstall` runs `scripts/rebuild-native.mjs` for Electron native addons and applies `patchedDependencies` from `pnpm-workspace.yaml` (Meshtastic JSR transports, MeshCore, `readable-stream`, `usb`, etc.). When bumping patched packages, update hashes under `patches/` and keep `WATCH_ENTRIES` in `scripts/update.sh` in sync — see [AGENTS.md](../AGENTS.md#6-commands--ci-checks).

### Dependabot dependency updates

Automated dependency updates are configured in `.github/dependabot.yml`:

- **Schedule:** Weekly on Saturdays
- **pnpm dependencies:** Grouped PRs; `electron` separate, all other deps together
- **GitHub Actions:** Grouped into one PR

**Testing Dependabot PRs locally:**

Always use **pnpm** to test dependabot PRs:

```bash
git checkout <dependabot-branch>
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:run
```

Do **not** use `npm install`; it creates a `package-lock.json` and may not respect pnpm's lockfile format.

### 4) Test harness setup and local quality checks

This section is the project test harness setup.

Installed via `pnpm install` (from `package.json`):

- `vitest`, `@vitest/coverage-v8`, and renderer/main test dependencies
- `eslint`, `typescript`, `typescript-eslint`
- `prettier`, `prettier-plugin-sh`, `prettier-plugin-tailwindcss`
- `markdownlint-cli2`, `vitest-axe`

Not installed by pnpm (install separately when needed):

- `actionlint` (recommended for workflow linting; run `pnpm run setup:actionlint` or install system-wide)
- `yamllint` (required for YAML linting; install via `pip install yamllint` or `brew install yamllint` on macOS)
- **Rust / `cargo`** (optional; Reticulum sidecar — see [Reticulum sidecar](#reticulum-sidecar-optional); prefer [rustup](https://rustup.rs/)). `rust-toolchain.toml` installs clippy/rustfmt/llvm-tools-preview on first build in `reticulum-sidecar/`. Optional: `cargo install cargo-llvm-cov` for `pnpm run reticulum:sidecar:coverage`.
- Podman or Docker (Docker-compatible engine) and `act` (optional for container CI — `act:*`; host CI uses `act:*:native` without a container engine)
- Python 3 + `venv` + MkDocs Python deps (for docs checks/builds)

#### Vitest projects and worker allocation

`vitest.config.ts` defines three projects:

| Project          | Environment | Role                                    |
| ---------------- | ----------- | --------------------------------------- |
| `renderer-ui`    | jsdom       | Component/hook tests with setup stubs   |
| `renderer-logic` | node        | Pure renderer unit tests (no setup)     |
| `main`           | node        | Main, shared, preload, and script tests |

Worker counts are derived in [`vitest.harness.ts`](../vitest.harness.ts) via `computeVitestMaxWorkers(cpuCount, ratio)`: jsdom workers use `RENDERER_UI_CPU_RATIO` because they are memory-heavy; node workers use `NODE_WORKER_CPU_RATIO`. Both pools floor at `MIN_VITEST_WORKERS` (currently 2) and cap effective CPU count at `MAX_VITEST_CPU_COUNT` (32). When tuning worker allocation, change those constants in the harness (not this doc). Shared Vite dependency inline lists (`VITEST_CORE_DEPS`, `VITEST_SERVER_INLINE_DEPS`) also live there — add new deps to the harness when tests need them inlined.

By default all three Vitest projects run in **parallel** (`groupOrder: 0`). On memory-constrained hosts, set `VITEST_SEQUENTIAL_PROJECTS=1` to run `renderer-ui` first, then `renderer-logic` + `main` together (legacy behavior).

CI runs coverage in three parallel jobs (`renderer-ui`, `renderer-logic`, `main`) and merges blob reports via `pnpm run test:coverage:merge` (see [`.github/workflows/tests.yaml`](../.github/workflows/tests.yaml)).

Monolithic protocol runtimes (`useMeshtasticRuntime`, `useMeshcoreRuntime`) also use **source contract tests** (read `.ts` files and assert wiring strings) where full `renderHook` integration would require heavy BLE/MQTT mocking; see `*.reconnect*.test.ts` beside those runtimes. Another example: [`meshtasticRuntimeWireEffects.diagnostics.contract.test.ts`](../src/renderer/lib/meshtastic/meshtasticRuntimeWireEffects.diagnostics.contract.test.ts) asserts LocalStats / RF hop-SNR still call `processNodeUpdate` from `meshtasticNodeSideEffects` / `meshtasticRawPacketSideEffects`.

#### Browser dev without Electron

When you open the Vite dev URL in a **plain browser tab** (not the Electron window), `installDevElectronApiStubIfNeeded()` in `src/renderer/main.tsx` installs a no-op `window.electronAPI` stub (`devElectronApiStub.ts`). UI shell and most panels render, but **RF connect, SQLite, MQTT IPC, and file dialogs require the Electron window**. The console logs `[dev] Installed browser electronAPI stub…` when the stub is active.

Run these quality checks before opening a PR:

```bash
pnpm run test:run
pnpm run lint
pnpm run lint:md
pnpm run typecheck
pnpm run format:check
pnpm run check:i18n
# Reticulum sidecar (when editing reticulum-sidecar/**)
pnpm run reticulum:sidecar:clippy:full
pnpm run reticulum:sidecar:test
```

Other useful commands:

- `pnpm test` (watch mode — reruns only changed test files)
- `pnpm run test:staged` (pre-commit helper: Vitest related to **staged** files only)
- `pnpm run test:changed` (one-shot tests for working-tree edits vs `HEAD`, including unstaged WIP)
- `pnpm run check:pr` (before opening/updating a PR: full lint + typecheck + `typecheck:strict-shared` + full `test:run`)
- Pre-push hook: `vitest run --changed` vs merge-base with `origin/main` (branch-scoped; not full suite)
- `pnpm run test:ui` / `test:logic` / `test:main` (single Vitest project)
- `pnpm run test:coverage` (CI coverage report; used by `act:tests:native`)
- `pnpm run test:coverage:merge` (merge sharded CI blob reports locally)
- `pnpm run reticulum:sidecar:coverage` (optional local HTML; CI threshold in `tests.yaml`)
- `pnpm run test:verbose` (verbose failures)
- `pnpm run check:i18n:branch` (i18n quality on branch-diff keys only)
- `pnpm run i18n:auto-translate` (fill missing keys)
- `pnpm run i18n:prune-unused -- --write` (drop orphaned locale keys)

The pre-commit hook runs path-gated `check:*` steps plus staged-related Vitest — see [Git hooks](#6-git-hooks-and-pre-commit-behavior).

### 5) Building a distributable

Use the platform-specific packaging command:

```bash
pnpm run dist:mac   # macOS -> .dmg + .zip in release/
pnpm run dist:linux # Linux -> .AppImage + .deb in release/
pnpm run dist:win   # Windows -> .exe installer in release/
```

Output goes to the `release/` directory.

**macOS (`dist:mac`)** runs `electron-builder --mac --publish never`, then **`node scripts/verify-mac-packaging.mjs`**. The verify step asserts `.dmg` + `.zip` artifacts, symlink-preserving ZIP extract (`ditto -xk`), DMG mount, launcher/framework sizes, and bundled Reticulum sidecar — same checks CI `packaging-smoke` uses on downloaded artifacts. It does **not** require signing secrets; unsigned local builds are expected to pass verify.

**Optional macOS signing (release parity):** export the same env vars CI uses before `pnpm run dist:mac` or `dist:mac:publish`:

```bash
export CSC_LINK='…' # base64 .p12 Developer ID Application cert
export CSC_KEY_PASSWORD='…'
export CSC_IDENTITY_AUTO_DISCOVERY=true
export APPLE_ID='…'
export APPLE_APP_SPECIFIC_PASSWORD='…'
export APPLE_TEAM_ID='…'
pnpm run dist:mac
```

When `CSC_LINK` is unset, electron-builder skips signing/notarization (`CSC_IDENTITY_AUTO_DISCOVERY=false` in CI). See [Release Process — macOS code signing and notarization](release-process.md#macos-code-signing-and-notarization).

### Build analysis

To analyze the main process bundle size and composition:

```bash
pnpm run build:main:minify-meta
```

This generates `dist-electron/main/meta.json`. Upload this file to [esbuild's online analyzer](https://esbuild.github.io/analyze/) to visualize:

- Bundle size by dependency
- Code that could be externalized
- Minification effectiveness

### 6) Git hooks and pre-commit behavior

After `pnpm install`, repo hooks are enabled via `core.hooksPath` (see the `prepare` script in `package.json`). The pre-commit hook runs on every commit. Typical commits run **staged-related Vitest only** (`pnpm run test:staged` → `vitest related` on staged source/test files, optionally narrowed to matching Vitest projects). Unstaged WIP is ignored. Full typecheck still runs every commit; ESLint runs on staged JS/TS with `--cache` (CI still runs full-tree lint). Path-gated `typecheck:strict-shared` runs when `src/shared/` (or `tsconfig.strict.json`) is staged. Several expensive `check:*` steps and `pnpm audit` / full-feature sidecar builds are **path-gated**.

ESLint: production `src/**` enforces `no-unsafe-*`; test files keep those off. `no-unnecessary-condition` is enforced for `src/shared/**` and `src/renderer/lib/**` only.

Green pre-commit does **not** replace PR CI: [`.github/workflows/tests.yaml`](../.github/workflows/tests.yaml) always runs the full Vitest suite with coverage. Use `pnpm run check:pr` before opening a PR. Pre-push runs branch `--changed` Vitest when `origin/main` is available.

Hook order (authoritative source: [`.githooks/pre-commit`](../.githooks/pre-commit)):

1. If `package.json` or `pnpm-lock.yaml` is staged: `pnpm install --frozen-lockfile`
2. Prettier on **staged** files only (not whole-tree `pnpm run format` unless you run it manually)
3. markdownlint-cli2 on staged `.md` files only (not full `pnpm run lint:md` unless you run it manually)
4. When `package.json` or `pnpm-lock.yaml` is staged: `pnpm dedupe`, re-stage `pnpm-lock.yaml`, then re-stage the originally staged paths
5. When `src/renderer/locales/en/translation.json` is staged: `pnpm run i18n:auto-translate` (incremental vs `HEAD` English, not `--all`) and re-stage `src/renderer/locales/` — see [Internationalization](#9-internationalization-i18n)
6. ESLint on **staged** JS/TS with `--cache` (skip when none staged)
7. `pnpm run typecheck` (full tree); path-gated `typecheck:strict-shared` when `src/shared/` or `tsconfig.strict.json` staged
8. Always-on: `check:electron-security`, `check:log-injection`, `check:log-service-sinks`, `check:codeql-extensions`, `check:insecure-temp-files`, `check:console-log`, `check:silent-catches`, `check:url-hostname-sanitization`, `check:xss-patterns`, `check:protocol-string-gates`, `check:log-panel-filter`, `check:licenses`; `check:i18n` when English locale staged else `check:i18n:branch`
9. Path-gated: `check:flatpak`, `check:db-migrations`, `check:ipc-contract`, `check:reticulum-interface-modes`, `check:reticulum-decommissioned-hubs`, `check:reticulum-sidecar` (when `cargo` on `PATH` and sidecar paths staged)
10. `pnpm audit --audit-level=high` only when dependency manifests staged; `actionlint` when `.github/workflows/*` staged; `yamllint` when any `*.yaml` / `*.yml` staged
11. `pnpm run test:staged` (`scripts/precommit-tests.mjs`: staged-only `vitest related`; full suite when vitest config/setup mocks or dependency manifests change; skip when no source/test staged)

**Pre-push:** [`.githooks/pre-push`](../.githooks/pre-push) runs `vitest run --changed <merge-base-with-origin/main>` when `origin/main` exists.

**Release / CI full suite:** `pnpm run release` (`scripts/release.sh`) and PR [`tests.yaml`](../.github/workflows/tests.yaml) always run `pnpm run test:run` (full Vitest) — never `test:staged`. Release also runs the ungated `check:*` set and requires actionlint + yamllint. Use `pnpm run check:pr` for the same Vitest/lint/typecheck surface locally before a PR.

Install hook dependencies via [Helper scripts](#8-helper-scripts-auto-install-where-possible) (`setup:actionlint`, yamllint via pip/brew/apt).

Emergency bypass (temporary only):

```bash
git commit --no-verify
```

Run any skipped checks manually as soon as possible.

### 7) CI workflow tooling (optional but recommended)

Local CI has two modes:

| Mode              | Scripts                                                  | Requires                                          |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------- |
| **Container**     | `pnpm run act:ci`, `pnpm run act:tests`, …               | Docker-compatible engine + act (Podman preferred) |
| **Host / native** | `pnpm run act:ci:native`, `pnpm run act:tests:native`, … | Node/pnpm only                                    |

Container mode runs GitHub Actions jobs inside containers using a Docker-compatible engine (Podman Desktop preferred). Host mode runs the same pnpm/cargo steps directly — use this when no container engine is available or act cannot reach the daemon.

Install (container mode):

| OS      | Container engine                                                       | act                                                                           |
| ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| macOS   | [Podman Desktop](https://podman.io/) with Docker compatibility enabled | `brew install act`                                                            |
| Linux   | Podman or Docker engine                                                | [act releases](https://github.com/nektos/act/releases)                        |
| Windows | [Podman Desktop](https://podman.io/) with Docker compatibility enabled | `choco install act-cli` or [releases](https://github.com/nektos/act/releases) |

```bash
pnpm run act:pull-images # container mode only
pnpm run act:list
pnpm run act:ci    # or act:ci:native
pnpm run act:tests # or act:tests:native
```

On macOS, podman exposes a Docker-compatible socket at `/var/run/docker.sock`; pass that path to `act` via `ACT_DOCKER_SOCKET`, or let it auto-detect if Podman created the socket symlink. If you use Docker Desktop instead of Podman, its socket is typically under `~/.docker/run/docker.sock`.

macOS and Windows **installer** builds still require native `pnpm run dist:mac` / `pnpm run dist:win`. See [ci-cd.md](ci-cd.md#running-ci-locally-with-act).

- **actionlint**: required for local pre-commit if workflow files are touched.

### 8) Helper scripts (auto-install where possible)

These scripts try to install optional tooling automatically. If they fail (for example, missing `sudo`/admin rights), follow the manual steps in this doc instead.

0. Verify your environment (recommended after a fresh clone):
   - `node scripts/check-environment.mjs` (before `pnpm install`)
   - `pnpm run check:environment` (after `pnpm install`)
1. Install `actionlint` (used by the git pre-commit hook):
   - `pnpm run setup:actionlint`
   - This installs into `.githooks/bin` so the hook can find it.
2. Install `yamllint` (required by the git pre-commit hook):
   - Install manually via pip: `pip install yamllint`
   - macOS alternative: `brew install yamllint`
   - Linux alternative: `sudo apt install yamllint` (Debian/Ubuntu) or `sudo dnf install yamllint` (Fedora)
3. Install native build dependencies:
   - `pnpm run setup:build-deps`
   - Linux/macOS: attempts to install what native builds need (requires sudo where applicable).
   - Windows: prints a message to install Visual Studio Build Tools manually.
4. (Linux only) Fix serial port permissions:
   - `pnpm run setup:dialout`
   - Adds your user to the `dialout` group (requires sudo + re-login).

### 9) Internationalization (i18n)

The app uses `i18next` for localization. English is the source of truth.

- **Locale files**: `src/renderer/locales/{en,es,uk,de,zh,pt-BR,fr,it,pl,cs,ja,ru,nl,ko,tr,id}/translation.json`
- **Adding strings**:
  1. Add the new key and English value to `src/renderer/locales/en/translation.json`.
  2. Use the `t('key.name')` hook in React components.
  3. Run `pnpm run i18n:auto-translate` to machine-translate the new key into other supported languages.
  4. Run `pnpm run check:i18n` to verify all keys are valid and accounted for.
- **Removing strings**: delete the English key, then run `pnpm run i18n:prune-unused -- --write` (or remove manually from every locale).

Auto-translation uses MyMemory by default. Incremental translations (new keys only) run automatically during the git pre-commit hook. Use `pnpm run i18n:auto-translate --all` to force a full re-scan of all missing keys. Use `pnpm run check:i18n:branch` before large doc-only PRs to lint keys changed vs `HEAD` without the full unused-key pass.

### 10) Optional editor/tooling

- VS Code (or Cursor) with TypeScript + ESLint support
- Prettier editor extension (optional convenience; repository already defines formatting rules)
- React DevTools for renderer debugging

## macOS

### Install prerequisites

1. Install Git (Xcode CLT includes it):
   ```bash
   xcode-select --install
   ```
2. Install Node 22 (22.13.0+ recommended via nvm) and npm:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh -o install_nvm.sh
   
   less install_nvm.sh
   bash install_nvm.sh
   rm install_nvm.sh
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
   nvm install 22
   nvm use 22
   ```

### Build/run flow

```bash
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
pnpm install
pnpm run dev
```

### Local CI container engine

[Podman Desktop](https://podman.io/) is the preferred cross-platform Docker-compatible engine for local CI. When Docker compatibility is enabled, Podman exposes a Docker-compatible socket at `/var/run/docker.sock`; pass that path to `act` via `ACT_DOCKER_SOCKET`, or let it auto-detect if Podman Desktop created the socket symlink. If you use Docker Desktop instead, see the socket note above.

### Bluetooth permissions

On first BLE connection, macOS prompts for Bluetooth access. If denied accidentally:

- Go to **System Settings > Privacy & Security > Bluetooth**
- Enable access for Mesh-Client

### Reticulum sidecar (optional)

If you work on the Reticulum protocol tab, install Rust and build the sidecar — see [Reticulum sidecar (optional)](#reticulum-sidecar-optional) above. On macOS, **rustup is preferred** over `brew install rust` (CI parity); do not install both.

### macOS release-download note (not required for source development)

If a downloaded app reports "Mesh-client is damaged and can't be opened", see [macOS: File is damaged and cannot be opened](troubleshooting.md#macos-file-is-damaged-and-cannot-be-opened).

## Windows

### Install prerequisites

1. Install Git and Node.js (winget primary path):
   ```powershell
   winget install git.git
   winget install OpenJS.NodeJS
   ```
2. Allow npm script execution in current user scope:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
3. Install **Visual Studio Build Tools** with **Desktop development with C++** workload.
4. Install Python 3 and ensure it is on PATH:
   ```powershell
   winget install Python.Python.3.12
   ```
   If needed, set npm Python path explicitly:
   ```powershell
   npm config set python "C:\\Path\\To\\python.exe"
   ```

### Build/run flow

```powershell
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
pnpm install
pnpm run dev
```

### Windows packaging note

The Windows build (`dist:win`) uses pnpm's `node-linker=hoisted` mode to work around asar packaging issues on Windows. The build command automatically reinstalls with hoisted mode, packages, then restores the default structure.

### Serial device driver reminder

If serial ports do not appear, install the right USB UART driver (for example CH340/CH341, CP210x, or FTDI).

### Troubleshooting

See [troubleshooting.md](troubleshooting.md#windows-could-not-find-any-visual-studio-installation-to-use) (Visual Studio), [Python](troubleshooting.md#windows-could-not-find-any-python-installation-to-use), and [`dist:win` path / `EPERM`](troubleshooting.md#windows-distwin-fails-with-path-spaces-or-eperm).

## Linux

### Install prerequisites

Install Node 22 (22.13.0+ recommended), `make`, and C++ build tools (`g++`/`gcc-c++`) with native build dependencies.

Debian/Ubuntu:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
sudo apt install build-essential
sudo apt install python3 libnspr4 libnss3
```

Fedora/RedHat:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
sudo dnf install @development-tools
sudo dnf install python3 nspr nss
```

### Build/run flow

```bash
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
pnpm install
pnpm run dev
```

### Serial permissions

Add your user to `dialout`:

```bash
sudo usermod -a -G dialout $USER
```

Log out/in after changing groups.

### Linux Bluetooth (BLE)

Linux uses Web Bluetooth (Chromium's built-in BLE API) instead of `@stoprocent/noble`. This approach:

- Requires no setcap/setuid workaround scripts
- Requires the user to select a device from the in-app Bluetooth picker (backed by Chromium's chooser event)
- Requires a user gesture (button click) to trigger device selection

The app automatically enables `--enable-experimental-web-platform-features` on Linux at startup.

There is **no portable Web Bluetooth API** for the negotiated ATT MTU ([WebBluetoothCG#383](https://github.com/WebBluetoothCG/web-bluetooth/issues/383)). When Chromium exposes `maximumWriteValueLength` on the TX characteristic, the client chunks `writeValue` accordingly; otherwise it sends each payload in one call.

Pairing failures and BlueZ steps: [BLE known issues](troubleshooting.md#ble-known-issues).

### Linux launch notes

The supported dev and local run flows are:

```bash
pnpm run dev
pnpm start
```

ARM (for example Raspberry Pi) may also require:

```bash
sudo apt install zlib1g-dev libfuse2
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

### Troubleshooting

See [Linux development: SIGILL / SIGSEGV](troubleshooting.md#linux-development-sigill-during-pnpm-install) and [Linux: serial port access denied](troubleshooting.md#linux-serial-port-access-denied).
