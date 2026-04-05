# Diagnostics Reference

This document is the authoritative reference for every diagnostic output in Mesh-Client. It covers the two diagnostic subsystems — **Routing** and **RF** — and explains what each finding means, what triggers it, and how to interpret it.

**Where diagnostics appear:**

- **DiagnosticsPanel** — network health status, anomaly table, halos toggles, environment profile, max-age settings
- **NodeDetailModal** — per-node routing health section, redundancy path history, RF findings, MQTT ignore toggle
- **NodeListPanel** — inline anomaly badges, redundancy `+N` echo count, MQTT-only node dimming
- **MapPanel** — channel utilization halos, routing anomaly aura circles

---

## 1. Network Health Status

The network health band summarizes the current diagnostic state of the mesh in the DiagnosticsPanel header.

| Badge     | Condition                                   | Color  |
| --------- | ------------------------------------------- | ------ |
| Healthy   | 0 errors, 0 warnings                        | Green  |
| Attention | Any errors or warnings (routing errors < 3) | Yellow |
| Degraded  | ≥ 3 routing errors                          | Red    |

The panel also shows a breakdown of error and warning counts, and a "This node" line when your connected device has its own issues separate from the mesh-wide picture.

---

## 2. Routing Anomalies

Routing anomaly detection runs on Meshtastic nodes. For MeshCore, hop-based anomalies require `hasHopCount` capability — if absent, they are skipped.

Detection is run in priority order — first match wins:

1. `impossible_hop`
2. `bad_route` (error variant)
3. `route_flapping`
4. `hop_goblin`
5. `bad_route` (warning variant)

Routing rows persist for up to **24 hours** by default (configurable 1–168 h in DiagnosticsPanel → Display Settings).

---

### hop_goblin — Error

**Trigger:** A node is within 3 km (standard profile) but is taking more than 2 hops to reach your device.

**Meaning:** A nearby node is routing through intermediate mesh nodes instead of connecting directly. This wastes airtime on rebroadcasts that should not be necessary for a short-range link.

**Environment multipliers:**

| Profile  | Distance threshold | Hop threshold |
| -------- | ------------------ | ------------- |
| Standard | 3 km               | 2 hops        |
| City     | 4.8 km (1.6×)      | 3 hops        |
| Canyon   | 7.8 km (2.6×)      | 4 hops        |

If your GPS source is IP-geolocation (low accuracy), the distance threshold is doubled automatically and a yellow banner appears in the diagnostics panel.

**MQTT behavior:** Skipped entirely for MQTT-only nodes when global or per-node MQTT ignore is active. For hybrid nodes (heard via both RF and MQTT), the anomaly still fires but a yellow advisory note suggests enabling MQTT filtering as a first step before adjusting node placement.

---

### bad_route — Two Variants

**Error variant (duplication rate):**

- **Trigger:** More than 55% of a node's recent packets are duplicates.
- **Meaning:** The mesh is forwarding the same packet through multiple competing paths from this node. This typically indicates a routing loop or excessive redundant rebroadcasting.

**Warning variant (close-in over-hopping):**

- **Trigger:** A node within 5 miles is taking more than `hopThreshold + 2` hops.
- **Meaning:** Suboptimal path — the node is reachable but the route is longer than expected for its distance.

---

### impossible_hop — Error

**Trigger:** A node reports 0 hops (direct neighbor) but is more than 100 miles away (GPS coordinates required on both your device and the remote node).

**Meaning:** Either the GPS coordinates are stale or wrong, or the hop-count metadata is unreliable for this node. The node's position data should be treated with suspicion.

**Note:** Skipped for MeshCore nodes without `hasHopCount` capability.

---

### route_flapping — Warning

**Trigger:** The hop count to a node changes more than 3 times within the last 10 minutes.

**Meaning:** The node's path through the mesh is unstable. Common causes include competing routes of similar quality, marginal RF links where the best next-hop changes frequently, or a node that is on the edge of coverage.

---

## 3. RF Diagnostics

RF diagnostics analyze signal-layer data from radio telemetry. There are two categories: **Connected Node** (your directly attached device, using LocalStats telemetry) and **Remote Nodes** (other mesh nodes, observed from their telemetry packets).

