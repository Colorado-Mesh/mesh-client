# Adding a MeshProtocol

Checklist and **lessons from MeshCom (CM)** for registering a fifth (or later) RF protocol. Repo-wide rules: [`AGENTS.md`](../../AGENTS.md) (§1 Protocol parity). MeshCom-specific wire detail: [meshcom.md](meshcom.md).

**Default:** shared Chat / Contacts / Map / Connection / Diagnostics surfaces apply to **all** registered protocols unless you document a justified exception. Gate with `ProtocolCapabilities` / `useRadioProvider(protocol)` — never `protocol === 'meshcore'` (or the new id) as the primary feature switch.

## 1. Registration spine

Touch these in one PR (or a stacked pair: types → runtime → UI):

| Layer            | What to update                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type union       | `REGISTERED_MESH_PROTOCOLS` in [`src/shared/meshProtocol.ts`](../../src/shared/meshProtocol.ts) (drives SQL `CHECK`, `isMeshProtocol`, most maps)                                                                                       |
| Capabilities     | `*_CAPABILITIES` + provider in [`BaseRadioProvider.ts`](../../src/renderer/lib/radio/BaseRadioProvider.ts) / `providerFactory.ts`; extend [`protocol-capabilities.test.ts`](../../src/renderer/lib/radio/protocol-capabilities.test.ts) |
| Theme            | Accent scale + monogram in `styles.css` / [`protocolTheme.ts`](../../src/renderer/lib/protocolTheme.ts) (+ test)                                                                                                                        |
| Offline identity | [`offlineProtocolIdentities.ts`](../../src/renderer/lib/offlineProtocolIdentities.ts) (`OFFLINE_*_IDENTITY_ID`, stub protocol)                                                                                                          |
| Protocol adapter | `src/renderer/lib/protocols/<Name>Protocol.ts` + `protocolRegistry` / lazy loader if codecs are heavy                                                                                                                                   |
| Runtime          | `use<Name>Runtime.ts` mounted **once** from `App.tsx`; session register in `lib/sessions/`                                                                                                                                              |
| Panel actions    | `use<Name>PanelActions` + [`useAllProtocolPanelActions`](../../src/renderer/hooks/useAllProtocolPanelActions.ts)                                                                                                                        |
| Facade / maps    | Every `protocolRecord(...)` / `selectByProtocol({...})` / `Record<MeshProtocol, …>` in App, hooks, stores — TypeScript will miss **runtime** fallthroughs that still compile                                                            |
| DB               | Migrations + `db:*` IPC; hydrate path in [`hydrateIdentityStoresFromDb.ts`](../../src/renderer/lib/hydrateIdentityStoresFromDb.ts)                                                                                                      |
| i18n             | English keys only in `en/translation.json`; no hardcoded UI English                                                                                                                                                                     |
| Docs             | Subsystem page under `docs/development/` + row in [index.md](index.md) + `mkdocs.yml`                                                                                                                                                   |
| Hide / stop      | `hiddenProtocols`, auto-connect `enabled`, power-resume skip, explicit-disconnect latch (see MeshCom App → Protocols)                                                                                                                   |

`pnpm run test:run` / `check:pr` will not catch every App `selectByProtocol` omission — grep for `meshtastic:` / `meshcore:` maps when adding a peer.

## 2. App / shell audit (fallthroughs)

MeshCom repeatedly broke when a shared control still selected Meshtastic or MeshCore actions:

- **Contacts / Nodes** `onToggleFavorite` — must resolve the **active** protocol’s `setNodeFavorited` (prefer an explicit `selectByProtocol({ …, meshcom: meshcomPanelActions.setNodeFavorited }, protocol)` map, not a union that can pick a no-op stub).
- **Detail modal** — `detailModalPanelActions` / `detailModalProtocol` must track the node’s protocol, not only the rail tab.
- **Delete / send / device commands** — same map discipline; MeshCom `deleteNode` is required even when `ProtocolRuntime` types it optional (re-narrow in panel actions).
- **Tabs** — `TAB_CAPABILITY_REQUIREMENTS` / `computeTabMappings()`; a protocol without Meshtastic channel config still needs a way onto Radio if you ship device settings (MeshCom: `hasMeshcomDeviceCommands`).
- **Sniffer / Stats / live map** — turn off capabilities you do not implement (`hasRawPacketLog`, etc.) so UI does not fall through to another protocol’s buffers.

