# AGENTS.md: Coding Guidelines for AI Assistants

This file holds the always-on hard rules (workflow, security, style, testing, CI, git). **Subsystem detail lives in the developer docs ([`docs/development/`](docs/development/index.md) plus the top-level guides linked in §8) — open the matching file when a task touches that area** (see §8). ARCHITECTURE.md and CONTRIBUTING.md are human references; read them only if you need deep subsystem detail beyond what's here.

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

Electron: `src/main/` (Node, SQLite, BLE, MQTT), `src/preload/` (bridge), `src/renderer/` (React 19, Vite, Zustand). **Multi-protocol:** Meshtastic and MeshCore; gate UI with `ProtocolCapabilities` and `useRadioProvider(protocol)` (do not compare `protocol === 'meshcore'`). Routing/diagnostics changes must stay compatible with the Diagnostics panel (Hop Goblins, Hidden Terminals, etc.). **pnpm** only for package commands. **Never** add cryptocurrency tech or dependencies.

**Colors:** Use Tailwind CSS utility classes (e.g., `text-green-400`, `bg-ink-800`). Neutrals are the **ink** charcoal scale (Mesh Hub palette: off-black `#1B1B1B`, dark charcoal `#292929`, grey `#808080`, white) (`--color-ink-*` in `styles.css`; `slate-*` / `zinc-*` / `gray-*` are rejected by source-policy `renderer-ink-neutrals`); protocol identity scales are Meshtastic emerald and MeshCore cyan (`lib/protocolTheme.ts`); status is success green, warning orange, error red, info indigo. Custom theme colors via CSS custom properties in `styles.css` (`--color-brand-green`, etc.). Avoid inline hex colors in JSX. **App → Appearance → Colors** lets users customize theme tokens including chat **message action** bar/button colors (`themeColors.ts`); **Show background** / **Always show message actions** control action-bar visibility. Shell layout, navigation, tokens, controls and UI copy rules: [`docs/style-guide.md`](docs/style-guide.md).