RF rows expire after **1 hour** (fixed, not configurable).

---

### Connected Node Findings

These findings use LocalStats data from your own device's radio.

| Finding                        | Trigger                                                                                    | Severity | Meaning                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Utilization vs. TX             | Channel utilization (CU) > 25% and air TX < 5%                                             | Warning  | Your node is hearing a busy channel but transmitting very little — high noise floor causing backoff                                                       |
| Non-LoRa Noise / RFI           | CU > 25%, ≥5 RX packets, 0 bad packets                                                     | Warning  | RF energy present from a non-LoRa source (motors, baby monitors, switching power supplies) — packets decode correctly because it is not LoRa interference |
| 900MHz Industrial Interference | Bad packet rate > 20% and CU > 25%                                                         | Warning  | Bursty high-power sources such as smart meters or industrial telemetry on 900 MHz causing frequent decode failures                                        |
| Channel Utilization Spike      | Current CU > 2× 30-min rolling average (minimum 12 samples, ≥30 min span, rolling avg ≥1%) | Warning  | Sudden congestion or interference surge above your node's normal baseline; 15-min cooldown before re-firing                                               |
| Mesh Congestion                | RX duplicate rate > 15%                                                                    | Warning  | Excessive redundant packet rebroadcasting across the mesh                                                                                                 |
| Hidden Terminal Risk           | CU > 40%, bad rate 5–10%, no industrial finding                                            | Warning  | Multiple transmitters cannot hear each other and are colliding at your node; a classic hidden terminal scenario                                           |
| LoRa Collision or Corruption   | Bad packet rate > 10% (catch-all)                                                          | Warning  | Preamble decoded but CRC/decode failed — often caused by non-Meshtastic LoRa devices on the same frequency                                                |

---

### Remote Node Findings

These findings use telemetry observed from other nodes' radio stats.

| Finding                   | Trigger                                                               | Severity | Notes                                                              |
| ------------------------- | --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| External Interference     | CU > 25% and air TX < 5%                                              | Warning  | Same pattern as connected node finding, observed at a remote node  |
| Channel Utilization Spike | Same gates as connected node (rolling average, min samples, cooldown) | Warning  | Sudden congestion at a remote node's location                      |
| Wideband Noise Floor      | CU > 25%, SNR < 0 dB                                                  | Warning  | Last-hop SNR only; elevated noise floor at the remote node         |
| Fringe / Weak Coverage    | CU ≤ 10%, SNR < 0 dB                                                  | Info     | Node is at the edge of mesh coverage; low activity and poor signal |

---

## 4. Foreign LoRa Detection

Foreign LoRa detection identifies non-Meshtastic LoRa traffic observed by your connected device's radio. The detection window is the **last 90 minutes**.

**Signal classes:**

| Class          | Label               | Severity |
| -------------- | ------------------- | -------- |
| `meshcore`     | MeshCore Activity   | Info     |
| `meshtastic`   | Meshtastic Traffic  | Info     |
| `unknown-lora` | Unknown LoRa Signal | Info     |

**Proximity classification** (from RSSI/SNR):

- Very Close
- Nearby
- Distant
- Unknown Distance

**Escalation:** If MeshCore packets exceed 5 per minute, the finding upgrades to **Potential MeshCore Repeater Conflict** (Warning) — indicating a nearby MeshCore repeater that may be competing for airtime on the same frequency.

**Cooldown:** The same (nodeId, class) pair updates at most every 5 minutes to avoid flooding the table.

---

## 5. Packet Redundancy

Packet redundancy measures how many distinct paths each packet travels through the mesh — both RF paths and MQTT. A higher redundancy score means a node is reachable via multiple independent routes, which improves reliability.

**Where it appears:**

- NodeListPanel "Redund." column (sortable)
- NodeDetailModal "Connection Health %" row + collapsible "Path History" in the Routing Health section

**Tracking:** The last 20 packets per node are tracked. For each packet, the number of distinct observed paths (RF + MQTT) is recorded.

**Score formula:**

