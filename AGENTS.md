# AGENTS.md: Coding Guidelines for AI Assistants

This file holds the always-on hard rules (workflow, security, style, testing, CI, git). **Subsystem detail lives in [`docs/agents/`](docs/agents/README.md) — open the matching file when a task touches that area** (see §8). ARCHITECTURE.md and CONTRIBUTING.md are human references; read them only if you need deep subsystem detail beyond what's here.

## 1. Scope & Workflow

- Only change what was asked. No drive-by refactors, reformatting, or types/comments outside scope.
- **Credits ↔ package.json:** When adding or renaming a person under **Authors** or **Contributors** in [`docs/credits.md`](docs/credits.md), also add/update the matching entry in root `package.json` `contributors` (same order as credits). Format: `"DisplayName https://github.com/handle"` when a GitHub URL exists, otherwise the credits display name/callsign only (e.g. `"megabear - KD5IHC"`). Do **not** put Colorado Mesh org thanks, Acknowledgements projects, or dependency/binary attribution tables into `contributors`. npm license tables live in [`docs/third-party-licenses.md`](docs/third-party-licenses.md) (`pnpm run docs:licenses`); do not hand-edit them or put them in credits.
- **Testing:** Ship a passing test for behavioral changes; do not call the task done without it.
- **Stateful/I/O code:** Preserve integrity on failure; document failure point, fallback, and logging where it matters.
- **Pre-commit patience:** Pre-commit runs staged-related Vitest (`pnpm run test:staged`), staged ESLint, full typecheck, path-gated `typecheck:strict-shared` when `src/shared/` is staged, and path-gated `check:*` scripts. Typical small commits are much faster than a full suite; vitest infra still forces a full Vitest run, and a dependency bump does so only when source is staged alongside the manifests (a manifest-only commit takes the fast path in the hook order below). Be patient — do not interrupt or force-skip. **PR CI** ([`tests.yaml`](.github/workflows/tests.yaml)) runs `vitest related` against the pull request merge-base paths, skips docs-only changes, and selects every project lane for shared contracts. It fails closed to the full suite for test infrastructure, dependency manifests, deletions/renames, oversized detector output, or detector failures. `merge_group`, `main` push, and manual runs always run full Vitest with global coverage thresholds. i18n is gated via `locale-quality.test.ts` (subprocess of `check:i18n`). **`pnpm run check:pr`** (hand, before opening/updating a PR) remains the comprehensive local gate: full lint + typecheck + `typecheck:strict-shared` + `test:run` (+ full-feature sidecar check when the branch touches sidecar). **`pnpm run release`** (`scripts/release.sh`) runs full Vitest **plus ungated `check:*` scanners** (including a direct `check:i18n`). Green pre-commit ≠ green CI or release.
- **Fresh clone:** Before other setup, run `node scripts/check-environment.mjs` (works before pnpm is installed). After `pnpm install`, re-run `pnpm run check:environment`. Fix required failures using printed hints and `setup:*` scripts; optional warnings can wait. Wrong/outdated pnpm is blocked by `scripts/check-package-manager.mjs` on `preinstall` and `pnpm run dev` (prints Corepack/`npm install -g pnpm@…` steps; Node 25+ needs Corepack installed separately).

### Platform parity

- **Default:** behavioral fixes and UI lifecycle changes apply to **linux, darwin, and win32** unless there is a documented, justified OS-specific exception.
- A reporter platform (e.g. Windows) does **not** by itself narrow scope — reproduce or reason about other platforms before splitting code paths.
- **When branching on `getPlatform()` / `process.platform`:** prefer shared state machines and teardown helpers; branch only at the boundary where the OS API differs (e.g. `showEmojiPanel()` vs inline `<emoji-picker>`).
- **Document exceptions inline** with a short comment (`// OS-specific: …`) and, for non-obvious splits, a note in the PR body.
- **Tests:** cover all three platforms when behavior is shared (`it.each(['linux', 'darwin', 'win32'])`); use platform-specific cases only when the mechanism under test exists on that OS.

