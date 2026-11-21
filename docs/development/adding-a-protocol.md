# Adding a MeshProtocol

Checklist and **lessons from MeshCom (CM)** for registering a fifth (or later) RF protocol. Repo-wide rules: [`AGENTS.md`](../../AGENTS.md) (§1 Protocol parity). MeshCom-specific wire detail: [meshcom.md](meshcom.md).

**Default:** shared Chat / Contacts / Map / Connection / Diagnostics surfaces apply to **all** registered protocols unless you document a justified exception. Gate with `ProtocolCapabilities` / `useRadioProvider(protocol)` — never `protocol === 'meshcore'` (or the new id) as the primary feature switch.

## 1. Registration spine

Touch these in one PR (or a stacked pair: types → runtime → UI):

| Layer            | What to update                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type union       | `REGISTERED_MESH_PROTOCOLS` in [`src/shared/meshProtocol.ts`](../../src/shared/meshProtocol.ts) (drives SQL `CHECK`, `isMeshProtocol`, most maps)                                                                                                                                                                                                                                                                                                      |
| Capabilities     | `*_CAPABILITIES` + provider in [`BaseRadioProvider.ts`](../../src/renderer/lib/radio/BaseRadioProvider.ts) / `providerFactory.ts`; extend [`protocol-capabilities.test.ts`](../../src/renderer/lib/radio/protocol-capabilities.test.ts)                                                                                                                                                                                                                |
| Theme            | Accent scale + monogram in `styles.css` / [`protocolTheme.ts`](../../src/renderer/lib/protocolTheme.ts) (+ test)                                                                                                                                                                                                                                                                                                                                       |
| Offline identity | [`offlineProtocolIdentities.ts`](../../src/renderer/lib/offlineProtocolIdentities.ts) (`OFFLINE_*_IDENTITY_ID`, stub protocol)                                                                                                                                                                                                                                                                                                                         |
| Protocol adapter | `src/renderer/lib/protocols/<Name>Protocol.ts` + `protocolRegistry` / lazy loader if codecs are heavy                                                                                                                                                                                                                                                                                                                                                  |
| Runtime          | `use<Name>Runtime.ts` mounted **once** from `App.tsx`; session register in `lib/sessions/`. If App uses a disabled/pre-live stub (lazy enable), spread `createInertProtocolRuntimeBase()` and register the factory in [`protocolRuntimeDisabledStubs.ts`](../../src/renderer/runtime/protocolRuntimeDisabledStubs.ts) — `protocolRuntimeAppPaint.test.ts` walks `REGISTERED_MESH_PROTOCOLS` and fails incomplete stubs (`e is not iterable` on launch) |
| Panel actions    | `use<Name>PanelActions` + [`useAllProtocolPanelActions`](../../src/renderer/hooks/useAllProtocolPanelActions.ts)                                                                                                                                                                                                                                                                                                                                       |
| Facade / maps    | Every `protocolRecord(...)` / `selectByProtocol({...})` / `Record<MeshProtocol, …>` in App, hooks, stores — TypeScript will miss **runtime** fallthroughs that still compile                                                                                                                                                                                                                                                                           |
| DB               | Migrations + `db:*` IPC; hydrate path in [`hydrateIdentityStoresFromDb.ts`](../../src/renderer/lib/hydrateIdentityStoresFromDb.ts)                                                                                                                                                                                                                                                                                                                     |
| i18n             | English keys only in `en/translation.json`; no hardcoded UI English                                                                                                                                                                                                                                                                                                                                                                                    |
| Docs             | Subsystem page under `docs/development/` + row in [index.md](index.md) + `mkdocs.yml`                                                                                                                                                                                                                                                                                                                                                                  |
| Hide / stop      | `hiddenProtocols`, auto-connect `enabled`, power-resume skip, explicit-disconnect latch (see MeshCom App → Protocols)                                                                                                                                                                                                                                                                                                                                  |
| GitHub triage    | Protocol label + auto-labeler + issue templates + support export / log ownership (see §9)                                                                                                                                                                                                                                                                                                                                                              |

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
- Chat (address space + channel strip + DM / broadcast semantics — see §7.1)
- Contacts (list + detail + favorite + delete)
- Map (positions only vs live traffic)
- Radio / device config (and any companion CLI catalog — see §7.1)
- Diagnostics (or explicit off)
- MQTT (or `hasMqttConnectionPanel: false`)
- Hide protocol + power resume
- Node detail OTA / telemetry fields you parse

Document justified exceptions in the protocol’s `docs/development/*.md` and inline `// Protocol-specific: …` where you gate.

### 7.1 Upstream product audit (avoid thin UX)

Transport + codec parity is necessary but not sufficient. A protocol can decode traffic and still feel unfinished when **chat addressing**, **device filters**, **delivery feedback**, or **companion commands** from the upstream docs never reach shared UI. Treat the vendor’s public pages (not this repo’s other stacks) as a checklist before calling the protocol done.

**Chat address space**

1. **Inventory every destination class** the radio/firmware understands (flood / ALL, named or numeric groups, rooms, DMs, digipeater paths, etc.). Wire decode alone is not product parity — each class needs a visible way to open, send, and (when the protocol books it on the node) listen.
2. **Merge device booking into the chat strip.** If the node holds a listen filter, channel list, or group slots, those ids must appear as pills alongside ALL and any history-discovered destinations. Local “open without booking” tabs are fine; they must not replace the device list.
3. **Vendor named catalogs when upstream publishes them.** Prefer a typed registry (id → short label + i18n note/reach) over raw numbers in the strip and join picker. Register dynamic `t(\`….\${leaf}\`)`prefixes in`scripts/i18n-unused-keys.mjs` so catalog leaves are not flagged unused.
4. **Radio Identity / device settings ↔ Chat.** Slot editors, master-first ordering, max-slot limits, and clear-all behavior belong next to other identity knobs **and** must stay consistent with what Chat shows after apply.
5. **Chat “+” / join UX** should search the catalog, accept custom ids the wire allows, and optionally book the node when Serial/BLE (or equivalent) is available.

