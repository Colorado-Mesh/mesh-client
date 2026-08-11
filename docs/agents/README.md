# Agent subsystem reference

Deep, file-level subsystem detail for AI assistants, split out of [`AGENTS.md`](../../AGENTS.md) so it is loaded on demand rather than on every prompt. Hard rules and the always-on workflow/security/style policy stay in `AGENTS.md`; open the matching file here when a task touches that subsystem.

| When working on…                                                                         | Read                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Reticulum sidecar, LXMF, propagation, Remote/rnsh/rncp, Nomad, RRC, voice, games         | [reticulum.md](reticulum.md)                   |
| LoRa BLE/serial, Noble reconnect, dual-radio startup, BLE coexistence                    | [ble-serial.md](ble-serial.md)                 |
| Renderer hooks/runtimes/stores, protocol entry points, DB, tab wiring                    | [renderer-hooks.md](renderer-hooks.md)         |
| Meshtastic config apply, admin, channel URLs, Store & Forward, remote admin, GPS         | [meshtastic.md](meshtastic.md)                 |
| MQTT ingest, channel key mapping, sticky BLE suppress                                    | [mqtt.md](mqtt.md)                             |
| Chat panel, composer, link previews, notifications, dedup, hop badges, reactions, export | [chat.md](chat.md)                             |
| MeshCore Repeaters admin (ping/trace/neighbors/CLI/waiting drain)                        | [meshcore-repeaters.md](meshcore-repeaters.md) |
| MeshCore Rooms (BBS) login/post/sync/wire text                                           | [meshcore-rooms.md](meshcore-rooms.md)         |
| Diagnostics engines, rows, tab scoping                                                   | [diagnostics.md](diagnostics.md)               |
| i18n / localization workflow, auto-translate, language selector                          | [i18n.md](i18n.md)                             |
| Connection panel helpers (error hints, rehydrate, storage migrations)                    | [connection-panel.md](connection-panel.md)     |
| Symptom → where-to-check index                                                           | [common-issues.md](common-issues.md)           |
| Headless server mode, Docker image, HTTP/WS remote control                               | [headless.md](headless.md)                     |

For human-facing deep dives, see the top-level docs (e.g. [../reticulum.md](../reticulum.md), [../diagnostics.md](../diagnostics.md), [../meshcore-meshtastic-parity.md](../meshcore-meshtastic-parity.md), [../troubleshooting.md](../troubleshooting.md)).
