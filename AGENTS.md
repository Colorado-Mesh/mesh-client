# AGENTS.md: Coding Guidelines for AI Assistants

This file is self-contained. ARCHITECTURE.md and CONTRIBUTING.md are human references; read them only if you need deep subsystem detail beyond what's here.

## 1. Scope & Workflow

- Only change what was asked. No drive-by refactors, reformatting, or types/comments outside scope.
- **Testing:** Ship a passing test for behavioral changes; do not call the task done without it.
- **Stateful/I/O code:** Preserve integrity on failure; document failure point, fallback, and logging where it matters.

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

| Layer        | Path                    | Role                                                                                                                                                                          |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **runtime/** | `src/renderer/runtime/` | Protocol side effects (`useMeshtasticRuntime`, `useMeshcoreRuntime`). Mount **once** from `App.tsx` via context providers; do not remount in child components or hooks.       |
| **hooks/**   | `src/renderer/hooks/`   | React composition: `useProtocolFacade`, store selectors (`useMessages`, `useConnectionView`), panel action bundles, feature hooks (`useChatOutbox`). No large protocol logic. |
| **lib/**     | `src/renderer/lib/`     | Pure logic, drivers (`ConnectionDriver`), sessions, ingest, protocol types (e.g. `lib/meshcore/meshcoreHookTypes.ts`).                                                        |

**App wiring:** Prefer `useProtocolFacade(protocol)` for connection state, panel actions, nodes, and messages. Use per-protocol `useProtocolConnectionActions('meshtastic' \| 'meshcore')` only when both protocol tabs need separate ConnectionPanel props. **`usePowerRecovery`** mounts once from `App.tsx` — coordinates macOS sleep/wake IPC, MQTT `powerSuspend`/`powerResume`, and runtime `onPowerResume` (~4s delayed RF recovery).

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
- **React:** Function components only; `exhaustive-deps` is errors; `?.` in JSX; every interactive control needs `aria-label`.
- **Zustand:** Module-level defaults for stable refs; prefer `useStore(s => s.field)` over broad subscriptions; avoid subscribing to whole Maps when one id suffices; `persist` for localStorage, IPC from an effect for SQLite; extract time constants to `src/renderer/lib/timeConstants.ts`.
- **Performance:** No hot-path O(n); lazy cleanup when collections grow large.

## 5. Testing

- Renderer: jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main: node (`src/main/**/*.test.ts`).
- Mock console before spying logged errors: `vi.spyOn(console, 'warn').mockImplementation(() => {})` in `beforeEach` when shared.
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.

## 6. Commands & CI Checks

**Key commands:** `pnpm run dev`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:run`, `pnpm run update`.

> **Update script sync:** When adding or removing packages from `patchedDependencies` in `package.json:205-213`, keep `WATCH_ENTRIES` in `scripts/update.sh:59-69` in sync so the script warns on version changes to every patched dependency.

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