```
score = min(round((maxPaths - 1) / 3 × 100), 100)
```

| maxPaths | Score | Meaning              |
| -------- | ----- | -------------------- |
| 1        | 0%    | Single path only     |
| 2        | 33%   | One echo             |
| 3        | 67%   | Two echoes           |
| 4+       | 100%  | Three or more echoes |

**Display:**

- `+N` echoes where N = maxPaths − 1
- ≥ 3 echoes: lime green (excellent redundancy)
- 1–2 echoes: gray
- 0 echoes: muted dash

**Cache:** 15-minute TTL per packet, maximum 2000 entries before cleanup.

---

## 6. Map Visualizations

### Channel Utilization Halos

Toggle: **"Show channel utilization halos on map"** in DiagnosticsPanel.

Halos appear as colored circles around node positions, sized relative to channel utilization.

| CU range | Color  |
| -------- | ------ |
| < 15%    | Green  |
| 15–30%   | Yellow |
| 31–50%   | Orange |
| ≥ 51%    | Red    |

**Radius:** `(CU / 100) × 14` pixels.

### Routing Anomaly Halos

Toggle: **"Show routing anomaly halos on map"** in DiagnosticsPanel.

| Severity | Style               | Radius | Animation         |
| -------- | ------------------- | ------ | ----------------- |
| Error    | Red dashed circle   | 500m   | Fast pulse (1.4s) |
| Warning  | Amber dashed circle | 500m   | Slow pulse (2s)   |
| Info     | Blue thin circle    | 350m   | None              |

---

## 7. MQTT Filtering

### Global Ignore MQTT

Checkbox in DiagnosticsPanel settings.

When enabled:

- MQTT-only nodes are dimmed in NodeListPanel (`opacity-50`, strikethrough on name/short name)
- `hop_goblin` and `impossible_hop` are skipped for MQTT-only nodes
- All nodes are re-analyzed immediately

### Per-Node MQTT Ignore

Toggle in NodeDetailModal ("MQTT Ignore" row); pill button in the anomaly table Action column.

- Same skip logic as global ignore, but scoped to one node
- Persisted to `localStorage['mesh-client:mqttIgnoredNodes']`
- Active nodes shown as yellow badge in DiagnosticsPanel "Per-Node MQTT Filters" section
- Active nodes show a yellow "MQTT Ignored" badge in the NodeDetailModal header

### Hybrid Nodes

A hybrid node has been heard via both RF and MQTT in the current session. For hybrid nodes, `hop_goblin` still fires (unlike MQTT-only nodes) but adds a yellow advisory note suggesting per-node MQTT filtering as a first diagnostic step before adjusting node placement.

---

## 8. Environment Profiles

The environment profile adjusts detection thresholds to account for different RF propagation environments.

Selected in DiagnosticsPanel settings via a segmented control.

| Profile  | Distance multiplier | Hop threshold | Use when                                                 |
| -------- | ------------------- | ------------- | -------------------------------------------------------- |
| Standard | 1×                  | 2 hops        | Rural / open terrain                                     |
| City     | 1.6×                | 3 hops        | Dense urban environment with buildings blocking RF       |
| Canyon   | 2.6×                | 4 hops        | Mountainous or canyon terrain with significant multipath |

**Low-accuracy GPS:** When your position is derived from IP geolocation (city-level only), distance thresholds are doubled automatically in addition to any profile multiplier. A yellow banner appears in the diagnostics panel indicating reduced accuracy.

---

## 9. Node Status Thresholds

| Status  | Condition                             | Color  |
| ------- | ------------------------------------- | ------ |
| Online  | Last heard < 2 hours                  | Green  |
| Stale   | Last heard 2–72 hours                 | Yellow |
| Offline | Last heard ≥ 72 hours, or never heard | Gray   |

**SNR quality** (used in path traces and neighbor SNR bars):

| SNR    | Quality  | Color  |
| ------ | -------- | ------ |
| ≥ 5 dB | Good     | Green  |
| 0–4 dB | Marginal | Yellow |
| < 0 dB | Poor     | Red    |

---

## 10. Key Source Files

For contributors who want to modify or extend the diagnostics system:

