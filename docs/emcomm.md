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
- Drill codes (`D01`, `D02`) mark a report as a drill: it is listed but never plays an alert tone or toast and never adds an unread alert badge. Open MAYDAY and URGENT drills still count toward the **Incident** tab badge.
- Tones and volume are configurable per severity in **App → Notifications → Notification tones**. MAYDAY and URGENT keep their mute bypass and a 10% volume floor. See [Notification sounds](notification-sounds.md).
- Chat channel and DM chips show a shield icon, colored by the most severe unread MECP report in that conversation.

## Sending a report

1. Turn on **App → MECP → Show MECP buttons in Chat** (off by default).
2. In Chat, open the conversation to send to, then click the red **siren** button to request help or report conditions, or the blue **shield** button to respond.
3. Choose severity and codes, add free text and optionally your position, and send. Both workflows start at ROUTINE with no codes selected. The response workflow opens on acknowledgements and help updates. Use **Show all MECP codes** if you need a code from another category.

Both workflows use the same standard MECP codes and translated labels, so other clients can read them. On MeshCore, queued reports and retries use the destination channel’s saved scope. Choose **Unscoped** beside Send for mesh-wide floods, or a saved region for local floods; **Default** follows the companion radio’s default.

Every report goes through the **emergency outbox**. It is sent right away when the radio is up, and it keeps retrying (after 30 seconds, 1 minute, 2 minutes, then every 5 minutes) until the network acknowledges it. Acknowledgement means the radio heard the mesh repeat or confirm it (a Meshtastic ACK, a MeshCore repeater rebroadcast or DM ACK, a Reticulum delivery receipt), or another station acknowledged or relayed your report. There is no age cutoff or attempt limit. While a report is waiting, Chat shows it with **Waiting for network acknowledgement…** or a retry countdown. If a report is stuck, use **Stop retrying** on it (you are asked to confirm). A soft cap of 20 queued emergency reports blocks the least urgent extras, but never deletes anything and never blocks a MAYDAY.

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

### Unseen emergency alert

The MAYDAY siren and URGENT tone play once, and the toast closes after 10 seconds. Everyone gets that one-time alert. Stations that must not miss a report (an EOC, a net control, a monitored shelter) can turn on **App → MECP → Incident Command station (standing alert)**. It is **off** by default.

With it on, a new MAYDAY or URGENT report (not a drill) also opens a red banner at the top of every tab, and the window flashes in the taskbar (or the dock icon bounces on macOS) when the app is not focused. The banner stays until you open the Incident tab, press **Mark seen**, acknowledge, or resolve the incident. **View** opens the Incident tab.

"Seen" is local to this computer and sends nothing over the mesh. Acknowledging is still a separate, deliberate step. Reports loaded from history at startup, your own beacons, and drills never open the banner. A report that escalates to MAYDAY or URGENT, or reopens after being resolved, opens it again.

For unattended stations, **App → MECP → Repeat unseen MAYDAY/URGENT alert (minutes)** (under the station toggle) replays the tone at that interval until the alert is seen. It is blank (off) by default.

### Spam and blocking

Anyone on the mesh can send a MECP report, so mesh-client limits how much noise one sender can make:

- **Repeat silencing:** after 3 alerts from the same sender within 10 minutes, further reports from that sender stop sounding. They still appear in the Incident tab (without the banner), and a one-time notice offers **Block sender**. If many different stations send reports within a minute, further tones pause briefly as well.
- **Block alerts:** each row in the Incident tab has **Block alerts**. Choose **Block only**, or **Block and resolve** to also close that sender's open incidents locally. Reports from a blocked sender no longer alert, open incidents, or get bridged by RF rebroadcast. They are still written to the audit log (marked blocked) and still show as text in Chat. Unblock in **App → MECP → Blocked emergency senders**.
- **Block a node completely (Meshtastic and MeshCore):** **Block** in a node's detail view drops all of that node's messages before they reach Chat, so it cannot send MECP either. Unblock in **App → Blocked nodes**. Reticulum has its own blocklist in the Reticulum network settings.

Node IDs can be spoofed, especially on Meshtastic, so blocking stops casual abuse but not a determined attacker. Only block a sender you are sure is abusing MECP.

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
- **Standing alert and repeat for unseen MAYDAY/URGENT:** in App → MECP; see [Unseen emergency alert](#unseen-emergency-alert).

## Exports

- **Nodes:** NodeList → **Export JSON** (topology) or **Export CSV**.
- **Diagnostics:** Diagnostics → **Export JSON** (visible rows for the active protocol).
- **MECP audit log:** App → MECP → **Export MECP log**.
- **Incident log:** Incident tab → **Export log** → JSON or CSV. Includes every stored incident (open, acknowledged, and resolved) with severity, codes, sender, relays, timestamps, coordinates, ACK peers, and beacon state, oldest first. Each incident also carries an `events` timeline: when it was received, relay copies heard, each ACK heard (and from whom), your own ACK sent, beacon confirmed or cancelled, resolved, and reopened. In CSV the timeline is one cell of semicolon-separated entries. Use it for the after-action record.

## Map tools for search and rescue

- **MGRS grid:** Map → **Layers → MGRS grid** (off by default). Grid precision adapts to the zoom level; labels appear when few enough squares are visible.
- **Measure:** the Map measure control draws a polyline and shows its length.
- **USGS Topo** basemap (US only) is available and can be cached for offline use like the other basemaps. See [Troubleshooting — Map tab without internet](troubleshooting.md#map-tab-without-internet-offline--no-wan).
- Position history for senders of open or acknowledged incidents is kept even when normal history pruning runs, so their tracks stay available until the incident is resolved.