**Delivery and status**

1. **Map firmware ACK / NACK / routing events onto chat rows.** If the transport emits delivery proof, wire it through the runtime (typed packet listener or equivalent), keep outbound DMs in `sending` until settle or timeout, and set capability flags honestly (`hasChannelDeliveryAck`, etc.). Fire-and-forget UI on an ACK-capable radio is a product gap, not a transport gap.
2. **Broadcast vs DM semantics differ** — document which destinations ack on wire-accept vs wait for peer proof; tests should cover both.

**Companion / device command catalog**

1. **Walk the full upstream command list**, not only RF/modem knobs. Flags that change chat behavior (suppress ALL, gateway/APRS inject, group listen, mailbox) need either first-class controls or an explicit “out of scope” note in the protocol’s subsystem doc.
2. **Capability honesty** — turn flags on only when the UI and side effects exist; leave them off (and document why) when the wire exists but product work is deferred. False negatives hide features; false positives show dead controls.
3. **Write down non-goals** in the subsystem page (MQTT ingest, embed maps, hardware id ranges, store-and-forward, …). Silence reads as unfinished; an explicit non-goal prevents the next contributor from rediscovering the same gap as a bug.

**Smoke questions before “done”**

- Can a user open every destination class the firmware docs describe without typing opaque wire syntax?
- After booking listen slots on the node, do those destinations appear in Chat without a reload hack?
- Does a DM that the radio ACKs leave `sending`, and does a missed ACK eventually fail?
- Is every chat-affecting companion flag either in Radio UI or listed as a deliberate non-goal?

## 8. Tests and CI

- Prefer protocol-matrix or capability-driven cases for shared components (`NodeListPanel`, ConnectionPanel).
- Source-contract / runtime contract tests when full BLE/SQLite integration is impractical (`loadRuntimeSource`, `index.contract.test.ts` for IPC guards).
- Path-gated pre-commit: staging `src/main/` runs `check:main-bundle`; staging English locale runs `i18n:auto-translate`.
- Do not leave `setNodeFavorited: async () => {}` (or similar) stubs in the shipped runtime return object.

## 9. GitHub labels, issue templates, and support exports

Maintainers triage by protocol label and by **Export for GitHub** bundles. When adding a protocol:

1. **Create the GitHub label** on `Colorado-Mesh/mesh-client` (same style as `meshtastic` / `meshcore` / `reticulum`):
   `gh label create <id> --color <hex> --description "Touches <Name> protocol support"`
   (MeshCom uses `#a2182f`, matching `meshcom-700`.)
2. **PR auto-labeler** — add the Conventional Commits scope and high-confidence path rules in [`scripts/label-pr.mjs`](../../scripts/label-pr.mjs) (`SCOPE_LABELS` + `PATH_RULES`) and coverage in `scripts/label-pr.test.mjs`. The workflow is [`.github/workflows/labeler.yaml`](../../.github/workflows/labeler.yaml) (same-repo PRs only).
3. **Issue templates** — add a checkbox under Protocol / Protocol relevance in [`.github/ISSUE_TEMPLATE/bug_report.md`](../../.github/ISSUE_TEMPLATE/bug_report.md) and [`feature_request.md`](../../.github/ISSUE_TEMPLATE/feature_request.md).
4. **Debug snapshot** — include a `sessionSummary.<id>` entry and a top-level protocol bucket in [`debugSnapshot.ts`](../../src/renderer/lib/debugSnapshot.ts) so Export for GitHub / Developer zips expose identity/MQTT/RF triage for the new stack (not only Meshtastic/MeshCore/Reticulum).
5. **Log ownership** — register console tags in [`logProtocolScope.ts`](../../src/shared/logProtocolScope.ts) and extend channel/session regexes in [`logProtocolChannelResolve.ts`](../../src/shared/logProtocolChannelResolve.ts) (GATT/BLE/IPC/`stack=`). Add the protocol’s source trees to [`scripts/check-log-panel-filter.mjs`](../../scripts/check-log-panel-filter.mjs) so unregistered tags fail CI. Shared MQTT adapters need a distinct `logTag` (see MeshCom’s `[MeshCom MQTT]`).
6. **Support-bundle README** — mention the new protocol in [`support-bundle.ts`](../../src/main/support-bundle.ts) GitHub/Developer README text and in [troubleshooting.md](../troubleshooting.md#reporting-bugs-export-for-github-app-tab) when documenting what maintainers read first.

App logs (`mesh-client.log` / `.1`) already ship in every support zip; ownership tags and the debug-snapshot bucket are what make MeshCom (or a fifth protocol) triageable without grepping shared lines.

## See also

- [meshcom.md](meshcom.md) — worked example (EXTUDP / KISS / serial / BLE / MQTT / Radio commands)
- [ble-serial.md](ble-serial.md) — GATT proxy, coexistence, dual-radio
- [mqtt.md](mqtt.md) — Meshtastic / MeshCore MQTT patterns
- [settings-search.md](settings-search.md) — anchors and registry
- [renderer-hooks.md](renderer-hooks.md) — runtime vs hooks vs facade
- [architecture-quick-ref.md](architecture-quick-ref.md) — where to look first