| File                                                                                                                 | Purpose                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`src/renderer/stores/diagnosticsStore.ts`](src/renderer/stores/diagnosticsStore.ts)                                 | Zustand store: anomaly state, persistence, MQTT ignore sets, foreign LoRa records |
| [`src/renderer/lib/diagnostics/RoutingDiagnosticEngine.ts`](src/renderer/lib/diagnostics/RoutingDiagnosticEngine.ts) | Hop anomaly detection (hop_goblin, bad_route, impossible_hop, route_flapping)     |
| [`src/renderer/lib/diagnostics/RFDiagnosticEngine.ts`](src/renderer/lib/diagnostics/RFDiagnosticEngine.ts)           | RF signal analysis (connected node + remote node findings)                        |
| [`src/renderer/lib/diagnostics/diagnosticRows.ts`](src/renderer/lib/diagnostics/diagnosticRows.ts)                   | Row merge/prune utilities, default max-age values                                 |
| [`src/renderer/lib/foreignLoraDetection.ts`](src/renderer/lib/foreignLoraDetection.ts)                               | Foreign LoRa packet classification and proximity scoring                          |
| [`src/renderer/components/DiagnosticsPanel.tsx`](src/renderer/components/DiagnosticsPanel.tsx)                       | Tab 8 UI: health band + counts, anomaly table, settings                           |
| [`src/renderer/components/NodeDetailModal.tsx`](src/renderer/components/NodeDetailModal.tsx)                         | Per-node detail overlay: routing health, MQTT ignore toggle                       |
| [`src/renderer/components/NodeInfoBody.tsx`](src/renderer/components/NodeInfoBody.tsx)                               | RF findings section, redundancy path history, congestion block                    |

---

## 11. Technical Reference

This section documents the exact protocol and hardware mechanisms behind each diagnostic finding. Thresholds are quoted directly from the source code.

---

### 11.1 RF Findings — Connected Node

#### Utilization vs. TX

**Trigger:** `channel_utilization > 25%` (`HIGH_CU`) and `air_util_tx < 5%` (`LOW_TX`)

**Mechanism:** Meshtastic uses CSMA/CA (Carrier Sense Multiple Access with Collision Avoidance). Before transmitting, the LoRa radio performs a Channel Activity Detection (CAD) check. `channel_utilization` counts the fraction of time the radio detected any RF energy on the channel — including non-decodable signals. `air_util_tx` counts only the time _your_ radio was actually transmitting. When CU is high but TX is very low, the radio is repeatedly sensing a busy channel and backing off — it cannot transmit because it keeps losing the CAD check.

**Fields:** `channel_utilization` (% of time channel was active in the last stats window, delivered via `NodeInfo.DeviceMetrics`); `air_util_tx` (% of the same window your node was actually on air).

**Common sources:** Co-located high-power transmitters (other LoRa gateways or repeaters on the same channel); local mesh congestion from nodes with high hop limits flooding the channel; or a non-LoRa wideband signal raising the energy floor.

**Mitigation:** Reduce hop limits on nearby high-traffic nodes; relocate antenna away from co-located transmitters; switch to a less-congested frequency plan.

---

#### Non-LoRa Noise / RFI

**Trigger:** `channel_utilization > 25%`, `num_packets_rx >= 5` (`MIN_SAMPLE`), and `num_packets_rx_bad === 0`

**Mechanism:** The LoRa radio's CAD/energy-detect circuit triggers on any RF energy above threshold (~−120 dBm), raising `channel_utilization`. But non-LoRa signals do not carry a valid LoRa preamble/sync word. When the radio detects energy without a valid preamble it does not even attempt demodulation, so `num_packets_rx_bad` stays at 0. The zero bad-packet criterion is what distinguishes wideband RFI from LoRa interference: real LoRa signals (even from foreign networks) produce demodulation attempts and CRC failures; pure noise or non-LoRa wideband sources do not.

**Fields:** `num_packets_rx_bad` must be exactly 0; `num_packets_rx` must be ≥ 5 to ensure the sample size is meaningful.

