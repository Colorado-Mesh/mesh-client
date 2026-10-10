# Architecture quick reference

Developer reference: where to look first by area. Moved out of [`ARCHITECTURE.md`](../../ARCHITECTURE.md), which stays the human overview. Symptom lookups live in [common-issues.md](common-issues.md). Repo-wide rules live in [`AGENTS.md`](../../AGENTS.md).

## Diagnostics

- **Engines:** `src/renderer/lib/diagnostics/`; `RoutingDiagnosticEngine.ts`, `RFDiagnosticEngine.ts`, `RemediationEngine.ts`.
- **Store:** `src/renderer/stores/diagnosticsStore.ts`; routing/RF rows, foreign LoRa, MQTT ignore, redundancy.
- **Tab scoping:** `filterDiagnosticRowsForProtocol()` — Meshtastic/MeshCore tabs show LoRa rows only; Reticulum tab shows `reticulum/*` only. Foreign-LoRa tables UI is on Meshtastic and MeshCore tabs (keyed by that protocol’s self node id).
- **Extend:** adjust `DiagnosticRow` in `src/renderer/lib/types.ts`, add detector, wire `replaceRoutingRowsFromMap` / `replaceRfRowsForNode`; TTL defaults in `diagnosticRows.ts` (routing 24h, RF 1h).
- **Node health score:** `src/renderer/lib/nodeHealthScore.ts`; `nodeHealthScore(node)` → `NodeHealthBreakdown`; `nodeHealthTier(total)` → color tier.
- **Watch/notify:** `src/renderer/stores/watchedNodesStore.ts` (persisted Set<nodeId>); `src/renderer/hooks/useNodeStatusNotifier.ts` (fires OS Notification on online/offline transitions).
- **Full reference** (meanings, triggers, UI surfaces): [docs/diagnostics.md](../diagnostics.md).

## Bug workflow

1. Reproduce (`pnpm start`); note what you see.
2. Search errors under `src/main/` or `src/renderer/`.
3. Add `console.debug` only when needed.
4. Minimal fix + co-located tests.
5. `pnpm run test:run -- path/to/file.test.ts` and `pnpm run lint`.

**First places to look:** `runtime/useMeshtasticRuntime.ts` / `runtime/useMeshcoreRuntime.ts` (protocol side effects); `hooks/useProtocolConnection.ts` (connect); `stores/*` (UI state); `src/main/index.ts` (IPC).

