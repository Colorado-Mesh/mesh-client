# Renderer side-effect migration

Target architecture for dual-protocol UI ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375), [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)).

## Final-state boundaries

| Concern                                                        | Owner                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| UI reads (nodes, messages, connection status)                  | Zustand stores + `useConnectionView`                                                       |
| UI writes (configure, send, admin)                             | `usePanelActions` / `useProtocolFacade(protocol).panel` + panel action hooks               |
| Connect / disconnect                                           | `useProtocolConnectionActions` + `lib/sessions/meshtasticSession.ts`, `meshcoreSession.ts` |
| Wire subscriptions, MQTT IPC, reconnect watchdog, DB hydration | `useMeshtasticRuntime` / `useMeshcoreRuntime` (mount once from `App.tsx`)                  |

## Migration status

| Area                                | Status      | Notes                                                                        |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `ConnectionDriver` + `PacketRouter` | In progress | RF connect via `useProtocolConnect` + `useConnect`; runtime attaches session |
| Meshtastic ingest                   | Partial     | `lib/ingest/meshtasticIngest.ts` post-router DB + dedup                      |
| MeshCore ingest                     | Partial     | `lib/ingest/meshcoreIngest.ts`                                               |
| DB hydration on mount               | Partial     | `lib/legacySideEffects/meshtasticDbHydration.ts`, `meshcoreDbHydration.ts`   |
| MQTT status in `connectionStore`    | Done        | `lib/legacySideEffects/mqttStatusBridge.ts` + runtime sync effect            |
| Queue status in `connectionStore`   | Partial     | `queue_status` domain events via PacketRouter                                |
| Meshtastic wire subscriptions       | Runtime     | `lib/meshtastic/meshtasticLegacyWireSubscriptions.ts` via `attachRfSession`  |
| MeshCore conn events                | Runtime     | `hooks/meshcore/meshcoreLegacyConnEvents.ts` via `attachRfSession`           |
| MeshCore Protocol config surface    | Deferred    | `ProtocolCompanion` extension; panel actions for companion JSON              |
| App orchestration                   | Done        | `useProtocolFacade` + runtime providers; legacy hooks removed                |

## Legacy hooks removed

`useDevice` / `useMeshCore` are deleted. Replacement surfaces:

- **Mount once:** [`useMeshtasticRuntime`](../src/renderer/runtime/useMeshtasticRuntime.ts), [`useMeshcoreRuntime`](../src/renderer/runtime/useMeshcoreRuntime.ts)
- **Context (panels/tests):** `MeshtasticRuntimeProvider`, `MeshcoreRuntimeProvider` (`useMeshtasticRuntimeContext`, `useMeshcoreRuntimeContext`)
- **Orchestration:** `useProtocolFacade(protocol)` — connection, `useConnectionView`, panel bundle, nodes, messages
- **RF session API:** [`meshtasticSession.ts`](../src/renderer/lib/sessions/meshtasticSession.ts), [`meshcoreSession.ts`](../src/renderer/lib/sessions/meshcoreSession.ts)

Do **not** remount runtime hooks in child components. Use `useProtocolFacade`, store selectors, and panel action hooks.

## Next steps (driver-owned side effects)

1. Move remaining wire/MQTT subscriptions from runtime into drivers or store effects.
2. Run DB hydration from driver connect/disconnect without runtime-local Maps.
3. Expand `MeshCoreProtocol.subscribe` + `PacketRouter` to replace duplicate legacy listeners.