**Common sources:** DC motor brushes and variable-frequency drives (900 MHz harmonics); switching-mode power supplies; other ISM-band devices operating in continuous-wave mode (older cordless phones, some baby monitors).

**Mitigation:** Identify the noise source with a spectrum analyzer or SDR. Physically separate the antenna from nearby electronics. A bandpass or SAW filter on the antenna feed can attenuate out-of-band energy before it reaches the LoRa front end.

---

#### 900 MHz Industrial Interference

**Trigger:** `num_packets_rx_bad / num_packets_rx > 20%` (`SPIKE_BAD_RATE`) and `channel_utilization > 25%`

**Mechanism:** 900 MHz ISM-band industrial devices — smart meters, SCADA telemetry, agricultural sensors — typically use FSK or GFSK modulation. The LoRa radio's CAD circuit detects their energy (raising CU) and in many cases detects what resembles a LoRa preamble, triggering a full demodulation attempt that fails CRC because the modulation is incompatible. The result is a high `num_packets_rx_bad / num_packets_rx` ratio alongside elevated CU. The >20% bad-rate threshold (higher than the 5–10% Hidden Terminal band) reflects the bursty, high-power nature of industrial transmitters.

**Fields:** `num_packets_rx_bad`, `num_packets_rx`, `channel_utilization` — all reported in `DeviceMetrics` / LocalStats telemetry packets.

**Common sources:** AMI smart meters (e.g., Itron, Landis+Gyr, Sensus operating on 902–928 MHz); agricultural IoT networks; oil/gas pipeline SCADA systems; municipal water metering.

**Mitigation:** Channel-hop to a less-contested sub-band (if your region and firmware support it); install a cavity or bandpass filter for the specific Meshtastic channel frequency. For permanent base-station installs in dense smart-meter areas, a SAW filter is often required.

---

#### Channel Utilization Spike

**Trigger:** Current `channel_utilization > 2×` 30-minute rolling average, with gates: ≥ 12 samples, ≥ 30-minute span, rolling average ≥ 1%. 15-minute cooldown per node before re-firing.

**Mechanism:** The detector maintains a rolling 24-hour history of `channel_utilization` samples in `diagnosticsStore.cuHistory` (one entry per NodeInfo update). `computeCuStats24h` computes the rolling average over the pruned sample window. A spike fires when current CU exceeds 2× that baseline. The 15-minute cooldown (`cuSpikeLastFired` map in `RFDiagnosticEngine`) prevents the same node from re-firing while CU remains elevated. Cooldown state is cleared by `clearDiagnostics()`.

**Fields:** Current `channel_utilization` vs. stored per-node `CuSample[]` history in diagnosticsStore.

**Common sources:** Sudden network event (new repeater powered on, MQTT downlink storm, firmware retransmission loop); external interference source that just came online; a scheduled transmitter on a recurring duty cycle.

**Mitigation:** Determine whether the spike is sustained or transient. If sustained, treat as mesh congestion or external interference. If it correlates with a time pattern, a scheduled transmitter may be nearby.

---

#### Mesh Congestion

**Trigger:** `num_rx_dupe / num_packets_rx > 15%` (`HIGH_DUPE_RATE`)

**Mechanism:** The Meshtastic firmware maintains a duplicate-detection window keyed by packet ID. When a node receives a packet it has already processed, it increments `num_rx_dupe` without rebroadcasting. A high duplicate rate means many nodes are re-forwarding the same packets — typically caused by too many nodes having high hop limits, causing the mesh to flood rather than route. The client-side `recordDuplicate()` in diagnosticsStore also feeds this counter from MQTT-observed duplicates.

**Fields:** `num_rx_dupe`, `num_packets_rx` from `DeviceMetrics`.

**Common sources:** Too many routers/repeaters in a dense mesh with default hop limits; MQTT-RF loop where the same packet arrives via both RF and the MQTT broker; overlapping repeater coverage with no intelligent routing.

**Mitigation:** Reduce hop limits on nearby routers (3 is often sufficient for most networks); enable the MQTT duplicate-ignore feature for bridged nodes; review `ROUTER` vs. `CLIENT_MUTE` roles to reduce unnecessary rebroadcasting.

---

