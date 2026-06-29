# Reticulum sidecar IPC contract

HTTP + WebSocket on `127.0.0.1` (ephemeral port in production; default dev port **19437**).

Aligned with [Ratspeak](https://github.com/ratspeak/Ratspeak) `ratspeak-tauri` commands — not meshchat aiohttp.

## REST

| Method | Path                 | Response                                           |
| ------ | -------------------- | -------------------------------------------------- |
| GET    | `/api/v1/status`     | `{ status, version, rns_ready, lxmf_ready }`       |
| GET    | `/api/v1/app/info`   | `{ sidecar_version, rns_version?, lxmf_version? }` |
| GET    | `/api/v1/interfaces` | `{ interfaces: [] }`                               |
| GET    | `/api/v1/contacts`   | `{ contacts: [] }`                                 |
| POST   | `/api/v1/lxmf/send`  | `{ ok, error? }`                                   |

## WebSocket

`GET /ws` — server push JSON text frames:

- `lxmf_message`
- `announce.received`
- `peers_updated`
- `stats_update`
- `interface.state`

## Electron bridge

Renderer calls `electronAPI.reticulum.*`; main process proxies to this API (sandboxed renderer cannot reach localhost directly).
