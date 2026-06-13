# Meshtastic vs MeshCore feature parity

This document summarizes which client features are **Meshtastic-only**, **MeshCore-only**, or **shared**, and whether gaps are **app wiring**, **post-MQTT**, or **blocked by protocol**.

See also [CONTRIBUTING.md](../CONTRIBUTING.md) (dual-protocol architecture).

## Capability flags

Shared UI gates use `ProtocolCapabilities` in [`src/renderer/lib/radio/BaseRadioProvider.ts`](../src/renderer/lib/radio/BaseRadioProvider.ts). Prefer new gates there instead of `protocol === 'meshcore'` string checks.

## Feature matrix

| Area                            | Meshtastic                                                                                                                                                                                                                               | MeshCore                                                                                                                                                                                                                                                                                                                                    | Gap type                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Transports                      | BLE, Serial, HTTP (`@meshtastic/core`)                                                                                                                                                                                                   | BLE, Web Serial, TCP bridge (5000)                                                                                                                                                                                                                                                                                                          | Different stacks                                                  |
| Tab “Modules” / “Repeaters”     | `ModulePanel` (protobuf modules; Remote Hardware GPIO, IP Tunnel status)                                                                                                                                                                 | `RepeatersPanel` (trace, status, neighbors)                                                                                                                                                                                                                                                                                                 | Product split                                                     |
| Tab “Administration”            | `AdminPanel` (reboot, shutdown, factory reset, NodeDB reset, OTA/DFU)                                                                                                                                                                    | `AdminPanel` (reboot only; meshcore.js limits)                                                                                                                                                                                                                                                                                              | **App**                                                           |
| MQTT broker UI                  | Full (with transport selection)                                                                                                                                                                                                          | Same broker fields; transport protocol selected when connecting; MeshCore-only **LetsMesh** / **Ripple** / **Colorado Mesh** / **Custom** presets fill known public brokers                                                                                                                                                                 | **Post-MQTT** codec on broker path                                |
| MQTT wire format                | `ServiceEnvelope` / `MeshPacket` ([`mqtt-manager.ts`](../src/main/mqtt-manager.ts))                                                                                                                                                      | JSON **v1** chat on `{topicPrefix}/meshcore/chat` (non-LetsMesh / private brokers); **LetsMesh**: optional meshcoretomqtt-style **packet** JSON on `{topicPrefix}/meshcore/packets` ([`meshcore-mqtt-adapter.ts`](../src/main/meshcore-mqtt-adapter.ts)); chat parser in [`meshcoreMqttEnvelope.ts`](../src/shared/meshcoreMqttEnvelope.ts) | Adapter vs protobuf                                               |
| MQTT channel crypto / uplink    | AES-128/256-CTR, `channelPsks`, TLS ([`mqttTls.ts`](../src/renderer/lib/mqttTls.ts)), per-channel publish ([`meshtasticMqttPublish.ts`](../src/renderer/lib/meshtasticMqttPublish.ts)); [`mqtt-manager.ts`](../src/main/mqtt-manager.ts) | JSON v1 path unchanged                                                                                                                                                                                                                                                                                                                      | **App** (Meshtastic wire)                                         |
| Node list hops / MQTT columns   | `hops_away`, `via_mqtt` from device                                                                                                                                                                                                      | Contact model; hops via `outPathLen` from device trace                                                                                                                                                                                                                                                                                      | **App** (implemented)                                             |
| RF diagnostics (LocalStats)     | From protobuf                                                                                                                                                                                                                            | Not available                                                                                                                                                                                                                                                                                                                               | **Blocked**                                                       |
| Routing diagnostics (hop-based) | `RoutingDiagnosticEngine` with hop count                                                                                                                                                                                                 | Skipped when `hasHopCount === false`                                                                                                                                                                                                                                                                                                        | **Blocked** until hop metric exists                               |
| Neighbor UI                     | `neighborInfo` protobuf                                                                                                                                                                                                                  | `getNeighbours` (repeaters)                                                                                                                                                                                                                                                                                                                 | Different primitive                                               |
| Radio config                    | Full protobuf (role, presets, WiFi, etc.)                                                                                                                                                                                                | `setRadioParams`, channels, advert name/position                                                                                                                                                                                                                                                                                            | **Blocked** for Meshtastic-only admin                             |
| Channel URL sync                | Radio tab import/export via [`meshtasticUrlEncoder.ts`](../src/shared/meshtasticUrlEncoder.ts) + [`meshtasticChannelApply.ts`](../src/shared/meshtasticChannelApply.ts) (`https://meshtastic.org/e/#…`, `meshtastic://`)                 | Not available                                                                                                                                                                                                                                                                                                                               | **App** (Meshtastic-only)                                         |
| Position                        | Full GPS protobuf + request position                                                                                                                                                                                                     | Advert lat/lon + `setAdvertLatLong`                                                                                                                                                                                                                                                                                                         | **Partial**                                                       |
| Waypoints                       | Supported                                                                                                                                                                                                                                | Not in protocol surface                                                                                                                                                                                                                                                                                                                     | **Blocked**                                                       |
| Favorites                       | `nodes` table                                                                                                                                                                                                                            | `meshcore_contacts.favorited` + `db:updateMeshcoreContactFavorited`                                                                                                                                                                                                                                                                         | **App** (implemented)                                             |
| Environment telemetry charts    | Device telemetry module                                                                                                                                                                                                                  | Cayenne LPP via `getTelemetry` → `environmentTelemetry`                                                                                                                                                                                                                                                                                     | **App** (implemented)                                             |
| Chat transport badges / history | `received_via` (`rf` / `mqtt` / `both`) plus `via_store_forward` for S&F replays; router heartbeat triggers `CLIENT_HISTORY` via [`meshtasticBacklogUtils.ts`](../src/renderer/lib/meshtasticBacklogUtils.ts)                            | `meshcore_messages.received_via` (`rf` / `mqtt` / `both`)                                                                                                                                                                                                                                                                                   | **App** (implemented)                                             |
| Chat search                     | `searchMessages`                                                                                                                                                                                                                         | `searchMeshcoreMessages`; UI search modal supports `user:` / `channel:` filters for cross-channel lookup                                                                                                                                                                                                                                    | Parallel DB tables                                                |
| Chat `@[Display Name]` tokens   | Same on-wire pattern for replies / reactions / path-style lines                                                                                                                                                                          | Same                                                                                                                                                                                                                                                                                                                                        | **App**; chat body renders tokens as inline labels (see below)    |
| Emoji reactions / tapbacks      | `reactions.ts` decodes protobuf tapbacks (`emoji` flag + UTF-8 payload, legacy index 1–12); `ChatPanel` quick picker + `sendReaction`                                                                                                    | MeshCore DM/channel tapback lines via [`meshcoreChannelText.ts`](../src/renderer/lib/meshcoreChannelText.ts); echo dedup in [`meshcoreStoreDedup.ts`](../src/renderer/lib/meshcoreStoreDedup.ts)                                                                                                                                            | **App** (shared UI, protocol-specific wire)                       |
| Chat composer                   | `ChatComposer.tsx` in `ChatPanel`                                                                                                                                                                                                        | Same `ChatComposer` in `ChatPanel` and `RoomsPanel`                                                                                                                                                                                                                                                                                         | **App** (shared)                                                  |
| Repeater CLI                    | Not applicable                                                                                                                                                                                                                           | Per-repeater expandable CLI in `RepeatersPanel`; prefix-token correlation, retry, flood/auto routing toggle (`RepeaterCommandService`); **Flood Advert** and **Sync Clock** buttons moved to Radio panel (Device Actions section); auto flood advert scheduling available in App Settings (disabled / 12h / 24h)                            | **App** (MeshCore-only)                                           |
| Security / PKI admin            | `SecurityPanel` when `hasSecurityPanel`; DM backup/restore is **one slot per app install** (not per node) — see [key-backup-and-crypto.md](key-backup-and-crypto.md)                                                                     | Tab omitted; no Meshtastic-style PKI surface on MeshCore firmware. Identity for MQTT: Radio JSON import or auto-cache on connect (`mesh-client:meshcoreIdentity`) — see [key-backup-and-crypto.md](key-backup-and-crypto.md)                                                                                                                | **Blocked** (protocol) for PKI tab; **App** for MC identity cache |
| PKC remote admin                | `ConfigureNodeSelector`, [`meshtasticRemoteAdmin.ts`](../src/renderer/lib/meshtasticRemoteAdmin.ts), [`meshtasticRemoteAdminKeyStorage.ts`](../src/renderer/lib/meshtasticRemoteAdminKeyStorage.ts); local radio (2.5+)                  | Not available                                                                                                                                                                                                                                                                                                                               | **App** (Meshtastic-only)                                         |
| Contact groups                  | Built-in groups (GPS, RF+MQTT) via `meshtasticContactGroupUtils`; user-managed via `ContactGroupsModal`                                                                                                                                  | SQLite-backed groups + Nodes toolbar (`useContactGroups`, `ContactGroupsModal`); built-in Room filter                                                                                                                                                                                                                                       | **App**; protocol-neutral with Meshtastic built-ins               |
| Log analyzer                    | `LogPanel` → **Analyze** (`logAnalyzer.ts`, protocol-aware)                                                                                                                                                                              | Same shared UI                                                                                                                                                                                                                                                                                                                              | **App** (implemented)                                             |
| Room servers (BBS)              | Not applicable                                                                                                                                                                                                                           | **Rooms** tab: login/post/admin CLI; optional **Remember password** (`app_settings`); **Auto-sync** periodic re-login while radio connected ([`meshcoreRoomSyncScheduler.ts`](../src/renderer/lib/meshcoreRoomSyncScheduler.ts), [`useMeshcoreRuntime.ts`](../src/renderer/runtime/useMeshcoreRuntime.ts)); RF-only (not MQTT)              | **App** (MeshCore-only)                                           |

