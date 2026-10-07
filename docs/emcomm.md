# EMCOMM: MECP and Incident Command

Mesh-Client supports emergency communications (EMCOMM) on Meshtastic, MeshCore, and Reticulum. This guide is for operators: how emergency reports are sent and received, what the **Incident** tab shows, and which settings matter. For problems, see [Troubleshooting — MECP](troubleshooting.md#mecp-emergency-reports).

## MECP reports

MECP ([Mesh Emergency Communication Protocol](https://mecp.radio/)) is structured emergency text sent as ordinary chat:

```text
MECP/<severity>/<codes> [freetext]
```

| Severity | Meaning | Alert                                                                    |
| -------- | ------- | ------------------------------------------------------------------------ |
| `0`      | MAYDAY  | Siren tone and emergency toast; **ignores mute**, even in a focused chat |
| `1`      | URGENT  | EAS-style tone and toast; **ignores mute**                               |
| `2`      | SAFETY  | Short tone when not muted                                                |
| `3`      | ROUTINE | Short tone when not muted                                                |

- Codes are a letter plus two digits (for example `M01`). Labels come from the MECP language packs, so codes display in your language.
- A report is at most **200 bytes** (UTF-8).
- Drill codes (`D01`, `D02`) mark a report as a drill: it is listed but never alerts or badges.
- Tones and volume are configurable per severity in **App → Notifications → Notification tones**. MAYDAY and URGENT keep their mute bypass and a 10% volume floor. See [Notification sounds](notification-sounds.md).
- Chat channel and DM chips show a shield icon, colored by the most severe unread MECP report in that conversation.

## Sending a report

1. Turn on **App → MECP → Show MECP button in Chat** (off by default).
2. In Chat, open the conversation to send to, then click the red **siren** button next to Send.
3. Choose severity and codes, add free text and optionally your position, and send.

If the radio is offline, MQTT-only, or the send fails, the report goes into the **emergency outbox**. Emergency reports keep retrying after reconnect with no age cutoff or attempt limit. A soft cap of 20 queued emergency reports blocks the least urgent extras, but never deletes anything and never blocks a MAYDAY.

## Incident tab

The **Incident** tab is always visible on all three protocols, at the bottom of the rail next to **App**. Its red badge counts open MAYDAY and URGENT reports (drills included), so you notice them even if you rarely open the tab.

Each row shows severity, sender, MECP codes, free text, ACK count, which protocols heard the report, and whether a distress **beacon** is active. The same report heard on several protocols (for example bridged from Meshtastic to MeshCore) appears once.

Coordinates come from the report itself or the sender's last known position, and appear on the Map under **Layers → Emergency incidents** (Meshtastic, MeshCore, and Reticulum maps).

### Acknowledge, confirm, resolve

| Button            | What it sends                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Acknowledge**   | An `R01` ACK echoing the report's codes                                                                               |
| **Confirm**       | A `B02` beacon ACK (shown instead of Acknowledge while someone's beacon is active), asking them to reduce beacon rate |
| **Resolve**       | Nothing; closes the row locally                                                                                       |
| **Cancel beacon** | A `B03` "I am OK" on the beacon's protocol and channel, then resolves the row. Shown only for beacons **you** sent    |

ACKs are sent on the protocol where the report was heard (preferring your active tab). They are **heard-by-network, best effort**: an ACK count means ACK copies were overheard on the mesh, not that the person in distress read anything. Treat it as "the network has it", never as a read receipt.

You can't cancel someone else's beacon: `B03` means "I am OK", so only the originator can send it.

## Durable audit log

Every inbound MECP report is appended to `mecp-received.log` in the app data folder (separate from the session app log, rotated to `mecp-received.log.1`). Export it from **App → MECP → Export MECP log**. It is also included in support bundles.

## RF rebroadcast (bridge)

**App → MECP** can bridge MECP reports between a Meshtastic channel and a MeshCore channel. It is **off** by default.

- Each rule has endpoint **A** and endpoint **B** (channel indices 0–7). Reports go **A → B** by default; turn on **Bidirectional** to also send **B → A**.
- Only reports heard over RF are bridged (not MQTT-only), and never your own reports, history, or drills. A loop guard prevents ping-ponging the same report.
- After each bridged report, a short plain-text notice follows: `MECP from <sender> via <Meshtastic|MeshCore> (<channel name>)`.

## Operational alerts

**App → Notifications** has ops alerts for nodes you mark as watched:

- **Silence:** a watched node has not been heard for the configured minutes, with an escalation at twice that time. Nodes never heard are not "silent".
- **Battery low:** a watched node's reported battery drops below the threshold (default 10%). Fires once, then re-arms after it recovers 5 points.
- **Link down:** your Meshtastic or MeshCore radio link drops unexpectedly. Never fires on a manual disconnect or while reconnecting. Reticulum is not included (it runs as a separate stack, not an RF link).

## Exports

- **Nodes:** NodeList → **Export JSON** (topology) or **Export CSV**.
- **Diagnostics:** Diagnostics → **Export JSON** (visible rows for the active protocol).
- **MECP audit log:** App → MECP → **Export MECP log**.

## Map tools for search and rescue

- **MGRS grid:** Map → **Layers → MGRS grid** (off by default). Grid precision adapts to the zoom level; labels appear when few enough squares are visible.
- **Measure:** the Map measure control draws a polyline and shows its length.
- **USGS Topo** basemap (US only) is available and can be cached for offline use like the other basemaps. See [Troubleshooting — Map tab without internet](troubleshooting.md#map-tab-without-internet-offline--no-wan).
- Position history for senders of open or acknowledged incidents is kept even when normal history pruning runs, so their tracks stay available until the incident is resolved.
