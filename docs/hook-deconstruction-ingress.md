# Hook deconstruction: ingress split

Dual-protocol mesh-client runs **two parallel ingress paths** while god-hooks are being split ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375) / [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)):

| Path         | Entry                                                                                   | Writes                                        |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Protocol** | `bindMeshtasticIngress` / `bindMeshcoreIngress` → `Protocol.subscribe` → `PacketRouter` | Identity-scoped Zustand stores                |
| **Ingest**   | `attachMeshtasticIngest` (post-router listeners)                                        | SQLite persistence, cross-transport dedup     |
| **Legacy**   | `useDevice.wireSubscriptions` / `useMeshCore.initConn`                                  | Hook `useState`, MQTT, diagnostics, lifecycle |

`App.tsx` reads chat/nodes via `useMessages` / `useNodeStore` (store-first; legacy hook fallback only when the store slice is empty). `useDbRefresh` hydrates Meshtastic SQLite → stores on startup.

## BOOM / issue status (Phase 2)

| Goal                                                    | Status          | Notes                                                                                            |
| ------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| Delete large `device.events.on*` blocks                 | **Partial**     | Queue/neighbor/module/waypoint state dupes removed; text/node/telemetry/MQTT/admin still in hook |
| `useDevice` ~1.5k LOC (aspirational) / &lt;2k (Phase 2) | **Not met**     | Facade target tracked per PR                                                                     |
| UI on stores only                                       | **Mostly**      | App uses stores; hooks retain legacy state for side effects                                      |
| **#375** split hooks                                    | **In progress** | Infrastructure + focused hooks; facades not slimmed                                              |
| **#377** decouple protocol                              | **In progress** | Dual ingress; production migrating to `ConnectionDriver.connect`                                 |
| `ConnectionDriver.connect` production path              | **In progress** | `useConnect` exists; god-hooks still open transport + `registerLegacyTransport`                  |
| Shared Meshtastic ingest (DB, dedup)                    | **Done**        | `attachMeshtasticIngest` on `PacketRouter` listeners                                             |
| HTTP via `ConnectionDriver.connect`                     | **Done**        | BLE/serial still legacy open + `bindMeshtasticIngress`                                           |
| MeshCore ingest (contacts → DB)                         | **Done**        | `attachMeshcoreIngest`                                                                           |
| App store-only chat/nodes                               | **Done**        | No hook fallback union in `App.tsx`                                                              |
| `useDevice` / `useMeshCore` &lt;2k LOC                  | **Not met**     | Facade extraction remains Phase 3                                                                |

### Do not close #375 / #377 until all are true

1. Production connect no longer depends on `registerLegacyTransport` as the primary path.
2. Legacy ingress blocks removed or limited to non-duplicative lifecycle taps only.
3. `useDevice` and `useMeshCore` each &lt;2k LOC (facades).
4. This table shows **done** for every row above.

If Phase 2 completes without all criteria, label issues **Phase 2 complete / Phase 3 follow-up** with linked child issues — do not silently close.

## Meshtastic (`MeshtasticProtocol.subscribe`)

Handled by protocol + `PacketRouter` (store updates). Post-router ingest handles DB + dedup. Legacy handlers **remain** for side effects not yet migrated:

| SDK event                              | Store (`PacketRouter`)      | Ingest (`meshtasticIngest`) | Legacy-only work                                                              |
| -------------------------------------- | --------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `onDeviceStatus`                       | `connectionStore.status`    | —                           | Watchdog, configure timeout, GPS interval, disconnect cleanup                 |
| `onMyNodeInfo`                         | minimal `node_info`         | —                           | Virtual node delete, identity remap, diagnostics migration, `myNodeNum` state |
| `onMeshPacket` (TEXT)                  | `messageStore`              | DB save, dedup upgrade      | MQTT merge, uplink, notifications, last_heard (until moved)                   |
| `onMeshPacket` (raw)                   | `deviceStore.rawPackets`    | —                           | UI `rawPackets` state (retire when App reads store only)                      |
| `onNodeInfoPacket`                     | `nodeStore`                 | DB save                     | Static GPS rules, stale hop suppression                                       |
| `onPositionPacket`                     | `nodeStore` position        | DB save                     | Map history, self-node static GPS                                             |
| `onTelemetryPacket`                    | `nodeStore` telemetry       | —                           | Charts, DB telemetry                                                          |
| `onWaypointPacket`                     | `nodeStore` waypoints       | —                           | MQTT uplink only                                                              |
| `onTraceRoutePacket` / TRACEROUTE port | `nodeStore` traceRoutes     | —                           | Diagnostics                                                                   |
| `onChannelPacket`                      | `deviceStore` channels      | —                           | URL flows                                                                     |
| `onConfigPacket`                       | partial device config       | —                           | LoRa/security UI, remote admin                                                |
| `onModuleConfigPacket`                 | `deviceStore.moduleConfigs` | —                           | (legacy state removed)                                                        |
| `onQueueStatus`                        | `connectionStore` queue     | —                           | (legacy state removed)                                                        |
| `onLogRecord`                          | `deviceStore` logs          | —                           | Foreign LoRa log parser                                                       |
| `onDeviceMetadataPacket`               | firmware in connection      | —                           | Battery/firmware UI state                                                     |
| `onNeighborInfoPacket`                 | `nodeStore` neighbors       | —                           | (legacy state removed)                                                        |

