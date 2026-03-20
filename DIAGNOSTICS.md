# Diagnostics Reference

This document is the authoritative reference for every diagnostic output in Mesh-Client. It covers the two diagnostic subsystems — **Routing** and **RF** — and explains what each finding means, what triggers it, and how to interpret it.

**Where diagnostics appear:**

- **DiagnosticsPanel** (Tab 8, `Cmd/Ctrl+8`) — network health status, anomaly table, halos toggles, environment profile, max-age settings
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

Routing anomaly detection runs on Meshtastic nodes only. MeshCore does not carry hop-count metadata so most routing anomaly types are skipped for MeshCore contacts.

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

**Note:** Skipped for MeshCore nodes (hop count is not reported by that protocol).

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
| [`src/renderer/components/DiagnosticsPanel.tsx`](src/renderer/components/DiagnosticsPanel.tsx)                       | Tab 8 UI: health score, anomaly table, settings                                   |
| [`src/renderer/components/NodeDetailModal.tsx`](src/renderer/components/NodeDetailModal.tsx)                         | Per-node detail overlay: routing health, MQTT ignore toggle                       |
| [`src/renderer/components/NodeInfoBody.tsx`](src/renderer/components/NodeInfoBody.tsx)                               | RF findings section, redundancy path history, congestion block                    |