**Renderer layers:** `runtime/` (single-mount protocol runtimes), `hooks/` (facades and store selectors), `lib/` (drivers, sessions, types), `stores/` (identity-scoped UI: `identityStore`, `nodeStore`, `messageStore`, `connectionStore`; Reticulum also uses session-global `reticulumIdentityStore` for sidecar identity status). Prefer `useProtocolFacade(protocol)` in App for new wiring. Hook/runtime boundaries: [renderer-hooks.md](renderer-hooks.md) ([#375](https://github.com/charlottemeshtastic/mesh-client/issues/375), [#377](https://github.com/charlottemeshtastic/mesh-client/issues/377)).

**Drivers / identity bridge:** `lib/drivers/ConnectionDriver.ts` owns RF/MQTT session lifecycle and dispatches Protocol events into `lib/drivers/PacketRouter.ts` (store ingest first, then side-effect listeners). `PacketRouter` invokes generic listeners before event-type listeners, in registration order within each group; attach persistence/ingest before dependent UI side effects. `lib/meshIdentityBridge.ts` builds transport params and attaches Meshtastic Protocol ingress; `lib/identityStoreReads.ts` is the canonical read path for identity-scoped nodes/messages (`getIdentityNode` / `getIdentityChatMessages`).

## Protocols

- **Meshtastic:** `runtime/useMeshtasticRuntime.ts`, `lib/protocols/MeshtasticProtocol.ts`, `lib/connection.ts` (`createConnection`).
- **MeshCore:** `runtime/useMeshcoreRuntime.ts`, `lib/protocols/MeshCoreProtocol.ts`, `@liamcottle/meshcore.js`.
- **Reticulum:** `runtime/useReticulumRuntime.ts`, `lib/sessions/reticulumSession.ts`, `components/ReticulumMapPanel.tsx`, `components/ReticulumRemotePanel.tsx`, `components/NomadNetworkPanel.tsx`, `components/RrcPanel.tsx`, `stores/reticulumDiscoveryMapStore.ts`, `stores/reticulumPeerStore.ts`, `stores/rncpTransferStore.ts`, `stores/rnshSessionStore.ts`, `stores/rrcHubStore.ts`, `stores/rrcSessionStore.ts`, `reticulum-sidecar/` (AGPL `mesh-client-reticulum` including `rrc_*` / `rnsh_*` / `rncp_*` modules); IPC `reticulum:*` in main with typed `electronAPI.reticulum.rrc|rnsh|rncp|remote`; RMAP map data: sidecar `DiscoveryStore` → REST/WS → store → join `reticulumPeerStore` for reachability; docs [docs/reticulum.md](../reticulum.md), [docs/reticulum-sidecar-ipc.md](../reticulum-sidecar-ipc.md).

## App lifecycle (mount once from `App.tsx`)

- **`usePowerRecovery`** — sleep/wake IPC, MQTT power suspend/resume, staggered RF reconnect (Meshtastic ~4s, MeshCore ~8s, dual-radio BLE settle up to ~30s).
- **`useRendererHeartbeat`** — renderer pings main every 30s; main `rendererHeartbeatWatchdog` warns if no heartbeat within 30s after resume **while visible**, and polls for a **90s visible-window stall**; sticky `rendererUnresponsiveSeen` + `getRendererLiveness()` feed support snapshot `mainLiveness`.
- **`ProtocolAutoConnectCoordinator`** / **`useProtocolRfAutoConnect`** — silent launch auto-connect for remembered serial/BLE/TCP/HTTP (cancel gate before manual Connect).
- **`rfReconnectController`** — LoRa single-owner reconnect scheduling shared by Meshtastic/MeshCore runtimes.
- **Dual-radio BLE** (Meshtastic + MeshCore different peripherals): concurrent sidecar GATT sessions; wake/startup stagger via `lib/meshcoreDualNobleBleInit.ts` (historical name) from `App.tsx` `useLayoutEffect` — see [ble-serial.md](ble-serial.md).

## Database

- WAL SQLite; `user_version` in `database.ts`; migrations as `migration_N()`; `db-compat.ts` over `node:sqlite`. After schema changes: `pnpm run check:db-migrations`.
- **Renderer DB → UI:** `lib/hydrateIdentityStoresFromDb.ts` (identity-scoped Zustand hydration; connect-time node cache before RF configure). **Startup prune:** `lib/startupDbPrune.ts` (once per app session from `App.tsx`).

## BLE and serial

- Meshtastic / MeshCore BLE: sidecar GATT (`gatt-sidecar-proxy.ts`, `transportSidecarGatt.ts`, `gatt:*` IPC) on all platforms. Reticulum BLE RNode/Peer runs in the same process with separate BLE centrals managed by rsReticulum. Main-process `ble-coexistence-coordinator.ts` tracks pending/live LoRa connections and configured Reticulum addresses, and serializes app-requested scans and LoRa connection setup. Autonomous rsReticulum discovery/reconnect remains outside that lease. Serial: `lib/connection.ts`, `serialPortSignature.ts`. Connection panel errors: `lib/connectionPanelErrorHumanize.ts` (`connectionPanel.errors.ble.*`). Reconnect watchdog: `runtime/useMeshtasticRuntime.ts`.
- **GATT writes:** Each Meshtastic ToRadio protobuf or MeshCore command is one characteristic value, capped at 512 bytes. Prefer writes with response when supported; let the OS handle ATT long writes. btleplug 0.11.8 does not expose negotiated MTU, so the sidecar does not infer a 20-byte application frame limit.

## MQTT

- **Meshtastic:** `mqtt-manager.ts` (AES-128/256-CTR with Meshtastic nonce layout, channel key map, protobuf ingest, dedup); inbound MQTT text prefers topic channel name (`/2/e/` and `/2/json/`) mapped through `channelNameToIndex` (receiver-local slot); `meshtasticMqttPublish.ts` (per-channel uplink name/PSK); `meshtasticChannelPskInput.ts` + `src/shared/meshtasticChannelPskLine.ts` (Connection tab PSK lines, including `ChannelName@index=base64`); `meshtasticMqttSettingsStorage.ts` (manual key persistence/recovery); `meshtasticMqttIdentity.ts` (MQTT-only outbound `from`: last RF node id vs virtual id); `mqtt-broker-client-id.ts` (stable broker clientId in `app_settings`). TLS: `src/shared/mqttTls.ts`.
- **Meshtastic WiFi/TCP (fast):** `TransportTcpIpc` + main-process `meshtastic:tcp-*` IPC (`net.Socket`, port **4403**, native framing); `connection.ts` `case 'tcp'`.
- **PKC remote admin (Meshtastic, local radio required):** `meshtasticRemoteAdmin.ts`, `meshtasticRemoteAdminSnapshot.ts` (tab-scoped partial fetch), `meshtasticRemoteAdminKeyStorage.ts` (per-node keys in `app_settings`), `ConfigureNodeSelector.tsx`; serialized with S&F via `meshtasticBacklogUtils.ts` (`remoteAdminReadsActiveCount`).
- **MeshCore:** `meshcore-mqtt-adapter.ts` (JSON v1 envelope); LetsMesh JWT in `letsMeshJwt.ts`.

## MeshCore Rooms

- **UI:** `RoomsPanel.tsx` + shared `ChatComposer.tsx`; unread `meshcoreRoomsUnread.ts`.
- **Runtime:** `useMeshcoreRuntime.ts` coordinates login queue, auto-sync (`meshcoreRoomSyncScheduler.ts`), and ingest dedup (`meshcoreStoreDedup.ts`).
- **RPC/helpers:** `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, `meshcoreRoomSession.ts`, `meshcoreChannelText.ts` (SignedPlain / tapbacks / Open wire via optional Radio toggle), `meshcoreGifWire.ts`, `meshcoreOpenReaction.ts`. RF-only (not MQTT). User guide: [docs/meshcore-meshtastic-parity.md](../meshcore-meshtastic-parity.md#meshcore-room-servers).

## UI

- Panels: `src/renderer/components/`. New tabs: `lazyTabPanels.ts` / `lazyAppPanels.ts` + capability requirements in `src/renderer/lib/appTabMappings.ts` (`TAB_CAPABILITY_REQUIREMENTS`, `computeTabMappings()`). **Administration:** `AdminPanel.tsx` (device commands / Danger Zone; Meshtastic OTA/DFU). **Config apply feedback:** `ConfigApplyNotice.tsx`. Stores: module defaults; persist vs SQLite IPC as elsewhere.

## EMCOMM (MECP + Incident Command)

- **MECP wire / alerts / audit / RF bridge:** `src/renderer/lib/mecp/` + `hooks/useMecpAlertWatcher.ts`; durable audit `mecp-received.log` via main `mecp-received-log.ts`. User toggle for Chat compose under App → MECP. See [mecp.md](mecp.md).
- **Incident Command:** always-visible **Incident** tab (`components/incident/`, `incidentStore`); emergency-priority outbox; R01/B02/B03 ACK/beacon; map markers + SAR overlays. See [emcomm.md](emcomm.md).

## Offline maps

- Privileged `mesh-tiles:` protocol + disk LRU under userData `tile-cache/` (`src/main/offline-maps/`); region download IPC; renderer **Layers → Offline maps**. Basemap allowlist includes OSM, Carto Dark, USGS Topo. See [offline-maps.md](offline-maps.md).
