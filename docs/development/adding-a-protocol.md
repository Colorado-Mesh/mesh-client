# Adding a MeshProtocol

One-pass checklist and **lessons from MeshCom (CM)** for registering a fifth (or later) RF protocol. Repo-wide rules: [`AGENTS.md`](../../AGENTS.md) (§1 Protocol parity). MeshCom-specific wire detail: [meshcom.md](meshcom.md).

MeshCom went from first transport to full parity across PRs [#1527–#1584](https://github.com/Colorado-Mesh/mesh-client/pulls?q=is%3Apr+meshcom). Most follow-ups were **not** wire bugs. They were shared surfaces that still defaulted to Meshtastic/MeshCore, helpers that needed one more id, and identity/persistence assumptions that only break after a restart. This page is that week distilled so the next protocol lands in **one pass** instead of compiling-yet-blank.

**Default:** shared Chat / Contacts / Map / Connection / Diagnostics / TAK / MECP surfaces apply to **all** registered protocols unless you document a justified exception. Gate with `ProtocolCapabilities` / `useRadioProvider(protocol)` — never `protocol === 'meshcore'` (or the new id) as the primary feature switch.

## 0. One-pass order

| Phase | What lands together                                             | Exit check                                                                                     |
| ----- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1     | Upstream audit + non-goals (§7.1)                               | Every destination class, command, ACK, beacon, hardware id is in scope or written as non-goal  |
| 2     | Registration spine (§1)                                         | App paints with the protocol enabled **and** with a live runtime; no first-paint crash         |
| 3     | Shell routing: tabs, detail modal, first-run, switcher (§2–3)   | Every shared control reaches the new protocol's actions, not another protocol's fallback       |
| 4     | Transports + saved devices + wake (§4)                          | Serial, BLE, and claimed network transports connect, reconnect, and survive sleep              |
| 5     | Identity, destinations, persistence, outbound (§6)              | Restart preserves history, destinations, self ownership, favorites, and settled delivery state |
| 6     | Product parity: chat, radio, telemetry, map, diagnostics (§7–8) | Capability matrix walked; nothing is capability-on with dead UI behind it                      |
| 7     | Ops, triage, docs, packaging (§9–11)                            | Hide/stop, firmware check, labels, support export, docs/nav, package metadata                  |
| 8     | Gates and smoke (§12)                                           | `check:pr`, bundle budget, first-run E2E, and the support-export drill                         |

Prefer **one branch / one PR**. If you must stack, the registration spine must not merge before shell routing — TypeScript will accept a half-registered protocol, and the app will silently route to another stack.

## 1. Registration spine

Touch these in one PR (or a stacked pair: types → runtime → UI):

| Layer            | What to update                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type union       | `REGISTERED_MESH_PROTOCOLS` in [`src/shared/meshProtocol.ts`](../../src/shared/meshProtocol.ts) (drives SQL `CHECK`, `isMeshProtocol`, most maps)                                                                                                                                                                                                                                                                                                                                                                    |
| Capabilities     | `*_CAPABILITIES` + provider in [`BaseRadioProvider.ts`](../../src/renderer/lib/radio/BaseRadioProvider.ts) / [`providerFactory.ts`](../../src/renderer/lib/radio/providerFactory.ts); extend [`protocol-capabilities.test.ts`](../../src/renderer/lib/radio/protocol-capabilities.test.ts)                                                                                                                                                                                                                           |
| Theme            | Accent scale + monogram in `styles.css` / [`protocolTheme.ts`](../../src/renderer/lib/protocolTheme.ts) (+ test); label and 700-step badge colour                                                                                                                                                                                                                                                                                                                                                                    |
| Offline identity | [`offlineProtocolIdentities.ts`](../../src/renderer/lib/offlineProtocolIdentities.ts) (`OFFLINE_*_IDENTITY_ID`, stub protocol)                                                                                                                                                                                                                                                                                                                                                                                       |
| Protocol adapter | `src/renderer/lib/protocols/<Name>Protocol.ts` + [`protocolRegistry.ts`](../../src/renderer/lib/protocols/protocolRegistry.ts) / lazy loader if codecs are heavy                                                                                                                                                                                                                                                                                                                                                     |
| Runtime          | `use<Name>Runtime.ts` mounted **once** from `App.tsx`; session register in `lib/sessions/`. If App uses a disabled/pre-live stub (lazy enable), spread `createInertProtocolRuntimeBase()` and register the factory in [`protocolRuntimeDisabledStubs.ts`](../../src/renderer/runtime/protocolRuntimeDisabledStubs.ts) — [`protocolRuntimeAppPaint.test.ts`](../../src/renderer/runtime/protocolRuntimeAppPaint.test.ts) walks `REGISTERED_MESH_PROTOCOLS` and fails incomplete stubs (`e is not iterable` on launch) |
| Panel actions    | `use<Name>PanelActions` + [`useAllProtocolPanelActions`](../../src/renderer/hooks/useAllProtocolPanelActions.ts); connection actions via [`useAllProtocolConnectionActions`](../../src/renderer/hooks/useAllProtocolConnectionActions.ts)                                                                                                                                                                                                                                                                            |
| Facade / maps    | Every `protocolRecord(...)` / `selectByProtocol({...})` / `Record<MeshProtocol, …>` in App, hooks, stores — TypeScript will miss **runtime** fallthroughs that still compile                                                                                                                                                                                                                                                                                                                                         |
| Tabs             | [`appTabMappings.ts`](../../src/renderer/lib/appTabMappings.ts) `TAB_CAPABILITY_REQUIREMENTS` / `computeTabMappings()`                                                                                                                                                                                                                                                                                                                                                                                               |
| First run        | [`FirstRunProtocolPicker.tsx`](../../src/renderer/components/FirstRunProtocolPicker.tsx) `PROTOCOL_NEEDS_KEY` + `firstRun.needs.<id>`; [`firstRunWizard.ts`](../../src/renderer/lib/firstRunWizard.ts) default selection / tour order; licence or consent gate if the radio needs one                                                                                                                                                                                                                                |
| App settings     | [`defaultAppSettings.ts`](../../src/renderer/lib/defaultAppSettings.ts) `hiddenProtocols` default (opt-in protocols) + any protocol-scoped keys                                                                                                                                                                                                                                                                                                                                                                      |
| DB               | Migrations + `db:*` IPC; hydrate path in [`hydrateIdentityStoresFromDb.ts`](../../src/renderer/lib/hydrateIdentityStoresFromDb.ts)                                                                                                                                                                                                                                                                                                                                                                                   |
| i18n             | English keys only in `en/translation.json`; no hardcoded UI English                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Docs             | Subsystem page under `docs/development/` + row in [index.md](index.md) + `mkdocs.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Hide / stop      | `hiddenProtocols`, auto-connect `enabled`, power-resume skip, explicit-disconnect latch (see MeshCom App → Protocols)                                                                                                                                                                                                                                                                                                                                                                                                |
| GitHub triage    | Protocol label + auto-labeler + issue templates + support export / log ownership (see §11)                                                                                                                                                                                                                                                                                                                                                                                                                           |

Then run the exhaustiveness sweep — the union is only half the job:

```bash
rg -n "REGISTERED_MESH_PROTOCOLS|Record<MeshProtocol|protocolRecord\(|selectByProtocol\(" src scripts
```

Files that have held a `Record<MeshProtocol, …>` or a protocol list and are easy to miss: `ProtocolSwitcher`, `InactiveProtocolNotifier`, `AppPanel`, `TakUnitFiltersSection`, `TeamRosterPanel`, `EmergencyIncidentRow`, `chatPanelProtocolStorage`, `detailModalProtocol`, `useActiveMeshIdentity`, `useBotSenderDetection`, `chatOrderScope`, `weatherFilterStore`, `botSendersStore`, `quitMeshClient`, `firstRunWizard`, `offlineProtocolIdentities`, `protocolRuntimeDisabledStubs`.

TypeScript catches a missing key in a literal `Record<MeshProtocol, T>`. It does **not** catch `Partial<Record<…>>`, `Record<string, T>`, array-index maps, or `?? meshtastic` fallbacks. Grep for the old protocol ids next to your new one as a second pass.

`pnpm run test:run` / `check:pr` will not catch every App `selectByProtocol` omission — grep for `meshtastic:` / `meshcore:` maps when adding a peer.

## 2. App / shell audit (fallthroughs)

MeshCom repeatedly broke when a shared control still selected Meshtastic or MeshCore actions:

- **Contacts / Nodes** `onToggleFavorite` — must resolve the **active** protocol’s `setNodeFavorited` (prefer an explicit `selectByProtocol({ …, meshcom: meshcomPanelActions.setNodeFavorited }, protocol)` map, not a union that can pick a no-op stub).
- **Detail modal** — `detailModalPanelActions` / `detailModalProtocol` must track the node’s protocol, not only the rail tab.
- **Delete / send / device commands** — same map discipline; MeshCom `deleteNode` is required even when `ProtocolRuntime` types it optional (re-narrow in panel actions).
- **Tabs** — `TAB_CAPABILITY_REQUIREMENTS` / `computeTabMappings()`; a protocol without Meshtastic channel config still needs a way onto Radio if you ship device settings (MeshCom: `hasMeshcomDeviceCommands`).
- **Sniffer / Stats / live map** — turn off capabilities you do not implement (`hasRawPacketLog`, etc.) so UI does not fall through to another protocol’s buffers.
- **First run** — the picker and setup tour are driven by `REGISTERED_MESH_PROTOCOLS`; add the requirement copy, default-checked state, licence acknowledgement, and tour step. A fresh install must reach the new protocol’s Connection tab without manual navigation.
- **Protocol switch** — panels that must stay mounted across switches (MeshCore Rooms) use [`protocolSwitchCommit.ts`](../../src/renderer/lib/protocolSwitchCommit.ts); a new protocol must not remount peers or drop their state on switch.
- **Hide / stop** — unchecking the protocol must remove it from the switcher, skip auto-connect, disconnect the active session, **disconnect its MQTT adapter**, and latch explicit-disconnect so power-wake does not revive it.
- **String gates** — add the new id to `PATTERNS` in [`scripts/check-protocol-string-gates.mjs`](../../scripts/check-protocol-string-gates.mjs) so `protocol === '<new>'` cannot spread through components; allowlist only with a reason.

## 3. Contacts, Graph, and favorites

Shared list already shows a star column for Contacts layouts. Lessons:

1. **Identity buckets** — App Contacts read `identityIdByProtocol` / `getIdentityIdForProtocol`; the runtime session ref (`identityIdRef`) can differ (offline hydrate vs RF connect). Favorites/delete must **resolve the row**, then **sync every <Protocol>-relevant identity** (`syncIdentityIds`: UI + session + offline), seeding missing buckets so the star is visible in `nodesForUi`.
2. **DB ingest** — `save*Contact` paths that omit `favorited` must **preserve** an existing star (MeshCom: `favorited_provided` CASE in SQLite upsert). Otherwise MHEARD/position churn clears favorites.
3. **Panel-actions memo** — MeshCom’s runtime object churns (MQTT status, nodes, messages). `useMeshcomPanelActions` must depend on **individual callbacks** (`runtime.setNodeFavorited`, …), not `[runtime]` alone, or Contacts can hold a stale handler after HMR / status updates.
4. **Display identity** — do not invent Meshtastic `!xxxxxxxx` labels for protocols whose identity is a callsign (or other non-node-num scheme). History stubs use `meshcomCallForNodeId` when registered. Graph labels should prefer a full name/callsign over a 4-char short name when the protocol has both.
5. **Import / export** — a protocol may need its own import format (MeshCom callsign JSON/CSV) without enabling MeshCore QR/pubkey/offload flags. Keep the capability flags separate and prove export columns in `nodeExportRows`.
6. **MHEARD / neighbor data** — map it into `hopsAway` / `path` / `neighbors` so VIA stations hang under digipeater hubs; keep on-demand status commands protocol-specific (never call MeshCore `requestRepeaterStatus`).
7. **Tests** — `NodeListPanel` with `mode: '<protocol>'` asserting add/remove favorites; runtime test that `setNodeFavorited` is not `async () => {}` and persists via DB IPC; identity helper tests for multi-bucket sync.

## 4. Transport sessions

BLE and serial sessions are **per protocol**, even when the wire profile is shared. Test each claimed transport independently:

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
7. Keep GATT events session-scoped. A failed MeshCore connect once logged `[GATT:meshtastic] connect_timeout` while the Meshtastic link was healthy; issue/error fan-out must carry and filter the session id, and the Log panel must not attribute one protocol's failure to another.
8. Add reconnect backoff / retry caps, and guard device-command writes while the session is not connected (show a connecting state instead of silent `write_failed: Not connected`).
9. Wire host-link RSSI end-to-end (Connection panel Signal row) — see §4.1.

### 4.1 Host-link BLE RSSI (Connection panel)

Shared meter: [`useHostLinkMeter`](../../src/renderer/hooks/useHostLinkMeter.ts) + GATT `linkRssi` from [`gatt-sidecar-proxy.ts`](../../src/main/gatt-sidecar-proxy.ts). MeshCom lessons that apply to any new GATT session:

1. **Session filter** — `onGattLinkRssi` / RSSI poll must accept the new session id (`meshtastic` \| `meshcore` \| `meshcom`). Filtering only the older two leaves Signal as `—` forever even when the radio is connected.
2. **CoreBluetooth has no live connected RSSI** on the LoRa btleplug path (darwin stays on btleplug 0.11; `read_rssi` is 0.13-only and cannot share a process with rsReticulum’s 0.11 Objective-C class). Host Signal must be seeded from **advertisement / scan** RSSI.
3. **Do not connect-without-scan on reconnect** — a “fast path” that opens GATT when the peripheral is already known skips discovery, so the proxy/sidecar scan-RSSI maps stay empty. [`reconnectBleWithScan`](../../src/renderer/lib/bleReconnectHelper.ts) runs a short discovery-first pass (`BLE_RECONNECT_DISCOVERY_TIMEOUT_SECS`) before connect; auto-connect and Connection panel Reconnect both use it.
4. **Persist `bleRssi` on picker select** into `lastConnection` (and keep updating from meter/scan) so cold reconnect can seed the UI even after `bleDevices` is cleared.
5. **Key normalization** — remember scan RSSI under lowercase address, punctuation-stripped / compact hex, and match the same keys at connect (`rememberScanRssi` / sidecar `last_seen_rssi`). UUID vs MAC aliases break seeds when keys diverge.
6. **Sidecar cache locking** — sync RSSI maps must not use `try_lock` and silently drop samples; prefer a `std::sync::Mutex` for the advertisement cache.
7. **Tests** — proxy: scan then connect emits seeded `linkRssi` when live `/rssi` is unavailable; helper: discovery-first match + long-scan retry; hook: `bleSeedRssi` until GATT emits.

### 4.2 Serial / USB

1. **Cross-protocol yield** — before opening, call the shared serial claim helper ([`serialPortClaim.ts`](../../src/renderer/lib/serialPortClaim.ts)) so another LoRa protocol's `releaseHold` frees the same port / matching USB signature. A manual serial Connect should also cancel other protocols' deferred auto-connects. Otherwise users see Chromium's `The port is already open`.
2. **Protocol-scoped saved port** — never read the global `mesh-client:lastSerialPort` for a protocol connect. Resolve the protocol's own saved port ([`lastConnectionStorage.ts`](../../src/renderer/lib/lastConnectionStorage.ts) / `resolveLastSerialPortId`) and fall back to `navigator.serial.requestPort()` when it is missing — **and** on `SERIAL_NO_MATCH_ERROR`, not only on an ambiguous match. MeshCom could not connect at all once any other part of the app had saved a port.
3. **Ambiguous signatures** — when two matching ports share VID/PID (Dual CP2105), open the picker instead of binding the first. Include `serialNumber` from [`serialPortSignature.ts`](../../src/renderer/lib/serialPortSignature.ts) when Chromium exposes it. Do not count time spent in the picker against the connect timeout.
4. **Post-wake health** — join [`serialDeliveryHealth.ts`](../../src/renderer/lib/serialDeliveryHealth.ts) and [`serialDeliveryProbe.ts`](../../src/renderer/lib/serialDeliveryProbe.ts): after sleep/resume or transport loss, treat the open USB port as untrusted until a delivery probe succeeds, then nudge replug/reboot. Track health per `identityId`.
5. **Failure copy** — distinguish an in-app hold (name the other protocol) from an OS/other-app lock, and log the connected-state snapshot for every LoRa protocol at claim/open failure.
6. **Preserve path identity** — keep `serialPath` casing when saving/reusing history.

### 4.3 UDP / TCP / HTTP

1. **Canonical peer** — resolve hostnames once and filter inbound datagrams by the canonical peer, not the unresolved string. Echo/receive mismatch is silent otherwise.
2. **One socket per protocol** — a fixed local port (MeshCom EXTUDP 1799) means a second app instance or another process yields `EADDRINUSE`; document it in the subsystem page and the connection error copy.
3. **Bound inbound before IPC** — drop oversized datagrams (MeshCom: 4 KiB) and rate-limit peer forwarding (MeshCom: 60/s) before the renderer fan-out. Send `Uint8Array`, not Node buffers.
4. **Bound framing** — cap KISS/line buffers (MeshCom: 128 KiB) and drop until the next `FEND` / newline on overflow.
5. **No inherited Meshtastic defaults** — clear or ignore stale Meshtastic TCP/UDP defaults for the new protocol, or cold auto-connect will try an endpoint the radio does not speak.
6. **Auth threat model** — if the firmware provides client-proves-password (MeshCom KISS / NET Console HMAC), scope passwords per endpoint, label the transport as LAN/VPN-only, and state plainly that there is no TLS or mutual peer proof. Do not imply authentication the wire cannot provide.

### 4.4 Wire safety, echo, and path parsing

1. **Sanitize before encode** — strip/escape control characters and CRLF in user text before serial/BLE command framing or chat injection (`hi\r\n--reboot` must not become a command).
2. **Clamp at both ends** — clamp inbound `msg` / `src` / `dst` fields in the codec, and enforce the outbound byte budget (UTF-8 bytes, including destination prefix) in the composer and transport.
3. **Own-TX echo filter** — many nodes reflect local sends back on the same transport. Drop chat rows whose source matches the operator identity or a recent outbound `dst`+text, while keeping POS/telemetry from self.
4. **No ghost self** — do not synthesize a fallback self marker while the identity is unknown (`myNodeNum === 0`); wait for `setOwner` / learned callsign.
5. **Normalize paths per hop** — a digipeater path like `IK5NJM-11,IW5EIA-12` must be split and normalized hop-by-hop; clamping the whole string produces `IK5NJM11IW5` and breaks DM replies.
6. **One notify = one frame** — do not scan past a protocol shortcut byte inside a BLE notify if the firmware promises one frame per notify; strip firmware padding (MeshCom pads to `blelen+2` with NULs).

### 4.5 Saved devices and connection history

1. **Per-protocol history** — [`connectionHistoryStorage.ts`](../../src/renderer/lib/connectionHistoryStorage.ts) keys are `mesh-client:connectionHistory:<id>` (max 20 entries); the identity key includes protocol + endpoint type. Seed the list from `lastConnection` when the history key is new.
2. **MRU vs display** — `lastConnection` stays the auto-connect / power-wake MRU. A failed or mismatched attempt must not overwrite an unrelated saved device.
3. **Save after success** — only add an entry once configure/connect succeeds. Defer the BLE MRU until configure succeeds, cancel stale BLE reconnect ownership, remove the matching row on `BLE_SELECTION_CLEARED`, and delete on raw-read errors instead of wiping the whole list.
4. **Radio name is display-only** — persist [`radioSelfName.ts`](../../src/renderer/lib/radioSelfName.ts) as a friendly label; identity and reconnect keys stay endpoint-based. Refresh it when the radio name arrives or changes.
5. **Serial path case** — preserve `serialPath` casing when saving and reusing history; endpoints are compared by signature, not raw string equality.
6. **Tests** — two saved endpoints, reconnect the older one, delete one without touching the other, failed attempt does not overwrite MRU, BLE clear removes only that row, stale reconnect does not complete.

## 5. MQTT

- Prefer **protocol-scoped storage** (`mqttSettings:<id>`, `mqttProfiles:<id>`, secure `mqtt:<id>` / `mqtt:profiles:<id>`) — do not overload Meshtastic’s legacy unscoped keys. Strip legacy Meshtastic `channelPsks` from anything new you write.
- **Presets vs custom:** MeshCom is custom-only (no Official/LetsMesh). Gate preset UI with capabilities; Connection panel + settings search need **unique** `data-setting-anchor` ids per protocol control (duplicate anchors fail `settingsSearchAnchors.test.ts`).
- **Empty state:** collapse an MQTT block that has no server, saved profile, or live session, and point at the device-side gateway path instead of showing a dead form.
- Main process: either a dedicated adapter instance or a clearly multiplexed manager; `mqttTransportProtocol` validation and connect/disconnect/power paths must list the new id. Give the adapter a distinct `logTag` (MeshCom: `[MeshCom MQTT]`).
- **Single-session exception:** if encrypted channel ingest would duplicate across brokers, keep the new protocol to one MQTT session and document that deliberate exception (MeshCore's multi-broker analyzer feeds are the opposite case).
- **Main bundle budget** — new MQTT wiring in `index.ts` counts toward `check:main-bundle`. Deduplicate event fan-out (see `attachMqttAdapterUiEvents`) or move bulk into a sibling esbuild entry before raising the budget.

## 6. Identity, destinations, persistence, and outbound

- Soft-normalize protocol addresses; stable `nodeId` for Zustand keys; never show another protocol’s id format in shared lists.
- **Persist native destinations** — store `*`, group numbers, or callsigns as the wire uses them; do not invent synthetic `NFFFFFFFF` ids for broadcasts. Do not register broadcast placeholders as contacts. Derive chat tabs at hydrate, and classify DMs by the protocol’s discriminator (MeshCom: `channel === -1`), not by “has a `to` field”. Recover legacy rows that carry a stray `to`.
- **Offline identity** — always write SQLite under `OFFLINE_<NAME>_IDENTITY_ID` so history survives before the first RF connect. On connect, `mergeOfflineStoreIntoIdentity`, and provide `db:rebind<Name>Identity` to adopt orphaned `id-*` rows after restart.
- **DB scoping and failure** — require a non-empty `identityId` on message/contact reads and writes; never fall through to another identity bucket. If SQLite is unavailable, use a documented degraded path and a user-visible toast (`<id>:db-degraded`), not a silent drop.
- **Send destination priority** — an explicit DM peer wins over a stale group/channel index left over from the last pill.
- **Favorites / user flags** — preserve them across upserts and identity merges (see §3).
- **Outbound ids** — if the firmware assigns ids from a sequence that restarts on every connection (MeshCom `msg_id` 1..N, wraps at 1000), the numeric wire id is **not** unique across sessions. Use `claimOutboundMessageId()` before renaming, keep ACK matching on the numeric prefix, and never pre-persist the provisional store id — it can never equal the final wire id and leaves a permanently `sending` duplicate row.
- **Early self** — stamp outbound with the device identity even when self is not known yet, and remap prior `from:0` rows when `myNodeNum` / callsign arrives.
- **Delivery semantics** — model ACK/NACK per transport, not per protocol. MeshCom DMs wait for peer ACK only on BLE and KISS/TCP; EXTUDP and USB serial ack on wire accept. Keep timeout (~6 min), settle the right row, and mark missing-key / orphan sends **Blocked**, not Failed, so they are not auto-resent.
- **System beacons** — detect network-time / gateway beacons by prefix only; record liveness, skip the chat store, and note that legacy rows may still hydrate.
- **Chat order** — scope per protocol **and** radio node; migrate legacy `:0:` keys only after a successful copy; re-read when persistence goes false→true on reconnect.
- **Tests** — send → restart → hydrate round-trip for destinations, self, favorites; outbound-id collision; rebind; beacon prefix.

## 7. Capabilities and product parity

Before shipping “protocol X is done,” walk shared surfaces with a matrix (at least smoke):

| Surface                    | Minimum to claim it                                                              | Common exception / off-switch                                  |
| -------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Connection                 | BLE / serial / TCP / UDP / HTTP matrix you actually support                      | Capability off for transports you do not implement             |
| Saved devices              | Per-protocol history, reconnect, delete, display name, MRU for cold auto-connect | Display name only; identity stays endpoint-based (see §4.5)    |
| Chat destinations          | Every class the firmware knows: ALL, groups, rooms, DMs, digipeater paths        | Named catalog instead of raw numbers                           |
| Delivery status            | ACK / NACK / timeout mapped onto outbound rows                                   | `hasChannelDeliveryAck: false` only when the wire has none     |
| Contacts                   | List + detail + favorite + delete + import/export as applicable                  | Separate import flag from MeshCore QR/pubkey/offload           |
| Graph / MHEARD / neighbors | Path, hops, VIA hubs, on-demand status if available                              | `hasNeighborInfo: false` when the firmware has no neighbor API |
| Map                        | Positions; live local traffic if the sniffer can feed it                         | Overview-only or external map link when no local RF stream     |
| Radio / device config      | Config sections, read-on-connect, apply, feature-gain gates                      | Explicit “out of scope” list per command class                 |
| Telemetry                  | Battery / environment from each transport you claim                              | Per-source table in the subsystem page                         |
| Diagnostics                | Diagnostics rows, Stats/Sniffer packet ring, RF histograms                       | Turn the capability off; never reuse another protocol’s buffer |
| Notifications              | Callsign / identity watchlist, system beacons, cooldowns                         | Capability-gated settings section                              |
| MQTT                       | Custom broker or documented single-session exception                             | `hasMqttConnectionPanel: false`                                |
| TAK / MECP / EMCOMM        | CoT feed, structured reports, rebroadcast endpoint, callsign rules               | Shared path must include the new protocol                      |
| Firmware                   | Installed version, update check, release link, optional flash                    | `hasDeviceFirmwareFlash: false` with upstream instructions     |
| Hide / stop / power resume | Switcher, auto-connect, latch, wake, MQTT disconnect                             | Opt-in protocols default hidden                                |

Document justified exceptions in the protocol’s `docs/development/*.md` and inline `// Protocol-specific: …` where you gate.

### 7.1 Upstream product audit (avoid thin UX)

Transport + codec parity is necessary but not sufficient. A protocol can decode traffic and still feel unfinished when **chat addressing**, **device filters**, **delivery feedback**, or **companion commands** from the upstream docs never reach shared UI. Treat the vendor’s public pages (not this repo’s other stacks) as a checklist before calling the protocol done.

**Chat address space**

1. **Inventory every destination class** the radio/firmware understands (flood / ALL, named or numeric groups, rooms, DMs, digipeater paths, etc.). Wire decode alone is not product parity — each class needs a visible way to open, send, and (when the protocol books it on the node) listen.
2. **Merge device booking into the chat strip.** If the node holds a listen filter, channel list, or group slots, those ids must appear as pills alongside ALL and any history-discovered destinations. Local “open without booking” tabs are fine; they must not replace the device list.
3. **Vendor named catalogs when upstream publishes them.** Prefer a typed registry (id → short label + i18n note/reach) over raw numbers in the strip and join picker. Register dynamic translation-key prefixes (`<catalog>.${leaf}`) in [`scripts/i18n-unused-keys.mjs`](../../scripts/i18n-unused-keys.mjs) so catalog leaves are not flagged unused.
4. **Radio Identity / device settings ↔ Chat.** Slot editors, master-first ordering, max-slot limits, clear-all, and group removal belong next to other identity knobs **and** must stay consistent with what Chat shows after apply. Removing a pill should unbook it from the node when device commands exist.
5. **Chat “+” / join UX** should search the catalog, accept custom ids the wire allows, and optionally book the node when Serial/BLE (or equivalent) is available.
6. **Watchlist / alerts** — if operators chase specific callsigns, base-identity matching, a cooldown, and `msg`/`pos`-only triggers belong in Notifications, not in an ad-hoc chat filter. Persist the setting before updating the cache or firing notifications; a failed save must not replace the previous list.
7. **External services** — if the ecosystem has a map/telemetry site, link it and expose the action that actually feeds it (e.g. send POS); do not imply the in-app map is that service.

**Delivery and status**

1. **Map firmware ACK / NACK / routing events onto chat rows.** If the transport emits delivery proof, wire it through the runtime (typed packet listener or equivalent), keep outbound DMs in `sending` until settle or timeout, and set capability flags honestly (`hasChannelDeliveryAck`, etc.). Fire-and-forget UI on an ACK-capable radio is a product gap, not a transport gap.
2. **Broadcast vs DM semantics differ** — document which destinations ack on wire-accept vs wait for peer proof; tests should cover both.
3. **Transport badges / provenance** — if the firmware distinguishes RF vs gateway, or direct vs digipeated, persist and show it (MeshCom: text `RF` / `GW`, hop tooltips with digipeater callsigns).

**Companion / device command catalog**

1. **Walk the full upstream command list**, not only RF/modem knobs. Flags that change chat behavior (suppress ALL, gateway/APRS inject, group listen, mailbox) need either first-class controls or an explicit “out of scope” note in the protocol’s subsystem doc.
2. **Capability honesty** — turn flags on only when the UI and side effects exist; leave them off (and document why) when the wire exists but product work is deferred. False negatives hide features; false positives show dead controls.
3. **Write down non-goals** in the subsystem page (MQTT ingest, embed maps, hardware id ranges, store-and-forward, …). Silence reads as unfinished; an explicit non-goal prevents the next contributor from rediscovering the same gap as a bug.
4. **Audit the vendor tables you mirror** — hardware id tables, country/region profiles, command lists. Record the firmware version/source you reviewed.

**Smoke questions before “done”**

- Can a user open every destination class the firmware docs describe without typing opaque wire syntax?
- After booking listen slots on the node, do those destinations appear in Chat without a reload hack?
- Does a DM that the radio ACKs leave `sending`, and does a missed ACK eventually fail?
- Is every chat-affecting companion flag either in Radio UI or listed as a deliberate non-goal?
- Does a restart keep history, destinations, self ownership, and favorites?
- Does the support export name the protocol in its identity/MQTT/RF buckets and log tags?

## 8. Device configuration, commands, and firmware

1. **Typed command catalog** — id → label + i18n note + wire channel. MeshCom marks `app` commands as Serial **and** BLE (`0xA0`); reserve `serial` for USB-console-only rows. Keep the wire module in the hot path and lazy-load the full catalog from the Radio panel.
2. **Read on connect** — load the node's current values (`--info` / `--wx`, BLE `{HELLO}` + config burst) with an explicit timeout, prefill the UI, and seed telemetry. BLE may need a longer wait than serial before the config burst drains.
3. **Apply safety** — keep dirty tracking (do not resync while editing), send the command, verify the resulting value, and keep chat/identity views consistent with what was applied.
4. **Firmware-variant gates** — model known stock vs vendor/mod firmware explicitly. Known stock: block the command with an error toast. Unknown: allow send with a “only on …” hint. Never silently no-op.
5. **Region / legal gate** — if the radio is licensed-band or region-scoped, use the country/region profile table, require a one-time acknowledgement, and show a persistent hint. Keep it distinct from Meshtastic's licensed-frequency unlock.
6. **Secrets** — redact passwords/tokens from logs and support bundles; never echo them in command results.
7. **Settings search** — unique anchors per control, and anchors must resolve inside collapsed sections (`SettingsCollapsible`).
8. **Firmware update check** — wire `hasFirmwareUpdateCheck`, the upstream releases URL, installed-version parsing, and a dismissible “don't remind me” toast. Sync the firmware string into runtime state so the notifier runs; compare vendor-tagged versions, not raw build stamps.

## 9. Tests and CI

- Prefer protocol-matrix or capability-driven cases for shared components (`NodeListPanel`, `ConnectionPanel`, `FirstRunProtocolPicker`).
- Source-contract / runtime contract tests when full BLE/SQLite integration is impractical (`loadRuntimeSource`, `index.contract.test.ts` for IPC guards).
- Required suites when adding a protocol:
  - `meshProtocol.test.ts`, `protocol-capabilities.test.ts`, `protocolTheme.test.ts`, `appProtocolSelect.test.ts`, `appTabMappings.test.ts`
  - `protocolRuntimeAppPaint.test.ts` (enabled **and** disabled stub), `firstRunWizard.test.ts`
  - wire codecs: caps, field clamping, CRLF injection, UTF-8 byte budgets, NUL padding, one-frame notify
  - ingest/hydrate round-trip: destinations, self, favorites, orphan rebind, outbound-id collision
  - ACK settle/timeout and blocked-vs-failed sends
  - serial claim/no-match/ambiguous picker; saved-device history; BLE RSSI seeding
  - `logProtocolScope.test.ts`, `check:log-panel-filter`
- Path-gated pre-commit: staging `src/main/` runs `check:main-bundle`; staging English locale runs `i18n:auto-translate`; staging `src/shared/` runs `typecheck:strict-shared`.
- Do not leave `setNodeFavorited: async () => {}` (or similar) stubs in the shipped runtime return object.
- Add the protocol to the first-run E2E (`launchApp({ firstRun: true })`) and the packaged-artifact skip step.
- Run `pnpm run check:pr` before the PR and `pnpm run check:changed` before push. `check:protocol-string-gates` must include the new id.

## 10. Docs, packaging, and release surface

1. **Subsystem page** under `docs/development/` with transports, identity/addressing, persistence, capabilities, device commands, telemetry, MQTT, known limitations/non-goals, and key source files. Add it to [index.md](index.md) and `mkdocs.yml`.
2. **Product copy** — README pitch/features/usage tables, [`docs/features.md`](../features.md), `src/shared/docsSite.ts`, and the Flatpak `<summary>` / `<description>` all list the protocol count and names.
3. **Package metadata** — root `package.json` description/keywords and `contributors` (see the credits rule in `AGENTS.md`).
4. **Attribution** — prior-art tools/libraries in [`docs/credits.md`](../credits.md) and the third-party license table where required; do not hand-edit generated license tables.
5. **Troubleshooting** — add entry points for the protocol’s transport-specific failures (port already open, `EADDRINUSE`, auth, firmware mismatch) and mention the protocol in the support-bundle instructions.
6. **Log ownership** — register console tags in [`logProtocolScope.ts`](../../src/shared/logProtocolScope.ts) and channel/session regexes in [`logProtocolChannelResolve.ts`](../../src/shared/logProtocolChannelResolve.ts) (GATT/BLE/IPC/`stack=`), and add the protocol’s source trees to [`scripts/check-log-panel-filter.mjs`](../../scripts/check-log-panel-filter.mjs).
7. **Chunk naming** — keep shared main/renderer chunks protocol-neutral. A chunk named after one protocol makes overnight errors from another stack stamp the wrong `[proto=…]`; lazy-load the protocol registration from `ConnectionDriver` and prefer IPC invoke tokens for attribution.
8. **Upstream watch** — if the firmware publishes releases, add a `check_<name>_upstream` entry to `scripts/update.sh` (`<NAME>_UPSTREAM_WATCH_ENTRIES`) and document the reviewed ref/pin. That pin is maintainer-only; it does not drive the in-app update check.

## 11. GitHub labels, issue templates, and support exports

Maintainers triage by protocol label and by **Export for GitHub** bundles. When adding a protocol:

1. **Create the GitHub label** on `Colorado-Mesh/mesh-client` (same style as `meshtastic` / `meshcore` / `reticulum`):
   `gh label create <id> --color <hex> --description "Touches <Name> protocol support"`
   (MeshCom uses `#a2182f`, matching `meshcom-700`.)
2. **PR auto-labeler** — add the Conventional Commits scope and high-confidence path rules in [`scripts/label-pr.mjs`](../../scripts/label-pr.mjs) (`SCOPE_LABELS` + `PATH_RULES`) and coverage in `scripts/label-pr.test.mjs`. The workflow is [`.github/workflows/labeler.yaml`](../../.github/workflows/labeler.yaml) (same-repo PRs only).
3. **Issue templates** — add a checkbox under Protocol / Protocol relevance in [`.github/ISSUE_TEMPLATE/bug_report.md`](../../.github/ISSUE_TEMPLATE/bug_report.md) and [`feature_request.md`](../../.github/ISSUE_TEMPLATE/feature_request.md).
4. **Debug snapshot** — include a `sessionSummary.<id>` entry and a top-level protocol bucket in [`debugSnapshot.ts`](../../src/renderer/lib/debugSnapshot.ts) so Export for GitHub / Developer zips expose identity/MQTT/RF triage for the new stack (not only Meshtastic/MeshCore/Reticulum).
5. **Log ownership** — see §10.6; shared MQTT adapters need a distinct `logTag` (see MeshCom’s `[MeshCom MQTT]`).
6. **Support-bundle README** — mention the new protocol in [`support-bundle.ts`](../../src/main/support-bundle.ts) GitHub/Developer README text and in [troubleshooting.md](../troubleshooting.md#reporting-bugs-export-for-github-app-tab) when documenting what maintainers read first.

App logs (`mesh-client.log` / `.1`) already ship in every support zip; ownership tags and the debug-snapshot bucket are what make MeshCom (or a fifth protocol) triageable without grepping shared lines.

## 12. Definition of done

A protocol is done when all of these are true on a **fresh profile** and after a **restart**:

- [ ] First-run picker lists it, the consent/licence gate works, Continue saves `hiddenProtocols`, and the tour reaches its Connection tab.
- [ ] Enabling/hiding stops and restores RF, MQTT, auto-connect, and power-resume behavior; the switcher and rail monogram match the theme.
- [ ] Every claimed transport connects, reconnects, appears in Saved devices, and survives sleep/wake without stealing another protocol's port or BLE session.
- [ ] Chat: every destination class the firmware exposes can be opened and sent to; device-booked destinations appear without a reload; DMs settle or fail; own sends do not echo; no ghost self marker.
- [ ] Restart: history, destinations, self ownership, ordering, favorites, and settled delivery state survive; no duplicate/stuck `sending` rows.
- [ ] Contacts/Graph: favorites stick across ingest; detail modal actions hit this protocol; MHEARD/VIA data renders; import/export (if claimed) works.
- [ ] Radio: read-on-connect prefills values; every catalog section applies; firmware-variant gates behave; country/legal gate is honest; settings search finds the controls.
- [ ] Map / Stats / Sniffer / RF / live traffic either work from this protocol's own buffers or are capability-off — never another protocol's data.
- [ ] TAK / MECP / EMCOMM / notifications / firmware update check include the protocol where shared.
- [ ] Support export contains the protocol bucket, tagged log lines, and identity/MQTT/RF state; README and troubleshooting name it.
- [ ] `pnpm run check:pr`, `check:main-bundle`, first-run E2E, and the docs/nav link tests are green.

## See also

- [meshcom.md](meshcom.md) — worked example (EXTUDP / KISS / serial / BLE / NET Console / MQTT / Radio commands / MHEARD)
- [ble-serial.md](ble-serial.md) — GATT proxy, coexistence, dual-radio
- [mqtt.md](mqtt.md) — Meshtastic / MeshCore MQTT patterns
- [settings-search.md](settings-search.md) — anchors and registry
- [renderer-hooks.md](renderer-hooks.md) — runtime vs hooks vs facade
- [architecture-quick-ref.md](architecture-quick-ref.md) — where to look first