## MeshCore: Room servers

Room servers (`hw_model === 'Room'`, contact type 3) are BBS nodes on the mesh. The companion radio must be connected over **RF** (BLE, serial, or TCP); **MQTT does not carry room login/post**.

**Login:** Guest read-only uses **zero password bytes** when the server guest password is empty (**Continue read-only** on the login overlay). Admin login uses the configured password. Login RPC, queue, and path sync live under `src/renderer/lib/meshcoreRoom*.ts` (e.g. [`meshcoreRoomLoginRpc.ts`](../src/renderer/lib/meshcoreRoomLoginRpc.ts), [`meshcoreRoomLoginQueue.ts`](../src/renderer/lib/meshcoreRoomLoginQueue.ts)); timeouts are shorter on TCP and 0-hop paths ([`timeConstants.ts`](../src/renderer/lib/timeConstants.ts)).

**Posts:** Outbound room posts use plain UTF-8 (`TXT_TYPE_PLAIN`) after login. Inbound **SignedPlain** pushes include a four-byte author prefix; the **Rooms** UI strips it. Posts appear in the **Rooms** tab (channel `-2`), not Chat channel pills.

**Sync:** Firmware only **pushes new posts** after login (no history backfill). **Auto-sync** re-logs in on a timer while the radio stays connected (minimum 60 minutes per room, [`meshcoreRoomSyncScheduler.ts`](../src/renderer/lib/meshcoreRoomSyncScheduler.ts)). Saved passwords: SQLite `app_settings` (same pattern as Meshtastic remote admin keys). Session clears on disconnect.

