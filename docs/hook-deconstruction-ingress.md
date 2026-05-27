# Hook deconstruction: ingress split

Dual-protocol mesh-client runs **two parallel ingress paths** while god-hooks are being split (#375 / #377):

| Path         | Entry                                                                                   | Writes                                           |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Protocol** | `bindMeshtasticIngress` / `bindMeshcoreIngress` → `Protocol.subscribe` → `PacketRouter` | Identity-scoped Zustand stores                   |
| **Legacy**   | `useDevice.wireSubscriptions` / `useMeshCore.initConn`                                  | Hook `useState`, SQLite, diagnostics, MQTT dedup |

`App.tsx` reads chat/nodes via `useMergedMessages` / `useMergedNodesMap` (store + legacy union) and `useDbRefresh` for Meshtastic SQLite → store hydration.

## Meshtastic (`MeshtasticProtocol.subscribe`)

Handled by protocol + `PacketRouter` (store updates). Legacy handlers **remain** for side effects not yet in stores:

| SDK event                              | Store (`PacketRouter`)      | Legacy-only work                                                              |
| -------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `onDeviceStatus`                       | `connectionStore.status`    | Watchdog, configure timeout, GPS interval, disconnect cleanup                 |
| `onMyNodeInfo`                         | minimal `node_info`         | Virtual node delete, identity remap, diagnostics migration, `myNodeNum` state |
| `onMeshPacket` (TEXT)                  | `messageStore`              | Dedup, DB save, reply previews, MQTT merge, node last_heard                   |
| `onMeshPacket` (raw)                   | `deviceStore.rawPackets`    | UI `rawPackets` state (same data, separate slice)                             |
| `onNodeInfoPacket`                     | `nodeStore`                 | DB save, static GPS rules, stale hop suppression                              |
| `onPositionPacket`                     | `nodeStore` position        | DB, map history, self-node static GPS                                         |
| `onTelemetryPacket`                    | `nodeStore` telemetry       | Charts, DB telemetry                                                          |
| `onWaypointPacket`                     | `nodeStore` waypoints       | Legacy `waypoints` map + DB                                                   |
| `onTraceRoutePacket` / TRACEROUTE port | `nodeStore` traceRoutes     | Legacy `traceRouteResults` map                                                |
| `onChannelPacket`                      | `deviceStore` channels      | Legacy channel state + URL flows                                              |
| `onConfigPacket`                       | partial device config       | LoRa/security UI, remote admin                                                |
| `onModuleConfigPacket`                 | `deviceStore.moduleConfigs` | Legacy `moduleConfigs` state                                                  |
| `onQueueStatus`                        | `connectionStore` queue     | Legacy `queueStatus` for header badge                                         |
| `onLogRecord`                          | `deviceStore` logs          | Foreign LoRa log parser                                                       |
| `onDeviceMetadataPacket`               | firmware in connection      | Battery/firmware UI state                                                     |
| `onNeighborInfoPacket`                 | `nodeStore` neighbors       | Legacy `neighborInfo` map                                                     |

**Do not remove** legacy `onMeshPacket` / `onNodeInfoPacket` until DB, dedup, and MQTT are moved behind `PacketRouter` or a shared ingest service.

## MeshCore (`MeshCoreProtocol.subscribe`)

Protocol subscribe surface is intentionally narrow (advert, DM, channel). **Permanent hook-only** until step 2d:

| Traffic                           | Location      |
| --------------------------------- | ------------- |
| Waiting messages / sync           | `useMeshCore` |
| Stats, MQTT JSON, repeater RPCs   | `useMeshCore` |
| Ping/trace/neighbor op results    | `useMeshCore` |
| Contact import/export, path reset | `useMeshCore` |

See `bindMeshcoreIngress` in `src/renderer/lib/meshIdentityBridge.ts` and `initConn` in `src/renderer/hooks/useMeshCore.ts`.

## Identity reconnect

After `onMyNodeInfo`, Meshtastic identity signature becomes `meshtastic:node:<num>`. `ConnectionDriver.remapMeshtasticNodeSignature` registers both transport and node keys so BLE/serial reconnect reuses the same `identityId` (see `meshIdentityBridge.test.ts`).

## Prior work

Selective port from branch `deconstruct-hooks` (contributor SHAs for PR credit):

- `c31ef1a6` — protocol + driver scaffold
- `4e8f3a2b` — identity stores
- `698b70a2` — ingress bind pattern

## Manual smoke checklist

- [ ] Meshtastic BLE connect → chat send/receive, node list updates
- [ ] Disconnect/reconnect same peripheral → same identity slice (no duplicate empty chat)
- [ ] Meshtastic MQTT + RF dedup (one row, `receivedVia: both` when applicable)
- [ ] MeshCore BLE connect → contacts, DM, repeater panel
- [ ] Switch protocol tabs; inactive-protocol toast still fires
- [ ] Startup node prune → node list refresh (`useDbRefresh` + legacy)
- [ ] Trace route / diagnostics still populate
