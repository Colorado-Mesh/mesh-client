# AGENTS.md: Coding Guidelines for AI Assistants

This file is self-contained. ARCHITECTURE.md and CONTRIBUTING.md are human references; read them only if you need deep subsystem detail beyond what's here.

## 1. Scope & Workflow

- Only change what was asked. No drive-by refactors, reformatting, or types/comments outside scope.
- **Testing:** Ship a passing test for behavioral changes; do not call the task done without it.
- **Stateful/I/O code:** Preserve integrity on failure; document failure point, fallback, and logging where it matters.
- **Pre-commit patience:** This repo has a very long pre-commit hook chain (lint, typecheck, thousands of tests, audit, actionlint, yamllint, many check:\* scripts). Commits can take 2+ minutes. Be patient and let them finish — do not interrupt or force-skip hooks.

### Platform parity

- **Default:** behavioral fixes and UI lifecycle changes apply to **linux, darwin, and win32** unless there is a documented, justified OS-specific exception.
- A reporter platform (e.g. Windows) does **not** by itself narrow scope — reproduce or reason about other platforms before splitting code paths.
- **When branching on `getPlatform()` / `process.platform`:** prefer shared state machines and teardown helpers; branch only at the boundary where the OS API differs (e.g. `showEmojiPanel()` vs inline `<emoji-picker>`).
- **Document exceptions inline** with a short comment (`// OS-specific: …`) and, for non-obvious splits, a note in the PR body.
- **Tests:** cover all three platforms when behavior is shared (`it.each(['linux', 'darwin', 'win32'])`); use platform-specific cases only when the mechanism under test exists on that OS.

## 2. Architecture & Domain

Electron: `src/main/` (Node, SQLite, BLE, MQTT), `src/preload/` (bridge), `src/renderer/` (React 19, Vite, Zustand). **Dual-protocol:** meshtastic and meshcore; gate UI with `ProtocolCapabilities` and `useRadioProvider(protocol)` (do not compare `protocol === 'meshcore'`). Routing/diagnostics changes must stay compatible with the Diagnostics panel (Hop Goblins, Hidden Terminals, etc.). **pnpm** only for package commands. **Never** add cryptocurrency tech or dependencies.

**Colors:** Use Tailwind CSS utility classes (e.g., `text-green-400`, `bg-slate-700`). Custom theme colors via CSS custom properties in `styles.css` (`--color-brand-green`, etc.). Avoid inline hex colors in JSX.

**Code style and testing:** [Code style & standards](CONTRIBUTING.md#code-style--standards) and [Testing protocols](CONTRIBUTING.md#testing-protocols) in [CONTRIBUTING.md](CONTRIBUTING.md).

### Layout map

Path alias `@/*` → `src/*` (see `tsconfig.json`).

| Boundary | Path            | Role                                                                                                                                                                                                                  |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main/`     | SQLite (`database.ts`, `db-compat.ts`), BLE (`noble-ble-manager.ts`), MQTT (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`), logging (`log-service.ts`, `sanitize-log-message.ts`), IPC handlers, window, GPS, updater |
| Preload  | `src/preload/`  | `contextBridge` exposing namespaced `electronAPI` only; never expose `ipcRenderer`                                                                                                                                    |
| Renderer | `src/renderer/` | React 19 + Vite + Zustand: `components/`, `hooks/`, `runtime/`, `stores/`, `lib/` (includes `lib/diagnostics/`, `lib/meshcore/`, `lib/radio/`, `lib/transport/`), `workers/`                                          |
| Shared   | `src/shared/`   | IPC contracts (`electron-api.types.ts`), protocol-neutral helpers                                                                                                                                                     |

Entry points: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`.

### Renderer: hooks vs runtime vs lib

| Layer        | Path                    | Role                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **runtime/** | `src/renderer/runtime/` | Protocol side effects (`useMeshtasticRuntime`, `useMeshcoreRuntime`). Mount **once** from `App.tsx` via context providers; do not remount in child components or hooks. Large runtimes are legacy; **new** protocol logic belongs in `lib/` + thin runtime wiring — do not grow monolithic return objects without grouping related fields into sub-objects when extending the public API. |
| **hooks/**   | `src/renderer/hooks/`   | React composition: `useProtocolFacade`, store selectors (`useMessages`, `useConnectionView`), panel action bundles, feature hooks (`useChatOutbox`). No large protocol logic.                                                                                                                                                                                                             |
| **lib/**     | `src/renderer/lib/`     | Pure logic, drivers (`ConnectionDriver`), sessions, ingest, protocol types (e.g. `lib/meshcore/meshcoreHookTypes.ts`).                                                                                                                                                                                                                                                                    |

**App wiring:** Prefer `useProtocolFacade(protocol)` for connection state, panel actions, nodes, and messages. Use per-protocol `useProtocolConnectionActions('meshtastic' \| 'meshcore')` only when both protocol tabs need separate ConnectionPanel props. **`usePowerRecovery`** mounts once from `App.tsx` — coordinates sleep/wake IPC, MQTT `powerSuspend`/`powerResume`, and runtime `onPowerResume` (Meshtastic ~4s after wake, MeshCore ~8s stagger after Meshtastic, plus up to 30s dual-Noble BLE settle when both protocols use BLE).

### Dual protocol

Both stacks can run simultaneously. Feature-gate with `ProtocolCapabilities`:

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';
const capabilities = useRadioProvider(protocol);
```