#### Hidden Terminal Risk

**Trigger:** `channel_utilization > 40%` (`HIDDEN_TERMINAL_CU`), bad packet rate in the range 5–10% (`HIDDEN_TERMINAL_BAD_MIN` / `HIGH_BAD_RATE`), and the Industrial finding is not already present.

**Mechanism:** The "hidden terminal" problem occurs when two transmitters (A and C) are both within range of your node (B) but cannot hear each other. Both use CSMA and check the channel before transmitting — but since they cannot detect each other's transmissions, both conclude the channel is clear simultaneously and transmit at the same time. Your node receives both overlapping signals, causing a collision: the LoRa preamble is detected (so demodulation is attempted) but the combined signal fails CRC. The 5–10% bad-rate band is specific to this scenario: below 5% is noise floor, above 10% is caught by the general LoRa Collision finding (or Industrial if >20%). The Industrial finding is evaluated first; if present, it blocks this finding.

**Fields:** `channel_utilization`, `num_packets_rx_bad`, `num_packets_rx`.

**Common sources:** Dense deployments where many nodes are at the edge of range to a central gateway; hilltop gateway nodes receiving from many edge nodes that cannot hear each other; hub-and-spoke repeater topologies.

**Mitigation:** Use directional antennas to reduce the number of simultaneous transmitters in view; reduce hop limits to limit the number of nodes routing through this node; consider splitting into multiple channels.

---

#### LoRa Collision or Corruption

**Trigger:** `num_packets_rx_bad / num_packets_rx > 10%` (`HIGH_BAD_RATE`), catch-all when the Industrial finding is not present.

**Mechanism:** The LoRa radio decoded a valid-looking preamble/sync word but the payload CRC failed. This indicates the packet was either corrupted in flight (multipath, near-far problem) or was transmitted by a non-Meshtastic LoRa network using the same frequency and spreading factor but a different sync word or modulation depth. Unlike the Non-LoRa RFI finding (which never produces demodulation attempts), this finding requires that the radio actually tried to decode the packet.

**Fields:** `num_packets_rx_bad / num_packets_rx`.

**Common sources:** LoRaWAN networks operating on the same channel (common in the 902–928 MHz US ISM band); other Meshtastic networks on the same channel with different PSKs; near-far collisions where a strong nearby transmitter overwhelms a weaker distant packet mid-reception.

**Mitigation:** Channel planning to avoid LoRaWAN frequencies; directional antenna with a bandpass filter; coordinate frequency and spreading-factor usage with operators of co-located LoRa deployments.

---

### 11.2 RF Findings — Remote Nodes

SNR-based findings (`Wideband Noise Floor`, `Fringe`) are only emitted when `snrMeaningfulForNodeDiagnostics` returns `true` — which requires that the remote node is a 0-hop direct RF neighbor, ensuring the SNR value reflects the actual link to your node rather than a multi-hop path.

---

#### External Interference

**Trigger:** `channel_utilization > 25%` and `air_util_tx < 5%` on a remote node.

**Mechanism:** Same CSMA backoff pattern as the connected-node "Utilization vs. TX" finding, but observed on a remote node via its `DeviceMetrics` telemetry. The remote node's radio is sensing a busy channel and reducing its own transmissions.

**Telemetry path:** The remote node reports `channel_utilization` and `air_util_tx` in its `NodeInfo` packet; your connected device receives this and forwards it to the app via the mesh. Because this is a remote observation, causes are specific to that node's physical location, not your environment.

---

#### Wideband Noise Floor

**Trigger:** `channel_utilization > 25%` and `SNR < 0 dB` (0-hop RF neighbor only).

**Mechanism:** Elevated CU combined with a negative SNR on the last hop indicates that the remote node's location has an elevated RF noise floor. SNR in Meshtastic is the ratio of the received signal power to the noise floor at the _receiver_ — a negative value means the noise floor is higher than the signal (the packet still decoded because LoRa spread-spectrum can operate below the noise floor). This combination implies that even though many transmissions are detected, signal quality is degraded by broadband noise at that location.

**Fields:** `snr` from the most recent packet received from this node (last-hop only, 0-hop RF).

