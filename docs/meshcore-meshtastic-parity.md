# Meshtastic vs MeshCore feature parity

This document summarizes which client features are **Meshtastic-only**, **MeshCore-only**, or **shared**, and whether gaps are **app wiring**, **post-MQTT**, or **blocked by protocol**.

See also [CONTRIBUTING.md](../CONTRIBUTING.md) (dual-protocol architecture).

## Capability flags

Shared UI gates use `ProtocolCapabilities` in [`src/renderer/lib/radio/BaseRadioProvider.ts`](../src/renderer/lib/radio/BaseRadioProvider.ts). Prefer new gates there instead of `protocol === 'meshcore'` string checks.

## Feature matrix

| Area                            | Meshtastic                                                                          | MeshCore                                                                                                                                                                                                     | Gap type                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Transports                      | BLE, Serial, HTTP (`@meshtastic/core`)                                              | BLE, Web Serial, TCP bridge (4403)                                                                                                                                                                           | Different stacks                                                |
| Tab “Modules” / “Repeaters”     | `ModulePanel` (protobuf modules)                                                    | `RepeatersPanel` (trace, status, neighbors)                                                                                                                                                                  | Product split                                                   |
| MQTT broker UI                  | Full (with transport selection)                                                     | Same broker fields; transport protocol selected when connecting                                                                                                                                              | **Post-MQTT** codec on broker path                              |
| MQTT wire format                | `ServiceEnvelope` / `MeshPacket` ([`mqtt-manager.ts`](../src/main/mqtt-manager.ts)) | JSON **v1** chat envelope on `topicPrefix/#` ([`meshcore-mqtt-adapter.ts`](../src/main/meshcore-mqtt-adapter.ts), parser in [`meshcoreMqttEnvelope.ts`](../src/shared/meshcoreMqttEnvelope.ts)) — extensible | Adapter vs protobuf                                             |
| Node list hops / MQTT columns   | `hops_away`, `via_mqtt` from device                                                 | Contact model; optional trace                                                                                                                                                                                | **Partial** (trace); full hops **blocked** without device field |
| RF diagnostics (LocalStats)     | From protobuf                                                                       | Not available                                                                                                                                                                                                | **Blocked**                                                     |
| Routing diagnostics (hop-based) | `RoutingDiagnosticEngine` with hop count                                            | Skipped when `hasHopCount === false`                                                                                                                                                                         | **Blocked** until hop metric exists                             |
| Neighbor UI                     | `neighborInfo` protobuf                                                             | `getNeighbours` (repeaters)                                                                                                                                                                                  | Different primitive                                             |
| Radio config                    | Full protobuf (role, presets, WiFi, etc.)                                           | `setRadioParams`, channels, advert name/position                                                                                                                                                             | **Blocked** for Meshtastic-only admin                           |
| Position                        | Full GPS protobuf + request position                                                | Advert lat/lon + `setAdvertLatLong`                                                                                                                                                                          | **Partial**                                                     |
| Waypoints                       | Supported                                                                           | Not in protocol surface                                                                                                                                                                                      | **Blocked**                                                     |
| Favorites                       | `nodes` table                                                                       | `meshcore_contacts.favorited` + `db:updateMeshcoreContactFavorited`                                                                                                                                          | **App** (implemented)                                           |
| Environment telemetry charts    | Device telemetry module                                                             | Cayenne LPP via `getTelemetry` → `environmentTelemetry`                                                                                                                                                      | **App** (implemented)                                           |
| Chat transport badges / history | `received_via` on Meshtastic messages                                               | `meshcore_messages.received_via` (`rf` / `mqtt` / `both`)                                                                                                                                                    | **App** (implemented)                                           |
| Chat search                     | `searchMessages`                                                                    | `searchMeshcoreMessages`; UI search modal supports `user:` / `channel:` filters for cross-channel lookup                                                                                                     | Parallel DB tables                                              |

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

Subscribes under `{topicPrefix}/#`. Outbound optional publish uses `mqtt:publishMeshcore` → topic `{topicPrefix}/meshcore/chat` (JSON same shape).

## Maintenance

When MeshCore firmware/SDK defines official MQTT topics and payloads, replace or extend [`MeshcoreMqttAdapter`](../src/main/meshcore-mqtt-adapter.ts) and update this document.
