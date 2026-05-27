# Hook deconstruction: ingress split

Dual-protocol mesh-client runs **protocol ingress** through `ConnectionDriver` while legacy hook listeners remain for side effects ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375) / [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)):

| Path         | Entry                                                                     | Writes                                        |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------- |
| **Protocol** | `ConnectionDriver.connect` → `Protocol.subscribe` → `PacketRouter`        | Identity-scoped Zustand stores                |
| **Ingest**   | `attachMeshtasticIngest` / `attachMeshcoreIngest` (post-router listeners) | SQLite persistence, cross-transport dedup     |
| **Legacy**   | `useDevice.wireSubscriptions` / `useMeshCore.setupEventListeners`         | Hook `useState`, MQTT, diagnostics, lifecycle |

`App.tsx` uses `useActiveMeshIdentity`, `useMessages`, and `useNodeStore` for chat/nodes. `useSendMessage` handles outbound chat.

## Status (Phase 3 in progress)

| Goal                                                   | Status      | Notes                                                                                          |
| ------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------- |
| Production connect via `ConnectionDriver.connect`      | **Done**    | Meshtastic + MeshCore BLE/serial/TCP; see `openMeshCoreTransport` / `openMeshtasticTransport`  |
| `registerLegacyTransport` not primary for new connects | **Done**    | Driver `connect` owns subscribe; legacy bind only when not driver-connected                    |
| Shared Meshtastic ingest (DB, dedup)                   | **Done**    | `attachMeshtasticIngest`                                                                       |
| MeshCore ingest (contacts → DB)                        | **Done**    | `attachMeshcoreIngest`                                                                         |
| App store-only chat/nodes                              | **Done**    | No hook fallback union in `App.tsx`                                                            |
| Protocol registry + capability lookup                  | **Done**    | `protocolRegistry.ts`, `useRadioProvider`                                                      |
| Extract legacy event blocks to services                | **Partial** | `meshtasticLegacyDeviceEvents.ts`, `meshcoreConnEventHandlers.ts`; large blocks still in hooks |
| `useDevice` / `useMeshCore` &lt;2k LOC facades         | **Not met** | ~5.1k / ~6.0k — further extraction + panel cutover remain                                      |
| UI free of dual god-hook orchestration                 | **Partial** | `useActiveMeshIdentity`; panels still call `useDevice` / `useMeshCore` for connect/actions     |

### Remaining before closing #375 / #377

1. Extract `wireSubscriptions` / `setupEventListeners` into protocol services (or delete duplicate state once panels are store-only).
2. Slim `useDevice` / `useMeshCore` below 2k LOC each (or replace with thin facades).
3. Wire panels to action hooks (`useConnect`, `useDisconnect`, `useSetConfig`, …) instead of god-hook methods.
4. Reduce `protocol ===` branching in shared panels using `ProtocolCapabilities`.

## Manual smoke checklist

- [ ] Meshtastic BLE connect → chat send/receive, node list updates
- [ ] Disconnect/reconnect same peripheral → same identity slice (no duplicate empty chat)
- [ ] Meshtastic MQTT + RF dedup (one row, `receivedVia: both` when applicable)
- [ ] MeshCore BLE connect → contacts, DM, repeater panel
- [ ] Switch protocol tabs; inactive-protocol toast still fires
- [ ] Startup node prune → node list refresh (`useDbRefresh` + legacy)
- [ ] Trace route / diagnostics still populate