**Code style and testing:** [Code style & standards](CONTRIBUTING.md#code-style--standards) and [Testing protocols](CONTRIBUTING.md#testing-protocols) in [CONTRIBUTING.md](CONTRIBUTING.md).

### Layout map

Path alias `@/*` → `src/*` (see `tsconfig.json`).

| Boundary     | Path                | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main         | `src/main/`         | SQLite (`database.ts`, `db-compat.ts`), BLE (`ble-sidecar-manager.ts` + `gatt-sidecar-proxy.ts` + coexistence), MQTT (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`), logging (`log-service.ts`, `sanitize-log-message.ts`, `mecp-received-log.ts`), offline maps (`offline-maps/` + `ipc/offline-maps-handlers.ts`), IPC handlers (`index.ts` plus namespaced modules in `src/main/ipc/` — TAK, GPS, offline maps, GATT pairing, …), window, GPS, updater |
| Preload      | `src/preload/`      | `contextBridge` exposing namespaced `electronAPI` only; never expose `ipcRenderer`                                                                                                                                                                                                                                                                                                                                                                         |
| Renderer     | `src/renderer/`     | React 19 + Vite + Zustand: `components/`, `hooks/`, `runtime/`, `stores/`, `lib/` (includes `lib/diagnostics/`, `lib/meshcore/`, `lib/radio/`, `lib/transport/`), `workers/`                                                                                                                                                                                                                                                                               |
| Shared       | `src/shared/`       | IPC contracts (`electron-api.types.ts`), protocol-neutral helpers                                                                                                                                                                                                                                                                                                                                                                                          |
| Architecture | `src/architecture/` | Vitest source-policy registry (file-local invariants; prefer over new `check-*.mjs`)                                                                                                                                                                                                                                                                                                                                                                       |

Entry points: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`.

### Renderer: hooks vs runtime vs lib

| Layer        | Path                    | Role                                                                                                                                                                                                                  |
| ------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **runtime/** | `src/renderer/runtime/` | Protocol side effects (`useMeshtasticRuntime`, `useMeshcoreRuntime`). Mount **once** from `App.tsx` via context providers. Large runtimes are legacy; **new** protocol logic belongs in `lib/` + thin runtime wiring. |
| **hooks/**   | `src/renderer/hooks/`   | React composition: `useProtocolFacade`, store selectors (`useMessages`, `useConnectionView`), panel action bundles, feature hooks (`useChatOutbox`). No large protocol logic.                                         |
| **lib/**     | `src/renderer/lib/`     | Pure logic, drivers (`ConnectionDriver`), sessions, ingest, protocol types (e.g. `lib/meshcore/meshcoreHookTypes.ts`).                                                                                                |

**App wiring:** The **active tab** reads connection, `connectionView`, queue, and panel from `useProtocolFacade(protocol)` (`activeFacade.connection` / `.connectionView` / `.queue` / `.panel`). App mounts **one** `<ConnectionPanel>` from `activeFacade.connection` plus capability-gated extras (firmware check, MeshCore MQTT identity). By-protocol maps (`uiMessagesByProtocol`, `uiNodesByProtocol`, `connectionViewByProtocol`, `panelActionsByProtocol`, …) stay for inactive-protocol notifier, detail modal when protocol differs, dual-protocol security labels, and other cross-protocol picks. Build per-protocol connection actions once with `useAllProtocolConnectionActions` (pass that map into the facade like `allPanelActions`); `ProtocolAutoConnectCoordinator` reads map entries. Chat/nodes still use display adapters (`uiMessagesByProtocol` / `nodesForUi`), not raw `activeFacade.messages` / `.nodes`. Mount once from `App.tsx`: **`usePowerRecovery`** (sleep/wake IPC, MQTT `powerSuspend`/`powerResume`, runtime `onPowerResume` — Meshtastic ~4s after wake, MeshCore ~8s stagger, up to 30s dual-radio BLE settle when both use BLE), **`useRendererHeartbeat`** (renderer pings main every 30s; `rendererHeartbeatWatchdog.ts` warns if no heartbeat within 30s after `powerMonitor` resume **while the window is visible**, and polls for a **90s visible-window stall**; sticky `rendererUnresponsiveSeen` + `getRendererLiveness()` feed support snapshot `mainLiveness`). Do not grow monolithic runtime return objects without grouping related fields into sub-objects.

### Multi-protocol

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';
const capabilities = useRadioProvider(protocol);
```

### IPC data flow

Adding a cross-boundary feature:

1. Types in `src/shared/electron-api.types.ts`.
2. `ipcMain.handle('namespace:action', ...)` in `src/main/index.ts` — or in a namespaced module under `src/main/ipc/` (e.g. `tak-handlers.ts`, `gps-handlers.ts`, `offline-maps-handlers.ts`) registered from `index.ts` when the handler set is large enough to warrant its own file.
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
- **Bluetooth helper (Rust, `ble-sidecar/`):** Clippy + rustfmt via `pnpm run check:ble-sidecar` (fmt + Clippy + test when `cargo` is on `PATH` **and** sidecar-related paths are staged) and the same checks in `ble-sidecar.yaml`. Coverage threshold (`cargo llvm-cov --fail-under-lines`) is enforced only in `tests.yaml` when sidecar paths change — not in pre-commit.
- **Temp dirs in tests:** Use `mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` — never write to a fixed name under `os.tmpdir()` (CodeQL + `check:insecure-temp-files`).
- Vitest worker pool sizes and shared Vite dep inline lists live in `vitest.harness.mts` — update when adding deps that need inlining.
- Prefer `mockConsoleWarn` / `withMockedConsoleWarn` from `src/renderer/lib/vitestConsoleMock.ts` over ad-hoc `vi.spyOn(console, 'warn')` in renderer tests.
- Monolithic runtimes (`useMeshtasticRuntime`, `useMeshcoreRuntime`, `gatt-sidecar-proxy`) may use **source contract tests** (`sourceContractTestHelpers.ts`, `*.reconnect*.test.ts`) when full integration mocking is impractical — see [development-environment.md](docs/development-environment.md#vitest-projects-and-worker-allocation). Runtime contract tests that load `use*Runtime.ts` must use `loadRuntimeSource()` (enforced by source policy).
- Mock console before spying logged errors: `vi.spyOn(console, 'warn').mockImplementation(() => {})` in `beforeEach` when shared.
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.

### Accessibility / axe

- **Dev:** `@axe-core/react` runs in `pnpm run dev` (`src/renderer/main.tsx`); treat `serious` axe console output as a bug.
- **CI:** Use `vitest-axe` (`import { axe } from 'vitest-axe'`); assert `toHaveNoViolations()` on the rendered subtree.
- **Do not mock `themeColors` in component axe tests** — call `hydrateAxeThemeColors()` from `src/renderer/lib/a11yTestHelpers.ts` so color-contrast runs against real hex values (jsdom does not load Tailwind CSS). Enforced by source-policy rule `axe-tests-hydrate-theme-colors`.
- **When to add tests:** New or changed UI with custom foreground/background pairs (badges, pills, buttons)—especially `text-2xs` / `text-xs` on saturated fills. Font sizes are rem tokens (`text-2xs` … `text-title` in `styles.css`), never `text-[Npx]`, so **App → Appearance → Text size** scales them (source-policy `renderer-font-size-in-rem`).
- **Theme tokens:** one accent (default Mesh Hub Signature Orange `#ffa31a`, `DEFAULT_THEME_COLORS.brandGreen` in `themeColors.ts`; the Meshtastic / MeshCore presets swap it). Primary fills (buttons, Send, switches, progress) are `bg-brand-green` with **`text-app-bg`** (dark text, about 13:1), and accent text uses `text-bright-green`; never `text-white` on the accent, and never `text-readable-green` on dark surfaces. Success / online status uses Tailwind green (`text-green-400`, `bg-green-500`), not the accent. `themeColors.ts` resets a brand-green override below 4.5:1 against `appBg`. `readable-green` (default dark orange `#b35f00`) is for white-text fills; its default must pass **4.5:1** with white (both enforced in `src/renderer/lib/themeColors.test.ts`). Text sizes: readable text is 12px or larger (`text-label` and up); `text-2xs` / `text-3xs` are for badge and count-pill text only. Radius comes from the `rounded-badge|control|card|modal|container` tokens, and shadows from `--shadow-level-1` through `--shadow-level-4`, in `styles.css` (`styleTokens.test.ts` asserts `--shadow-sm`, `--shadow-md`, and `--shadow-lg` are absent).
- **`animate-pulse`:** Never on the same element as small text with strict contrast fills. Use a separate `aria-hidden` decorative pulse layer; the text-bearing element stays fully opaque (see `ProtocolUnreadBadge.tsx`). Connection-status header pulses remain the documented exception.
- **Badge patterns:** Rail, section-tab and launcher unread badges use `bg-red-600 text-white`; protocol-switcher badges use each protocol's 700 step (`bg-meshtastic-700`, `bg-meshcore-700`, white text)—add axe coverage when touching either.
- **Manual:** See [`docs/accessibility-checklist.md`](docs/accessibility-checklist.md).

## 6. Commands & CI Checks

**Key commands:** `pnpm run dev`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:run`, `pnpm run check:pr`, `pnpm run update`. Electron E2E (on demand / daily CI, not Vitest or pre-commit): `pnpm run test:e2e:build` (or `test:e2e` after `build`); workflow [`.github/workflows/e2e.yaml`](.github/workflows/e2e.yaml) (`schedule` on `main` + `workflow_dispatch`, 3-OS matrix). Bluetooth helper: `pnpm run check:ble-sidecar`.

**ESLint type-aware scopes:** production `src/**` enables `no-unsafe-*`; `*.test.ts` / `*.test.tsx` keep those off. `@typescript-eslint/no-unnecessary-condition` is error only for `src/shared/**` and `src/renderer/lib/**` (not UI components/runtimes).

**Local Linux CI (optional):** Container mode — `act:ci`, `act:tests`, `act:pr`, … (needs a Docker-compatible engine + act; Podman preferred). Host mode — `act:ci:native`, `act:tests:native`, … (no container engine). See [docs/ci-cd.md](docs/ci-cd.md). macOS/Windows packaging uses native `dist:mac` / `dist:win`. **`dist:mac`** / **`dist:mac:publish`** always run **`scripts/verify-mac-packaging.mjs`** (ZIP + DMG symlink asserts, no raw `.app` CI uploads). macOS signing env (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_IDENTITY_AUTO_DISCOVERY`) is scoped to **`macos-latest`** jobs in `release.yaml` / `build.yaml`; partial-secret validation fails the release job when `CSC_LINK` is set but notarization secrets are missing.

> **Update script sync:** When adding or removing packages from `patchedDependencies` in `pnpm-workspace.yaml`, keep `WATCH_ENTRIES` in `scripts/update.sh` in sync so the script warns on version changes to every patched dependency. Vendored **MECP** ([xiang-dev-1/MECP](https://github.com/xiang-dev-1/MECP)) is watched via `MECP_UPSTREAM_WATCH_ENTRIES` / `check_mecp_upstream` and `MECP_PR_WATCH_ENTRIES` / `check_mecp_prs`. `pnpm run update` also runs `rustup update` and `cargo build` in `ble-sidecar/` when `cargo` is on `PATH`.

**Pre-commit hook order:**

1. If `package.json` or `pnpm-lock.yaml` is staged: `pnpm install --frozen-lockfile`
2. Prettier on **staged** files only
3. markdownlint on **staged** `.md` files only
4. When dependency manifests staged: `pnpm dedupe`, re-stage lockfile and originally staged paths
5. When `en/translation.json` is staged: `pnpm run i18n:auto-translate` and re-stage `src/renderer/locales/`
6. ESLint on **staged** JS/TS with `--cache` (CI still runs full `pnpm run lint`); full `typecheck`; path-gated `typecheck:strict-shared` when `src/shared/` or `tsconfig.strict.json` staged
7. **Manifest-only fast path:** when the staged set contains nothing but `package.json`, `pnpm-lock.yaml`, `io.github.charlottemeshtastic.MeshHub.yml`, and `flatpak/io.github.charlottemeshtastic.MeshHub.metainfo.xml` (the `pnpm run release` version commit), the repo-wide source scanners and Vitest are skipped (`pre-commit: skip … (manifest-only commit)`); `typecheck`, `check:flatpak`, `check:licenses`, and `pnpm audit` still run. A staged `package.json` also re-runs `scripts/sync-flatpak-electron.mjs` and re-stages the manifest so the vendored Electron/pnpm pins self-heal. Mixed manifest + source commits keep the full pre-commit path.
8. `check:electron-security` runs first (right after `typecheck`), then the always-on cheap `check:*` scanners; path-gated checks for flatpak / DB migrations / IPC / `check:ble-sidecar` (when `cargo` on `PATH` and sidecar paths staged); `check:i18n` when English locale staged else `check:i18n:branch`; `check:licenses`
9. `pnpm audit` only when dependency manifests staged; `actionlint` / `yamllint` when workflows / YAML staged
10. `pnpm run test:staged` → `scripts/precommit-tests.mjs` (staged-only `vitest related`; full suite for vitest config/setup/deps; skip when no source/test staged or the commit is manifest-only)

Before PR: `pnpm run check:pr` (lint + typecheck + `typecheck:strict-shared` + full `test:run` + path-aware sidecar). Release pre-flight (`pnpm run release`) always uses `test:run` + full `check:*` (no path-gating / soft-skips).

## 7. Git & PR Workflow

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Remote: `charlottemeshtastic/mesh-client` (fork of `Colorado-Mesh/mesh-client`). Pre-PR: refresh `README`/version metadata as needed; `gh pr create` descriptions must cover **all** commits on the branch (`git log origin/main..HEAD --oneline`), not only the last one.

## 8. Subsystem Quick Reference

Deep, file-level subsystem detail lives in the developer docs ([`docs/development/`](docs/development/index.md) and the top-level guides below), shared by human contributors and agents, so it loads on demand instead of on every prompt. **Open the matching file when a task touches that area.**

| When working on…                                                                              | Read                                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| LoRa BLE/serial, sidecar GATT reconnect, dual-radio wake stagger, BLE coexistence             | [`docs/development/ble-serial.md`](docs/development/ble-serial.md)                             |
| Renderer hooks/runtimes/stores, protocol entry points, DB, tab wiring                         | [`docs/development/renderer-hooks.md`](docs/development/renderer-hooks.md)                     |
| Meshtastic config/admin, channel URLs, Store & Forward, remote admin, GPS                     | [`docs/development/meshtastic.md`](docs/development/meshtastic.md)                             |
| MQTT ingest, channel key mapping, sticky BLE suppress                                         | [`docs/development/mqtt.md`](docs/development/mqtt.md)                                         |
| Chat panel, composer, link previews, notifications, dedup, hop badges, relay coverage, export | [`docs/development/chat.md`](docs/development/chat.md)                                         |
| MeshCore Repeaters admin (ping/trace/neighbors/CLI/waiting drain)                             | [`docs/development/meshcore-repeaters.md`](docs/development/meshcore-repeaters.md)             |
| MeshCore Rooms (BBS) login/post/sync/wire text                                                | [`docs/development/meshcore-rooms.md`](docs/development/meshcore-rooms.md)                     |
| Diagnostics engines, rows, tab scoping                                                        | [`docs/diagnostics.md#17-key-source-files`](docs/diagnostics.md#17-key-source-files)           |
| i18n / localization workflow, auto-translate, language selector                               | [`docs/localization.md#maintainer-workflow`](docs/localization.md#maintainer-workflow)         |
| Connection panel helpers (error hints, rehydrate, storage migrations)                         | [`docs/development/connection-panel.md`](docs/development/connection-panel.md)                 |
| MECP emergency reports, siren, audit log, ALERT_APP, RF rebroadcast                           | [`docs/development/mecp.md`](docs/development/mecp.md)                                         |
| EMCOMM Incident Command, emergency outbox, ACK/beacon, ops alerts, SAR/export                 | [`docs/development/emcomm.md`](docs/development/emcomm.md)                                     |
| Offline maps (`mesh-tiles:`), tile cache, region download                                     | [`docs/development/offline-maps.md`](docs/development/offline-maps.md)                         |
| Weather forecast map (parsed chat forecasts drawn on the Map)                                 | `src/renderer/components/WeatherForecastLayer.tsx`                                             |
| App shell (rail, section tabs, status bar, launcher), UI tokens, controls, copy rules         | [`docs/style-guide.md`](docs/style-guide.md)                                                   |
| Launcher settings search: adding a searchable setting, anchors, registry, guards              | [`docs/development/settings-search.md`](docs/development/settings-search.md)                   |
| Developer service announcements feed, strip, pre-commit warning                               | [`docs/service-announcements.md#implementation`](docs/service-announcements.md#implementation) |
| Symptom → where-to-check index                                                                | [`docs/development/common-issues.md`](docs/development/common-issues.md)                       |
| Where to look first by area (diagnostics, protocols, lifecycle, DB, BLE, MQTT, Rooms, UI)     | [`docs/development/architecture-quick-ref.md`](docs/development/architecture-quick-ref.md)     |
| Published docs site (mkdocs nav, landing/install pages, in-app doc links)                     | `mkdocs.yml`, `src/shared/docsSite.ts`                                                         |

**Always-remember invariants** (details in the linked files):

- Gate features with `ProtocolCapabilities` / `useRadioProvider(protocol)` — never `protocol === 'meshcore'`.
- Mount protocol runtimes **once** from `App.tsx`; do not remount in children. New protocol logic goes in `lib/` + thin runtime wiring, not monolithic runtimes.
- Prefer `useProtocolFacade` and identity-scoped stores (`identityStore` / `nodeStore` / `messageStore` / `connectionStore`, keyed by `identityId`); SQLite→UI via `hydrateIdentityStoresFromDb`.
- MeshCore zero-hop Status/Telemetry/Neighbors are pubkey-framed (no contact-list gate); multi-hop ping needs a hash-segment path (≥2 bytes), never the full destination pubkey. Do not change behavior guarded by `meshcoreZeroHopRepeaterWorkingState.test.ts` without explicit user request — see [`docs/development/meshcore-repeaters.md`](docs/development/meshcore-repeaters.md).
- LoRa BLE runs through the bundled Rust Bluetooth helper (`ble-sidecar/`, binary `mesh-hub-ble`, btleplug GATT) managed by `src/main/ble-sidecar-manager.ts` — see [`docs/development/ble-serial.md`](docs/development/ble-serial.md).
- LoRa BLE reconnect is single-owner via `rfReconnectController`; manual disconnect must not auto-reconnect. Dual-radio BLE wake/startup stagger is wired from `App.tsx` `useLayoutEffect` — see [`docs/development/ble-serial.md`](docs/development/ble-serial.md).

## 9. Cursor / Claude indexing

Optional local ignore files (e.g. `.cursorignore`, `.geminiignore`, `.claudeignore` — all listed in `.gitignore`, and any given one may not exist in a working tree) exclude noisy paths when present (build output, dependencies, Cursor debug logs under `.cursor/`). Ignored paths may still be read when you open the file, paste an excerpt, or reference an explicit path in chat.

## 10. Context Management

- **Read/Glob Hygiene:** When reading files larger than 100 lines or performing wide directory globs, provide a concise summary of findings.
- **Cold Storage Transition:** After 10 turns, if a previously read file is not the current focus, refer to it by summary or path; do not re-read unless a specific logic change is required.
