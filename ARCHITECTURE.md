# Architecture

Project layout, data flow, and code placement for human reference. For AI coding guidelines, see [AGENTS.md](AGENTS.md) (self-contained).

## Layout map

Path alias `@/*` maps to `src/*` (see `tsconfig.json`).

| Boundary | Path            | Role                                                                                                                                                                                                                                                                                                |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main/`     | SQLite (`database.ts`, `db-compat.ts`), BLE (`noble-ble-manager.ts`), MQTT (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`), logging (`log-service.ts`, `sanitize-log-message.ts`), IPC handlers (`index.ts` plus namespaced modules in `src/main/ipc/` — Reticulum, TAK, GPS), window, GPS, updater |
| Preload  | `src/preload/`  | `contextBridge` exposing namespaced `electronAPI` only; never expose `ipcRenderer`                                                                                                                                                                                                                  |
| Renderer | `src/renderer/` | React 19 + Vite + Zustand: `components/`, `hooks/`, `runtime/` (protocol runtimes, single mount), `stores/`, `lib/`, `locales/`, `workers/`                                                                                                                                                         |

| Shared | `src/shared/` | IPC contracts (`electron-api.types.ts`), protocol-neutral helpers |

**Entry points:** `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`.

**Repo root (not exhaustive):** `.github/workflows/`, `scripts/check-*.mjs` (IPC, migrations, log injection, etc.), `docs/`, `resources/`, `vite.config.mts`, `electron-builder.yml`, `package.json`.

## Process boundaries

- **Main:** Node runtime; all privileged I/O and IPC handlers.
- **Preload:** Thin bridge; namespaced channels (`db:*`, `mqtt:*`, `log:*`, `ble:*`, `serial:*`, `session:*`, etc.).
- **Renderer:** UI only; talk to main via `window.electronAPI` from preload.
- **Shared:** Types and safe helpers imported by main and renderer.