**Do not remove** legacy `onMeshPacket` / `onNodeInfoPacket` until MQTT, notifications, and configure-replay gates are moved behind ingest or lifecycle services.

## MeshCore (`MeshCoreProtocol.subscribe`)

Protocol subscribe handles advert, DM, channel (store path). **Hook-only** until MeshCore ingest parity:

| Traffic                           | Location      |
| --------------------------------- | ------------- |
| Waiting messages / sync           | `useMeshCore` |
| Stats, MQTT JSON, repeater RPCs   | `useMeshCore` |
| Ping/trace/neighbor op results    | `useMeshCore` |
| Contact import/export, path reset | `useMeshCore` |

See `bindMeshcoreIngress` in `src/renderer/lib/meshIdentityBridge.ts` and `initConn` in `src/renderer/hooks/useMeshCore.ts`.

## Identity reconnect

After `onMyNodeInfo`, Meshtastic identity signature becomes `meshtastic:node:<num>`. `ConnectionDriver.remapMeshtasticNodeSignature` registers both transport and node keys so BLE/serial reconnect reuses the same `identityId` (see `meshIdentityBridge.test.ts`).

## Upstream `deconstruct-hooks` delta (preflight)

As of Phase 2 start, `origin/deconstruct-hooks` has **no commits** after `698b70a2`. No additional selective port required beyond `refactor/hook-deconstruction`.

## Prior work

Selective port from branch `deconstruct-hooks` (contributor SHAs for PR credit):

- `c31ef1a6` — protocol + driver scaffold
- `4e8f3a2b` — identity stores
- `698b70a2` — ingress bind pattern
- `66c9e4ac` — Phase 1 closure (App store wiring, partial handler removal)

## Phase 2 PR sequence

1. **PR0** — This doc + honest status (baseline) — **done**
2. **PR1** — `meshtasticIngest` + `PacketRouter` listeners — **done**
3. **PR2** — `ConnectionDriver.connect` for HTTP in `useDevice` — **done** (BLE/serial legacy)
4. **PR3** — Skip legacy `setMessages` when identity store active — **partial** (full facade split → Phase 3)
5. **PR4** — `meshcoreIngest` + protocol path — **done** (narrow subscribe unchanged; DB via ingest)
6. **PR5** — App store-only reads + test updates — **done**

### Phase 2 closure evidence (for #375 / #377 comments)

- `src/renderer/lib/ingest/meshtasticIngest.ts` — DB + cross-transport dedup after `PacketRouter`
- `src/renderer/lib/ingest/meshcoreIngest.ts` — contact/node DB persistence after router
- `src/renderer/lib/drivers/PacketRouter.ts` — post-dispatch listener registry
- `useDevice` — HTTP via `connectionDriver.connect`; ingest attached; legacy chat mirror skipped when store identity active
- `App.tsx` — messages/nodes from stores only (no hook fallback union)
- Tests: `meshtasticIngest.test.ts`, `meshcoreIngest.test.ts`, `App.test.tsx` store seeding

**Still open:** god-hook LOC, BLE/serial driver connect, full `device.events` deletion, #375/#377 per table above.

## Manual smoke checklist

- [ ] Meshtastic BLE connect → chat send/receive, node list updates
- [ ] Disconnect/reconnect same peripheral → same identity slice (no duplicate empty chat)
- [ ] Meshtastic MQTT + RF dedup (one row, `receivedVia: both` when applicable)
- [ ] MeshCore BLE connect → contacts, DM, repeater panel
- [ ] Switch protocol tabs; inactive-protocol toast still fires
- [ ] Startup node prune → node list refresh (`useDbRefresh` + legacy)
- [ ] Trace route / diagnostics still populate