**Unread:** Room BBS traffic increments the **Rooms** sidebar badge ([`meshcoreRoomsUnread.ts`](../src/renderer/lib/meshcoreRoomsUnread.ts)) and system-tray unread when backgrounded; it does not increment the **Chat** tab badge.

**Dedup:** [`meshcoreStoreDedup.ts`](../src/renderer/lib/meshcoreStoreDedup.ts) merges duplicate RF/MQTT and tapback echoes for chat and rooms (cross-transport and channel RF **5 min**; room/tapback **60 s**).

## MeshCore: identity-scoped UI stores

Live Chat and Nodes read **identity-scoped** `nodeStore` / `messageStore` (keyed by `identityId`). Hook-local refs in `useMeshcoreRuntime` (`nodesRef`, pubkeys) remain for send/RPC until contact rebuild syncs. Hydration: [`hydrateIdentityStoresFromDb.ts`](../src/renderer/lib/hydrateIdentityStoresFromDb.ts). **Chat-driven `last_heard`** (`meshcoreIngest`, `ensureMeshcoreChatSenderInNodeStore`) updates node freshness on text traffic, not only adverts.

## MeshCore: Rooms scroll UX

**Rooms** tab scroll layout matches **Chat**: outer scroll container, unread divider, jump-to-unread button, and persisted last-read via `meshcoreRoomsUnread` / localStorage. Uses [`chatScrollUtils.ts`](../src/renderer/lib/chatScrollUtils.ts) (`getDistFromChatBottom`).