### IPC data flow

Adding a cross-boundary feature:

1. Types in `src/shared/electron-api.types.ts`.
2. `ipcMain.handle('namespace:action', ...)` in `src/main/index.ts`.
3. Expose on `electronAPI` in `src/preload/index.ts` via `ipcRenderer.invoke`.
4. Call from renderer: `window.electronAPI...`

## 3. Security & Error Handling

- Catches must log, rethrow, or `// catch-no-log-ok <reason>`. Prefer Result types over deep nesting.
- **Logging:** `console.debug` / `warn` / `error` as appropriate; no bare `console.log`.
- **Log injection:** Call `sanitizeLogMessage()` on user-controlled strings before `appendLine()` or loggers.
- **IPC:** Namespaced channels (`db:*`, `mqtt:*`, etc.); expose only via `contextBridge` in preload; **never** expose `ipcRenderer` directly.
- **System boundaries:** Follow repo security rules for subprocess APIs, DOM/HTML sinks, and dynamic code. Validate external inputs; do not over-validate internal code.

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

- Renderer: jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main: node (`src/main/**/*.test.ts`).
- Vitest worker pool sizes and shared Vite dep inline lists live in `vitest.harness.ts` — update when adding deps that need inlining.
- Prefer `mockConsoleWarn` / `withMockedConsoleWarn` from `src/renderer/lib/vitestConsoleMock.ts` over ad-hoc `vi.spyOn(console, 'warn')` in renderer tests.
- Monolithic runtimes (`useMeshtasticRuntime`, `useMeshcoreRuntime`, `noble-ble-manager`) may use **source contract tests** (`sourceContractTestHelpers.ts`, `*.reconnect*.test.ts`) when full integration mocking is impractical — see [development-environment.md](docs/development-environment.md#vitest-projects-and-worker-allocation).
- Mock console before spying logged errors: `vi.spyOn(console, 'warn').mockImplementation(() => {})` in `beforeEach` when shared.
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.

### Accessibility / axe

- **Dev:** `@axe-core/react` runs in `pnpm run dev` (`src/renderer/main.tsx`); treat `serious` axe console output as a bug.
- **CI:** Use `vitest-axe` (`import { axe } from 'vitest-axe'`); assert `toHaveNoViolations()` on the rendered subtree.
- **Do not mock `themeColors` in component axe tests** — call `hydrateAxeThemeColors()` from `src/renderer/lib/a11yTestHelpers.ts` so color-contrast runs against real hex values (jsdom does not load Tailwind CSS).
- **When to add tests:** New or changed UI with custom foreground/background pairs (badges, pills, buttons)—especially `text-[10px]` / `text-xs` on saturated fills.
- **Theme tokens:** `readable-green` is for white-on-green fills; the default must pass **4.5:1** contrast with white (enforced in `src/renderer/lib/themeColors.test.ts`).
- **`animate-pulse`:** Never on the same element as small text with strict contrast fills. Use a separate `aria-hidden` decorative pulse layer; the text-bearing element stays fully opaque (see `ProtocolUnreadBadge.tsx`). Connection-status header pulses remain the documented exception.
- **Badge patterns:** Sidebar/Chat unread badges use `bg-red-600 text-white`; protocol-switcher badges use brand colors (`bg-readable-green`, `bg-cyan-600`)—add axe coverage when touching either.
- **Manual:** See [`docs/accessibility-checklist.md`](docs/accessibility-checklist.md).

## 6. Commands & CI Checks

**Key commands:** `pnpm run dev`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:run`, `pnpm run update`.

> **Update script sync:** When adding or removing packages from `patchedDependencies` in `package.json:205-213`, keep `WATCH_ENTRIES` in `scripts/update.sh:59-69` in sync so the script warns on version changes to every patched dependency. `pnpm run update` also runs `rustup update` (or Homebrew `rust` on macOS without rustup) and `cargo build` in `reticulum-sidecar/` when `cargo` is on `PATH`.

**Pre-commit hook order:**

1. `pnpm run format`: Prettier writes fixes
2. `pnpm run lint:md`: Markdown fixes
3. Re-stage staged files
4. `pnpm run i18n:auto-translate`: fills missing translation keys; re-stages `src/renderer/locales/`
5. `pnpm run lint`
6. `pnpm run typecheck`
7. `check:electron-security`, `check:flatpak`, `check:log-injection`, `check:log-service-sinks`, `check:codeql-extensions`, `check:db-migrations`, `check:ipc-contract`, `check:console-log`, `check:silent-catches`, `check:url-hostname-sanitization`, `check:xss-patterns`, `check:protocol-string-gates`, `check:log-panel-filter`, `check:i18n`, `check:licenses`
8. `pnpm audit --audit-level=high`
9. `actionlint`, `yamllint`
10. `pnpm run test:run`

Before PR: `pnpm run lint`, `typecheck`, `test:run`, plus any relevant `check:*`.

## 7. Git & PR Workflow

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Remote: `Colorado-Mesh/mesh-client`. Pre-PR: refresh `README`/version metadata as needed; `gh pr create` descriptions must cover **all** commits on the branch (`git log origin/main..HEAD --oneline`), not only the last one.

## 8. Subsystem Quick Reference

### Reticulum

- **Sidecar:** `reticulum-sidecar/` (AGPL Rust binary `mesh-client-reticulum`); dev: `pnpm run reticulum:sidecar:dev`
- **IPC:** `reticulum:*` main handlers (`proxyGet` / `proxyPost` / `proxyPut` / `proxyDelete`, config file read/import dialog); renderer uses `electronAPI.reticulum` proxy (no direct localhost from sandbox)
- **Panels:** `ReticulumStackPanel` (Connection — stack lifecycle), `ReticulumRadioPanel` (Radio — identity, interfaces, stack/announce settings, propagation, config import), `ReticulumAdminPanel` (Admin — RNode flasher, factory reset), `ReticulumPeerListPanel` (Peers), `NomadNetworkPanel` (Nomad Network)
- **Runtime:** `useReticulumRuntime`, `reticulumSession.ts`, `reticulumIngest.ts`; connect starts sidecar, not `ConnectionDriver` RF
- **Diagnostics:** `ReticulumDiagnosticEngine.ts` (Reticulum-native rows; no LoRa hop-goblin semantics)
- **No Noble/MQTT** for Reticulum tab; gate UI with `hasReticulumInterfaceConfig` / `hasReticulumNetworkPanel` / `ProtocolCapabilities`
- **Multi-protocol BLE:** Meshtastic, MeshCore, and Reticulum (BLE Peer + `ble://` RNode) may connect to **different** BLE devices at once on all platforms. Coexistence: `ble-coexistence-coordinator.ts` (peripheral MAC registry + scan-only mutex); Linux mesh uses Web Bluetooth + sidecar `btleplug`. Same MAC rejected; scans serialized—never disconnect unrelated GATT for scans.
- **Docs:** [docs/reticulum.md](docs/reticulum.md), [docs/reticulum-sidecar-ipc.md](docs/reticulum-sidecar-ipc.md)

### Diagnostics

- **Engines:** `src/renderer/lib/diagnostics/`; `RoutingDiagnosticEngine.ts`, `RFDiagnosticEngine.ts`, `RemediationEngine.ts`.
- **Store:** `src/renderer/stores/diagnosticsStore.ts`; routing/RF rows, foreign LoRa, MQTT ignore, redundancy.
- **Extend:** adjust `DiagnosticRow` in `src/renderer/lib/types.ts`, add detector, wire `replaceRoutingRowsFromMap` / `replaceRfRowsForNode`; TTL defaults in `diagnosticRows.ts` (routing 24h, RF 1h).
- **Full reference:** [docs/diagnostics.md](docs/diagnostics.md).

### Renderer hook architecture (dual protocol)

See **Renderer: hooks vs runtime vs lib** (layout map above). Legacy `useDevice` / `useMeshCore` are removed ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375), [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)). Default rules for new UI:

| Concern                                               | Use                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestration (App tab)                               | `useProtocolFacade(protocol)` — connection, `useConnectionView`, panel bundle, nodes, messages                                                              |
| Active protocol identity                              | `useActiveMeshIdentity(protocol)` — focused `identityId` per tab; prefer `capabilities` over `protocol ===`                                                 |
| Dual-protocol panel bundles (App)                     | `useDualProtocolPanelActions(meshtasticRuntime, meshcoreRuntime)` — single hook site for both protocols                                                     |
| Reads (nodes, messages, connection fields)            | Zustand stores + `useNodes` / `useMessages` / `useConnectionView` / `useConnectionStatus`                                                                   |
| Writes (configure, send, admin, panel callbacks)      | `usePanelActions(protocol, identityId, …)` / `useProtocolFacade(protocol).panel` or `useSendMessage(identityId)`                                            |
| Connect / disconnect / auto-connect                   | `useProtocolConnectionActions(protocol)` (`useProtocolConnect` + `useProtocolDisconnect` + `lib/sessions/*Session.ts`); driver-first via `ConnectionDriver` |
| Wire subscriptions, MQTT IPC, reconnect, DB hydration | `useMeshtasticRuntime` / `useMeshcoreRuntime` in `runtime/` — mount **once** from `App.tsx` via context providers                                           |

Do **not** remount protocol runtimes in child components. Do **not** compare `protocol === 'meshcore'` for feature gates; use `ProtocolCapabilities` / `useRadioProvider(protocol)`.

Protocol SDK adapters: `src/renderer/lib/protocols/`. Connection lifecycle: `ConnectionDriver`; inbound domain events: `PacketRouter` → stores. **MeshCore post-router side effects:** `lib/ingest/meshcoreIngest.ts` (chat persist, `last_heard`, path-updated), `lib/meshcore/meshcoreLiveContactPersist.ts` (SQLite contact rows), `lib/meshcore/meshcorePubKeyRegistry.ts` (DM/trace pubkeys mirrored into runtime refs). Live UI nodes/messages read `nodeStore` / `messageStore`; `useMeshcoreRuntime` still keeps hook-local `nodesRef` for send/RPC until contact rebuild syncs it. **Favorites:** `setNodeFavorited` patches `meshcoreIdentityIdRef` (fallback `getIdentityIdForProtocol('meshcore')`). **Dedup windows:** cross-transport and channel RF **5 min**; room/tapback **60 s**. Path-updated (129) for existing contacts does not bump SQLite `last_advert` until the next advert (128).

