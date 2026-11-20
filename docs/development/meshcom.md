# MeshCom protocol

MeshCom 4.0 is the fourth RF protocol (`meshcom`, rail monogram **CM**). It mirrors the MeshCore/Meshtastic LoRa spine (`ConnectionDriver` / `PacketRouter` / shared Chat·Contacts·Map·Radio·Diagnostics) with first-party codecs under `src/renderer/lib/meshcom/` — there is **no** MeshCom npm SDK, and MeshCore/`meshcore.js` codecs must not drive MeshCom wire frames.

## Transports

| Transport    | Port / medium       | Notes                                                                                                                         |
| ------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **EXTUDP**   | UDP **1799**        | Primary MVP. JSON `msg` / `pos` / `tele`. Node needs `--extudp on` + `--extudpip`. Main bridge: `src/main/ipc/udp-bridge.ts`. |
| **KISS/TCP** | TCP **8001**        | Required. AX.25 UI over KISS (`0x00`/`0x10`/`0x20`/`0xF0`). Not Reticulum `kiss` / `ax25kiss`.                                |
| **Serial**   | 115200 console      | `--` commands, `{CALL}text` inject, `--info` / `--setctry` / ExtUDP+KISS bootstrap.                                           |
| **BLE**      | NUS + phone framing | Sidecar GATT session `gatt:meshcom` (same NUS UUID as MeshCore — filter by advertising name / user selection).                |

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

## Device configuration (Radio panel)

Capability `hasMeshcomDeviceCommands` also unlocks the **Radio** tab (`TAB_CAPABILITY_REQUIREMENTS` — MeshCom has neither `hasChannelConfig` nor MeshCore `hasJsonRadioConfigImport`). MeshCom has **no** Meshtastic protobuf config slices — every ICSSW [node command](https://icssw.org/en/meshcom-kommandos-cl-gw/) is applied as a `--` console line over Serial/BLE.

Radio → **Device Configuration** renders first-class sections (Display, Position / GPS, Sensors, Identity & groups, WiFi / Network, Gateway, Bluetooth, Neighbors, Mailbox, Status & debug, Power & OTA, KISS / misc) from the catalog in [`meshcomCommands.ts`](../../src/renderer/lib/meshcom/meshcomCommands.ts). UI: [`MeshComDeviceCommandsSection.tsx`](../../src/renderer/components/MeshComDeviceCommandsSection.tsx). Wire: Serial CRLF or BLE `0xA0` via [`meshcomDeviceCommands.ts`](../../src/renderer/lib/meshcom/meshcomDeviceCommands.ts). EXTUDP/KISS are chat-only (sections stay visible with a Serial/BLE notice).

- **Read on connect**: after Serial/BLE attach, `refreshMeshcomDeviceSettings` loads the node’s current values — Serial via `--info` text parse, BLE via `{HELLO}` companion JSON (`TYP` I/SN/SW/G/SA/… then `CONFFIN`) with `--info` fallback. Snapshot prefills Device User / Country and Radio command rows (`meshcomDeviceSettings.ts`).
- **Country Apply** (above Device Configuration) saves `meshcomCountryCode` and, on Serial/BLE, sends `--setctry <code>` (reboots after ~15s on the node).
- **Auto `--settime`**: app setting `meshcomAutoSettime` (default off). When enabled, after each Serial/BLE connect the runtime sends `--settime yyyy.mm.dd hh:mm:ss` in host UTC.
- Meshtastic Device Role / Position / Power / WiFi / Display / Bluetooth shells stay off for MeshCom so the Radio tab is not an empty config heading.

## Firmware release watch

`pnpm run update` runs `check_meshcom_upstream` against [icssw-org/MeshCom-Firmware](https://github.com/icssw-org/MeshCom-Firmware) published releases (`MESHCOM_UPSTREAM_WATCH_ENTRIES` in `scripts/update.sh`). On a newer tag, review EXTUDP/BLE/serial wire sources and country profiles, then bump `reviewed-ref`.

## Capability gates

`MESHCOM_CAPABILITIES` in `BaseRadioProvider.ts`. Shared MeshCore-style panels are on where firmware supports them; Rooms BBS and MeshCore repeater admin stay off (`hasRoomServersPanel: false`, `modulesTabUsesRepeatersLabel: false`).

**Map / live traffic:** MeshCom has SmartBeaconing (`--track`) for LoRa-APRS on the track frequency and mesh POS reports, but **no** MeshCore-style corescope / live packet animation stream. The Map tab uses the overview map (contacts with positions) only — live-traffic mode stays off (`hasRawPacketLog: false` so Stats/Sniffer do not appear or fall through to Meshtastic buffers).

**Chat channels:** ALL (`*`, index 0) plus positive GRC group indices seen in messages — never MeshCore PSK channel pills.

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
