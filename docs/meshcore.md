# MeshCore in mesh-client

MeshCore is one of three protocols in mesh-client (cyan **MC** on the rail protocol switcher), alongside Meshtastic and Reticulum. All three can stay connected at the same time. This guide is the operator view of the MeshCore tab set: connect a companion radio, manage contacts and channels, chat and DMs, Repeaters and Rooms, companion CLI, and security. Wire-level repeater and room detail lives in the development docs linked from each section — this page stays at operator depth.

Related docs: [README — MeshCore Features](../README.md#meshcore-features), [Meshtastic vs MeshCore parity](meshcore-meshtastic-parity.md), [MeshCore troubleshooting](troubleshooting-meshcore.md), [Meshtastic](meshtastic.md), [Chat](chat.md), [EMCOMM](emcomm.md).

---

## What MeshCore is here

MeshCore companions speak a different companion protocol than Meshtastic. mesh-client talks to them over Bluetooth, USB serial, or TCP, and can also ingest public JSON MQTT chat. Panels are grouped into rail sections: **Chat**, **Network** (Contacts, Repeaters, Rooms, TAK), **Map**, **Monitor**, **Device** (Connection, Radio, Administration), then **Incident** and **App**.

Where Meshtastic uses **Nodes** and **Modules**, MeshCore uses **Contacts** and **Repeaters**. Room BBS traffic has its own **Rooms** tab (not channel chips in Chat).

---

## Quick start

1. Select **MC** (MeshCore, cyan) on the rail.
2. **Device → Connection**: pick **Bluetooth**, **USB Serial**, or **TCP**, then **Connect** (or configure MQTT for receive/uplink without a radio).
3. Wait for contacts and channels to finish loading. The header may show queued-message sync (**Fetching queued messages…** / **Sync now**).
4. **Chat** shows channels and DMs. **Contacts** lists chat users, repeaters, rooms, and sensors the radio knows.
5. Open **Device → Radio** for name/position advert, channels, and regional flood scope before you transmit on a new mesh.

Optional: enable auto-connect on the Connection tab so the same radio reconnects on launch.

---

## Connect

| Connection type | What you need                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Bluetooth LE    | MeshCore firmware on the radio; Bluetooth enabled. Pairing behaviour follows the OS (Windows can pair from the app). |
| USB Serial      | USB data cable; **Select Serial Port** after Connect.                                                                |
| TCP             | Hostname/IP of a companion that exposes MeshCore TCP (default port **5000**, including OpenHop / pyMC).              |
| MQTT            | Broker URL and MeshCore JSON chat path; presets include LetsMesh, MeshMapper, and others.                            |

Notes:

- A physical radio can belong to only one protocol at a time. If it is already connected as Meshtastic, disconnect there first (`blePeripheralInUse` style errors).
- BLE needs MeshCore GATT services; wrong firmware fails with a clear missing-services message.
- After sleep/wake, use **Disconnect → Connect** if auto-reconnect does not recover. Dual-radio BLE with Meshtastic uses a staggered wake settle.
- LetsMesh MQTT auth (v1 username / token): [LetsMesh MQTT auth](letsmesh-mqtt-auth.md).
- General BLE / serial / TCP / MQTT failures: [Troubleshooting](troubleshooting.md) and [MeshCore troubleshooting](troubleshooting-meshcore.md).

---

## Contacts

**Contacts** is the MeshCore node list. Contact types include **Chat**, **Repeater**, **Room**, and **Sensor** (plus placeholders the UI labels **None** / **Unknown**).

- Contacts arrive from heard **adverts**, radio contact sync after connect, optional MQTT stubs, and manual import / share.
- **Favourites** are exempt from age-based prune. Stars are stored with the contact.
- Built-in type filters: **Type: Chat**, **Type: Repeater**, **Type: Room**. Custom **Contact Groups** work the same as on Meshtastic — see [Settings — Contact groups](settings.md#contact-groups).
- **Radio →** contact management controls how the companion auto-adds adverts (**Auto add all** / **Auto add selected**, overwrite oldest non-favourites, max hops). Offload frees slots when the radio table is full (~350) while keeping rows in the app database.
- Deleting a contact removes local DB rows (and that room’s BBS messages). If the radio still has the contact, it may return on the next dump.

Export / share a contact from the contact detail when you need to move a public key to another operator.

---

## Channels

MeshCore channels are configured on **Device → Radio → Channels (MeshCore)** (and appear as Chat chips).

- Add, edit, or remove channel slots; set name and PSK; derive a key from a `#hashtag` where the UI offers it.
- Channel QR import/export can carry regional flood-scope preferences for mesh-client.
- **Single-packet rule:** outbound channel (and DM / room) text that does not fit one radio packet is **blocked** in the composer — mesh-client does not split MeshCore sends into `[i/N]` parts (busy repeaters drop parts). Inbound multi-part from other clients is still merged for display. Details and rationale: [Meshtastic vs MeshCore parity — Chat composer](meshcore-meshtastic-parity.md).
- Removing a channel chip or clearing history follows the shared Chat patterns — see [Chat](chat.md).

**Regional flood scope** (radio-wide default on Radio; per-view override beside Chat Send as Default / Unscoped / named hashtag) limits which repeaters forward floods. PSK still controls who can decrypt. Community naming: [RegionMesh MeshCore region configuration](https://www.regionmesh.com/meshcore-region-configuration/). Parity notes: [meshcore-meshtastic-parity.md — regional flood scope](meshcore-meshtastic-parity.md#meshcore-regional-flood-scope).

---

## Direct messages

Open a DM from a Chat contact or from Chat’s DM list.

- Delivery uses companion ACK / path feedback; failed sends show in the outbox with retry. Read [Chat — Outbox and delivery](chat.md) for shared honesty rules.
- Close or clear a DM thread from the conversation controls; that does not delete the contact from the radio by itself.
- If a multi-hop peer has no path, send a **Flood Advert** (header / Radio device actions) and wait for contact path updates before retrying.
- Optional **MeshCore Open wire (experimental)** under App enables keyed replies, compact `r:` reactions, and `g:` GIFs for Open-aware peers; default remains official companion keyless wire. See parity doc emoji / GIF sections.

---

## Repeaters

The **Repeaters** tab is MeshCore repeater (and room-row) administration: status, sensors/telemetry, neighbors, ping/trace, and an expandable CLI. Prefer **Contacts** search for day-to-day lookup on large meshes; open Repeaters when you need bulk admin.

Operator summary only — do not treat this page as the zero-hop / multi-hop RPC contract. Full behaviour, timeouts, and path rules: [MeshCore Repeaters (developer)](development/meshcore-repeaters.md). Field failures: [MeshCore troubleshooting](troubleshooting-meshcore.md).

---

## Rooms (BBS)

**Rooms** is the MeshCore room-server (BBS) UI. Login and posts use the companion radio over **RF** (BLE, serial, or TCP) — **MQTT does not carry room login/post**.

- Blank guest login is read-only when the room allows it; guest password **`hello`** is the usual read/write default; admin uses the room password.
- **Remember password** stores a per-room secret on this computer and turns on **Auto-login when connected**. Auto-login and **Auto-sync** (re-login on a timer while the radio stays connected) are in **Room details**, which opens from the room header before or after you log in. Auto-login needs a saved password, so turning it on while logged in saves the password you logged in with.
- Posts appear under Rooms (not Chat channel chips). Unread badges the Rooms tab.
- Room ACL / CLI admin for a room server also appears on Repeaters room rows.

Operator depth and wire notes: [MeshCore Rooms (developer)](development/meshcore-rooms.md). Login problems: [MeshCore troubleshooting — Room server](troubleshooting-meshcore.md#meshcore-room-server-login-posts-and-windows-10).

---

## Companion CLI

Companions that report a new enough protocol version expose **Companion CLI** settings on Radio (device / radio / WiFi groups), plus reboot / power-off helpers that reconnect cleanly after a planned reboot.

- Local CLI is for the connected companion (settings, reboot). Secrets such as WiFi password and BLE PIN are write-scoped and redacted in logs and support bundles.
- **Remote CLI** on another chat companion requires the peer’s contact flag that allows it; grant/revoke from that contact’s detail.
- Sensor **telemetry push** subscriptions (when firmware supports them) live on Sensor contact detail.

Developer reference: [MeshCore companion CLI](development/meshcore-companion-cli.md). Repeater/room CLI remains under Repeaters — see the Repeaters development doc.

---

## Security

MeshCore **Security** covers backup/restore of the companion identity **per node id**, signing, and export/import helpers. It does **not** implement Meshtastic-style PKI remote admin. Active MQTT identity cache keys are documented with the backup flow.

See [Key backup and crypto](key-backup-and-crypto.md). Flash or replace firmware only after you have a backup you can restore — [Firmware](firmware.md).

---

## MECP, TAK, and Incident

| Feature      | On MeshCore                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **MECP**     | Same Chat buttons and Incident tab as other protocols; flood scope follows the channel Send override. [EMCOMM](emcomm.md) |
| **TAK**      | MeshCore nodes feed the CoT gateway like Meshtastic. [TAK gateway](tak.md)                                                |
| **Incident** | Always-visible rail tab; map layer **Emergency incidents**. [EMCOMM](emcomm.md)                                           |

---

## Differences from Meshtastic

Do not duplicate the full matrix here. For transports, MQTT wire shape, hops, rooms, flood scope, reactions, and every known gap, use [Meshtastic vs MeshCore feature parity](meshcore-meshtastic-parity.md). High-level operator contrasts:

- Contacts + Repeaters + Rooms instead of Nodes + Modules
- Single-packet outbound chat (no multi-part send)
- JSON MQTT chat (and LetsMesh packet JSON) instead of Meshtastic protobuf envelopes
- No Meshtastic channel URL scheme or PKC remote admin

---

## Troubleshooting

Start here: [MeshCore troubleshooting](troubleshooting-meshcore.md).

Also useful:

- [Troubleshooting — MeshCore section](troubleshooting.md#meshcore) (index into the dedicated page)
- [USB serial frozen](troubleshooting.md#meshcore--meshtastic-usb-serial-app-frozen-or-stuck-on-reconnecting)
- [Bluetooth](troubleshooting.md#bluetooth-ble) / [Wi-Fi, HTTP, and TCP](troubleshooting.md#wi-fi-http-and-tcp) / [MQTT](troubleshooting.md#mqtt)

### Related

- [Chat](chat.md)
- [Maps](maps.md)
- [Settings](settings.md)
- [Diagnostics](diagnostics.md)
- [Firmware](firmware.md)
