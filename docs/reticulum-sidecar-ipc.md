# Reticulum sidecar IPC contract

HTTP + WebSocket on `127.0.0.1` (ephemeral port in production; default dev port **19437**).

Aligned with [Ratspeak](https://github.com/ratspeak/Ratspeak) `ratspeak-tauri` commands — not meshchat aiohttp.

## REST

### Status and app

| Method | Path               | Body / notes | Response                                           |
| ------ | ------------------ | ------------ | -------------------------------------------------- |
| GET    | `/api/v1/status`   |              | `{ status, version, rns_ready, lxmf_ready }`       |
| GET    | `/api/v1/app/info` |              | `{ sidecar_version, rns_version?, lxmf_version? }` |

### Identity

| Method | Path                            | Body / notes                  | Response                                                  |
| ------ | ------------------------------- | ----------------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/identity/status`       |                               | `{ configured, identity_hash, lxmf_hash, display_name? }` |
| POST   | `/api/v1/identity/generate`     | `{ display_name? }`           | `{ ok, mnemonic?, identity_hash, lxmf_hash }`             |
| POST   | `/api/v1/identity/import`       | `{ mnemonic, display_name? }` | `{ ok, identity_hash, lxmf_hash }`                        |
| POST   | `/api/v1/identity/export`       | `{ passphrase }`              | `{ ok, backup? }`                                         |
| POST   | `/api/v1/identity/display-name` | `{ display_name }`            | `{ ok }`                                                  |

### Interfaces

| Method | Path                              | Body / notes                                                      | Response                                      |
| ------ | --------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| GET    | `/api/v1/interfaces`              |                                                                   | `{ interfaces: [] }`                          |
| POST   | `/api/v1/interfaces`              | `{ type, name?, host?, port?, preset?, serial_port?, callsign? }` | `{ ok, interface? }`                          |
| PUT    | `/api/v1/interfaces/{id}`         | Partial patch (see below)                                         | `{ ok, interface? }`                          |
| DELETE | `/api/v1/interfaces/{id}`         |                                                                   | `{ ok }`                                      |
| POST   | `/api/v1/interfaces/{id}/enable`  |                                                                   | `{ ok }`                                      |
| POST   | `/api/v1/interfaces/{id}/disable` |                                                                   | `{ ok }`                                      |
| GET    | `/api/v1/rnode/presets`           |                                                                   | `{ presets: [] }`                             |
| GET    | `/api/v1/serial/ports`            |                                                                   | `{ ports: [] }`                               |
| GET    | `/api/v1/ble/availability`        |                                                                   | `{ available, missing, permissions_granted }` |

**`PUT /api/v1/interfaces/{id}` patch fields** (all optional): `name`, `type`, `enabled`, `host`, `port`, `preset`, `serial_port`, `frequency`, `bandwidth`, `txpower`, `spreading_factor`, `coding_rate`, `callsign`, `id_interval`, `mode`.

The Radio tab UI edits a subset: **name** for all types; **host** / **port** for TCP; **serial_port**, **preset**, **callsign** for RNode. Enable/disable uses the dedicated POST routes.

### Config and stack settings

| Method | Path                     | Body / notes                       | Response                                              |
| ------ | ------------------------ | ---------------------------------- | ----------------------------------------------------- |
| GET    | `/api/v1/config`         |                                    | `{ content }`                                         |
| PUT    | `/api/v1/config`         | `{ content }` (full rnsd INI text) | `{ ok }`                                              |
| GET    | `/api/v1/config/export`  |                                    | `{ content }`                                         |
| POST   | `/api/v1/config/import`  | `{ content, mode: merge\           | replace }`                                            |
| GET    | `/api/v1/stack/settings` |                                    | `{ enable_transport, share_instance, loglevel, ... }` |
| PUT    | `/api/v1/stack/settings` | `StackSettings` JSON               | `{ ok }`                                              |
| POST   | `/api/v1/stack/restart`  |                                    | `{ ok }`                                              |

### LXMF and contacts

| Method | Path                           | Body / notes                                               | Response                      |
| ------ | ------------------------------ | ---------------------------------------------------------- | ----------------------------- |
| POST   | `/api/v1/lxmf/send`            | `{ destination_hash, text, reply_to_hash?, reply_to_id? }` | `{ ok, sent_via?, message? }` |
| POST   | `/api/v1/lxmf/reaction`        | `{ destination_hash, target_hash, emoji }`                 | `{ ok, message? }`            |
| POST   | `/api/v1/lxmf/resource`        | LXMF file attachment payload                               | `{ ok, message? }`            |
| DELETE | `/api/v1/lxmf/messages/{hash}` |                                                            | `{ ok }`                      |
| GET    | `/api/v1/contacts`             |                                                            | `{ contacts: [] }`            |

### Peers and propagation

| Method | Path                               | Body / notes | Response              |
| ------ | ---------------------------------- | ------------ | --------------------- |
| GET    | `/api/v1/peers`                    |              | `{ peers: [] }`       |
| POST   | `/api/v1/peers/{hash}/path`        |              | `{ ok }`              |
| POST   | `/api/v1/peers/{hash}/probe`       |              | `{ ok, hops? }`       |
| GET    | `/api/v1/propagation`              |              | `{ propagation: [] }` |
| POST   | `/api/v1/propagation/{id}/enable`  |              | `{ ok }`              |
| POST   | `/api/v1/propagation/{id}/disable` |              | `{ ok }`              |

### System

| Method | Path                           | Body / notes | Response                         |
| ------ | ------------------------------ | ------------ | -------------------------------- |
| GET    | `/api/v1/diagnostics`          |              | Reticulum-native health snapshot |
| POST   | `/api/v1/system/factory-reset` |              | `{ ok }`                         |
| GET    | `/api/v1/voice/status`         |              | LXST stub status                 |
| GET    | `/api/v1/games/status`         |              | LRGP stub status                 |
| GET    | `/api/v1/identities`           |              | `{ identities: [] }`             |
| POST   | `/api/v1/identities/switch`    | `{ id }`     | `{ ok }`                         |

## WebSocket

`GET /ws` — server push JSON text frames:

```json
{ "type": "lxmf_message", "payload": { ... } }
```

Event types: `lxmf_message`, `announce.received`, `peers_updated`, `stats_update`, `interface.state`.

`lxmf_message` payload fields include `sender_hash`, `text`, `timestamp`, `message_hash`, optional `direction` (`inbound` / `outbound`), and transport markers `received_via` / `sent_via` (`rf`, `tcp`, or `network`).

## Electron bridge

Renderer calls `electronAPI.reticulum.*`; main process proxies to this API (sandboxed renderer cannot reach localhost directly).

| IPC channel                                                     | Role                                        |
| --------------------------------------------------------------- | ------------------------------------------- |
| `reticulum:start` / `stop` / `getStatus`                        | Sidecar lifecycle                           |
| `reticulum:proxyGet` / `proxyPost` / `proxyPut` / `proxyDelete` | HTTP proxy to paths above                   |
| `reticulum:readDefaultConfigFile`                               | Read first existing system rnsd config path |
| `reticulum:showConfigImportDialog`                              | Native file picker for config import        |
| `reticulum:onEvent` / `onStatus`                                | WS events and sidecar status                |

SQLite chat history uses separate `db:*` handlers (`getReticulumMessages`, `saveReticulumMessage`, `searchReticulumMessages`, `deleteReticulumMessage`, destination upserts).
