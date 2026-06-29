# Reticulum sidecar IPC contract

HTTP + WebSocket on `127.0.0.1` (ephemeral port in production; default dev port **19437**).

Aligned with [Ratspeak](https://github.com/ratspeak/Ratspeak) `ratspeak-tauri` commands — not meshchat aiohttp.

## REST

| Method | Path                               | Body / notes                                               | Response                                                  |
| ------ | ---------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/status`                   |                                                            | `{ status, version, rns_ready, lxmf_ready }`              |
| GET    | `/api/v1/app/info`                 |                                                            | `{ sidecar_version, rns_version?, lxmf_version? }`        |
| GET    | `/api/v1/identity/status`          |                                                            | `{ configured, identity_hash, lxmf_hash, display_name? }` |
| POST   | `/api/v1/identity/generate`        | `{ display_name? }`                                        | `{ ok, mnemonic?, identity_hash, lxmf_hash }`             |
| POST   | `/api/v1/identity/import`          | `{ mnemonic, display_name? }`                              | `{ ok, identity_hash, lxmf_hash }`                        |
| POST   | `/api/v1/identity/export`          | `{ passphrase }`                                           | `{ ok, backup? }`                                         |
| POST   | `/api/v1/identity/display-name`    | `{ display_name }`                                         | `{ ok }`                                                  |
| GET    | `/api/v1/interfaces`               |                                                            | `{ interfaces: [] }`                                      |
| POST   | `/api/v1/interfaces`               | `{ type, name?, host?, port?, preset?, serial_port? }`     | `{ ok, interface? }`                                      |
| POST   | `/api/v1/interfaces/{id}/enable`   |                                                            | `{ ok }`                                                  |
| POST   | `/api/v1/interfaces/{id}/disable`  |                                                            | `{ ok }`                                                  |
| GET    | `/api/v1/rnode/presets`            |                                                            | `{ presets: [] }`                                         |
| GET    | `/api/v1/serial/ports`             |                                                            | `{ ports: [] }`                                           |
| GET    | `/api/v1/ble/availability`         |                                                            | `{ available, missing, permissions_granted }`             |
| GET    | `/api/v1/contacts`                 |                                                            | `{ contacts: [] }`                                        |
| GET    | `/api/v1/peers`                    |                                                            | `{ peers: [] }`                                           |
| POST   | `/api/v1/peers/{hash}/path`        |                                                            | `{ ok }`                                                  |
| POST   | `/api/v1/peers/{hash}/probe`       |                                                            | `{ ok, hops? }`                                           |
| GET    | `/api/v1/propagation`              |                                                            | `{ propagation: [] }`                                     |
| POST   | `/api/v1/propagation/{id}/enable`  |                                                            | `{ ok }`                                                  |
| POST   | `/api/v1/propagation/{id}/disable` |                                                            | `{ ok }`                                                  |
| POST   | `/api/v1/lxmf/send`                | `{ destination_hash, text, reply_to_hash?, reply_to_id? }` | `{ ok, message? }`                                        |
| POST   | `/api/v1/lxmf/reaction`            | `{ destination_hash, target_hash, emoji }`                 | `{ ok, message? }`                                        |

## WebSocket

`GET /ws` — server push JSON text frames:

```json
{ "type": "lxmf_message", "payload": { ... } }
```

Event types: `lxmf_message`, `announce.received`, `peers_updated`, `stats_update`, `interface.state`.

## Electron bridge

Renderer calls `electronAPI.reticulum.*`; main process proxies to this API (sandboxed renderer cannot reach localhost directly).
