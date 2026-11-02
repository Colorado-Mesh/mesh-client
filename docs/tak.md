# TAK gateway (CoT)

The **TAK** tab turns mesh-client into a Cursor on Target (CoT) gateway. It shows mesh nodes on the tactical maps of ATAK, WinTAK, and iTAK, and can pass chat between those apps and your radios. It works on Meshtastic, MeshCore, and Reticulum, and it can also relay the same positions to a remote OpenTAKServer, FreeTAKServer, or TAK Server.

This guide is for operators. For problems, see [Troubleshooting — TAK (CoT gateway)](troubleshooting.md#tak-cot-gateway). For code, see [TAK gateway (developer map)](development/tak.md).

---

## What TAK does

The **TAK** tab sits in the **Network** rail section, after **Remote**. It is available on Meshtastic, MeshCore, and Reticulum, and it feeds every protocol at once, whichever tab is open.

| Feature                       | What it does                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local TAK server**          | Broadcasts node positions as CoT XML events over TLS TCP (default port 8089) so ATAK, WinTAK, and iTAK clients see mesh nodes on their maps |
| **Remote TAK server relay**   | Streams the same positions to an OpenTAKServer, FreeTAKServer, or TAK Server over mutual TLS, or over plain TCP                             |
| **Certificates**              | Self-signed CA, server, and client certificates, made and kept by the app                                                                   |
| **ATAK data package**         | An importable bundle with the truststore, client certificate, and connection settings                                                       |
| **Channels as ATAK contacts** | Serves chosen MeshCore and Meshtastic channels to ATAK as chat contacts                                                                     |
| **Direct messages**           | Lets ATAK message a radio's companions from their markers                                                                                   |
| **MECP in ATAK**              | Shows emergency reports as text and as map markers                                                                                          |
| **Unit filters and icons**    | Restyle relayed nodes and give repeaters and room servers their own icons                                                                   |
| **ATAK plugin messages**      | Lists ATAK plugin packets heard from Meshtastic nodes                                                                                       |

**What is relayed.** Positions come from:

- Meshtastic and MeshCore nodes heard within their protocol's online window.
- Reticulum RMAP-discovered interfaces that have coordinates.
- Your own Reticulum position, when a static GPS position is set.

Positions are re-sent every 5 minutes so markers do not go stale in ATAK.

**Status.** The panel shows **Running** or **Stopped** with the port and the number of connected clients, and lists each connected client with its callsign or address and how long it has been connected. The status bar shows one TAK label that combines the local server and the remote relay (for example, "TAK running, remote connected"). Like the device and MQTT indicators, it pulses red after an unexpected disconnect, and a manual stop stays gray.

**Auto-start.** **Auto-start on application launch** is off by default. When it is on, the local server starts with the app.

---

## Before you start

1. **LAN IP.** ATAK connects to your computer's LAN address. The data package uses that address as its connect host, and it must match the address in the server certificate. The app picks the address for you and skips virtual and VPN adapters (Docker bridges, `veth`, `tun`, `tap`, WireGuard, Tailscale, ZeroTier, and similar). If your computer has several network adapters, check that the address in the generated package is the one your devices can reach.
2. **Same network.** The phone, tablet, or PC running ATAK must be on the same LAN as the desktop running mesh-client.
3. **Ports.**

   | Port     | Used for                                                                                                                          |
   | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
   | **8089** | Default TLS port of the local server and of most remote TAK servers. The local server accepts any port from **1024** to **65535** |
   | **8446** | Usual enrollment port on a remote TAK Server that issues certificates for a username and password                                 |

4. **Firewall.** Allow inbound TCP on the local server's port (default 8089) so devices can reach it.
5. **Subject Alternative Name (SAN).** The server certificate includes your server name and your LAN IP as SAN entries. Strict clients (iTAK, WinTAK, and newer ATAK) reject a certificate whose names do not match the address they dialed. If your LAN IP changes, regenerate the certificate if needed, then generate a new data package.

---

## Local TAK server

Open the **TAK** tab and use **Server Settings**.

| Setting                                             | Default       | Notes                                                                                                                                      |
| --------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Port (1024–65535)**                               | 8089          | Cannot be changed while the server is running                                                                                              |
| **Server Name**                                     | `mesh-client` | Baked into the server certificate. Cannot be changed while the server is running                                                           |
| **Require client certificate (mTLS)**               | On            | Clients must present the client certificate from the data package. Cannot be changed while the server is running                           |
| **Auto-start on application launch**                | Off           | Starts the server when the app opens                                                                                                       |
| **Sound ATAK's emergency alarm for an MECP MAYDAY** | Off           | See [Messaging in ATAK](#messaging-in-atak) and [EMCOMM: Reports in ATAK](emcomm.md#reports-in-atak). Takes effect at once, running or not |

Press **Start Server** to start and **Stop Server** to stop. **Start Server** stays disabled until the port is valid and the server name is not empty.

**Connected Clients** lists every ATAK device that has connected. Inbound CoT from local clients shows as contacts on the map, labelled as coming from a local ATAK client.

---

## Certificates

Under **Certificates**, mesh-client makes a self-signed CA plus server and client certificates (with node-forge) on first start and stores them in the app data directory. The server certificate includes DNS and your LAN IP in its Subject Alternative Name, so devices can verify TLS.

Press **Regenerate Certificates** to make a new set at any time. This invalidates existing ATAK data packages: you must generate a new package and re-import it on every device.

Regenerate certificates, then generate a new package, when:

- Your LAN IP changed.
- You changed the server name.
- A device reports the certificate as invalid and you have updated mesh-client.

---

## ATAK data package

Under **ATAK Data Package**, press **Generate & Reveal**. The server must be running first. The app writes a `.zip` and reveals it in Finder or Explorer (**Package saved — check Finder/Explorer**).

The package contains:

- `certs/truststore.p12`, the CA as a password-protected PKCS#12 truststore that ATAK, iTAK, and WinTAK can load.
- `certs/client.p12`, your client certificate and key.
- `connection.pref`, the connection definition. Its connect string is your LAN IP and port with TLS (`<LAN IP>:<port>:ssl`).
- A `MANIFEST/manifest.xml` that asks ATAK to import the package.

The PKCS#12 files use the password `atakatak`.

**Importing.** Copy the zip to the device and import it in ATAK, WinTAK, or iTAK. Remove any earlier mesh-client connection or package first.

**Re-generate the package** after certificate regeneration or a LAN IP change. The connect host must match the server certificate SAN.

---

## What ATAK sees

Once connected, ATAK shows each relayed node as a marker. Markers are drawn from the role the node advertises:

- Repeaters and routers as installations.
- Sensors as sensors.
- Everyone else as a team member.

You can change this under [Unit filters and icons](#unit-filters-and-icons).

Beyond markers, ATAK also receives:

- **Channel contacts** and **direct message** contacts (see below).
- **MECP incidents** as spot markers (see [Messaging in ATAK](#messaging-in-atak)).

Inbound CoT from your local ATAK clients and from the remote TAK server appears in mesh-client as contacts on the map. A contact's detail reads **From a local ATAK client** or **From the remote TAK server**.

---

## Remote TAK server relay

Use **Remote TAK Server** to stream node positions from every protocol to an OpenTAKServer, FreeTAKServer, or TAK Server, over TLS or plain TCP. It works with or without the local server.

### Connection

| Setting                                                                               | Notes                                                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Server address**                                                                    | Hostname or IP address                                                        |
| **Port**                                                                              | 1–65535. Default 8089                                                         |
| **Use TLS (recommended)**                                                             | Mutual TLS. Turn it off to use plain TCP                                      |
| **Verify the server certificate (recommended)**                                       | On by default                                                                 |
| **Accept a certificate issued for a different name (imported CA only, as ATAK does)** | Opt-out for servers set up that way. Needs verification on and an imported CA |
| **Connect on application launch**                                                     | Reconnects at app start. Not available on plain TCP or with verification off  |

**Plain TCP** is unencrypted: anyone on the network path can read the relayed positions. Certificates are not used, and connecting at launch stays off.

**Verification on (default).** The server certificate must chain to the imported CA, or to the system trust store when no CA is imported, and must name the server address.

**Name mismatch opt-out.** This accepts a certificate issued for another name, as ATAK does. It needs verification on and an imported CA.

**Verification off.** Certificate failures do not stop the connection, so anyone who can intercept it receives the relayed positions, and the relay does not connect at launch.

**Reconnect.** The relay reconnects on its own after a drop. A manual **Disconnect** does not reconnect.

### Certificates for the remote server

Use one of these two ways to give the relay its credentials.

**Import files.** Choose **Import Certificates** and pick a `.p12` file or PEM files:

- A TAK data package carries a truststore and a client `.p12`, usually with the password `atakatak`.
- Enter the **Certificate password** before you import.
- **Remove Certificates** deletes what you imported.

The panel summarizes what is stored: the trusted CA, and the client certificate with its subject and expiry. With no CA imported, the server is checked against the system trust store.

**Enroll with a username and password.** TAK Servers that use logins issue a client certificate on their enrollment port (usually 8446), as ATAK does. Enter the server address first, then **Username**, **Password**, and **Enrollment port**, and press **Get Certificate**.

- The password is sent once and not saved.
- The private key stays in the main process.
- Enrollment needs server certificate verification on. For a self-signed server, import its CA first.

### Notes

- The relay carries positions, plus any channel you tick **Remote server** for (read only).
- Direct messages, MECP spot markers, and ATAK's emergency alarm are never sent to the remote server.

---

## Messaging in ATAK

Under **MeshCore messaging in ATAK** and **Meshtastic messaging in ATAK**, set **Channels in ATAK** to **Off**, **All channels**, or **Selected channels**. Connect a radio first to list its channels.

### Channels as contacts

Each served channel becomes a contact on every connected ATAK device, and what the channel hears arrives from that contact. For Meshtastic this includes traffic heard over MQTT.

**Names.** A contact is named with its protocol:

| Example      | Meaning                    |
| ------------ | -------------------------- |
| `#MC Public` | MeshCore channel           |
| `#MC ops`    | MeshCore hashtag channel   |
| `#MT 🔒 Ops` | Meshtastic private channel |

Type your own name in a channel's **ATAK name** field to replace the default.

**Replies and reactions.** A reply says whom it answers (`@Alice copy that`) and a reaction what it reacts to (`👍 to Alice: "meet at the trailhead…"`), on both protocols.

### Per-channel options

| Option            | What it does                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In ATAK**       | Serves the channel                                                                                                                                                                       |
| **ATAK name**     | Contact name in ATAK                                                                                                                                                                     |
| **ATAK can send** | Lets a message to the contact be transmitted on that channel from this radio. Off means the channel is receive only                                                                      |
| **Add callsign**  | Prefixes the sender's callsign to the message. Turn it off for a bot channel, because a bot looks for its command at the start of the message and misses one that starts with a callsign |
| **Remote server** | Also streams the channel, read only, to the remote TAK server                                                                                                                            |
| **Tracker fixes** | Turns MeshCore tracker position messages (`!MT1`) into map markers (shown where the radio supports tracker channels)                                                                     |

**Sending.** With **ATAK can send** on, a message to the contact is prefixed with the sender's callsign (`[VIPER] on scene`) and shows in Chat like any other. Sending is:

- Off by default.
- Cut to fit one mesh message.
- Limited to 10 messages a minute per device.

**MeshCore replies.** On a MeshCore channel, start with `@` and the start of a name to reply in MeshCore's form. `@silver are you on?` goes out as `@[Silver Eagle] [VIPER] are you on?`, with the callsign after the reply so MeshCore apps still see it. Start with `@@` to reply to whoever spoke last, the same as MeshCore TAK Bridge. If the start of the name fits several people heard on the channel, nothing is sent and the chat says who matched.

**Held messages.** Up to 50 messages heard while no ATAK device is connected are held for the first one to connect (for a day), and only that one.

**Settings from earlier versions** carry over. A channel that had a GeoChat room is served, keeps its send setting and its room name (as its ATAK name), and streams to the remote server.

**Per channel, not per slot.** Channel settings are kept per channel, so a channel moving into another's slot never inherits its settings, and ATAK devices are told to drop the old room contacts.

### MECP in ATAK

An MECP report heard on a served channel or in a direct message reaches ATAK in words, in the app's language, with its code line below (`🆘 MAYDAY: Injury · 2 people · 48.6520, 20.1305`), as MeshCore TAK Bridge shows one.

Each open incident with a position is also a spot marker on ATAK's map, coloured by severity (grey for drills), and removed when the incident is resolved.

**Emergency alarm.** The option **Sound ATAK's emergency alarm for an MECP MAYDAY** is off by default. When on, a MAYDAY with a position also sets off ATAK's emergency alarm, cancelled when it is resolved. Anyone on a channel can send a MAYDAY, so the alarm only sounds for a MAYDAY with a position, never for a drill, a blocked sender, or an alert the app has silenced.

Full details: [EMCOMM: Reports in ATAK](emcomm.md#reports-in-atak).

---

## Direct messages with companions

Tick **Direct messages** under a radio's messaging section. Every companion that radio can message can then be messaged from its marker in ATAK:

- A MeshCore companion in its contacts.
- Any Meshtastic node.
- A Reticulum LXMF peer whose delivery address is known.

Reticulum has its own **Reticulum messaging in ATAK** section for this. An LXMF peer with no position appears at 0, 0 only once mesh-client has a conversation with it, so ATAK's contact list does not fill with every peer heard.

**Sending.** The message goes out from this radio as a direct message, prefixed with the sender's callsign, and shows in Chat like any other.

**Delivery.** ATAK marks the message delivered when the companion acknowledges it. If it still is not acknowledged after mesh-client's automatic resends, a "Not confirmed" note says so. For MeshCore, the note includes a reminder that a flood advert from each radio usually fixes a DM that keeps failing.

**Replies.** A companion's replies go to the ATAK device that last wrote to it, or to every connected device when none has. They are held for that device while it is away.

**No marker.** A companion with no marker on the map appears at 0, 0 for a day after a message.

**Limits.**

- Direct messages are never sent to the remote TAK server.
- A message ATAK cannot deliver (direct messages off, or not a companion this radio can reach) gets a note in its conversation saying why.

---

## Unit filters and icons

Under **Relayed unit styles**, restyle how relayed nodes look in ATAK.

### Unit filters

Use **Add filter** to restyle nodes by name, node type, protocol, or a combination. Each filter has:

| Field                                  | Choices                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Enable filter**                      | On or off                                                                                                                      |
| **Node type**                          | Any node type, **Companions and clients**, **Repeaters and routers**, **Room servers**, **Sensors**, **Trackers**              |
| **Protocol**                           | Any protocol, or one protocol                                                                                                  |
| **Match type**                         | **Name is**, **Name starts with**, **Name ends with**, **Name contains**                                                       |
| **Name patterns**                      | Any name, or comma-separated (for example `EMS-, Medic`)                                                                       |
| **Unit type**                          | **Team member**, **Infantry**, **Reconnaissance**, **Medical**, **Ground vehicle**, **Installation**, **Sensor**, **Aircraft** |
| **Team color**                         | A team, or **No team**                                                                                                         |
| **Team role**                          | A role, or **No role**                                                                                                         |
| **Custom color**                       | A custom marker color                                                                                                          |
| **Remove the match from the callsign** | Strips the matched text from the callsign                                                                                      |

**Rules.**

- A filter with no name pattern applies to every node of its type or protocol.
- The first enabled filter that matches wins.
- **Relay nodes that no filter matches** controls whether unmatched nodes are relayed at all. When it is off, they are not relayed.

Use **Test a node name**, **Node type to test**, and **Protocol to test** to see which filter applies. Press **Save styles** to apply (**Saved and applied**).

### Repeater and room server icons

Give repeaters (MeshCore repeaters, Meshtastic routers, Reticulum interfaces) and room servers each an icon from an ATAK icon set:

- **Icon for repeaters and routers** and **Icon for room servers** take a path in the form `<set UID>/<group>/<file>`.
- **GeoOps icon for repeaters and routers** and **GeoOps icon for room servers** pick from the GeoOps WildFire presets that MeshCore TAK Bridge offers (Repeater, Repeater Mobile Relay, Ranger Station, and others).

Rules:

- The icon follows the node type, so a filter can change a room server's team and role and it keeps its icon.
- Both fields are optional. Leave a field empty for the standard symbol.
- Each TAK device needs the same icon set installed. A device without it draws the standard symbol.

---

## ATAK plugin messages (Meshtastic)

On Meshtastic, incoming ATAK plugin packets from mesh nodes are listed under **ATAK Plugin Messages**, with the sender node, the packet count, and when the newest packet arrived.

For the newest packet from each node the panel summarizes what it can decode: callsign, CoT type, team, position, battery, temperature, or chat text. A payload it cannot decode reads **Payload not recognized as a TAK packet**. When nothing has arrived, the section reads **No ATAK plugin messages received from mesh.**

This section appears only where the radio supports the ATAK plugin.

---

## Troubleshooting

Common symptoms and fixes are in [Troubleshooting — TAK (CoT gateway)](troubleshooting.md#tak-cot-gateway):

- An EUD reports "TLS certificate invalid" or cannot connect with a mesh-client data package.
- ATAK reports "remote host's certificate not trusted; check truststore".

Quick checks first:

1. The server is running and the device is on the same LAN.
2. The firewall allows inbound TCP on the server port (default 8089).
3. You generated the data package after the last certificate regeneration or LAN IP change, and removed the old one before importing.
4. For the remote relay, read **Last error** in the panel. Typical causes are an untrusted CA, a wrong name, a missing client certificate, or a server that is not using TLS.

---

## Security notes

- **Keys stay in the main process.** Certificate and key handling, TLS, and enrollment run in the app's main process. The renderer never receives a private key.
- **Remote credentials.** The imported client key is encrypted with the operating system's secure storage (Keychain, DPAPI, libsecret) when it is available. Otherwise it is stored in a file readable only by your user.
- **Enrollment password.** Sent once and never saved.
- **Package password.** The data package's PKCS#12 files use the well-known password `atakatak`, as TAK data packages do. Treat the zip as a secret, because it holds the client key.
- **mTLS.** Leave **Require client certificate (mTLS)** on unless you understand the exposure. Without it, any device that can reach the port can receive relayed positions.
- **Plain TCP and verification off.** Both expose relayed positions to anyone who can intercept the connection. Neither connects at launch.
- **Name mismatch opt-out.** Only with verification on and an imported CA, as ATAK does.
- **Regenerating certificates** invalidates old packages, which is the way to cut off a lost device.
- **Sending is off by default.** **ATAK can send**, **Direct messages**, and ATAK's emergency alarm each need to be turned on, and sending is capped at 10 messages a minute per device.

---

## Related links

- [EMCOMM: Reports in ATAK](emcomm.md#reports-in-atak) — MECP text, spot markers, and the emergency alarm
- [Troubleshooting — TAK (CoT gateway)](troubleshooting.md#tak-cot-gateway)
- [Features](features.md) — TAK Server (CoT Gateway) summary
- [TAK gateway (developer map)](development/tak.md)
- [Reticulum](reticulum.md) — LXMF peers that ATAK can message