**Common sources:** Faulty electronics in the same structure as the node; proximity to power lines with corona discharge; poorly shielded switching supplies near the antenna.

---

#### Fringe / Weak Coverage

**Trigger:** `channel_utilization ≤ 10%` and `SNR < 0 dB` (0-hop RF neighbor only).

**Mechanism:** Low CU means the node is not hearing much mesh traffic — it is on the periphery of coverage or in an RF shadow. The negative SNR confirms the link quality is marginal. This is informational: the node is functional but poorly connected to the rest of the mesh.

**Note:** Because severity is `info`, this finding does not contribute to the error or warning counts in the health status band.

---

### 11.3 Routing Anomalies

#### hop_goblin (`RoutingDiagnosticEngine.detectHopGoblin()`)

**What it measures:** The `hops_away` field from the received NodeInfo packet vs. the haversine distance between your connected node's GPS coordinates and the remote node's GPS coordinates. `hops_away` is the hop count embedded in the Meshtastic packet header by the originating firmware — it is decremented by each relay node and thus reflects how many RF hops the packet actually traversed.

**Distance computation:** Uses `haversineDistanceKm()` from `nodeStatus.ts` — a standard great-circle distance formula. Requires that both your connected node and the remote node have valid non-null GPS coordinates in their NodeInfo.

**Why GPS is required:** Earlier implementations used SNR + hops heuristics, but `rxSnr` is last-hop only (meaningless for multi-hop originators and MQTT-only nodes). GPS distance is the only reliable proxy for expected hop count.

**Note on `distanceOffsetKm`:** This parameter is `0` in the current implementation. Only `distanceMultiplier` varies by environment profile. The offset exists as a code provision for future user-adjustable baseline correction.

---

#### bad_route (`RoutingDiagnosticEngine.detectBadRoute()`)

**Duplicate tracking:** `diagnosticsStore.packetStats` accumulates `{ total, duplicates }` per originating node. `total` is incremented on every `processNodeUpdate` call for that node; `duplicates` is incremented by `recordDuplicate()`, which is called from the MQTT dedup handler and the RF dedup path in `useDevice.ts`. The ratio `duplicates / total` is evaluated against the 55% threshold.

**Close-in over-hopping:** Uses the same haversine distance as hop_goblin but converted to miles (1 km = 0.621371 mi); threshold is 5 miles × profile multiplier. The hop threshold used here is `hopsThreshold + 2` — for Standard profile that is 4, City 5, Canyon 6.

**Why 55% for routing loop:** At 55%+ duplication, the packet is arriving from multiple mesh paths more often than not, indicating the routing algorithm is forwarding it redundantly — characteristic of a routing loop or an over-configured flood mesh.

---

#### impossible_hop (`RoutingDiagnosticEngine.detectImpossibleHop()`)

**The 0-hop case:** `hops_away === 0` means the originating firmware stamped this packet as a direct transmission (no relays). In a legitimate direct link, 0 hops is only possible within LoRa range (typically ≤ ~20 km under ideal conditions). The 100-mile (~160 km) threshold is deliberately conservative to avoid false positives.

**Why this happens:** Most commonly seen when an MQTT-bridged node appears to have 0 hops — the MQTT message does not carry hop-count metadata, so the app may receive the node without a hop field, which defaults to 0. Per-node MQTT ignore resolves this in most cases. Can also indicate stale GPS where a node moved but has not updated its position.

**MeshCore skip:** `capabilities?.hasHopCount === false` causes this check to be bypassed entirely.

---

#### route_flapping (`RoutingDiagnosticEngine.detectRouteFlapping()`)

**Hop history:** `diagnosticsStore.hopHistory` stores `{ t: timestamp, h: hops_away }` tuples per node, pruned to a 24-hour window. The flapping detector filters to the last 10 minutes and counts transitions where `recent[i].h !== recent[i-1].h`. More than 3 transitions fires the warning.

**What this looks like:** A node whose hop count alternates between 2 and 3 on successive packets over 10 minutes has `changes = 6` → fires. A node that was 3 hops and settled to 2 hops has `changes = 1` → does not fire.

