# Renderer side-effect migration

Target architecture for dual-protocol UI ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375), [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)).

## Final-state boundaries

| Concern                                                        | Owner                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| UI reads (nodes, messages, connection status)                  | Zustand stores + `useLegacyConnectionView`                                      |
| UI writes (configure, send, admin)                             | `useMeshtasticPanelActions` / `useMeshcorePanelActions` + protocol action hooks |
| Connect / disconnect                                           | `useProtocolConnectionActions` with App-injected legacy instances               |
| Wire subscriptions, MQTT IPC, reconnect watchdog, DB hydration | `useDevice` / `useMeshCore` (side-effect engines only)                          |

## Migration status

| Area                                | Status      | Notes                                                                     |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `ConnectionDriver` + `PacketRouter` | In progress | RF connect and domain events route to stores                              |
| Meshtastic ingest                   | Partial     | `meshtasticIngest.ts` post-router DB + dedup                              |
| MeshCore ingest                     | Partial     | `meshcoreIngest.ts`                                                       |
| MQTT status in `connectionStore`    | Partial     | Legacy hooks mirror `mqttStatus` into store on IPC updates                |
| Queue status in `connectionStore`   | Partial     | `queue_status` domain events via PacketRouter                             |
| Meshtastic wire subscriptions       | Legacy      | `meshtasticLegacyWireSubscriptions.ts` via `useDevice`                    |
| MeshCore conn events                | Legacy      | `meshcoreLegacyConnEvents.ts` via `useMeshCore`                           |
| MeshCore Protocol config surface    | Deferred    | Companion JSON paths stay on panel actions until Protocol implements them |

## Removal condition for legacy hooks

`useDevice` / `useMeshCore` can be deleted when:

1. All wire/MQTT subscriptions and reconnect logic live in drivers or store effects.
2. DB hydration runs from driver connect/disconnect without hook-local Maps.
3. No App or panel imports legacy hook return values for reads or writes.

Until then, mount each hook **once** from `App.tsx` only.
