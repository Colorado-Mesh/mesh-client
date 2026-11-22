# MeshCom protocol

MeshCom 4.0 is the fourth RF protocol (`meshcom`, rail monogram **CM**). It mirrors the MeshCore/Meshtastic LoRa spine (`ConnectionDriver` / `PacketRouter` / shared Chat·Contacts·Map·Radio·Diagnostics) with first-party codecs under `src/renderer/lib/meshcom/` — there is **no** MeshCom npm SDK, and MeshCore/`meshcore.js` codecs must not drive MeshCom wire frames.

Checklist / lessons for the next protocol: [adding-a-protocol.md](adding-a-protocol.md).

## Transports

| Transport    | Port / medium       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **EXTUDP**   | UDP **1799**        | Primary MVP. JSON `msg` / `pos` / `tele`. Node needs `--extudp on` + `--extudpip`. Main bridge: `src/main/ipc/udp-bridge.ts`.                                                                                                                                                                                                                                                                                                                    |
| **KISS/TCP** | TCP **8001**        | Required. AX.25 UI over KISS (`0x00`/`0x10`/`0x20`/`0xF0`). Not Reticulum `kiss` / `ax25kiss`.                                                                                                                                                                                                                                                                                                                                                   |
| **Serial**   | 115200 console      | `--` commands, `{CALL}text` inject, `--info` / `--setctry` / ExtUDP+KISS bootstrap.                                                                                                                                                                                                                                                                                                                                                              |
| **BLE**      | NUS + phone framing | Sidecar GATT session `gatt:meshcom` (same NUS UUID as MeshCore). Picker hides `RNode*` adverts and prefers `MC-<mac>-<call>` names; firmware pads notifies with trailing NULs (`blelen+2`) which the client strips before JSON parse. Connection panel **Signal** is scan-seeded (CoreBluetooth has no live GATT RSSI on the LoRa btleplug path) — see [adding-a-protocol.md §4.1](adding-a-protocol.md#41-host-link-ble-rssi-connection-panel). |

Shared constants: `src/shared/meshcomConstants.ts`.

## Identity and addressing

- Soft-normalize callsigns (`normalizeMeshcomCallsign`) — no hard ITU reject.
- Stable store key: `callsignToNodeId` → uint32; wire address remains the callsign.
- Chat: `*` = ALL (channel 0), groups = positive GRC ids, DM = channel `-1`.
- Digipeater path from comma-separated `src` → hop display (`messageRouteDetail: 'floodPath'`).

## Persistence

SQLite tables `meshcom_messages` / `meshcom_contacts` with IPC `db:*Meshcom*`. Hydration via `hydrateIdentityStoresFromDb('meshcom', …)`.

## Licensed amateur radio notice

MeshCom operates on region-selected ham LoRa frequencies (`--setctry` / Country Setting — worldwide profiles in `meshcomCountryProfiles.ts`). First enable in App → Protocols requires an i18n acknowledgment (`meshcom.licenseNotice*`); Connection panel shows a persistent hint. Distinct from Meshtastic’s licensed-ham frequency unlock toggle.

## App → Protocols (hide / stop)

MeshCom is **opt-in**: default `hiddenProtocols` includes `meshcom`. Unchecking **Enable MeshCom** in App → Protocols adds it to `hiddenProtocols`, which:

- Removes it from the protocol switcher (`enabledProtocolsFrom`)
- Skips RF auto-connect (`ProtocolAutoConnectCoordinator` `enabled: false`)
- Disconnects an active session and latches explicit-disconnect via `latchHiddenProtocolStop('meshcom')` → `meshcomSession` (so power-wake / reconnect will not revive it)
- Skips power-resume recovery while hidden

Re-enabling clears the latch and shows MeshCom again after the license acknowledgment (first time only).

## MQTT (Connection panel)

MeshCom has `hasMqttConnectionPanel: true` and `hasMqttHybrid: false`. Broker settings are **custom only** (no Meshtastic Official/Liam or MeshCore LetsMesh network presets) and live in their own storage:

| Key                                | Role                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| `mesh-client:mqttSettings:meshcom` | Active broker fields (+ secure `mqtt:meshcom` password)     |
| `mesh-client:mqttProfiles:meshcom` | Saved custom broker list (+ secure `mqtt:profiles:meshcom`) |

Connect uses `mqttTransportProtocol: 'meshcom'` and a dedicated main-process adapter instance (same MQTT.js stack as MeshCore; no MeshCom chat ingest yet). Device-side gateway commands (`--gateway`, …) remain under Radio → Device Configuration.

## Device configuration (Radio panel)

Capability `hasMeshcomDeviceCommands` also unlocks the **Radio** tab (`TAB_CAPABILITY_REQUIREMENTS` — MeshCom has neither `hasChannelConfig` nor MeshCore `hasJsonRadioConfigImport`). MeshCom has **no** Meshtastic protobuf config slices — every ICSSW [node command](https://icssw.org/en/meshcom-kommandos-cl-gw/) is applied as a `--` console line over Serial/BLE.

Radio → **Device Configuration** renders first-class sections (Display, Position / GPS, Sensors, Identity & groups, WiFi / Network, Gateway, Bluetooth, Neighbors, Mailbox, Status & debug, Power & OTA, KISS / misc) from the catalog in [`meshcomCommands.ts`](../../src/renderer/lib/meshcom/meshcomCommands.ts). UI: [`MeshComDeviceCommandsSection.tsx`](../../src/renderer/components/MeshComDeviceCommandsSection.tsx). Wire: Serial CRLF or BLE `0xA0` via [`meshcomDeviceCommands.ts`](../../src/renderer/lib/meshcom/meshcomDeviceCommands.ts). EXTUDP/KISS are chat-only (sections stay visible with a Serial/BLE notice).

**Chat wire length:** Serial/BLE outbound text is capped at **160 UTF-8 bytes** for address prefix + body (`{260}…` / `{CALL}…`; ALL has no braces). The composer uses a UTF-8 byte counter. EXTUDP JSON `msg` remains capped at 150 characters in the codec.

**MeshCom RM / kocel commands:** `--battcal` and `--e22pa` (plus stock `--txpower`) live in the Power group. RM-only rows are gated with [`meshcomRmFirmware.ts`](../../src/renderer/lib/meshcom/meshcomRmFirmware.ts) using `FWVER` / settings `firmwareVersion` (e.g. `4.40a-rm5`). Known **stock** firmware blocks those sends with an error toast; **unknown** firmware still allows send and shows an “only on MeshCom RM / kocel” hint.

### Serial / BLE command badges

Each catalog row carries a `channel` in [`meshcomCommands.ts`](../../src/renderer/lib/meshcom/meshcomCommands.ts): **`app`** means the command can be sent from Serial **and** the BLE companion (`0xA0`); the Device Configuration UI labels these as App+Serial. **`serial`** is reserved for USB-console-only entries (none in the current ICSSW catalog). `meshcomCommandWire.ts` stays in the hot App path; load the full catalog only from the lazy Radio panel.

- **Read on connect**: after Serial/BLE attach, `refreshMeshcomDeviceSettings` loads the node’s current values — Serial via `--info` text parse + `--wx` weather dump, BLE via `{HELLO}` companion JSON (`TYP` I/SN/SW/G/SA/W/… then `CONFFIN`) with `--info` / `--wx` fallback. Firmware waits ~3s after HELLO before draining the config burst, so the BLE `CONFFIN` wait is 15s. Snapshot prefills Device User / Country and Radio command rows (`meshcomDeviceSettings.ts`) and seeds Telemetry.
- **Country Apply** (above Device Configuration) saves `meshcomCountryCode` and, on Serial/BLE, sends `--setctry <code>` (reboots after ~15s on the node).
- **Auto `--settime`**: app setting `meshcomAutoSettime` (default off). When enabled, after each Serial/BLE connect the runtime sends `--settime yyyy.mm.dd hh:mm:ss` in host UTC.
- Meshtastic Device Role / Position / Power / WiFi / Display / Bluetooth shells stay off for MeshCom so the Radio tab is not an empty config heading.

## Dynamic APRS telemetry commands

ICSSW [dynamic telemetry compilation](https://icssw.org/en/telemetrie-dynamisch-zusammenstellen/) (`--parm` / `--unit` / `--eqns` / `--values` / `--ptime` / `--tel`) is in the Sensors group of [`meshcomCommands.ts`](../../src/renderer/lib/meshcom/meshcomCommands.ts) (Device Configuration / console). Packets go RF→MeshCom server→aprs.fi and are hidden from the APP by design — no dedicated builder UI. Value token names include `press`, `hum`, `temp`, `onewire`, `co2`, `gasres`, `batt`, `proz`, `vbus`, `vcurrent`, `qnh`.

## Callsign watchlist

App → Notifications → MeshCom callsign watchlist stores base callsigns (SSID ignored). When MeshCom ingest hears a matching **`msg`** or **`pos`** (not bare `node_info` POS refreshes), it plays the DM notification tone and fires an OS notification (30s cooldown per base call).

## Network time liveness

Inbound text whose payload **starts with** `{CET}` (gateway/network clock, ~every 5 minutes — firmware prefix match) updates [`meshcomNetworkTime.ts`](../../src/renderer/lib/meshcom/meshcomNetworkTime.ts). Live traffic: `PacketRouter` records the beacon and skips the message store; ingest only drops `{CET}` rows that arrive as in-memory **`text_message`** events (it does not delete SQLite/history). **Hydration** copies stored messages straight into the message store, so legacy `{CET}` rows saved before this filter may still appear in chat after restart until manually cleared or aged out. Connection → radio link tile shows the last network time and age as a mesh/gateway liveness hint (distinct from BLE/serial link-up).

## MeshMap (meshmap.oevsv.at)

Companions do **not** POST to [MeshMap](https://meshmap.oevsv.at/). Gateways upload POS/telemetry to MeshCom servers over UDP; MeshMap reads that server feed. Mesh Client feeds MeshMap only by causing the linked node to TX POS that a gateway hears (`--sendpos`, GPS/`--setlat`/`--setlon` push, `--track`, or `--gateway on` on a site node).

The MeshCom **Map** panel links to MeshMap and offers **Send POS** (push known coords when available, then `--sendpos`). The in-app map is local contacts only — it is not MeshMap.

## Device telemetry

`MESHCOM_CAPABILITIES.hasBatteryTelemetry` / `hasEnvironmentTelemetry` are on. Sources:

| Source                                                   | Battery | Environment    |
| -------------------------------------------------------- | ------- | -------------- |
| BLE `TYP` I (`BATP`/`BATV`) + `TYP` W                    | yes     | yes            |
| Serial `--info` (`BATT`) + `--wx` (`TEMP`/`HUM`/`QFE`/…) | yes     | yes            |
| EXTUDP `tele` / `pos` (`batt`)                           | yes     | `tele` sensors |

Outbound firmware `tele` JSON (`extern_tele_json.h` TLM-04) uses `temp1` / `qfe` / `gas`; client→node injection still uses `temp` / `press` / `gasres`. [`meshcomExtUdpCodec`](../../src/renderer/lib/meshcom/meshcomExtUdpCodec.ts) accepts both shapes (`temp1`→`temp`, `qfe`→`press`, `gas`→`gasres`).

`MeshComProtocol` emits `telemetry` DomainEvents; `meshcomIngest` patches the node row and `recordEnvironmentReading('meshcom', …)`. The runtime also listens for chart points and seeds from the settings snapshot after connect / Telemetry refresh (HELLO can race ahead of ingest attach).

## BLE phone APRS (`@` frames)

Firmware prepends `0x40` to LoRa APRS buffers for the APP (`ble_phone_frame.h`). Client decoder: [`meshcomAprsPhone.ts`](../../src/renderer/lib/meshcom/meshcomAprsPhone.ts) — text (`:`), position (`!`), ACK (`0x41`). After CONFFIN refresh, BLE sends a `0x20` UTC timestamp packet (`phone_commands`).

## Chat destinations (ALL / GRC / DM)

| Destination | Wire                            | `channelIndex` |
| ----------- | ------------------------------- | -------------- |
| ALL         | `*` / plain serial text         | `0`            |
| GRC group   | `{n}text` / EXTUDP `dst` digits | positive `n`   |
| DM          | `{CALL}text`                    | `-1`           |

Send honors `SendMessageOptions.channelIndex` for groups ([`meshcomChannel.ts`](../../src/renderer/lib/meshcom/meshcomChannel.ts)). When a DM peer `destination` is set, that callsign wins over a stale positive GRC `channelIndex` (Chat keeps the last group pill when opening a DM tab). SQLite `channel_idx` allows **-1..99999** (GRC ids, not Meshtastic 0–255 slots).

### GRC groups (ICSSW)

Named catalog: [`meshcomGrcGroups.ts`](../../src/renderer/lib/meshcom/meshcomGrcGroups.ts) (from [ICSSW GRC Gruppen](https://icssw.org/en/meshcom-grc-gruppen/)). Firmware listen filter is up to **six** ids via `--setgrc a;b;…` (first = master); bare `--setgrc` clears. Empty filter shows all GRCs; with ≥1 booking, only matching groups reach the APP. Group **9** (LOC) is HF-cloud only.

**Chat pills:** ALL + device listen slots (`GCB` / `--info`) + locally opened ids + history-discovered ids ([`buildMeshcomChatChannels`](../../src/renderer/lib/meshcom/meshcomGrcGroups.ts)). Chat “+” opens [`MeshComGrcChatManager`](../../src/renderer/components/MeshComGrcChatManager.tsx); Radio → Identity uses [`MeshComGrcEditor`](../../src/renderer/components/MeshComGrcEditor.tsx) (slots + `--nomsgall`).

**DM delivery:** `hasChannelDeliveryAck: true`. On transports that can emit peer delivery ACKs (**BLE** phone `0x41`, **KISS/TCP** `ackNN`), outbound DMs stay `sending` until `meshcomRoutingAckSideEffects` settles the row or a ~6 minute timeout. **EXTUDP** and **USB serial** have no peer-delivery ACK on the wire — DMs ack on wire accept there. Firmware message ids are `((gwId & 0x3FFFFF) << 10) | (node_msgid & 0x3FF)` (`loop_functions.cpp` / `msgid_counter.h`); KISS returns the assigned id in `TX_RESULT`, BLE ACKs reference the full id or the low `{NNN}` suffix. ALL/GRC ack on wire accept on every transport.

## MHEARD

BLE HELLO `TYP` **MH** JSON and serial `--mheard` rows parse into `node_info` / contact upserts ([`meshcomMheard.ts`](../../src/renderer/lib/meshcom/meshcomMheard.ts)).

## Hardware IDs

[`meshcomHwIds.ts`](../../src/renderer/lib/meshcom/meshcomHwIds.ts) maps on-air / EXTUDP `hw_id` to abbreviations (ICSSW protocol table + firmware README / WebDesk through ~61). Unknown ids display as `HW#n`.

## Firmware release watch

`pnpm run update` runs `check_meshcom_upstream` against [icssw-org/MeshCom-Firmware](https://github.com/icssw-org/MeshCom-Firmware) published releases (`MESHCOM_UPSTREAM_WATCH_ENTRIES` in `scripts/update.sh`). On a newer tag, review EXTUDP/BLE/serial wire sources and country profiles, then bump `reviewed-ref`.

## Capability gates

`MESHCOM_CAPABILITIES` in `BaseRadioProvider.ts`. Shared MeshCore-style panels are on where firmware supports them; Rooms BBS and MeshCore repeater admin stay off (`hasRoomServersPanel: false`, `modulesTabUsesRepeatersLabel: false`).

**Map / live traffic:** MeshCom has SmartBeaconing (`--track`) for LoRa-APRS on the track frequency and mesh POS reports, but **no** MeshCore-style corescope / live packet animation stream. The Map tab uses the overview map (contacts with positions) only — live-traffic mode stays off (`hasRawPacketLog: false` so Stats/Sniffer do not appear or fall through to Meshtastic buffers). See [MeshMap](#meshmap-meshmapoevsvat) for the external map feed path.

**Chat channels:** ALL (`*`, index 0) plus device listen / local / history GRC pills (named via ICSSW registry) — never MeshCore PSK channel pills.

## EXTUDP local bind (UDP 1799)

Each Mesh Client instance binds **one** local UDP socket on **1799** for EXTUDP (`udp-bridge.ts`). A second copy of the app on the same machine, or another process holding that port, yields `EADDRINUSE` on connect — disconnect other copies or stop the conflicting process, then retry.

At connect, the bridge resolves a hostname to a canonical IPv4 and filters inbound datagrams to that peer (not the unresolved hostname string).

## Serial console `{CALL}text`

- **TX:** `{CALLSIGN}payload` directs the injection to that callsign (or `{groupId}` for GRC).
- **RX:** firmware echoes use the **sender** callsign inside braces (see ICSSW `sendReply` / `:{CALL}` forms), so `{OE1BBB-2}hello` attributes `from` = `OE1BBB-2`.

## BLE phone framing

ICSSW `ble_phone_drain.h` documents **one BLE notify = one phone frame**. The client does not scan past a leading `0x40` APRS shortcut in the same chunk — firmware does not concatenate multiple frames in one notify.

## Key source files

| Area             | Path                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| Protocol adapter | `src/renderer/lib/protocols/MeshComProtocol.ts`                                      |
| Transports       | `src/renderer/lib/protocols/meshcom/MeshComTransport.ts`                             |
| Codecs           | `src/renderer/lib/meshcom/*`                                                         |
| Device commands  | `meshcomCommands.ts`, `meshcomDeviceCommands.ts`, `MeshComDeviceCommandsSection.tsx` |
| Runtime          | `src/renderer/runtime/useMeshcomRuntime.ts`                                          |
| Ingest           | `src/renderer/lib/ingest/meshcomIngest.ts`                                           |
| Theme            | burgundy scale in `styles.css` / `protocolTheme.ts` (ICSSW `#a2182f`)                |