**Common causes:** Two relay paths of similar quality competing; a relay node that is intermittently reachable (marginal RF link); environmental RF changes (vehicles, weather, multipath) altering which relay wins the forwarding race.

---

### 11.4 Foreign LoRa Detection

#### Packet classification (`foreignLoraDetection.classifyPayload()`)

The classifier operates on raw LoRa payload bytes received by the radio before any decryption:

| Rule                    | Byte condition                                                                                                                                        | Classification |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| MeshCore frame-start    | `raw[0] === 0x3c` (`<` in ASCII)                                                                                                                      | `meshcore`     |
| Meshtastic short packet | `raw.length` 8–15 AND bytes 0–3 = valid destId AND bytes 4–7 = valid senderId (both non-zero, non-broadcast `0xFFFFFFFF`)                             | `meshtastic`   |
| Meshtastic full header  | `raw.length >= 16` AND bytes 0–3 = valid destId AND bytes 4–7 = valid senderId AND byte 12 flags: `hop_limit` (bits [2:0]) ≤ `hop_start` (bits [7:5]) | `meshtastic`   |
| Fallback                | everything else                                                                                                                                       | `unknown-lora` |

Short packets (8–15 bytes) pass on ID checks alone: MeshCore frames always begin with `0x3c`, so any non-0x3c payload of this length with valid IDs reliably indicates Meshtastic. For full 16-byte headers, the flags byte (byte 12) is also validated: `hop_limit` (bits [2:0]) must be ≤ `hop_start` (bits [7:5]). This structural invariant holds for all Meshtastic packets including direct-only devices (`hop_start=0, hop_limit=0`), and filters out MeshCore encrypted packets whose first 8 bytes happen to look like valid Meshtastic node IDs.

**MeshCore log-pattern detection** (`containsMeshCorePattern()`): Device log messages mentioning decode failures and containing `0x3c` (or `<`) are matched via regex — this catches MeshCore traffic even when only the log stream is available (no raw packet data).

#### Proximity classification (`classifyProximity()`)

RSSI is the primary signal; SNR is used as fallback when RSSI is unavailable.

| RSSI              | SNR (fallback)    | Label            |
| ----------------- | ----------------- | ---------------- |
| > −80 dBm         | > 8 dB            | Very Close       |
| −95 to −80 dBm    | 2–8 dB            | Nearby           |
| < −95 dBm         | < 2 dB            | Distant          |
| neither available | neither available | Unknown Distance |

#### MeshCore rate escalation

A module-level `RollingRateCounter(60_000)` counts MeshCore-class packets in the last 60 seconds. When `getRate() > 5` (more than 5 packets/minute), the diagnostic row is promoted from Info to Warning with the label "Potential MeshCore Repeater Conflict." This threshold targets active repeater behavior — a repeater forwards many packets per minute — vs. an occasional passthrough.

#### 5-minute cooldown

`rfRowCooldowns: Map<string, number>` is keyed by `"nodeId:packetClass"`. The same sender/class combination updates at most once every 5 minutes, preventing table noise during sustained interference events.

---

### 11.5 Packet Redundancy

#### Data model

Each incoming packet (RF or MQTT) calls `recordPacketPath(packetId, fromNodeId, path)` in diagnosticsStore. Packets with `packetId === 0` are rejected (protobuf default / missing field). Each record stores an array of `PacketPath` objects: `{ transport: 'rf' | 'mqtt', snr?, rssi?, timestamp }`.

#### The `maxPaths` metric

For each `PacketRecord`, `paths.length` is the number of times that specific packet arrived via distinct observed paths. `maxPaths` is the maximum `paths.length` across the last 20 packets for a given node — the highest observed redundancy under current conditions.

**Why max, not average:** A single highly-redundant packet proves the mesh _can_ deliver multiple paths to this node. The max represents the theoretical ceiling under current conditions; an average would be pulled down by single-path packets during quiet periods.

#### Cache management

15-minute TTL per `PacketRecord` (keyed by `packetId`). When the cache exceeds 2000 entries, all entries older than 15 minutes are pruned. The packetCache is session-only and is not persisted to disk.