## 3. Contacts favorites (NodeListPanel)

Shared list already shows a star column for Contacts layouts. Lessons:

1. **Identity buckets** — App Contacts read `identityIdByProtocol` / `getIdentityIdForProtocol`; the runtime session ref (`identityIdRef`) can differ (offline hydrate vs RF connect). Favorites/delete must **resolve the row**, then **sync every MeshCom-relevant identity** (`syncIdentityIds`: UI + session + offline), seeding missing buckets so the star is visible in `nodesForUi`.
2. **DB ingest** — `save*Contact` paths that omit `favorited` must **preserve** an existing star (MeshCom: `favorited_provided` CASE in SQLite upsert). Otherwise MHEARD/position churn clears favorites.
3. **Panel-actions memo** — MeshCom’s runtime object churns (MQTT status, nodes, messages). `useMeshcomPanelActions` must depend on **individual callbacks** (`runtime.setNodeFavorited`, …), not `[runtime]` alone, or Contacts can hold a stale handler after HMR / status updates.
4. **Callsign / id display** — do not invent Meshtastic `!xxxxxxxx` labels for protocols whose identity is a callsign (or other non-node-num scheme). History stubs use `meshcomCallForNodeId` when registered.
5. **Tests** — `NodeListPanel` with `mode: '<protocol>'` asserting add/remove favorites; runtime test that `setNodeFavorited` is not `async () => {}` and persists via DB IPC; identity helper tests for multi-bucket sync.

## 4. BLE / GATT sessions

LoRa BLE uses sidecar GATT via [`gatt-sidecar-proxy.ts`](../../src/main/gatt-sidecar-proxy.ts). Session slots are **not** the same as sidecar wire profiles:

| Concept                              | Example                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `GattSessionProfile` (Electron slot) | `meshtastic` \| `meshcore` \| `meshcom`               |
| Sidecar wire profile                 | `meshtastic` \| `meshcore` (NUS) \| `rnode` \| `peer` |

MeshCom BLE reuses **MeshCore NUS** on the wire (`gattWireProfileFromSession('meshcom') === 'meshcore'`) but keeps a **distinct session** and coexistence owner `gatt:meshcom`.

When adding BLE for a new protocol:

1. Extend `GattSessionProfile` + `isGattSessionProfile`.
2. Map the session → wire profile (reuse NUS/MeshCore/Meshtastic as appropriate).
3. Accept the new id in **every** `gatt:*` IPC guard in `src/main/index.ts` (`start-scan`, `stop-scan`, `connect`, `disconnect`, `is-connected`, `to-radio`). Missing this yields: `sessionId must be meshtastic or meshcore`.
4. Register `gatt:<protocol>` on `BlePeripheralOwner` and treat it like other LoRa owners when Reticulum holds the scan lease.
5. Transport / `connectGattWithScanBusyRetry('<session>', …)` must use the **session** id, not only the wire profile.
6. Update [ble-serial.md](ble-serial.md) session-id wording and LogPanel / logAnalyzer tags if you emit `[GATT:<session>]`.
7. Wire host-link RSSI end-to-end (Connection panel Signal row) — see §4.1.

### 4.1 Host-link BLE RSSI (Connection panel)

Shared meter: [`useHostLinkMeter`](../../src/renderer/hooks/useHostLinkMeter.ts) + GATT `linkRssi` from [`gatt-sidecar-proxy.ts`](../../src/main/gatt-sidecar-proxy.ts). MeshCom lessons that apply to any new GATT session:

1. **Session filter** — `onGattLinkRssi` / RSSI poll must accept the new session id (`meshtastic` \| `meshcore` \| `meshcom`). Filtering only the older two leaves Signal as `—` forever even when the radio is connected.
2. **CoreBluetooth has no live connected RSSI** on the LoRa btleplug path (darwin stays on btleplug 0.11; `read_rssi` is 0.13-only and cannot share a process with rsReticulum’s 0.11 Objective-C class). Host Signal must be seeded from **advertisement / scan** RSSI.
3. **Do not connect-without-scan on reconnect** — a “fast path” that opens GATT when the peripheral is already known skips discovery, so the proxy/sidecar scan-RSSI maps stay empty. [`reconnectBleWithScan`](../../src/renderer/lib/bleReconnectHelper.ts) runs a short discovery-first pass (`BLE_RECONNECT_DISCOVERY_TIMEOUT_SECS`) before connect; auto-connect and Connection panel Reconnect both use it.
4. **Persist `bleRssi` on picker select** into `lastConnection` (and keep updating from meter/scan) so cold reconnect can seed the UI even after `bleDevices` is cleared.
5. **Key normalization** — remember scan RSSI under lowercase address, punctuation-stripped / compact hex, and match the same keys at connect (`rememberScanRssi` / sidecar `last_seen_rssi`). UUID vs MAC aliases break seeds when keys diverge.
6. **Sidecar cache locking** — sync RSSI maps must not use `try_lock` and silently drop samples; prefer a `std::sync::Mutex` for the advertisement cache.
7. **Tests** — proxy: scan then connect emits seeded `linkRssi` when live `/rssi` is unavailable; helper: discovery-first match + long-scan retry; hook: `bleSeedRssi` until GATT emits.

## 5. MQTT

- Prefer **protocol-scoped storage** (`mqttSettings:<id>`, `mqttProfiles:<id>`, secure `mqtt:<id>` / `mqtt:profiles:<id>`) — do not overload Meshtastic’s legacy unscoped keys.
- **Presets vs custom:** MeshCom is custom-only (no Official/LetsMesh). Gate preset UI with capabilities; Connection panel + settings search need **unique** `data-setting-anchor` ids per protocol control (duplicate anchors fail `settingsSearchAnchors.test.ts`).
- Main process: either a dedicated adapter instance or a clearly multiplexed manager; `mqttTransportProtocol` validation and connect/disconnect/power paths must list the new id.
- **Main bundle budget** — new MQTT wiring in `index.ts` counts toward `check:main-bundle`. Deduplicate event fan-out (see `attachMqttAdapterUiEvents`) or move bulk into a sibling esbuild entry before raising the budget.

## 6. Identity, ingest, and outbound

- Soft-normalize protocol addresses; stable `nodeId` for Zustand keys; never show another protocol’s id format in shared lists.
- Ingest: tombstones / locally-deleted contacts; preserve user flags (`favorited`) across upserts.
- Outbound persist + optimistic UI: cover send failure and reconnect; MeshCom isolated CM chat so messages do not land in MeshCore/Meshtastic stores.
- `mergeOfflineStoreIntoIdentity` on connect so offline hydration is not stranded when a new primary identity is created.

## 7. Capabilities and product parity

Before shipping “protocol X is done,” walk shared surfaces with a matrix (at least smoke):

- Connection (transport matrix you claim: BLE / serial / TCP / UDP / HTTP)
- Chat (channels / ALL / DM semantics)
- Contacts (list + detail + favorite + delete)
- Map (positions only vs live traffic)
- Radio / device config
- Diagnostics (or explicit off)
- MQTT (or `hasMqttConnectionPanel: false`)
- Hide protocol + power resume
- Node detail OTA / telemetry fields you parse

Document justified exceptions in the protocol’s `docs/development/*.md` and inline `// Protocol-specific: …` where you gate.

## 8. Tests and CI

- Prefer protocol-matrix or capability-driven cases for shared components (`NodeListPanel`, ConnectionPanel).
- Source-contract / runtime contract tests when full BLE/SQLite integration is impractical (`loadRuntimeSource`, `index.contract.test.ts` for IPC guards).
- Path-gated pre-commit: staging `src/main/` runs `check:main-bundle`; staging English locale runs `i18n:auto-translate`.
- Do not leave `setNodeFavorited: async () => {}` (or similar) stubs in the shipped runtime return object.

## See also

- [meshcom.md](meshcom.md) — worked example (EXTUDP / KISS / serial / BLE / MQTT / Radio commands)
- [ble-serial.md](ble-serial.md) — GATT proxy, coexistence, dual-radio
- [mqtt.md](mqtt.md) — Meshtastic / MeshCore MQTT patterns
- [settings-search.md](settings-search.md) — anchors and registry
- [renderer-hooks.md](renderer-hooks.md) — runtime vs hooks vs facade
- [architecture-quick-ref.md](architecture-quick-ref.md) — where to look first