**Tests:** Co-located `*.test.ts` / `*.test.tsx`; update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change (see [Testing protocols](CONTRIBUTING.md#testing-protocols) in CONTRIBUTING.md).

**Package manager:** `pnpm` only.

## Multi-protocol (Meshtastic + MeshCore + Reticulum)

All three stacks can run at once: independent sessions, header switcher for focus (green / cyan / amber), inactive protocols stay connected, per-protocol unread badges. Meshtastic and MeshCore use `ConnectionDriver` for RF/MQTT; Reticulum uses the AGPL sidecar (`useReticulumRuntime`; no Noble/MQTT for Reticulum's own connections — the sidecar owns BLE RNode via `btleplug`). A Reticulum BLE RNode connect on macOS/Windows may still briefly suspend/yield Noble so it does not contend with the sidecar's BLE scan (see [docs/agents/ble-serial.md](docs/agents/ble-serial.md) **Multi-protocol BLE coexistence**). Capabilities differ (e.g. Meshtastic: full Security PKI/Modules/TAK; MeshCore: partial Security backup/restore, Repeaters, **Rooms** BBS; Reticulum: LXMF DMs, **Remote** rnsh/rncp (`hasReticulumRemotePanel`), **Nomad Network / My Pages** (`hasNomadNetworkPanel`), **Peers**, **RRC** hub chat (`hasRrcPanel`), propagation, RNode flasher, **Map** (RMAP v4 discovery), Topology). Sidebar tab slots are fixed in `src/renderer/lib/tabSlotIds.ts`; visibility is computed in `src/renderer/lib/appTabMappings.ts` (`computeTabMappings()` consumed from `App.tsx`); **Rooms** requires `hasRoomServersPanel`, Reticulum panels gate on `hasReticulumNetworkPanel` / `hasReticulumInterfaceConfig` / `hasReticulumDiscoveryMap` / `hasRrcPanel` / `hasReticulumRemotePanel` / `hasNomadNetworkPanel`, **Security**/`TAK` require capability flags (~16 visible tabs per LoRa protocol; MeshCore hides TAK; Reticulum hides LoRa-specific tabs).

**Feature gating:** use `ProtocolCapabilities` via `useRadioProvider(protocol)` from `src/renderer/lib/radio/providerFactory.ts`; do not branch on raw `protocol === 'meshcore'` strings.

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';

const capabilities = useRadioProvider(protocol);
```

## IPC data flow

Adding a cross-boundary feature:

1. Types in `src/shared/electron-api.types.ts`.
2. `ipcMain.handle('namespace:action', ...)` in `src/main/index.ts`, or in a namespaced module under `src/main/ipc/` (e.g. `reticulum-handlers.ts`, `tak-handlers.ts`, `gps-handlers.ts`) registered from `index.ts` (mirror existing patterns).
3. Expose on `electronAPI` in `src/preload/index.ts` via `ipcRenderer.invoke`.
4. Call from renderer: `window.electronAPI....`

Sanitize user-controlled strings before logs and IPC per [AGENTS.md](AGENTS.md).

## AI assistant quick reference

### Diagnostics

- **Engines:** `src/renderer/lib/diagnostics/`; `RoutingDiagnosticEngine.ts`, `RFDiagnosticEngine.ts`, `RemediationEngine.ts`.
- **Store:** `src/renderer/stores/diagnosticsStore.ts`; routing/RF rows, foreign LoRa, MQTT ignore, redundancy.
- **Tab scoping:** `filterDiagnosticRowsForProtocol()` — Meshtastic/MeshCore tabs show LoRa rows only; Reticulum tab shows `reticulum/*` only. Foreign-LoRa tables UI is on Meshtastic and MeshCore tabs (keyed by that protocol’s self node id).
- **Extend:** adjust `DiagnosticRow` in `src/renderer/lib/types.ts`, add detector, wire `replaceRoutingRowsFromMap` / `replaceRfRowsForNode`; TTL defaults in `diagnosticRows.ts` (routing 24h, RF 1h).
- **Node health score:** `src/renderer/lib/nodeHealthScore.ts`; `nodeHealthScore(node)` → `NodeHealthBreakdown`; `nodeHealthTier(total)` → color tier.
- **Watch/notify:** `src/renderer/stores/watchedNodesStore.ts` (persisted Set<nodeId>); `src/renderer/hooks/useNodeStatusNotifier.ts` (fires OS Notification on online/offline transitions).
- **Full reference** (meanings, triggers, UI surfaces): [docs/diagnostics.md](docs/diagnostics.md).

### Bug workflow

1. Reproduce (`pnpm start`); note what you see.
2. Search errors under `src/main/` or `src/renderer/`.
3. Add `console.debug` only when needed.
4. Minimal fix + co-located tests.
5. `pnpm run test:run -- path/to/file.test.ts` and `pnpm run lint`.

**First places to look:** `runtime/useMeshtasticRuntime.ts` / `runtime/useMeshcoreRuntime.ts` (protocol side effects); `hooks/useProtocolConnection.ts` (connect); `stores/*` (UI state); `src/main/index.ts` (IPC).

**Renderer layers:** `runtime/` (single-mount protocol runtimes), `hooks/` (facades and store selectors), `lib/` (drivers, sessions, types), `stores/` (identity-scoped UI: `identityStore`, `nodeStore`, `messageStore`, `connectionStore`; Reticulum also uses session-global `reticulumIdentityStore` for sidecar identity status). Prefer `useProtocolFacade(protocol)` in App for new wiring. Hook/runtime boundaries: [docs/agents/renderer-hooks.md](docs/agents/renderer-hooks.md) ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375), [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)).

**Drivers / identity bridge:** `lib/drivers/ConnectionDriver.ts` owns RF/MQTT session lifecycle and dispatches Protocol events into `lib/drivers/PacketRouter.ts` (store ingest first, then side-effect listeners). `PacketRouter` invokes generic listeners before event-type listeners, in registration order within each group; attach persistence/ingest before dependent UI side effects. `lib/meshIdentityBridge.ts` builds transport params and attaches Meshtastic Protocol ingress; `lib/identityStoreReads.ts` is the canonical read path for identity-scoped nodes/messages (`getIdentityNode` / `getIdentityChatMessages`).

### Protocols

- **Meshtastic:** `runtime/useMeshtasticRuntime.ts`, `lib/protocols/MeshtasticProtocol.ts`, `lib/connection.ts` (`createConnection`).
- **MeshCore:** `runtime/useMeshcoreRuntime.ts`, `lib/protocols/MeshCoreProtocol.ts`, `@liamcottle/meshcore.js`.
- **Reticulum:** `runtime/useReticulumRuntime.ts`, `lib/sessions/reticulumSession.ts`, `components/ReticulumMapPanel.tsx`, `components/ReticulumRemotePanel.tsx`, `components/NomadNetworkPanel.tsx`, `components/RrcPanel.tsx`, `stores/reticulumDiscoveryMapStore.ts`, `stores/reticulumPeerStore.ts`, `stores/rncpTransferStore.ts`, `stores/rnshSessionStore.ts`, `stores/rrcHubStore.ts`, `stores/rrcSessionStore.ts`, `reticulum-sidecar/` (AGPL `mesh-client-reticulum` including `rrc_*` / `rnsh_*` / `rncp_*` modules); IPC `reticulum:*` in main with typed `electronAPI.reticulum.rrc|rnsh|rncp|remote`; RMAP map data: sidecar `DiscoveryStore` → REST/WS → store → join `reticulumPeerStore` for reachability; docs [docs/reticulum.md](docs/reticulum.md), [docs/reticulum-sidecar-ipc.md](docs/reticulum-sidecar-ipc.md).

### App lifecycle (mount once from `App.tsx`)

- **`usePowerRecovery`** — sleep/wake IPC, MQTT power suspend/resume, staggered RF reconnect (Meshtastic ~4s, MeshCore ~8s, dual-Noble settle up to ~30s).
- **`useRendererHeartbeat`** / **`useLongSessionMaintenance`** — renderer pings main every 30s; main `rendererHeartbeatWatchdog` warns if no heartbeat within 30s after resume **while visible**, and polls for a **90s visible-window stall**; sticky `rendererUnresponsiveSeen` + `getRendererLiveness()` feed support snapshot `mainLiveness`; long-uptime restart nudge.
- **`ProtocolAutoConnectCoordinator`** / **`useProtocolRfAutoConnect`** — silent launch auto-connect for remembered serial/BLE/TCP/HTTP (cancel gate before manual Connect).
- **`rfReconnectController`** — LoRa single-owner reconnect scheduling shared by Meshtastic/MeshCore runtimes.
- **Dual-radio Noble BLE startup** (Meshtastic + MeshCore different peripherals): `lib/meshcoreDualNobleBleInit.ts` initialized from `App.tsx` `useLayoutEffect`; primary order from `mesh-client:protocol` localStorage — see [docs/agents/ble-serial.md](docs/agents/ble-serial.md) **Dual-radio Noble BLE startup**.

### Database

- WAL SQLite; `user_version` in `database.ts`; migrations as `migration_N()`; `db-compat.ts` over `node:sqlite`. After schema changes: `pnpm run check:db-migrations`.
- **Renderer DB → UI:** `lib/hydrateIdentityStoresFromDb.ts` (identity-scoped Zustand hydration; connect-time node cache before RF configure). **Startup prune:** `lib/startupDbPrune.ts` (once per app session from `App.tsx`).

### BLE and serial

- Meshtastic BLE: `lib/connection.ts` / `src/renderer/lib/transport/TransportManager.ts`. MeshCore BLE: `noble-ble-manager.ts` (macOS/Windows), Web Bluetooth IPC on Linux. Reticulum BLE: sidecar `btleplug` (RNode `ble://`, BLE Peer mesh) — coexistence via `ble-coexistence-coordinator.ts` (different MACs only; scan mutex). Serial: `lib/connection.ts`, `serialPortSignature.ts`. Connection panel errors: `lib/connectionPanelErrorHumanize.ts`. Reconnect watchdog: `runtime/useMeshtasticRuntime.ts`.
- **ATT MTU:** Noble sessions chunk `toRadio` writes from `peripheral.mtu` / `mtu` events (`bleAttWriteLimit.ts` for spec-safe defaults). Web Bluetooth (Linux) chunks only when Chromium exposes `BluetoothRemoteGATTCharacteristic.maximumWriteValueLength`; otherwise a single `writeValue` per payload (no portable negotiated-MTU API in the web spec).

### MQTT

- **Meshtastic:** `mqtt-manager.ts` (AES-128/256-CTR with Meshtastic nonce layout, channel key map, protobuf ingest, dedup); inbound MQTT text prefers topic channel name (`/2/e/` and `/2/json/`) mapped through `channelNameToIndex` (receiver-local slot); `meshtasticMqttPublish.ts` (per-channel uplink name/PSK); `meshtasticChannelPskInput.ts` + `src/shared/meshtasticChannelPskLine.ts` (Connection tab PSK lines, including `ChannelName@index=base64`); `meshtasticMqttSettingsStorage.ts` (manual key persistence/recovery); `meshtasticMqttIdentity.ts` (MQTT-only outbound `from`: last RF node id vs virtual id); `mqtt-broker-client-id.ts` (stable broker clientId in `app_settings`). Renderer TLS: `mqttTls.ts`.
- **Meshtastic WiFi/TCP (fast):** `TransportTcpIpc` + main-process `meshtastic:tcp-*` IPC (`net.Socket`, port **4403**, native framing); `connection.ts` `case 'tcp'`.
- **PKC remote admin (Meshtastic, local radio required):** `meshtasticRemoteAdmin.ts`, `meshtasticRemoteAdminSnapshot.ts` (tab-scoped partial fetch), `meshtasticRemoteAdminKeyStorage.ts` (per-node keys in `app_settings`), `ConfigureNodeSelector.tsx`; serialized with S&F via `meshtasticBacklogUtils.ts` (`remoteAdminReadsActiveCount`).
- **MeshCore:** `meshcore-mqtt-adapter.ts` (JSON v1 envelope); LetsMesh JWT in `letsMeshJwt.ts`.

### MeshCore Rooms

- **UI:** `RoomsPanel.tsx` + shared `ChatComposer.tsx`; unread `meshcoreRoomsUnread.ts`.
- **Runtime:** `useMeshcoreRuntime.ts` coordinates login queue, auto-sync (`meshcoreRoomSyncScheduler.ts`), and ingest dedup (`meshcoreStoreDedup.ts`).
- **RPC/helpers:** `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, `meshcoreRoomSession.ts`, `meshcoreChannelText.ts` (SignedPlain / tapbacks / Open wire via optional App toggle), `meshcoreGifWire.ts`, `meshcoreOpenReaction.ts`. RF-only (not MQTT). User guide: [docs/meshcore-meshtastic-parity.md](docs/meshcore-meshtastic-parity.md#meshcore-room-servers).

### UI

- Panels: `src/renderer/components/`. New tabs: `lazyTabPanels.ts` / `lazyAppPanels.ts` + capability requirements in `src/renderer/lib/appTabMappings.ts` (`TAB_CAPABILITY_REQUIREMENTS`, `computeTabMappings()`). **Administration:** `AdminPanel.tsx` (device commands / Danger Zone; Meshtastic OTA/DFU). **Config apply feedback:** `ConfigApplyNotice.tsx`. Stores: module defaults; persist vs SQLite IPC as elsewhere.

### Common issues

| Symptom                  | Where to check                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection fails         | `ConnectionDriver`, `hooks/useProtocolConnection.ts`, `runtime/useMeshtasticRuntime.ts`, `runtime/useMeshcoreRuntime.ts`                        |
| Send fails               | `hooks/useSendMessage.ts`, runtime send APIs, `TransportManager`                                                                                |
| UI stale                 | Zustand store, effect deps                                                                                                                      |
| Empty chat/nodes offline | `hydrateIdentityStoresFromDb`, runtime connect-time DB cache, `hooks/useDbRefresh.ts`                                                           |
| BLE timeout              | `noble-ble-manager.ts`, `bleConnectErrors`                                                                                                      |
| Serial missing           | `serialPortSignature.ts`                                                                                                                        |
| MQTT loop                | `mqtt-manager.ts`                                                                                                                               |
| MQTT decrypt fail        | `mqtt-manager.ts`, `meshtasticChannelPskInput.ts`                                                                                               |
| MQTT-only sender         | `meshtasticMqttIdentity.ts`, `runtime/useMeshtasticRuntime.ts`, `hooks/useSendMessage.ts`                                                       |
| Remote admin fail        | `meshtasticRemoteAdmin.ts`, `meshtasticRemoteAdminKeyStorage.ts`                                                                                |
| Garbled chat insert      | `meshtasticBacklogUtils.ts` readable-text filter                                                                                                |
| MeshCore dup/echo chat   | `meshcoreStoreDedup.ts`, `meshcoreChannelText.ts`                                                                                               |
| Room BBS login/post      | `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, [troubleshooting](docs/troubleshooting.md#meshcore-room-server-login-posts-and-windows-10) |
| DB errors                | `database.ts` migrations                                                                                                                        |
| Log gaps                 | `log-service.ts`, log tags                                                                                                                      |
