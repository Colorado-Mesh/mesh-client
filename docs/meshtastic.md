# Meshtastic in mesh-client

Meshtastic is one of three protocols in mesh-client (green **MT** on the rail protocol switcher), alongside MeshCore and Reticulum. All three stay connected at the same time, so you can switch tabs without dropping a radio. This guide is the operator view of the Meshtastic tab set: how to connect a radio, set up channels, message other nodes, manage the node list, configure modules, and use the advanced tools under **Radio**, **Modules**, **Administration**, and **Telemetry**.

Panels are grouped into rail sections: **Chat**, **Network**, **Map**, **Monitor**, **Device**, then **Incident** and **App**. Every panel is also in the Ctrl/Cmd+K launcher, which can search individual settings as well. Meshtastic uses **Nodes** (where MeshCore uses **Contacts**), **Modules** (where MeshCore uses **Repeaters**), and has **Security** and **Administration** tabs with Meshtastic-specific content.

Related docs: [README — Meshtastic Features](../README.md#meshtastic-features), [Developer notes: Meshtastic](development/meshtastic.md), [Diagnostics reference](diagnostics.md), [Troubleshooting — Meshtastic](troubleshooting.md#meshtastic), [MeshCore](meshcore.md), [Reticulum](reticulum.md), [Meshtastic vs MeshCore parity](meshcore-meshtastic-parity.md).

---

## Quick start

1. Select **MT** (Meshtastic, green) on the rail.
2. **Device → Connection**: pick **Bluetooth**, **USB Serial**, **WiFi/HTTP**, or **WiFi/TCP (fast)**, then **Connect**.
3. Wait for the radio to finish loading its configuration. **Apply** buttons on Radio, Modules, and Security stay disabled until each config slice has been read from the device, so defaults cannot overwrite live settings.
4. **Chat** shows your channels and direct messages. **Nodes** lists everything the radio has heard.
5. Open **Device → Radio** to review region, modem preset, and channels before you transmit on a new mesh.

Optional: turn on **Auto-connect on application start** on the Connection tab so the same radio (or saved address) reconnects on launch.

---

## Connect

The **Connection Type** selector on **Device → Connection** chooses how mesh-client talks to the radio.

| Connection type  | Label in the app    | What you need                                                                                                       |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Bluetooth LE     | **Bluetooth**       | Bluetooth enabled on the radio and computer. Click **Connect** to scan; a device picker lists nearby radios.        |
| USB serial       | **USB Serial**      | USB data cable. Click **Connect** and choose from **Select Serial Port**.                                           |
| WiFi (REST)      | **WiFi/HTTP**       | IP address or hostname of a WiFi-enabled node. One packet per request.                                              |
| WiFi (streaming) | **WiFi/TCP (fast)** | Hostname or IP of a WiFi-enabled node with TCP enabled. Default port **4403**; much faster NodeDB sync on big nets. |
| MQTT only        | **MQTT Connection** | A broker URL, topic, and optional credentials. No radio required for receive-only use.                              |

### Bluetooth

- Bluetooth uses the sidecar GATT stack on all platforms. Startup auto-reconnect can run without a user gesture.
- On macOS, a radio that shows as "AdaDFU" should be paired first in System Settings → Bluetooth to reveal its Meshtastic name.
- On Windows the app checks pairing and pairs the radio itself when needed, prefilling the Meshtastic PIN (`123456`). On Linux an unpaired radio asks for a PIN; use `123456` for Meshtastic. If pairing is stuck, use **Remove & Re-pair Device**.
- A radio can be owned by only one protocol at a time. If it is already connected to MeshCore or Reticulum, disconnect it there first.

### USB serial

- Saved port signatures let mesh-client reconnect to the same physical device after re-enumeration.
- On Linux, add your user to the `dialout` group if you see access denied. On Windows, install the CH340, CP210x, or FTDI driver that matches your board.

### WiFi/HTTP and WiFi/TCP (fast)

- Enter the address as `hostname`, `192.168.1.x`, or `[fd00::1]`. For **WiFi/TCP (fast)** the port defaults to **4403** when omitted, for example `meshtastic.local:4403`.
- If `meshtastic.local` is unreliable, use the device IP address; desktop mDNS can be flaky. On Windows, `.local` names need Bonjour.
- Remembered addresses auto-connect on launch and support quick reconnect after drops.

### MQTT

The **MQTT Connection** card on the Connection tab receives mesh traffic from a broker.

- **Channel PSKs**: one key per line, `ChannelName=base64` or `ChannelName@index=base64` when your local slot differs from the topic name. Keys must decode to 16 bytes (AES-128) or 32 bytes (AES-256). The default LongFast key is always tried; keys from the Radio tab sync automatically when a radio is connected.
- **Enable TLS (mqtts / wss)** for private brokers, with an optional **Allow insecure TLS** for self-signed certificates.
- **Saved profile** lets you name and switch broker settings. Switching to a profile with a different broker waits until you disconnect and reconnect MQTT.
- Each message shows a transport badge: **RF**, **MQTT**, or **both**. When the same message arrives by both within about 10 minutes, one bubble is kept.
- MQTT-only sessions cannot administer remote nodes (PKC remote admin needs a connected local radio).

See [Developer notes: MQTT](development/mqtt.md) and [Troubleshooting — MQTT](troubleshooting.md#mqtt).

### Link troubleshooting

| Symptom                                               | Where to look                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Bluetooth connect fails, pairing loops, wake problems | [Troubleshooting — Bluetooth (BLE)](troubleshooting.md#bluetooth-ble), [BLE and serial notes](development/ble-serial.md) |
| Serial port missing, access denied, port already open | [Troubleshooting — USB serial](troubleshooting.md#usb-serial)                                                            |
| HTTP/TCP fails, slow link, `.local` name not found    | [Troubleshooting — Wi-Fi, HTTP, and TCP](troubleshooting.md#wi-fi-http-and-tcp)                                          |
| Broker refused, decrypt fails                         | [Troubleshooting — MQTT](troubleshooting.md#mqtt)                                                                        |
| Anything else on Meshtastic                           | [Troubleshooting — Meshtastic](troubleshooting.md#meshtastic)                                                            |

Use **Log → Analyze** on connection problems; it recognizes common transport failures.

---

## Channels

Channels live on **Device → Radio** under **Channels**. Select a channel to edit it, then use **Save Channel** (or **Reset to defaults**).

| Field                  | Notes                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Name**               | Channel name.                                                                                                    |
| **Role**               | **Primary**, **Secondary**, or **Disabled**.                                                                     |
| **Key Size**           | **None (no encryption)**, **Simple (default Meshtastic key)**, **AES-128**, or **AES-256**.                      |
| **Encryption Key**     | Base64 key (**Encryption Key (base64)**). **Regenerate** generates a random key.                                 |
| **MQTT Uplink**        | Forward packets received on this channel to the MQTT broker (RF to MQTT), using the channel's real name and PSK. |
| **MQTT Downlink**      | Subscribe to the broker and re-broadcast packets. Follows the radio's MQTT proxy settings.                       |
| **Position precision** | How precisely your location is shared on this channel (0 means no location).                                     |

The **Simple** option uses the default public key shared by all default-configuration devices, so it is not private. All nodes on a channel must use the same key.

Also on the Radio tab: region and modem preset, device role, and the **Display**, **Bluetooth**, and **Power** sections. On firmware 2.8+, the modem preset list follows the radio's per-region preset map.

### Hashtag channels

Deriving a channel key from a `#name` is a **MeshCore** feature (see [MeshCore channels](meshcore.md#channels)). On Meshtastic, create or edit a channel on the Radio tab and paste or generate the base64 key, or import a channel URL.

### Channel URLs

**Share / import channel URL** on the Radio tab uses the same ChannelSet format as the Android and web clients.

**Export**: choose **Include secondary channels** if wanted, then **Generate link**. You get a **Web link (Android QR)** (`https://meshtastic.org/e/#…`), a **meshtastic:// link**, and a QR code, each with a copy button.

**Import**: paste into **Paste channel URL**, review **Channels in link**, then choose a mode:

| Mode                 | Effect                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Replace channels** | Replaces your channel configuration and LoRa settings on the connected radio.                                            |
| **Add channels**     | Adds new channels; existing channels with the same name are skipped. **Also apply LoRa settings from link** is optional. |

Click **Apply to radio** and confirm. Channel URL import and export is Meshtastic-only.

To stop using a channel on Meshtastic, set its **Role** to **Disabled** (or **Reset to defaults**) on the Radio tab and save. The Chat-side **Remove channel** menu is a MeshCore feature.

---

## Direct messages

Open a DM from **Nodes** (node detail → **Message**) or from a channel message sender. DMs need the peer's public key; a node with a key is labelled "Has public key - can send DMs" in node detail, and a keyless row is shown as chat-only.

| Status                  | Meaning                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Queued**              | Composed while disconnected; sent when the radio connects (durable outbox survives restart).                |
| **Sending…**            | Handed to the radio.                                                                                        |
| **Delivered**           | A delivery ACK came back.                                                                                   |
| **no ACK** / **Failed** | No acknowledgement arrived. The message may still have been sent; no other node in range may have answered. |
| **Blocked**             | No encryption key available for the peer.                                                                   |

- **Automatic resend**: a failed message is resent up to 3 times (after 15 seconds, 1 minute, then 3 minutes). The bubble shows a **Retrying (n/max)** countdown with **Cancel retry**.
- **Resend message** stays available on the bubble afterwards for a manual resend.
- A DM tab can be closed with **Close DM tab**. The DM info header shows the peer's battery, last heard, and SNR.
- Long messages are split into `[N/T]` chunks (at most 9) automatically. This is Meshtastic and Reticulum behavior; MeshCore is single-packet.
- Reactions, replies, starring, link previews, export, drafts, and the F1–F12 macro bar are shared with the other protocols; see [Developer notes: Chat](development/chat.md) and [Chat guide](chat.md).

---

## Nodes

**Network → Nodes** (heading **Node Database**) lists every node the radio has heard.

| Feature             | Details                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Columns             | Health, Favorite, ID, Long Name, Short, Last Heard, Type, Role, Hops, MQTT, Lat/Lon, MGRS, Signal, SNR, Battery, Voltage, Ch.Util, Air Tx, Alt, Redund.                                               |
| **Last heard**      | Any live RF packet (position, telemetry, traceroute, text), not only chat.                                                                                                                            |
| **Signal bars**     | Direct (0-hop) RF neighbors only; multi-hop and MQTT-only paths omit bars.                                                                                                                            |
| **Favorites**       | Star a row (**Add to favorites** / **Remove from favorites**) to pin it. Persisted in the app database.                                                                                               |
| **Distance filter** | Enable in **App → Appearance**. The list then hides nodes beyond the chosen distance; a banner shows how many are hidden. Without a GPS fix, all nodes show.                                          |
| **Status filter**   | Filter by **Online**, **Stale**, or **Offline**.                                                                                                                                                      |
| **Contact groups**  | **Manage groups** creates groups and members; the group filter limits the list. Meshtastic also has built-in **GPS**, **RF+MQTT**, and **Router** filters. Custom groups are shared by all protocols. |
| **Export**          | **Export JSON** (topology) or **Export CSV** of the node list.                                                                                                                                        |

### Node health

Each row shows a 0 to 100 **Node health** badge: signal 40 points, recency 30, load 20, battery 10. Green, yellow, and red coloring comes with a tooltip showing the breakdown. A separate **Redund.** column shows a redundancy score from the last 20 packets and a `+N` echo count.

### Node detail

Click a row to open node detail.

- **Message**, **Show on map**, **Trace Route** (per-hop display), **Request Position**, **Delete Node**.
- **Neighbors**, **Map Report**, **Pax Counter**, **Detection Sensor**, **Range Test**, channel utilization, packet redundancy, and a collapsible **Path History** when data exists.
- **Notes**: private free-text notes about the node (not transmitted), saved in SQLite.
- **Watch**: turns on an OS desktop notification when the node goes online or offline. The button reads **Watching** while on.
- **MQTT Ignore**: excludes the node's MQTT data from diagnostics.
- **Remote admin key** and **Configure node remotely** (see [Admin](#admin)).
- **Verify key…** (see [Key verification](#key-verification)).

---

## Modules

The **Modules** tab (Device section) edits firmware module configuration. Section order follows what the radio exposes and is not strictly alphabetical. Each section stays on **Waiting for … settings from the device** with **Apply** disabled until its slice has been read; if a module key never appears, the connected firmware does not expose it.

| Group                 | Sections                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry and sensors | **Telemetry Module** (device, environment, air quality intervals), **Detection Sensor Module**, **Pax Counter Module**, **Range Test Module**     |
| Messaging and alerts  | **Canned Messages**, **External Notification Module**, **RTTTL Ringtone**, **Audio module** (when exposed by firmware), **Status Message Module** |
| Networking and relay  | **MQTT Relay (Device-Side)**, **Map Report**, **Serial Module**, **IP Tunnel** (status only), **Traffic Management Module**, **TAK Module**       |
| Mesh behavior         | **Neighbor Info Module**, **Store & Forward Module**, **Mesh Beacon Module**                                                                      |
| Hardware              | **Remote Hardware** (GPIO pins plus a live status stream when enabled), **Ambient Lighting Module**                                               |

Module status displays show packet counts and last-received timestamps for Range Test, Serial, Store & Forward, Remote Hardware, and IP Tunnel when the module is enabled. A **Debug modules** section holds less common options. A notice at the top of Radio, Modules, and Security reminds you that changes persist to the device and may require a reboot.

Developer detail: [Meshtastic config apply and modules](development/meshtastic.md).

---

## Store & Forward

When a Store & Forward router is on the mesh, mesh-client can replay recent chat history it missed. After the radio finishes configuring, the client may request history on the first primary-router heartbeat, within capped message and time windows with a cooldown and an offline gate; this auto-fetch can be turned off in App settings.

- **Catch up from Store & Forward** in Chat fetches manually.
- Replayed text carries a **Store & Forward** badge ("Replayed from Store & Forward").
- If no router has been heard, wait for a heartbeat or check the **Store & Forward Module** section on the Modules tab.

Limits, cooldowns, and the history profile setting are in [Developer notes: Meshtastic](development/meshtastic.md).

---

## Advanced tools

### Key verification

Key verification lets two operators confirm each other's public keys out of band. It requires **Meshtastic firmware 2.7 or newer**; on older firmware node detail shows an unsupported-firmware notice.

1. Open **node detail** for a node that has shared its public key and click **Verify key…**.
2. The **Verify key** dialog walks through the firmware handshake. One side is shown a **Security number**; read it to the other operator over a separate channel (voice or in person), never over the mesh. The other side types it in and clicks **Continue**.
3. Both radios then show **Verification characters**. Compare them over the same separate channel and click **They match** only if they are identical, or **They do not match** otherwise.

If you confirm, the node shows a **Key verified** badge. Esc or **Cancel verification** abandons the handshake.

| Badge             | Meaning                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Key verified**  | Manual: you and the other operator compared the security number and matching characters using the radio's handshake.                                 |
| **XEdDSA signed** | The radio cryptographically checked a signature from this node. This proves the packets came from the holder of the key, but not who that person is. |

Only **Key verified** means a person confirmed the key. Details are in **How key trust works** in node detail; see also [Key backup and cryptography](key-backup-and-crypto.md).

### Remote shell

**Device → Administration → Remote shell (Meshtastic)** opens a command-line session on another node's firmware. The section appears when the radio's provider supports it and is collapsed by default.

- Read the **Security warning: remote command-line access** first. A remote shell is administrator access: use it only on nodes you own, do not type secrets, and expect LoRa airtime for every keystroke and reply, with delays and dropped frames.
- Tick **I understand the risks and I am authorized to access this node**. The **Open shell** button stays disabled until you do and a valid **Target node** is entered (`!a1b2c3d4` or a node number). When **Configure node** targets a remote node, that node fills in.
- The target firmware must have remote shell enabled and must authorize this radio. Idle sessions close automatically after 10 minutes.
- Use **Send**, **Send Ctrl+C**, **Clear**, and **Close shell**. The transcript stays in memory only and is discarded when you disconnect or close the app; leaving the Administration tab closes the session.
- Lost output frames are reported in the panel, and older output is dropped to keep the transcript small.

Reticulum has its own separate **Remote** tab (rnsh); this one is Meshtastic only.

### XMODEM file transfer

**Device → Radio → XMODEM file transfer** transfers files to and from the connected radio's firmware. It is **local radio only**: the section is hidden while **Configure node** targets a remote node, and the buttons are disabled while disconnected.

1. Enter **Remote filename** (for example `config.txt`; invalid characters are rejected).
2. **Upload file…** sends a file from your computer; **Download file** saves the radio's file to your computer.

### Firmware lockdown

**Device → Radio → Firmware Lockdown** shows lockdown status reported by the firmware. A locked radio rejects configuration changes until it is unlocked with its passphrase. Radios without lockdown support never report a status, and the section shows **Not reported by this radio**.

| Field or control                                                         | Meaning                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **State**                                                                | **Needs provisioning**, **Locked**, **Unlocked**, **Unlock failed**, **Disabled**, or **Unspecified**. |
| **Reason**, **Reboots remaining**, **Unlocked until**, **Retry backoff** | Shown when the firmware reports them.                                                                  |
| **Passphrase** with **Provision** / **Unlock**                           | Set the passphrase on a new radio, or unlock a locked one.                                             |
| **Lock now**                                                             | Lock the radio immediately.                                                                            |
| **Disable lockdown**                                                     | Turn lockdown off.                                                                                     |

Buttons stay disabled until a passphrase is entered and the radio is connected.

### Mesh Beacon

The **Mesh Beacon Module** section on the Modules tab lets a node advertise itself and, optionally, a channel and radio settings that listeners can choose to join. It appears when the connected firmware exposes the module.

**Configure**

- **Broadcast beacons** sends a beacon periodically. **Broadcast interval** has a minimum of 3600 seconds (1 hour).
- **Beacon message** is sent with every copy (byte counter shown), so keep it short. **Legacy text split** also sends the text as a separate message for older firmware, using more airtime.
- **Mesh offer**: **Offered channel** copies a channel name and key into the beacon (anyone who hears it can join), and **Offered region**, **Offered modem preset**, and **Offered frequency slot** advertise radio settings. Leave them on **None** / **Not advertised** to offer nothing.
- **Broadcast targets** sends one beacon copy per target, switching the radio between each target's region, modem preset, channel, and frequency slot. With no targets, one beacon is sent on the current settings over the primary channel.
- **Listen for beacons** receives beacons from other nodes. Beacon text goes to the inbox; nothing is applied automatically.

**Heard beacons**

Heard beacons list under **Heard beacons** with the offered channel, region, preset, and slot.

- **Join channel** adds the offered channel to the first free secondary slot (never the primary) after you confirm; it is blocked with **No free channel slot to join this channel.** when slots are full, and noted when the channel is already on the radio.
- **Use radio settings** applies the offered region, modem preset, or slot after you confirm. The radio reboots and may lose contact with your current mesh, and a region mismatch is called out rather than changed silently.
- Joining is only available for the connected radio, not for a remote **Configure node** target.

### Cayenne LPP charts

**Device → Telemetry → Cayenne LPP sensors** charts Cayenne Low Power Payload packets (CAYENNE_APP) sent by sensor nodes. This is **Meshtastic only**: it is gated by the Meshtastic-only `hasCayenneTelemetry` capability and does not apply to MeshCore or Reticulum.

- Pick a **Sensor node**, then read one chart per decoded kind: temperature, humidity, barometric pressure, illuminance, GPS position, analog and digital inputs and outputs, accelerometer, gyrometer, power, energy, distance, and more.
- This is session history only; it is not saved.
- Node detail also shows **Sensor telemetry (LPP)** when LPP data exists.

---

## Admin

The **Administration** tab (Device section) holds device commands for the connected radio. They take effect immediately and show a confirmation first.

| Action                        | Notes                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Reboot**                    | Reboots the radio.                                                                                                |
| **Shutdown**                  | Powers off; you must switch the radio back on physically.                                                         |
| **Reset NodeDB**              | Clears the radio's node database; it rediscovers nodes over time. Remote targets get a preserve-favorites option. |
| **Reboot to OTA**             | Reboots into over-the-air update mode. Local radio only.                                                          |
| **Enter DFU Mode**            | Reboots into Device Firmware Update mode. Local radio only.                                                       |
| **Factory Reset Config Only** | **Danger Zone.** Resets configuration but preserves the node database. Local radio only.                          |
| **Factory Reset Device**      | **Danger Zone.** Erases all settings, channels, and stored data permanently.                                      |

OTA and DFU are disabled when **Configure node** targets a remote node. **Flash device firmware** (USB, supported boards only) also appears here for a local radio; it needs the radio's USB serial connection closed and has its own checklist. See the [firmware guide](firmware.md).

### Configure a remote node

PKC remote administration (firmware 2.5+) lets you edit another node's settings through your connected local radio.

1. Save the remote node's admin public key in node detail (**Admin key**, base64, `base64:…`, or 64-character hex), or use the NodeDB key when it is present.
2. Choose the node with **Configure node** on Radio, Modules, Security, or Administration, or click **Configure node remotely** in node detail.
3. Use **Copy** next to your public key on **Security** for the one-time trust setup on the remote node.

A connected local radio is required; MQTT-only sessions cannot administer remote nodes. See [Troubleshooting — Meshtastic](troubleshooting.md#meshtastic).

### Security tab

**Device → Security** manages keys on the local radio: DM keys with **Regenerate Keys**, **Admin Keys** with **Apply Admin Keys**, **Administration Settings** (managed device, serial console, debug log API, legacy admin channel), and **Key Backup / Restore**. **Backup Keys** stores the connected radio's public and private keys per node in an encrypted local archive; **Restore Keys** and **Restore from backup…** apply them. Backing up one radio never overwrites another's archive. See [Key backup and cryptography](key-backup-and-crypto.md).

---

## Diagnostics

The shared **Monitor → Diagnostics** tab shows LoRa routing and RF findings for Meshtastic: network health (**Healthy**, **Attention**, **Degraded**), routing anomalies such as hop goblins, channel utilization history, and foreign-LoRa overhear tables. Distance-based checks use a trusted position only (this session's radio GPS fix or a location you confirmed). See the [Diagnostics reference](diagnostics.md).

Also under Monitor: **Stats** and **Sniffer** (packet log), and **RF** and **Graph** for LoRa-only views.

---

## Troubleshooting

Start with [Troubleshooting — Meshtastic](troubleshooting.md#meshtastic). Common entries:

- Modules tab stuck on "waiting for settings"
- **Configure node remotely** does nothing or is disabled
- Remote admin channel settings fail to load
- MQTT decrypts on other clients but not mesh-client
- Battery or uptime for your own node looks wrong: [Meshtastic: mesh vs local client telemetry](meshtastic-telemetry-local-client.md)

For connection layers, use the [link troubleshooting](#link-troubleshooting) table above. Attach the log with **App → Export for GitHub** when reporting a bug.

---

## Related

- [Chat guide](chat.md) and [Developer notes: Chat](development/chat.md)
- [Maps guide](maps.md) and [Offline maps](development/offline-maps.md)
- [TAK guide](tak.md) (TAK tab and CoT gateway)
- [Firmware guide](firmware.md)
- [Meshtastic: mesh vs local client telemetry](meshtastic-telemetry-local-client.md)
- [Key backup and cryptography](key-backup-and-crypto.md)
- [Developer notes: Meshtastic](development/meshtastic.md)
- [EMCOMM: MECP and Incident Command](emcomm.md)