**Identity-scoped UI stores:** `identityStore`, `nodeStore`, `messageStore`, `connectionStore` — nodes/messages keyed by `identityId`. **SQLite → UI:** `lib/hydrateIdentityStoresFromDb.ts` (coordinator: `identityHydrationCoordinator.ts`; Meshtastic node map: `meshtasticDbCacheHydration.ts`; message cap: `meshtasticMessageLoadLimit.ts`); manual refresh via `hooks/useDbRefresh.ts`. Runtimes may still merge DB rows into hook-local refs on connect; identity-scoped Zustand hydration is the canonical UI path ([#375]). **MeshCore contacts DB:** `meshcore_contacts.last_advert` is Unix **seconds**; age prune uses `src/shared/meshcoreContactAgeCutoff.ts` (do not compare in ms).

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
- **Adding strings:** add to `src/renderer/locales/en/translation.json`, use `t('your.key')` in components; `check:i18n` enforces all call sites resolve to English keys.
- **Auto-translate:** `pnpm run i18n:auto-translate` uses MyMemory (default) or LibreTranslate (`LIBRETRANSLATE_URL`). With git, the default run **only** fills keys that are **new in English vs `HEAD`** and still missing from each locale (pre-commit uses this). Use **`pnpm run i18n:auto-translate --all`** or **`I18N_TRANSLATE_ALL=1`** to backfill every key missing from a locale vs English. Use **`--audit`** (or `I18N_AUDIT=1`) to additionally retranslate any key whose locale value is still identical to English (i.e. never actually translated). Existing translated entries are never overwritten. MyMemory sends contact `info@coloradomesh.org` by default for the 50 k words/day quota; override with `MYMEMORY_EMAIL` if needed.
- **Key check:** `pnpm run check:i18n` — hard fails on missing English keys; warns (does not fail) on incomplete locale coverage so rate-limit gaps don't block commits. Also runs locale quality rules via `scripts/check-i18n-quality.mjs` (mojibake, `meshtastic://` spacing, false friends).
- **Language selector:** `src/renderer/components/LanguageSelector.tsx` — globe-icon dropdown in the header; calls `i18n.changeLanguage()` + `mergeAppSetting('locale', ...)` + `electronAPI.appSettings.set('locale', ...)`.

### Chat Panel

- **Components:** `ChatPanel.tsx` (channel/DM UI) + shared `ChatComposer.tsx` (drafts, mentions, chunking, spellcheck, emoji; also used by `RoomsPanel.tsx`). Scroll-at-bottom helper: `chatScrollUtils.ts` (`getDistFromChatBottom`).
- **Payload / links:** `ChatPayloadText.tsx` — mention highlighting, search marks, URL linkification; link previews via `chat:fetchLinkPreview` (`src/main/fetchLinkPreview.ts`, blocks localhost/private IPs, 10s timeout, 64 KiB HTML cap). Reply quotes: `replyPreview.ts`.
- **Storage helpers:** `src/renderer/lib/chatPanelProtocolStorage.ts` — drafts (`mesh-client:drafts:<protocol>`), open DM tabs, last-read, per-view mute (`mesh-client:mutedViews:<protocol>`), starred (`mesh-client:starred:<protocol>`, cap 200).
- **Notifications:** `src/renderer/lib/chatNotifications.ts` — `playMessageNotification(type)` via Web Audio: `channel` = single 880 Hz pulse (150 ms); `dm` / `reply` = dual pulse (587.33 Hz then 783.99 Hz, 50 ms each, 35 ms gap). Resumes suspended `AudioContext` when the window is hidden/minimized. Type selection in `chatUnreadCounts.ts` (`resolveChatNotificationType`, `pickAudibleNotificationType`; batch priority reply > dm > channel). **ChatPanel** plays when the user is on Chat but reading another view; **App** plays for other panels / backgrounded window (avoids double beep). Meshtastic hidden-window desktop notifications are visual-only (`silent: true` in `meshtasticLegacyWireSubscriptions.ts`); typed Web Audio from App owns sound. Global mute `mesh-client:notifMuted`; per-view mute in `mutedViews`. Main-process **tray** icon shows unread when chat or MeshCore Rooms traffic arrives while backgrounded (`src/main/index.ts` `buildTrayIcon`).
- **Meshtastic dedup:** `meshtasticMessageDedup.ts` — merges delayed RF/MQTT duplicates (10-minute content window) in `useMeshtasticRuntime` ingest.
- **MeshCore dedup:** `meshcoreStoreDedup.ts` — RF/MQTT merge, companion TX echo, tapback self-echo, room BBS paths in `useMeshcoreRuntime` ingest.
- **Reactions / tapbacks:** `reactions.ts` (Meshtastic protobuf) + `meshcoreChannelText.ts` (MeshCore wire lines); `ChatPanel.tsx` attaches tapbacks via `replyId` + runtime/panel `sendReaction`.
- **Mention segments:** `src/renderer/lib/chatMentionSegments.ts` — parse/build `@[Name]` tokens; `MentionAutocomplete.tsx` renders the dropdown.
- **Export IPC:** `chat:export` — renderer calls `window.electronAPI.chat.export(messages)`; main opens a Save dialog and writes a `.txt` file.

### MeshCore Rooms (BBS)

- **UI:** `RoomsPanel.tsx` — login overlay, post composer (`ChatComposer`), admin CLI, auto-sync toggles; sidebar badge via `meshcoreRoomsUnread.ts` (`mesh-client:meshcoreRoomsUnread`).
- **Session / RPC:** `meshcoreRoomSession.ts`, `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, `meshcoreRoomLogoutRpc.ts`, `meshcoreRoomLoginQueue.ts`, `meshcoreRoomLoginPathSync.ts`, `meshcoreRoomSentWait.ts`; credentials in `meshcoreRoomCredentialStorage.ts` / `meshcoreRoomSyncStorage.ts`.
- **Saved passwords:** `meshcoreRoomSavedSecrets.ts` — sidebar/overlay **Forget** / **Stop auto-login**; `forgetMeshcoreRoomSavedSecrets` clears credential + disables auto-login and auto-sync; `disableMeshcoreRoomLoginAfterAuthFailure` disables both without clearing password or in-memory failure UI.
- **Scheduler:** `meshcoreRoomSyncScheduler.ts` + `useMeshcoreRuntime.ts` — periodic re-login (Auto-sync, RF-only); single-flight ticks; background route resolve uses `skipTrace` / `MESHCORE_ROOM_SYNC_ROUTE_RESOLVE_FAST_MS`. Auth failure disables auto-sync and auto-login via `disableMeshcoreRoomLoginAfterAuthFailure`. Connect auto-login skips rooms with `getMeshcoreRoomAutoLoginFailure`. Timeouts in `timeConstants.ts` (shorter for TCP / 0-hop).
- **Wire text:** `meshcoreChannelText.ts` — channel/DM/room payloads, SignedPlain inbound strip, tapback lines.

### Common issues

| Symptom                   | Where to check                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection fails          | `ConnectionDriver`, `runtime/useMeshtasticRuntime.ts`, `runtime/useMeshcoreRuntime.ts`                                                          |
| Send fails                | `useSendMessage`, runtime send paths                                                                                                            |
| UI stale                  | Zustand store, effect deps                                                                                                                      |
| Empty chat/nodes offline  | `hydrateIdentityStoresFromDb`, connect-time cache in runtimes, `useDbRefresh`                                                                   |
| BLE timeout               | `noble-ble-manager.ts`, `bleConnectErrors`                                                                                                      |
| Serial missing            | `serialPortSignature.ts`                                                                                                                        |
| MQTT loop                 | `mqtt-manager.ts`                                                                                                                               |
| DB errors                 | `database.ts` migrations                                                                                                                        |
| Log gaps                  | `log-service.ts`, log tags                                                                                                                      |
| Chat export fails         | `chat:export` handler in `src/main/index.ts`                                                                                                    |
| Draft not restored        | `chatPanelProtocolStorage.ts`, `viewKey` logic                                                                                                  |
| Mention picker missing    | `MentionAutocomplete.tsx`, `buildMentionCandidates`                                                                                             |
| Link preview missing      | `fetchLinkPreview.ts`, `chat:fetchLinkPreview` IPC                                                                                              |
| Duplicate RF+MQTT msg     | `meshtasticMessageDedup.ts`, Meshtastic runtime ingest                                                                                          |
| MeshCore duplicate/echo   | `meshcoreStoreDedup.ts`, `useMeshcoreRuntime.ts`                                                                                                |
| Room login/post fails     | `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, [troubleshooting](docs/troubleshooting.md#meshcore-room-server-login-posts-and-windows-10) |
| Rooms unread vs Chat      | `meshcoreRoomsUnread.ts` — Rooms tab badge only                                                                                                 |
| MQTT decrypt / sender     | `mqtt-manager.ts`, `meshtasticMqttIdentity.ts`                                                                                                  |
| Remote admin fails        | `meshtasticRemoteAdmin.ts`, key storage                                                                                                         |
| S&F history garbled       | `meshtasticBacklogUtils.ts` decode, heartbeat trigger                                                                                           |
| Garbled TEXT_MESSAGE      | `meshtasticBacklogUtils.ts` readable-text filter                                                                                                |
| Channel URL apply         | `meshtasticChannelApply.ts`, `meshtasticUrlEncoder.ts`                                                                                          |
| Header red on loss        | `connectionHeaderStatus.ts`, `mqttDisconnectIntent.ts`                                                                                          |
| Sleep/wake reconnect      | `usePowerRecovery`, `systemPowerState`, `bleReconnectHelper`, `rfReconnectHelper`, runtimes; ~4s post-wake delay                                |
| MeshCore contact prune    | `meshcoreContactAgeCutoff.ts`, `database.ts` (`last_advert` seconds); favorited exempt                                                          |
| MQTT transient after wake | `networkTransientErrors.ts`, `mqtt:powerSuspend` / `mqtt:powerResume` IPC                                                                       |

## 9. Cursor / Claude indexing

Optional local ignore files [`.cursorignore`](.cursorignore) and [`.claudeignore`](.claudeignore) (both listed in `.gitignore`) exclude noisy paths when present (build output, dependencies, Cursor debug logs under `.cursor/`). Ignored paths may still be read when you open the file, paste an excerpt, or reference an explicit path in chat.

## 10. Context Management

- **Read/Glob Hygiene:** When reading files larger than 100 lines or performing wide directory globs, provide a concise summary of findings.
- **Cold Storage Transition:** After 10 turns, if a previously read file is not the current focus, refer to it by summary or path; do not re-read unless a specific logic change is required.