## 2. Architecture & Domain

Electron: `src/main/` (Node, SQLite, BLE, MQTT), `src/preload/` (bridge), `src/renderer/` (React 19, Vite, Zustand). **Multi-protocol:** Meshtastic, MeshCore, and Reticulum; gate UI with `ProtocolCapabilities` and `useRadioProvider(protocol)` (do not compare `protocol === 'meshcore'`). Routing/diagnostics changes must stay compatible with the Diagnostics panel (Hop Goblins, Hidden Terminals, etc. for LoRa; Reticulum uses `ReticulumDiagnosticEngine.ts`). **pnpm** only for package commands. **Never** add cryptocurrency tech or dependencies.

**Colors:** Use Tailwind CSS utility classes (e.g., `text-green-400`, `bg-slate-700`). Custom theme colors via CSS custom properties in `styles.css` (`--color-brand-green`, etc.). Avoid inline hex colors in JSX. **App → Appearance → Colors** lets users customize theme tokens including chat/RRC **message action** bar/button colors (`themeColors.ts`); **Show background** / **Always show message actions** control action-bar visibility.

**Code style and testing:** [Code style & standards](CONTRIBUTING.md#code-style--standards) and [Testing protocols](CONTRIBUTING.md#testing-protocols) in [CONTRIBUTING.md](CONTRIBUTING.md).

### Layout map

Path alias `@/*` → `src/*` (see `tsconfig.json`).

| Boundary     | Path                | Role                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main         | `src/main/`         | SQLite (`database.ts`, `db-compat.ts`), BLE (`noble-ble-manager.ts`), MQTT (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`), logging (`log-service.ts`, `sanitize-log-message.ts`), IPC handlers (`index.ts` plus namespaced modules in `src/main/ipc/` — Reticulum, Reticulum DB, Reticulum identity, RRC DB, TAK, GPS), window, GPS, updater |
| Preload      | `src/preload/`      | `contextBridge` exposing namespaced `electronAPI` only; never expose `ipcRenderer`                                                                                                                                                                                                                                                            |
| Renderer     | `src/renderer/`     | React 19 + Vite + Zustand: `components/`, `hooks/`, `runtime/`, `stores/`, `lib/` (includes `lib/diagnostics/`, `lib/meshcore/`, `lib/radio/`, `lib/transport/`), `workers/`                                                                                                                                                                  |
| Shared       | `src/shared/`       | IPC contracts (`electron-api.types.ts`), protocol-neutral helpers                                                                                                                                                                                                                                                                             |
| Architecture | `src/architecture/` | Vitest source-policy registry (file-local invariants; prefer over new `check-*.mjs`)                                                                                                                                                                                                                                                          |

Entry points: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`.

### Renderer: hooks vs runtime vs lib

| Layer        | Path                    | Role                                                                                                                                                                                                                                         |
| ------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **runtime/** | `src/renderer/runtime/` | Protocol side effects (`useMeshtasticRuntime`, `useMeshcoreRuntime`, `useReticulumRuntime`). Mount **once** from `App.tsx` via context providers. Large runtimes are legacy; **new** protocol logic belongs in `lib/` + thin runtime wiring. |
| **hooks/**   | `src/renderer/hooks/`   | React composition: `useProtocolFacade`, store selectors (`useMessages`, `useConnectionView`), panel action bundles, feature hooks (`useChatOutbox`). No large protocol logic.                                                                |
| **lib/**     | `src/renderer/lib/`     | Pure logic, drivers (`ConnectionDriver`), sessions, ingest, protocol types (e.g. `lib/meshcore/meshcoreHookTypes.ts`).                                                                                                                       |

**App wiring:** Prefer `useProtocolFacade(protocol)` for connection state, panel actions, nodes, and messages. Use `useProtocolConnectionActions('meshtastic' | 'meshcore' | 'reticulum')` when ConnectionPanel props differ per tab. Mount once from `App.tsx`: **`usePowerRecovery`** (sleep/wake IPC, MQTT `powerSuspend`/`powerResume`, runtime `onPowerResume` — Meshtastic ~4s after wake, MeshCore ~8s stagger, Reticulum sidecar resume, up to 30s dual-Noble BLE settle), **`useRendererHeartbeat`** (renderer pings main every 30s; `rendererHeartbeatWatchdog.ts` warns if no heartbeat within 30s after `powerMonitor` resume **while the window is visible**, and polls for a **90s visible-window stall**; sticky `rendererUnresponsiveSeen` + `getRendererLiveness()` feed support snapshot `mainLiveness`), **`useLongSessionMaintenance`** (after **4 days** main-process uptime **and only while Noble BLE is active on Meshtastic or MeshCore**, one-time restart nudge toast; sessionStorage gate — a Reticulum-only session never nudges). Do not grow monolithic runtime return objects without grouping related fields into sub-objects.

### Multi-protocol

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';
const capabilities = useRadioProvider(protocol);
```

### IPC data flow

Adding a cross-boundary feature:

1. Types in `src/shared/electron-api.types.ts`.
2. `ipcMain.handle('namespace:action', ...)` in `src/main/index.ts` — or in a namespaced module under `src/main/ipc/` (e.g. `reticulum-handlers.ts`, `reticulum-db-handlers.ts`, `reticulum-identity-handlers.ts`, `rrc-db-handlers.ts`, `tak-handlers.ts`, `gps-handlers.ts`) registered from `index.ts` when the handler set is large enough to warrant its own file.
3. Expose on `electronAPI` in `src/preload/index.ts` via `ipcRenderer.invoke`.
4. Call from renderer: `window.electronAPI...`

## 3. Security & Error Handling

- Catches must log, rethrow, or `// catch-no-log-ok <reason>`. Prefer Result types over deep nesting.
- **Logging:** `console.debug` / `warn` / `error` as appropriate; no bare `console.log`.
- **Log injection:** Call `sanitizeLogMessage()` on user-controlled strings before `appendLine()` or loggers.
- **IPC:** Namespaced channels (`db:*`, `mqtt:*`, etc.); expose only via `contextBridge` in preload; **never** expose `ipcRenderer` directly.
- **System boundaries:** Follow repo security rules for subprocess APIs, DOM/HTML sinks, and dynamic code. Validate external inputs; do not over-validate internal code.
- **CodeQL — insecure temp files (`js/insecure-temporary-file`):** Never write to a predictable path under `os.tmpdir()` / `tmpdir()`. Always `fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-…-'))` (or `fs.promises.mkdtemp`) and write **inside** that unique directory. String-only tmpdir joins for mocks (no disk write) are OK. Enforced by `pnpm run check:insecure-temp-files` (pre-commit). See `.github/codeql/README.md`.

## 4. Code Style

- **Prettier:** Semi always, single quotes, trailing commas, print width 100, tab 2, LF.
- **TypeScript:** Strict; avoid `any`; prefer `unknown` + guards; export types; prefer interfaces over type aliases.
- **Shared validation:** Reuse helpers instead of inline clamps/parsers. TCP ports → `clampTcpPort()` in `src/shared/tcpPort.ts`; time units in `src/shared/timeConstants.ts` must derive from `MS_PER_SECOND` (e.g. `MS_PER_MINUTE = 60 * MS_PER_SECOND`).
- **Domain error tags:** Do not attach ad-hoc properties to `Error` with type assertions. Use `markPairingRelatedError()` / `isPairingRelatedError()` from `src/shared/blePairingError.ts` for BLE pairing classification.
- **RF connect APIs:** Transport-specific connect args use discriminated unions in `src/renderer/lib/rfConnectionTypes.ts` (`RfConnectionTransportOpts`, `RfConnectFn`, `RfConnectAutomaticFn`). Do not pass `httpAddress` and `blePeripheralId` as unrelated optional params on a flat signature.
- **React:** Function components only; `exhaustive-deps` is errors; `?.` in JSX; every interactive control needs `aria-label`.
- **Zustand:** Module-level defaults for stable refs; prefer `useStore(s => s.field)` over broad subscriptions; avoid subscribing to whole Maps when one id suffices; for `connectionStore`, never bare `useConnectionStore()` — use a selector such as `useConnectionStore((s) => (identityId ? (s.connections[identityId] ?? null) : null))` so components re-render only when that identity's record changes; `persist` for localStorage, IPC from an effect for SQLite; extract time constants to `src/renderer/lib/timeConstants.ts`.
- **Performance:** No hot-path O(n); lazy cleanup when collections grow large.

## 5. Testing

- Renderer: jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main: node (`src/main/**/*.test.ts`, `src/architecture/**/*.test.ts`, `src/shared` / preload / scripts).
- **Source policy (Vitest registry):** file-local / small-glob invariants live in [`src/architecture/sourcePolicyRules.ts`](src/architecture/sourcePolicyRules.ts) + walker [`sourcePolicy.ts`](src/architecture/sourcePolicy.ts) — prefer adding a rule there over a new `scripts/check-*.mjs`. Suppress with `// source-policy-ok <rule-id> <reason>`. Pre-commit always appends `src/architecture/sourcePolicy.test.ts` when any TypeScript under `src/` is staged (the registry is not import-related). Keep cross-cutting always-on hygiene in existing `check:*` scanners.
- **Reticulum sidecar (Rust):** Clippy + rustfmt via `pnpm run check:reticulum-sidecar` (full-feature fmt + Clippy + test when `cargo` is on `PATH` **and** sidecar-related paths are staged) and the same feature set in `reticulum-sidecar.yaml`. Coverage threshold (`cargo llvm-cov --fail-under-lines`) is enforced only in `tests.yaml` when sidecar paths change — not in pre-commit.
- **Temp dirs in tests:** Use `mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` — never write to a fixed name under `os.tmpdir()` (CodeQL + `check:insecure-temp-files`).
- Vitest worker pool sizes and shared Vite dep inline lists live in `vitest.harness.mts` — update when adding deps that need inlining.
- Prefer `mockConsoleWarn` / `withMockedConsoleWarn` from `src/renderer/lib/vitestConsoleMock.ts` over ad-hoc `vi.spyOn(console, 'warn')` in renderer tests.
- Monolithic runtimes (`useMeshtasticRuntime`, `useMeshcoreRuntime`, `noble-ble-manager`) may use **source contract tests** (`sourceContractTestHelpers.ts`, `*.reconnect*.test.ts`) when full integration mocking is impractical — see [development-environment.md](docs/development-environment.md#vitest-projects-and-worker-allocation). Runtime contract tests that load `use*Runtime.ts` must use `loadRuntimeSource()` (enforced by source policy).
- Mock console before spying logged errors: `vi.spyOn(console, 'warn').mockImplementation(() => {})` in `beforeEach` when shared.
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.

### Accessibility / axe

- **Dev:** `@axe-core/react` runs in `pnpm run dev` (`src/renderer/main.tsx`); treat `serious` axe console output as a bug.
- **CI:** Use `vitest-axe` (`import { axe } from 'vitest-axe'`); assert `toHaveNoViolations()` on the rendered subtree.
- **Do not mock `themeColors` in component axe tests** — call `hydrateAxeThemeColors()` from `src/renderer/lib/a11yTestHelpers.ts` so color-contrast runs against real hex values (jsdom does not load Tailwind CSS). Enforced by source-policy rule `axe-tests-hydrate-theme-colors`.
- **When to add tests:** New or changed UI with custom foreground/background pairs (badges, pills, buttons)—especially `text-[10px]` / `text-xs` on saturated fills.
- **Theme tokens:** `readable-green` is for white-on-green fills; the default must pass **4.5:1** contrast with white (enforced in `src/renderer/lib/themeColors.test.ts`).
- **`animate-pulse`:** Never on the same element as small text with strict contrast fills. Use a separate `aria-hidden` decorative pulse layer; the text-bearing element stays fully opaque (see `ProtocolUnreadBadge.tsx`). Connection-status header pulses remain the documented exception.
- **Badge patterns:** Sidebar/Chat unread badges use `bg-red-600 text-white`; protocol-switcher badges use brand colors (`bg-readable-green`, `bg-cyan-600`)—add axe coverage when touching either.
- **Manual:** See [`docs/accessibility-checklist.md`](docs/accessibility-checklist.md).

## 6. Commands & CI Checks

**Key commands:** `pnpm run dev`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:run`, `pnpm run check:pr`, `pnpm run update`. Electron E2E (on demand / daily CI, not Vitest or pre-commit): `pnpm run test:e2e:build` (or `test:e2e` after `build`); workflow [`.github/workflows/e2e.yaml`](.github/workflows/e2e.yaml) (`schedule` on `main` + `workflow_dispatch`, 3-OS matrix). Reticulum sidecar: `pnpm run check:reticulum-sidecar` (full features), `pnpm run reticulum:sidecar:clippy:full`, `pnpm run reticulum:sidecar:test`.

**ESLint type-aware scopes:** production `src/**` enables `no-unsafe-*`; `*.test.ts` / `*.test.tsx` keep those off. `@typescript-eslint/no-unnecessary-condition` is error only for `src/shared/**` and `src/renderer/lib/**` (not UI components/runtimes).

**Local Linux CI (optional):** Container mode — `act:ci`, `act:tests`, `act:pr`, … (needs a Docker-compatible engine + act; Podman preferred). Host mode — `act:ci:native`, `act:tests:native`, … (no container engine). See [docs/ci-cd.md](docs/ci-cd.md). macOS/Windows packaging uses native `dist:mac` / `dist:win`. **`dist:mac`** / **`dist:mac:publish`** always run **`scripts/verify-mac-packaging.mjs`** (ZIP + DMG symlink asserts, no raw `.app` CI uploads). macOS signing env (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_IDENTITY_AUTO_DISCOVERY`) is scoped to **`macos-latest`** jobs in `release.yaml` / `build.yaml`; partial-secret validation fails the release job when `CSC_LINK` is set but notarization secrets are missing.

> **Update script sync:** When adding or removing packages from `patchedDependencies` in `pnpm-workspace.yaml`, keep `WATCH_ENTRIES` in `scripts/update.sh` in sync so the script warns on version changes to every patched dependency. When adding or removing Ratspeak overlays under `reticulum-sidecar/patches/`, keep `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` (`check_ratspeak_patches`) in sync — `pnpm run update` queries upstream PRs (rsReticulum / rsLXMF) and warns when a local overlay can be removed. It also runs `check_ratspeak_upstream` (watched **published** releases for rsLXST / lrgp-rs / Ratspeak vs `reviewed-ref` pins, plus new `ratspeak` org repos) — keep `RATSPEAK_RELEASE_WATCH_ENTRIES` / `RATSPEAK_KNOWN_ORG_REPOS` in sync when adopting libs. LXMFace is not a published-release watch: its baseline is a vendored-file commit (`file:js/lxmface.js@<sha>`) compared with the latest GitHub commit that touched that file. `scripts/clone-ratspeak-stack.sh` floats **rsReticulum** / **rsLXMF** / **rsNomad** / **rsLXST** / **lrgp-rs** to `origin/main` (override with `RS_RETICULUM_REF` / `RS_LXMF_REF` / `RS_NOMAD_REF` / `RS_LXST_REF` / `RS_LRGP_REF`); overlays must apply or the clone fails. Ratspeak release watch uses stub-kind `games-parity` to nudge Games tab review when a published release is newer than the pin (`docs/reticulum-games-parity.md`). Peer default avatars use vendored **LXMFace** (`src/renderer/lib/reticulum/lxmface.ts`). `pnpm run update` also runs `rustup update` (or Homebrew `rust` on macOS without rustup) and `cargo build` in `reticulum-sidecar/` when `cargo` is on `PATH` (full-feature build includes `nomad-core` / rsNomad).

**Pre-commit hook order:**

1. If `package.json` or `pnpm-lock.yaml` is staged: `pnpm install --frozen-lockfile`
2. Prettier on **staged** files only
3. markdownlint on **staged** `.md` files only
4. When dependency manifests staged: `pnpm dedupe`, re-stage lockfile and originally staged paths
5. When `en/translation.json` is staged: `pnpm run i18n:auto-translate` and re-stage `src/renderer/locales/`
6. ESLint on **staged** JS/TS with `--cache` (CI still runs full `pnpm run lint`); full `typecheck`; path-gated `typecheck:strict-shared` when `src/shared/` or `tsconfig.strict.json` staged
7. **Manifest-only fast path:** when the staged set contains nothing but `package.json`, `pnpm-lock.yaml`, and `org.coloradomesh.MeshClient.yml`, the repo-wide source scanners and Vitest are skipped (`pre-commit: skip … (manifest-only commit)`); `typecheck`, `check:flatpak`, `check:licenses`, and `pnpm audit` still run. A staged `package.json` also re-runs `scripts/sync-flatpak-electron.mjs` and re-stages the manifest so the vendored Electron/pnpm pins self-heal. Mixed manifest + source commits keep the full pre-commit path.
8. `check:electron-security` runs first (right after `typecheck`), then the always-on cheap `check:*` scanners; path-gated checks for flatpak / DB migrations / IPC / reticulum interface modes / decommissioned hubs / `check:pn-hosting-policy` (when `pn_hosting_policy.rs`, `pnHostingPolicy.ts`, or its scanner is staged) / `check:reticulum-sidecar` (when `cargo` on `PATH` and sidecar paths staged); `check:i18n` when English locale staged else `check:i18n:branch`; `check:licenses`
9. `pnpm audit` only when dependency manifests staged; `actionlint` / `yamllint` when workflows / YAML staged
10. `pnpm run test:staged` → `scripts/precommit-tests.mjs` (staged-only `vitest related`; full suite for vitest config/setup/deps; skip when no source/test staged or the commit is manifest-only)

Before PR: `pnpm run check:pr` (lint + typecheck + `typecheck:strict-shared` + full `test:run` + path-aware sidecar). Release pre-flight (`pnpm run release`) always uses `test:run` + full `check:*` (no path-gating / soft-skips).

## 7. Git & PR Workflow

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Remote: `Colorado-Mesh/mesh-client`. Pre-PR: refresh `README`/version metadata as needed; `gh pr create` descriptions must cover **all** commits on the branch (`git log origin/main..HEAD --oneline`), not only the last one.

## 8. Subsystem Quick Reference

Deep, file-level subsystem detail now lives in [`docs/agents/`](docs/agents/README.md) so it loads on demand instead of on every prompt. **Open the matching file when a task touches that area.**

| When working on…                                                                              | Read                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Reticulum sidecar, LXMF, propagation, Remote/rnsh/rncp, Nomad, RRC, voice, games              | [`docs/agents/reticulum.md`](docs/agents/reticulum.md)                   |
| LoRa BLE/serial, Noble reconnect, dual-radio startup, BLE coexistence                         | [`docs/agents/ble-serial.md`](docs/agents/ble-serial.md)                 |
| Renderer hooks/runtimes/stores, protocol entry points, DB, tab wiring                         | [`docs/agents/renderer-hooks.md`](docs/agents/renderer-hooks.md)         |
| Meshtastic config/admin, channel URLs, Store & Forward, remote admin, GPS                     | [`docs/agents/meshtastic.md`](docs/agents/meshtastic.md)                 |
| MQTT ingest, channel key mapping, sticky BLE suppress                                         | [`docs/agents/mqtt.md`](docs/agents/mqtt.md)                             |
| Chat panel, composer, link previews, notifications, dedup, hop badges, relay coverage, export | [`docs/agents/chat.md`](docs/agents/chat.md)                             |
| MeshCore Repeaters admin (ping/trace/neighbors/CLI/waiting drain)                             | [`docs/agents/meshcore-repeaters.md`](docs/agents/meshcore-repeaters.md) |
| MeshCore Rooms (BBS) login/post/sync/wire text                                                | [`docs/agents/meshcore-rooms.md`](docs/agents/meshcore-rooms.md)         |
| Diagnostics engines, rows, tab scoping                                                        | [`docs/agents/diagnostics.md`](docs/agents/diagnostics.md)               |
| i18n / localization workflow, auto-translate, language selector                               | [`docs/agents/i18n.md`](docs/agents/i18n.md)                             |
| Connection panel helpers (error hints, rehydrate, storage migrations)                         | [`docs/agents/connection-panel.md`](docs/agents/connection-panel.md)     |
| Symptom → where-to-check index                                                                | [`docs/agents/common-issues.md`](docs/agents/common-issues.md)           |

**Always-remember invariants** (details in the linked files):

- Gate features with `ProtocolCapabilities` / `useRadioProvider(protocol)` — never `protocol === 'meshcore'`.
- Mount protocol runtimes **once** from `App.tsx`; do not remount in children. New protocol logic goes in `lib/` + thin runtime wiring, not monolithic runtimes.
- Prefer `useProtocolFacade` and identity-scoped stores (`identityStore` / `nodeStore` / `messageStore` / `connectionStore`, keyed by `identityId`); SQLite→UI via `hydrateIdentityStoresFromDb`.
- MeshCore zero-hop Status/Telemetry/Neighbors are pubkey-framed (no contact-list gate); multi-hop ping needs a hash-segment path (≥2 bytes), never the full destination pubkey. Do not change behavior guarded by `meshcoreZeroHopRepeaterWorkingState.test.ts` without explicit user request — see [`docs/agents/meshcore-repeaters.md`](docs/agents/meshcore-repeaters.md).
- Reticulum connect = sidecar start (not `ConnectionDriver` RF); no Noble/MQTT for Reticulum's own stack (sidecar owns BLE RNode via `btleplug`); a Reticulum BLE RNode may yield Noble on macOS/Windows — see [`docs/agents/ble-serial.md`](docs/agents/ble-serial.md) and [`docs/agents/reticulum.md`](docs/agents/reticulum.md).
- Reticulum automation ownership: do **not** reimplement RNS pathfinding/announce flood in UI or sidecar; **do** own lxmd-parity LXMF client/PN loops in the sidecar; treat Auto demotion / multi-PN cascade / path-medium / DM probe as **product policy** — see [`docs/reticulum.md#ownership-rns-vs-lxmf-client-vs-mesh-client-policy`](docs/reticulum.md#ownership-rns-vs-lxmf-client-vs-mesh-client-policy).
- LoRa BLE reconnect is single-owner via `rfReconnectController`; manual disconnect must not auto-reconnect. Dual-radio Noble startup is serialized from `App.tsx` `useLayoutEffect` — see [`docs/agents/ble-serial.md`](docs/agents/ble-serial.md).

## 9. Cursor / Claude indexing

Optional local ignore files (e.g. `.cursorignore`, `.geminiignore`, `.claudeignore` — all listed in `.gitignore`, and any given one may not exist in a working tree) exclude noisy paths when present (build output, dependencies, Cursor debug logs under `.cursor/`). Ignored paths may still be read when you open the file, paste an excerpt, or reference an explicit path in chat.

## 10. Context Management

- **Read/Glob Hygiene:** When reading files larger than 100 lines or performing wide directory globs, provide a concise summary of findings.
- **Cold Storage Transition:** After 10 turns, if a previously read file is not the current focus, refer to it by summary or path; do not re-read unless a specific logic change is required.