**Identity-scoped UI stores:** `identityStore`, `nodeStore`, `messageStore`, `connectionStore` — nodes/messages keyed by `identityId`. **MQTT status bridge:** `mirrorMqttStatusToConnection` copies main-process `mqtt.onStatus` IPC into `connectionStore.mqttStatus` from legacy runtime handlers until MQTT moves fully into `ConnectionDriver`. **SQLite → UI:** `lib/hydrateIdentityStoresFromDb.ts` (coordinator: `identityHydrationCoordinator.ts`; Meshtastic node map: `meshtasticDbCacheHydration.ts`; message cap: `meshtasticMessageLoadLimit.ts`); manual refresh via `hooks/useDbRefresh.ts`. Runtimes may still merge DB rows into hook-local refs on connect; identity-scoped Zustand hydration is the canonical UI path ([#375]). **MeshCore contacts DB:** `meshcore_contacts.last_advert` is Unix **seconds**; age prune uses `src/shared/meshcoreContactAgeCutoff.ts` (do not compare in ms).

### First places to look

- Connection issues: `ConnectionDriver`, `useProtocolConnection.ts`, `runtime/useMeshtasticRuntime.ts`, `runtime/useMeshcoreRuntime.ts`
- UI state: `stores/*`, `useConnectionView.ts`
- IPC: `src/main/index.ts`

### Protocol entry points

- **Meshtastic:** `MeshtasticProtocol.ts`, `useMeshtasticRuntime` (side effects), `connection.ts` (`createConnection`)
- **MeshCore:** `MeshCoreProtocol.ts`, `useMeshcoreRuntime` (side effects), `@liamcottle/meshcore.js`

### Database

WAL SQLite; `user_version` in `database.ts`; migrations as `migration_N()`; `db-compat.ts` over `node:sqlite`. After schema changes: `pnpm run check:db-migrations`. **Startup maintenance:** `lib/startupDbPrune.ts` — single-flight per session from `App.tsx` (node/message retention, RF stub migration); do not re-invoke from unstable effect deps.

### BLE and serial

Meshtastic BLE: `connection.ts` / `TransportManager`. MeshCore BLE: `noble-ble-manager.ts` (macOS/Windows), Web Bluetooth IPC on Linux. Serial: `connection.ts`, `serialPortSignature.ts`. Reconnect watchdog: `runtime/useMeshtasticRuntime.ts`.

**Meshtastic USB serial vendor patches:** `@jsr/meshtastic__core` and `@jsr/meshtastic__transport-web-serial` are patched via pnpm `patchedDependencies` (`patches/@jsr__meshtastic__core@*.patch`, `patches/@jsr__meshtastic__transport-web-serial@*.patch`) so Web Serial streams abort cleanly on disconnect (avoids “port is already open” on reconnect). Re-hash patches after JSR bumps; see `docs/troubleshooting.md`.

**ATT MTU / writes:** Noble `toRadio` writes in `noble-ble-manager.ts` are chunked using negotiated `peripheral.mtu` (sanitized via `src/shared/bleAttWriteLimit.ts`; values below spec min 23 are coerced—NobleMac may log `MTU updated: 20` before a full exchange). Linux Web Bluetooth uses `webbluetooth-ble-manager.ts`; when Chromium exposes `maximumWriteValueLength`, writes are chunked—there is no standard Web API for negotiated MTU ([WebBluetoothCG#383](https://github.com/WebBluetoothCG/web-bluetooth/issues/383)).

**Meshtastic transport writes:** `meshtasticTransportLossDetection.ts` wraps `transport.toDevice` with `createSerializedWritableStream` so concurrent SDK `getWriter()` calls (ping, Store & Forward, queue) do not throw `WritableStream is locked`. After configure, `getMetadata` retries once after `MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS` when NodeDB traffic starves BLE.

**Linux Web Bluetooth (Meshtastic):** `webbluetooth-ble-manager.ts` subscribes to **fromNum** GATT notify for unsolicited mesh traffic, runs a **3 s background fromRadio poll** between write cycles, and uses **multi-shot read probes** instead of a single post-write safety read (LoRa latency). MeshCore BLE echo filtering: `meshcoreCompanionTxEchoFilter.ts` (Noble + Web Bluetooth).

**Dual-radio Noble BLE startup (macOS/Windows):** When both Meshtastic and MeshCore have **different** saved BLE peripherals, the renderer must serialize auto-connect and manual Noble connects. Coordinator: `src/renderer/lib/meshcoreDualNobleBleInit.ts`; UI wiring: `ConnectionPanel.tsx` (both panels stay mounted from `App.tsx`).

| Rule               | Detail                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Init timing        | Call `initNobleBleDualRadioStartup()` from **`App.tsx` `useLayoutEffect`** (not `useEffect`). Child ConnectionPanel auto-connect `useEffect` runs after layout effects — initializing in parent `useEffect` races and leaves primary unset.                        |
| Primary order      | `mesh-client:protocol` localStorage (`meshcore` / `meshtastic`; Reticulum or missing → Meshtastic). Single-radio installs skip peer deferral.                                                                                                                      |
| Primary notify     | Primary calls `notifyNobleBlePrimaryRfLinkReady()` when GATT + handshake succeed (MeshCore transport + Meshtastic `createBleConnection`), or `notifyNobleBlePrimaryAutoConnectSettled()` on first attempt failure — **not** after full configure or scan fallback. |
| Secondary wait     | Secondary waits only on `awaitNobleBlePrimaryAutoConnectSettled()` — do **not** add `awaitNobleBleProtocolSettle()` here (mutex + post-config defer handles configure overlap).                                                                                    |
| Mutex              | All Noble IPC connects go through `withNobleBleConnectMutex()` (Meshtastic + MeshCore).                                                                                                                                                                            |
| MeshCore reconnect | `useMeshcoreRuntime` must **not** start the reconnect loop on disconnect before the first successful configure — ConnectionPanel `reconnectBleWithScan` owns initial retries (`meshcoreEverConfiguredRef`).                                                        |
| Tests              | Protocol-neutral unit tests: `meshcoreDualNobleBleInit.test.ts`. Meshtastic + MeshCore defer paths: `ConnectionPanel.test.tsx` (`active-protocol-first BLE auto-connect`).                                                                                         |

Do **not** reintroduce Meshtastic-only startup gates, child-before-parent init, or runtime-side secondary auto-connect subscriptions — ConnectionPanel owns auto-connect for both protocols.

### Meshtastic channel URLs & Store & Forward

- **Config apply (Radio / Modules / Security):** Firmware `setConfig` / `setModuleConfig` replace full protobuf structs. UI must merge cached device slices with form edits via `meshtasticConfigApply.ts` (`mergeMeshtasticConfigApplyValue`, `buildMeshtasticModuleApplyValue`); slices live in `deviceStore.meshtasticConfigSlices` and `moduleConfigs` (PacketRouter + `meshtasticLegacyWireSubscriptions`). Module-specific validation: `meshtasticMqttModuleApply.ts`, `meshtasticSerialModuleApply.ts`. Apply failures surface `clientNotification` text within 8s (`meshtasticClientNotification.ts` → `formatMeshtasticModuleApplyError`); inline status via `ConfigApplyNotice.tsx`. Forms re-sync after reboot via `useSyncFormFromConfig`.
- **Administration tab:** `AdminPanel.tsx` — device commands and Danger Zone (reboot, shutdown, factory reset, NodeDB reset, OTA/DFU); shared `ConfirmModal.tsx` with Radio/Modules destructive flows. Local-only OTA/DFU disabled when **Configure node** targets a remote node.
- **Remote admin module snapshot:** `meshtasticRemoteAdminModuleFetches.ts` — canonical list/count of `ModuleConfig` reads during remote snapshot (`REMOTE_ADMIN_MODULE_CONFIG_FETCHES`).
- **Channel URLs:** `src/shared/meshtasticUrlEncoder.ts` (parse/generate), `src/shared/meshtasticChannelApply.ts` (replace vs add-only apply); Radio panel UI; Meshtastic-only.
- **S&F chat history:** `src/renderer/lib/meshtasticBacklogUtils.ts` — `CLIENT_HISTORY` on primary router heartbeat after RF configure (auto: 50-msg cap, 120 min window cap, 15 min per-server cooldown, 5 min offline gate; `storeForwardAutoFetchHistory` opt-out; manual catch-up in Chat). Protobuf decode for replayed text, `via_store_forward` on messages; do not await SDK queue for history (async replay).
- **MQTT broker clientId:** `src/main/mqtt-broker-client-id.ts` — stable per-install IDs in `app_settings` (`meshtasticMqttClientId`, `meshcoreMqttClientId`); MeshCore LetsMesh `v1_` username unchanged as clientId.
- **PKC remote admin (firmware 2.5+):** `meshtasticRemoteAdmin.ts` — PKI-wrapped `AdminMessage` via `MeshDevice.sendRaw()` (`pkiEncrypted: true`, channel omitted on wire); session passkeys (~300s); tab-scoped snapshot routes in `meshtasticRemoteAdminSnapshot.ts` (Channels-first LoRa load). Per-node keys: `meshtasticRemoteAdminKeyStorage.ts` (`meshtasticRemoteAdminKey:<nodeNum>` in `app_settings`; base64 / `base64:` / 64-char hex paste). Dest public key: NodeDB hex first, stored admin-key base64 fallback. `useMeshtasticRuntime`: `configureTargetNodeNum`, `remoteConfigSnapshot`, `runRemoteAdminOp` (errors → UI + toast); serialize admin reads with S&F (`remoteAdminReadsActiveCount` in `meshtasticBacklogUtils.ts`). **Requires connected local radio** (MQTT-only cannot admin). UI: `ConfigureNodeSelector.tsx`; NodeDetailModal admin key + **Configure node remotely**; SecurityPanel **Copy** public key. Persist last target in `meshtasticConfigureTargetNodeNum`. Gate with `hasRemoteAdmin`. Legacy admin channel (PSK + `"admin"`) out of scope.
- **Meshtastic last heard:** `meshtasticLastHeard.ts` — bump `last_heard` on live RF packets (not only text); `computeNodeInfoLastHeardMs` prevents configure replay from regressing fresher client timestamps.
- **Static GPS:** `src/renderer/lib/gpsSource.ts` — App tab static coordinates sync to self-node, map, and radio `setPosition`.

### MQTT

Meshtastic: `mqtt-manager.ts` (AES-128/256-CTR, Meshtastic nonce layout, channel keys, protobuf, dedup); `meshtasticMqttPublish.ts`; `meshtasticChannelPskInput.ts` + `src/shared/meshtasticChannelPskLine.ts`; `meshtasticMqttSettingsStorage.ts`; `meshtasticMqttIdentity.ts` (MQTT-only `from`); `mqtt-broker-client-id.ts`. MeshCore: `meshcore-mqtt-adapter.ts` (JSON v1); LetsMesh JWT `letsMeshJwt.ts`.

### UI

Panels: `src/renderer/components/`. New tabs: `lazyTabPanels.ts` / `lazyAppPanels.ts` + capabilities. Stores: module defaults; persist vs SQLite IPC as elsewhere.

### i18n / Localization

- **Framework:** i18next + react-i18next; static JSON bundles loaded at startup; `fallbackLng: 'en'`.
- **Locale files:** `src/renderer/locales/{en,es,uk,de,zh,pt-BR,fr,it,pl,cs,ja,ru,nl,ko,tr,id}/translation.json` — English is source of truth (`pnpm run check:i18n` reports key count).
- **Locale persistence:** `locale` key in `app_settings` SQLite table (canonical) and `mesh-client:appSettings` localStorage (fast startup read); reconciled in `App.tsx` on mount.
- **Reduce motion:** `reduceMotion` boolean in the same `app_settings` / localStorage bundle; toggled in **App → Appearance** ([`AppPanel.tsx`](src/renderer/components/AppPanel.tsx)). When true, non-essential UI motion (animated icons, decorative CSS pulses) is suppressed; loading spinners and connection status pulses remain. Does not auto-sync to OS `prefers-reduced-motion` after first-run init — see [`docs/accessibility-checklist.md`](docs/accessibility-checklist.md).
- **Adding strings:** add to `src/renderer/locales/en/translation.json`, use `t('your.key')` in components; `check:i18n` enforces all call sites resolve to English keys and **fails on unused English keys** (no static `t()`, registered dynamic prefix, quoted literal in `src/`, or `tabs.*` from `TAB_SLOT_IDS`).
- **Removing strings:** delete the key from `en/translation.json` and run `pnpm run i18n:prune-unused -- --write` to drop it from every locale (or remove manually). `check:i18n` blocks orphaned English keys.
- **Auto-translate:** `pnpm run i18n:auto-translate` uses MyMemory (default) or LibreTranslate (`LIBRETRANSLATE_URL`). With git, the default run **only** fills keys that are **new in English vs `HEAD`** and still missing from each locale (pre-commit uses this). Use **`pnpm run i18n:auto-translate --all`** or **`I18N_TRANSLATE_ALL=1`** to backfill every key missing from a locale vs English. Use **`--audit`** (or `I18N_AUDIT=1`) to additionally retranslate any key whose locale value is still identical to English (i.e. never actually translated). Existing translated entries are never overwritten. MyMemory sends contact `info@coloradomesh.org` by default for the 50 k words/day quota; override with `MYMEMORY_EMAIL` if needed.
- **Key check:** `pnpm run check:i18n` — hard fails on missing English keys and unused English keys; warns (does not fail) on incomplete locale coverage so rate-limit gaps don't block commits. Also runs locale quality rules via `scripts/check-i18n-quality.mjs` (mojibake, `meshtastic://` spacing, false friends). Unused-key detection lives in `scripts/i18n-unused-keys.mjs`; `pnpm run check:i18n:branch` skips the unused pass and only runs quality rules on keys new/changed vs `HEAD`.
- **Language selector:** `src/renderer/components/LanguageSelector.tsx` — globe-icon dropdown in the header; calls `i18n.changeLanguage()` + `mergeAppSetting('locale', ...)` + `electronAPI.appSettings.set('locale', ...)`.

### Chat Panel

- **Components:** `ChatPanel.tsx` (channel/DM UI) + shared `ChatComposer.tsx` (drafts, mentions, chunking, spellcheck, emoji; also used by `RoomsPanel.tsx`). Scroll-at-bottom helper: `chatScrollUtils.ts` (`getDistFromChatBottom`).
- **Payload / links:** `ChatPayloadText.tsx` — mention highlighting, search marks, URL linkification; link previews via `chat:fetchLinkPreview` (`src/main/fetchLinkPreview.ts`, blocks localhost/private IPs, 10s timeout, 64 KiB HTML cap). Reply quotes: `replyPreview.ts`.
- **Storage helpers:** `src/renderer/lib/chatPanelProtocolStorage.ts` — drafts (`mesh-client:drafts:<protocol>`), open DM tabs, last-read, per-view mute (`mesh-client:mutedViews:<protocol>`), starred (`mesh-client:starred:<protocol>`, cap 200).
- **Notifications:** `src/renderer/lib/chatNotifications.ts` — `playMessageNotification(type)` via Web Audio: `channel` = single 880 Hz pulse (150 ms); `dm` / `reply` = dual pulse (587.33 Hz then 783.99 Hz, 50 ms each, 35 ms gap). Resumes suspended `AudioContext` when the window is hidden/minimized. Type selection in `chatUnreadCounts.ts` (`resolveChatNotificationType`, `pickAudibleNotificationType`; batch priority reply > dm > channel). **ChatPanel** plays when the user is on Chat but reading another view; **App** plays for other panels / backgrounded window (avoids double beep). Meshtastic hidden-window desktop notifications are visual-only (`silent: true` in `meshtasticLegacyWireSubscriptions.ts`); typed Web Audio from App owns sound. Global mute `mesh-client:notifMuted`; per-view mute in `mutedViews`. Main-process **tray** icon shows unread when chat or MeshCore Rooms traffic arrives while backgrounded (`src/main/index.ts` `buildTrayIcon`).
- **Meshtastic dedup:** `meshtasticMessageDedup.ts` — merges delayed RF/MQTT duplicates (10-minute content window) in `useMeshtasticRuntime` ingest.
- **MeshCore dedup:** `meshcoreStoreDedup.ts` — RF/MQTT merge, companion TX echo, tapback self-echo, room BBS paths in `useMeshcoreRuntime` ingest.
- **Reactions / tapbacks:** `reactions.ts` (Meshtastic protobuf) + `meshcoreChannelText.ts` (MeshCore default outbound keyless `@[Name] emoji` / `@[Name] body`; opt-in **MeshCore Open compatibility** in App enables keyed replies, `r:` reactions, and `g:` GIF send via `meshcoreOpenWireCompatEnabled` in `appSettingsStorage.ts`; inbound keyed/sec↔ms parent match via `meshcoreMessageMatchesReplyKey`; inbound emoji-only replies promoted via `meshcorePromoteEmojiOnlyReplyToTapback`; inbound Open `r:HASH:INDEX` in `meshcoreOpenReaction.ts`); `ChatPanel.tsx` attaches tapbacks via `replyId` + runtime/panel `sendReaction`.
- **Mention segments:** `src/renderer/lib/chatMentionSegments.ts` — parse/build `@[Name]` tokens; `MentionAutocomplete.tsx` renders the dropdown.
- **Export IPC:** `chat:export` — renderer calls `window.electronAPI.chat.export(messages)`; main opens a Save dialog and writes a `.txt` file.

### MeshCore Rooms (BBS)

- **UI:** `RoomsPanel.tsx` — login overlay, post composer (`ChatComposer`), admin CLI, auto-sync toggles; sidebar badge via `meshcoreRoomsUnread.ts` (`mesh-client:meshcoreRoomsUnread`).
- **Session / RPC:** `meshcoreRoomSession.ts`, `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, `meshcoreRoomLogoutRpc.ts`, `meshcoreRoomLoginQueue.ts`, `meshcoreRoomLoginPathSync.ts`, `meshcoreRoomSentWait.ts`; credentials in `meshcoreRoomCredentialStorage.ts` / `meshcoreRoomSyncStorage.ts`.
- **Saved passwords:** `meshcoreRoomSavedSecrets.ts` — sidebar/overlay **Forget** / **Stop auto-login**; `forgetMeshcoreRoomSavedSecrets` clears credential + disables auto-login and auto-sync; `disableMeshcoreRoomLoginAfterAuthFailure` disables both without clearing password or in-memory failure UI.
- **Scheduler:** `meshcoreRoomSyncScheduler.ts` + `useMeshcoreRuntime.ts` — periodic re-login (Auto-sync, RF-only); single-flight ticks; background route resolve uses `skipTrace` / `MESHCORE_ROOM_SYNC_ROUTE_RESOLVE_FAST_MS`. Auth failure disables auto-sync and auto-login via `disableMeshcoreRoomLoginAfterAuthFailure`. Connect auto-login skips rooms with `getMeshcoreRoomAutoLoginFailure`. Timeouts in `timeConstants.ts` (shorter for TCP / 0-hop).
- **Wire text:** `meshcoreChannelText.ts` — channel/DM/room payloads, SignedPlain inbound strip, tapback/reply lines; `meshcoreGifWire.ts` — Open `g:GIFID`; `meshcoreOpenReaction.ts` — Open `r:HASH:INDEX`. Default companion keyless outbound; opt-in Open wire via App `meshcoreOpenWireCompatEnabled`.

### Connection panel helpers

- **Error humanization:** `connectionPanelErrorHumanize.ts` — serial/HTTP/BLE user-facing hints (i18n); uses `electronAPI.getPlatform()`.
- **Last connection / reconnect rehydrate:** `lastConnectionStorage.ts` — `mesh-client:lastConnection:<protocol>` and BLE fallback keys; rebuild RF params after wake or Noble disconnect.
- **Storage migrations:** `connectionPanelStorageMigrations.ts` — idempotent localStorage fixes on ConnectionPanel mount.
- **MeshCore chat channel filter:** `meshcoreConfiguredChatChannels.ts` — zero-PSK slots excluded from unread badges and chat channel pills.

### Common issues

| Symptom                               | Where to check                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connection fails                      | `ConnectionDriver`, `runtime/useMeshtasticRuntime.ts`, `runtime/useMeshcoreRuntime.ts`                                                                                                                 |
| Send fails                            | `useSendMessage`, runtime send paths                                                                                                                                                                   |
| UI stale                              | Zustand store, effect deps                                                                                                                                                                             |
| Empty chat/nodes offline              | `hydrateIdentityStoresFromDb`, connect-time cache in runtimes, `useDbRefresh`; identity split — [troubleshooting](docs/troubleshooting.md#chat-stuck-new-traffic-in-logsdb-but-messages-do-not-appear) |
| Chat stuck / badge moves, no new rows | `identityByProtocol`, `useActiveMeshIdentity`, `mergeOfflineIdentityStore`; **Copy Debug Snapshot** — [troubleshooting](docs/troubleshooting.md#reporting-bugs-copy-debug-snapshot-app-tab)            |
| BLE timeout                           | `noble-ble-manager.ts`, `bleConnectErrors`                                                                                                                                                             |
| Reticulum sidecar won't start         | `reticulum-sidecar-manager.ts`, `ipc/reticulum-handlers.ts`, [troubleshooting](docs/troubleshooting.md#reticulum-sidecar-wont-start-or-health-poll-times-out)                                          |
| Reticulum interface CRUD fails        | `ReticulumRadioPanel.tsx`, `proxyPut`/`proxyDelete` — [troubleshooting](docs/troubleshooting.md#reticulum-interface-addeditdelete-fails)                                                               |
| Serial missing                        | `serialPortSignature.ts`                                                                                                                                                                               |
| MQTT loop                             | `mqtt-manager.ts`                                                                                                                                                                                      |
| DB errors                             | `database.ts` migrations                                                                                                                                                                               |
| Log gaps                              | `log-service.ts`, log tags                                                                                                                                                                             |
| Chat export fails                     | `chat:export` handler in `src/main/index.ts`                                                                                                                                                           |
| Draft not restored                    | `chatPanelProtocolStorage.ts`, `viewKey` logic                                                                                                                                                         |
| Mention picker missing                | `MentionAutocomplete.tsx`, `buildMentionCandidates`                                                                                                                                                    |
| Link preview missing                  | `fetchLinkPreview.ts`, `chat:fetchLinkPreview` IPC                                                                                                                                                     |
| Duplicate RF+MQTT msg                 | `meshtasticMessageDedup.ts`, Meshtastic runtime ingest                                                                                                                                                 |
| MeshCore duplicate/echo               | `meshcoreStoreDedup.ts`, `useMeshcoreRuntime.ts`                                                                                                                                                       |
| Room login/post fails                 | `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, [troubleshooting](docs/troubleshooting.md#meshcore-room-server-login-posts-and-windows-10)                                                        |
| Rooms unread vs Chat                  | `meshcoreRoomsUnread.ts` — Rooms tab badge only                                                                                                                                                        |
| MQTT decrypt / sender                 | `mqtt-manager.ts`, `meshtasticMqttIdentity.ts`                                                                                                                                                         |
| Remote admin fails                    | `meshtasticRemoteAdmin.ts`, key storage                                                                                                                                                                |
| S&F history garbled                   | `meshtasticBacklogUtils.ts` decode, heartbeat trigger                                                                                                                                                  |
| Garbled TEXT_MESSAGE                  | `meshtasticBacklogUtils.ts` readable-text filter                                                                                                                                                       |
| Channel URL apply                     | `meshtasticChannelApply.ts`, `meshtasticUrlEncoder.ts`                                                                                                                                                 |
| Header red on loss                    | `connectionHeaderStatus.ts`, `mqttDisconnectIntent.ts`                                                                                                                                                 |
| Sleep/wake reconnect                  | `usePowerRecovery`, `systemPowerState`, `bleReconnectHelper`, `rfReconnectHelper`, runtimes; Meshtastic ~4s + MeshCore ~8s stagger + up to 30s dual-Noble settle                                       |
| MeshCore contact prune                | `meshcoreContactAgeCutoff.ts`, `database.ts` (`last_advert` seconds); favorited exempt                                                                                                                 |
| MQTT transient after wake             | `networkTransientErrors.ts`, `mqtt:powerSuspend` / `mqtt:powerResume` IPC                                                                                                                              |

## 9. Cursor / Claude indexing

Optional local ignore files [`.cursorignore`](.cursorignore) and [`.claudeignore`](.claudeignore) (both listed in `.gitignore`) exclude noisy paths when present (build output, dependencies, Cursor debug logs under `.cursor/`). Ignored paths may still be read when you open the file, paste an excerpt, or reference an explicit path in chat.

## 10. Context Management

- **Read/Glob Hygiene:** When reading files larger than 100 lines or performing wide directory globs, provide a concise summary of findings.
- **Cold Storage Transition:** After 10 turns, if a previously read file is not the current focus, refer to it by summary or path; do not re-read unless a specific logic change is required.
