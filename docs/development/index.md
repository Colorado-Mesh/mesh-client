# Subsystem reference

File-level developer notes for each subsystem, for human contributors and coding agents alike. Repo-wide rules (workflow, security, style, testing) live in [`AGENTS.md`](../../AGENTS.md); project layout lives in [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

| When working on…                                                                                          | Read                                                                                    |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Reticulum sidecar, LXMF, propagation, Remote/rnsh/rncp, Nomad, RRC, voice, games                          | [reticulum-development.md — Code map](../reticulum-development.md#code-map)             |
| LoRa BLE/serial, sidecar GATT reconnect, dual-radio wake stagger, BLE coexistence                         | [ble-serial.md](ble-serial.md)                                                          |
| Renderer hooks/runtimes/stores, protocol entry points, DB, tab wiring                                     | [renderer-hooks.md](renderer-hooks.md)                                                  |
| Meshtastic config apply, admin, channel URLs, Store & Forward, remote admin, GPS                          | [meshtastic.md](meshtastic.md)                                                          |
| MQTT ingest, channel key mapping, sticky BLE suppress                                                     | [mqtt.md](mqtt.md)                                                                      |
| Chat panel, composer, link previews, notifications, dedup, hop badges, reactions, relay coverage, export  | [chat.md](chat.md)                                                                      |
| MeshCore Repeaters admin (ping/trace/neighbors/CLI/waiting drain)                                         | [meshcore-repeaters.md](meshcore-repeaters.md)                                          |
| MeshCore Rooms (BBS) login/post/sync/wire text                                                            | [meshcore-rooms.md](meshcore-rooms.md)                                                  |
| Diagnostics engines, rows, tab scoping                                                                    | [diagnostics.md — Key Source Files](../diagnostics.md#17-key-source-files)              |
| i18n / localization workflow, auto-translate, language selector                                           | [localization.md — Maintainer workflow](../localization.md#maintainer-workflow)         |
| Connection panel helpers (error hints, rehydrate, storage migrations)                                     | [connection-panel.md](connection-panel.md)                                              |
| MECP emergency reports, siren alerts, audit log, ALERT_APP, RF rebroadcast                                | [mecp.md](mecp.md)                                                                      |
| EMCOMM Incident Command, safety invariants (S1–S16), emergency outbox, ACK/beacon, ops alerts, SAR/export | [emcomm.md](emcomm.md)                                                                  |
| Offline maps (`mesh-tiles:`), tile cache, region download, quiet update offline                           | [offline-maps.md](offline-maps.md)                                                      |
| Weather forecast map (parsed chat forecasts drawn on the Map)                                             | `src/renderer/components/WeatherForecastLayer.tsx`                                      |
| App shell (rail, section tabs, status bar, launcher), UI tokens, controls, copy rules                     | [style-guide.md](../style-guide.md)                                                     |
| Launcher settings search (registry, `data-setting-anchor`, reveal, guards)                                | [settings-search.md](settings-search.md)                                                |
| Developer service announcements feed (`announcements/announcements.json`), strip, pre-commit warning      | [service-announcements.md — Implementation](../service-announcements.md#implementation) |
| Symptom → where-to-check index                                                                            | [common-issues.md](common-issues.md)                                                    |
| Where to look first by area (diagnostics, protocols, lifecycle, DB, BLE, MQTT, Rooms, UI)                 | [architecture-quick-ref.md](architecture-quick-ref.md)                                  |

For user-facing guides, see [reticulum.md](../reticulum.md), [emcomm.md](../emcomm.md), [troubleshooting.md](../troubleshooting.md), [troubleshooting-meshcore.md](../troubleshooting-meshcore.md), [troubleshooting-reticulum.md](../troubleshooting-reticulum.md), and [meshcore-meshtastic-parity.md](../meshcore-meshtastic-parity.md).