Operational troubleshooting: [troubleshooting.md](troubleshooting.md#meshcore-room-server-login-posts-and-windows-10).

## MeshCore: Trace Route and Ping trace

**Trace Route** (node detail) and **Ping trace** (Repeaters panel) use the firmware `tracePath` flow. Remote nodes often answer only when they have **your** node in **their** contact list. Heard-only or one-way peers may produce no response until the client times out. See [troubleshooting.md](troubleshooting.md#meshcore-trace-route-or-ping-trace-times-out).

## Windows: MeshCore over BLE

Pair the radio in **Settings → Bluetooth & devices** before connecting from the app; WinRT is much more reliable with a bonded device. The client may **retry once** after transient GATT discovery failures, and canceling mid-connect should not surface a misleading long-running channel timeout. User-facing copy lives in the Connection tab on Windows; contributor details are in [CONTRIBUTING.md](../CONTRIBUTING.md) (MeshCore internals, BLE) and [README.md](../README.md) (MeshCore Transport Notes).

## Linux: MeshCore over BLE

Linux uses **Web Bluetooth** in the renderer (not Noble). After you pick a device, the client reads **`bluetoothctl info <MAC>`**. If the radio is **not** paired in BlueZ, the UI asks for the **PIN shown on the device** and runs **`bluetooth-pair`** before resolving the pending Web Bluetooth `requestDevice()` selection. If a handshake times out, a **single retry** reuses the granted device via `getDevices()` so `requestDevice()` is not called again without a click. See [development-environment.md](development-environment.md#linux-bluetooth-ble) and [troubleshooting.md](troubleshooting.md#ble-known-issues).

## Chat mention tokens

Meshtastic and MeshCore use the literal form `@[Display Name]` in channel payloads for **thread replies**, **emoji tapbacks**, **path / hop summaries**, and **inline references**. The client may keep the raw string in storage when a reply parent cannot be matched; the **Chat** tab still parses these segments for **display** only: brackets are hidden and the name is shown as a compact inline label (`ChatPayloadText` in [`ChatPanel.tsx`](../src/renderer/components/ChatPanel.tsx), parser in [`chatMentionSegments.ts`](../src/renderer/lib/chatMentionSegments.ts)). Threading / `replyId` behavior is unchanged; this is purely presentational.

## MeshCore MQTT JSON envelope (v1)

Interim broker format until a binary/official MeshCore MQTT layout ships:

```json
{
  "v": 1,
  "text": "message body",
  "channelIdx": 0,
  "senderName": "optional",
  "senderNodeId": 305419896,
  "timestamp": 1700000000000
}
```

Subscribes under `{topicPrefix}/#`. Outbound optional publish uses `mqtt:publishMeshcore` → `{topicPrefix}/meshcore/chat` (JSON same shape). **LetsMesh public brokers** do not use that path for MQTT-only chat without a radio; optional **Packet logger** (`mqtt:publishMeshcorePacketLog`) publishes RX packet summaries to `{topicPrefix}/meshcore/packets` using meshcoretomqtt-shaped JSON; implemented in [`MeshcoreMqttAdapter.publishPacketLog`](../src/main/meshcore-mqtt-adapter.ts) (see [letsmesh-mqtt-auth.md](letsmesh-mqtt-auth.md) § Packet logger). Debug logging is sampled to suppress repeated decode failures and noise (traceroute, empty-type JSON).

## Meshtastic MQTT network presets

In **Meshtastic** mode, [`ConnectionPanel.tsx`](../src/renderer/components/ConnectionPanel.tsx) shows **MQTT :1883**, **Liam's**, and **Custom** preset buttons. They populate `MQTTSettings` used by [`mqtt-manager.ts`](../src/main/mqtt-manager.ts).

| Preset     | Broker host                      | Port | Notes                                                                                                                        |
| ---------- | -------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| MQTT :1883 | `mqtt.meshtastic.org`            | 1883 | Plaintext; may be blocked on some networks                                                                                   |
| Liam's     | `mqtt.meshtastic.liamcottle.net` | 1883 | **Uplink-only** (puts your node on Liam Cottle's map; no downlink). No TLS. Useful when `mqtt.meshtastic.org` is unreachable |
| Custom     | (user)                           | ;    | No automatic changes; use for private brokers                                                                                |

Topic prefix defaults to `msh/US/`; users can edit fields after choosing a preset. Defined in [`meshtasticMqttTlsMigration.ts`](../src/renderer/lib/meshtasticMqttTlsMigration.ts).

### Private brokers (Meshtastic)

For ham or private MQTT brokers (typically **Custom** preset), the Connection tab adds:

- **Channel PSKs**: AES-128 (16-byte) or AES-256 (32-byte) base64 keys, one per line; optional `ChannelName=base64` for MQTT-only channels (multiple lines per name allowed). LongFast default is always tried. Keys from the Radio tab sync when the radio is connected; custom named keys are preserved when sync would only send the default public PSK. Line parsing: [`meshtasticChannelPskLine.ts`](../src/shared/meshtasticChannelPskLine.ts).
- **MQTT-only sender id**: [`meshtasticMqttIdentity.ts`](../src/renderer/lib/meshtasticMqttIdentity.ts) uses last RF `myNodeNum` when known, else a stable virtual id for chat/MQTT publish without a radio.
- **Enable TLS (mqtts / wss)**: explicit TLS toggle via [`mqttTls.ts`](../src/renderer/lib/mqttTls.ts) (port 8883/443 no longer required to imply TLS). **Allow insecure TLS** for self-signed or non–public CA chains.
- **Per-channel uplink**: outbound RF → MQTT uses each channel’s name and PSK via [`meshtasticMqttPublish.ts`](../src/renderer/lib/meshtasticMqttPublish.ts).

## MeshCore MQTT network presets

In **MeshCore** mode only, [`ConnectionPanel.tsx`](../src/renderer/components/ConnectionPanel.tsx) shows **LetsMesh**, **Ripple Networks**, **Colorado Mesh**, and **Custom** preset buttons. They populate the same `MQTTSettings` the main process uses for [`meshcore-mqtt-adapter.ts`](../src/main/meshcore-mqtt-adapter.ts) (with `mqttTransportProtocol: 'meshcore'`).

| Preset          | Broker host                                            | Port       | Notes                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LetsMesh        | `mqtt-us-v1.letsmesh.net` or `mqtt-eu-v1.letsmesh.net` | 443        | **WebSocket** (`wss`). JWT auth; see [Authentication](#meshcore-mqtt-authentication) below. Optional **Packet logger** publishes to `meshcore/packets`. See [`letsmesh-mqtt-auth.md`](letsmesh-mqtt-auth.md). |
| Ripple Networks | `mqtt.ripplenetworks.com.au`                           | 8883       | TLS; preset fills default shared credentials and **insecure TLS** for self-signed / non–public CA chains                                                                                                      |
| Colorado Mesh   | `meshcore_mqtt.coloradomesh.org`                       | 8883 / 443 | TLS; JWT auth with custom audience mapping (`coloradomesh` in token generation). Same topic prefix `meshcore`.                                                                                                |
| Custom          | (user)                                                 | ;          | No automatic changes; use for private brokers                                                                                                                                                                 |

Topic prefix is set to `meshcore` for both public presets; users can still edit fields after choosing a preset.

## Log filtering

MQTT log messages are prefixed for easy filtering: **`[Meshtastic MQTT]`** in [`mqtt-manager.ts`](../src/main/mqtt-manager.ts) and **`[MeshCore MQTT]`** in [`meshcore-mqtt-adapter.ts`](../src/main/meshcore-mqtt-adapter.ts). The Log panel filter and analyzer patterns recognize these tags.

## Maintenance

When MeshCore firmware/SDK defines official MQTT topics and payloads, replace or extend [`MeshcoreMqttAdapter`](../src/main/meshcore-mqtt-adapter.ts) and update this document.

## MeshCore MQTT Authentication

### LetsMesh JWT authentication

LetsMesh uses WebSocket (`wss`) with JWT authentication. The implementation matches [meshcore-mqtt-broker](https://github.com/michaelhart/meshcore-mqtt-broker):

- **MQTT username**: `v1_<64-hex public key>` (uppercase hex)
- **MQTT password**: A token from `@michaelhart/meshcore-decoder` `createAuthToken` with:
  - `publicKey`: 64-character hex public key
  - `iat`: Issued-at timestamp
  - `exp`: Expiration timestamp
  - JWT `aud` (audience): The **regional broker hostname** (same as the Server field)

The JWT audience must match the regional broker hostname (`mqtt-us-v1.letsmesh.net` or `mqtt-eu-v1.letsmesh.net`).

Signing uses cached **private key** material from either a **Radio**-tab MeshCore JSON import or **automatic persistence** after a successful MeshCore radio session (same storage shape as import).

### Configuration

Import a MeshCore config JSON file (Radio tab) when you need credentials before connecting a radio, or to replace missing data; otherwise connecting the MeshCore radio first fills the same cache. The implementation is in [`letsMeshJwt.ts`](../src/renderer/lib/letsMeshJwt.ts).

### Packet logger (optional)

The optional **Packet logger** publishes RX packet summaries to `meshcore/packets` under the topic prefix using meshcoretomqtt-shaped JSON. See [`letsmesh-mqtt-auth.md`](letsmesh-mqtt-auth.md) for details.
