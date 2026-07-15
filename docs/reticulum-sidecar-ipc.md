# Reticulum sidecar IPC contract

HTTP + WebSocket on `127.0.0.1` (ephemeral port in production; default dev port **19437**).

Aligned with [Ratspeak](https://github.com/ratspeak/Ratspeak) `ratspeak-tauri` commands — not meshchat aiohttp.

Electron main validates proxy paths: must start with `/api/v1/` (no `..` segments).

## REST

### Status and app

| Method | Path               | Body / notes | Response                                           |
| ------ | ------------------ | ------------ | -------------------------------------------------- |
| GET    | `/api/v1/status`   |              | `{ status, version, rns_ready, lxmf_ready }`       |
| GET    | `/api/v1/app/info` |              | `{ sidecar_version, rns_version?, lxmf_version? }` |

### Identity

| Method | Path                              | Body / notes                                       | Response                                                  |
| ------ | --------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/identity/status`         |                                                    | `{ configured, identity_hash, lxmf_hash, display_name? }` |
| POST   | `/api/v1/identity/generate`       | `{ display_name?, replace? }`                      | `{ ok, mnemonic?, identity_hash, lxmf_hash }`             |
| POST   | `/api/v1/identity/import`         | `{ mnemonic, display_name?, replace? }`            | `{ ok, identity_hash, lxmf_hash }`                        |
| POST   | `/api/v1/identity/import-backup`  | `{ backup, passphrase?, display_name?, replace? }` | `{ ok, identity_hash, lxmf_hash, metadata_only? }`        |
| POST   | `/api/v1/identity/import-private` | `{ private_key, display_name?, replace? }`         | `{ ok, identity_hash, lxmf_hash }`                        |
| POST   | `/api/v1/identity/export`         | `{ passphrase }`                                   | `{ ok, backup? }`                                         |
| POST   | `/api/v1/identity/display-name`   | `{ display_name }`                                 | `{ ok }`                                                  |

### Interfaces

| Method | Path                                     | Body / notes                                                                                                       | Response                                                                                               |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/interfaces`                     |                                                                                                                    | `{ interfaces: [], primary_local_serial_interface_id?, effective_primary_local_serial_interface_id? }` |
| POST   | `/api/v1/interfaces`                     | `{ type, name?, host?, port?, preset?, serial_port?, callsign?, mode? }`                                           | `{ ok, interface? }`                                                                                   |
| POST   | `/api/v1/interfaces/primary-local-rnode` | `{ id }` — enabled locally connected serial interface (`rnode`, `rnode_multi`, `kiss` over USB, BLE, or local TCP) | `{ ok, reordered?, effective_id?, error? }`                                                            |
| PUT    | `/api/v1/interfaces/{id}`                | Partial patch (see below)                                                                                          | `{ ok, interface? }`                                                                                   |
| DELETE | `/api/v1/interfaces/{id}`                |                                                                                                                    | `{ ok }`                                                                                               |
| POST   | `/api/v1/interfaces/{id}/enable`         |                                                                                                                    | `{ ok }`                                                                                               |
| POST   | `/api/v1/interfaces/{id}/disable`        |                                                                                                                    | `{ ok }`                                                                                               |
| GET    | `/api/v1/rnode/presets`                  |                                                                                                                    | `{ presets: [] }`                                                                                      |
| GET    | `/api/v1/serial/ports`                   |                                                                                                                    | `{ ports: [] }`                                                                                        |
| GET    | `/api/v1/ble/availability`               |                                                                                                                    | `{ available, missing, permissions_granted, probe_failed? }`                                           |
| GET    | `/api/v1/ble/scan`                       | `timeout_secs` (1–30, default 5), `mode` (`peer` \| `rnode` \| `all`)                                              | `{ devices: [{ address, name?, rssi?, kind? }] }` or `{ ok: false, error }`                            |

**`PUT /api/v1/interfaces/{id}` patch fields** (all optional): `name`, `type`, `enabled`, `host`, `port`, `preset`, `serial_port`, `frequency`, `bandwidth`, `txpower`, `spreading_factor`, `coding_rate`, `callsign`, `id_interval`, `mode` (`full` \| `point_to_point` \| `access_point` \| `roaming` \| `boundary` \| `gateway`; aliases `ap`/`gw`; empty clears; invalid non-empty → API error `invalid interface mode: …`; omitted on PUT preserves existing), `discoverable`, `latitude`, `longitude`, `height`, `discovery_name`, `announce_interval_min`, `connectable`, `reachable_on`. On **POST** add, omitted `mode` defaults to `boundary` (tcp/udp/i2p) or `access_point` (rnode/rnode_multi); Auto/BLE Peer/KISS/Pipe leave mode unset.

The Connection tab UI edits a subset: **name** and **mode** for all types; **host** / **port** for TCP/UDP; **serial_port**, **preset**, **callsign** for RNode. Enable/disable uses the dedicated POST routes.

### Config and stack settings

| Method | Path                     | Body / notes                                                                                                        | Response                                                                                                                                             |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/config`         |                                                                                                                     | `{ content }`                                                                                                                                        |
| PUT    | `/api/v1/config`         | `{ content }` (full rnsd INI text)                                                                                  | `{ ok }`                                                                                                                                             |
| GET    | `/api/v1/config/export`  |                                                                                                                     | `{ content }`                                                                                                                                        |
| POST   | `/api/v1/config/import`  | `{ content, mode: merge\|replace }`                                                                                 | `{ ok, warnings? }`                                                                                                                                  |
| GET    | `/api/v1/config/audit`   |                                                                                                                     | `{ issues: ConfigAuditIssue[] }` — config vs live interface audit                                                                                    |
| POST   | `/api/v1/config/repair`  | `{ repair_kinds?: string[] }` — `repair_config`, `apply_preset`, `add_auto`, `disable_share_instance` (empty = all) | `{ ok, repaired: string[], restart_required: bool }`                                                                                                 |
| GET    | `/api/v1/stack/settings` |                                                                                                                     | `{ enable_transport, share_instance, loglevel, announce_interval_sec }` — `announce_interval_sec` defaults to **3600** (1 h) when absent from config |
| PUT    | `/api/v1/stack/settings` | Full `StackSettings` JSON (all four fields recommended)                                                             | `{ ok }` — missing `announce_interval_sec` deserializes as **0**                                                                                     |
| POST   | `/api/v1/stack/restart`  |                                                                                                                     | `{ ok }`                                                                                                                                             |
| DELETE | `/api/v1/announces`      |                                                                                                                     | `{ ok }` — clears stub persisted peers; live path table may repopulate under `rns-stack`                                                             |
| POST   | `/api/v1/announces`      |                                                                                                                     | `{ ok }` — send LXMF delivery announce now (live stack). Interval scheduling also sends startup + periodic announces from `announce_interval_sec`    |

**Config bootstrap (stack start):** When `announce_interval_sec` is missing from rnsd config, the sidecar writes **3600**; explicit **0** is left unchanged (`ensure_announce_interval_sec_default` in `reticulum-sidecar/src/stack/config.rs`). Missing `share_instance` / `instance_name` are filled as **No** / **mesh-client** (explicit values are preserved). Same bootstrap pass may set `discover_interfaces = Yes` for RMAP ingest.

### LXMF and contacts

| Method | Path                           | Body / notes                                                                                   | Response                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/v1/lxmf/send`            | `{ destination_hash, text, reply_to_hash?, reply_to_id?, reply_preview_text? }`                | Live: stamps LXMF `FIELD_REPLY_TO` (0x30) / optional `FIELD_REPLY_QUOTE` (0x31) before sign; `{ ok, delivery_method?, delivery_status?, sent_via?, message? }` or `{ ok: false, error: "no_propagation_node" }`. **`delivery_status` on this response is initial enqueue state only** (`queued` or `sending`) — not delivery confirmation. Stub: `{ ok, sent_via?, message? }` |
| POST   | `/api/v1/lxmf/reaction`        | `{ destination_hash, target_hash, emoji }`                                                     | `{ ok, message? }`                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/api/v1/lxmf/resource`        | `{ destination_hash, file_name, mime_type, data_base64, reply_to_hash?, reply_preview_text? }` | Live: LXMF `FIELD_FILE_ATTACHMENTS` send (+ optional reply fields). Stub: local persist only. `{ ok, message? }`. **UI attach/voice deferred** — endpoint retained for a future redesign.                                                                                                                                                                                      |
| DELETE | `/api/v1/lxmf/messages/{hash}` |                                                                                                | `{ ok }`                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/api/v1/contacts`             |                                                                                                | `{ contacts: [] }` — overlays announce/peer/Nomad labels onto nameless or hash-prefix contact `display_name` values (does not overwrite a real name) and may persist fills                                                                                                                                                                                                     |
| DELETE | `/api/v1/contacts`             |                                                                                                | `{ ok, cleared }` — clears LXMF contacts after demoting them into the peer cache (keeps Peers; does not delete chat messages)                                                                                                                                                                                                                                                  |

### Peers, topology, and propagation

| Method | Path                         | Body / notes           | Response                                                                                                                                                                                                                                                   |
| ------ | ---------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/peers`              | `?refresh=1` optional  | `{ peers: [] }` — live path table when `rns-stack` enabled; without `refresh=1` may serve a short-TTL maintenance cache; `refresh=1`/`true` forces live `GetPathTable` (manual Refresh). `display_name` overlayed from contacts/Nomad/announce label cache |
| POST   | `/api/v1/peers/{hash}/path`  |                        | `{ ok }` — emits `peers_updated` WS on success                                                                                                                                                                                                             |
| POST   | `/api/v1/peers/{hash}/probe` |                        | `{ ok, hops? }` live; `{ ok, mode, hash }` stub — emits `peers_updated` on success                                                                                                                                                                         |
| POST   | `/api/v1/ping`               | `{ destination_hash }` | `{ ok, rtt_ms? }`                                                                                                                                                                                                                                          |
| GET    | `/api/v1/topology`           |                        | `{ nodes, edges, total?, shown?, truncated? }` — `via_hash` is the immediate RNS next hop (transport id); sidecar infers `self → relay` when needed                                                                                                        |
| GET    | `/api/v1/rmap/discovered`    |                        | `{ discovered: RmapDiscoveredWireRow[] }` — local RMAP v4 heard interfaces (7-day TTL eviction in rsReticulum DiscoveryStore)                                                                                                                              |

**`RmapDiscoveredWireRow` fields** (see `src/shared/reticulum-types.ts`): `discovery_hash`, `transport_id`, `discovery_name`, `interface_type`, `latitude`, `longitude`, `height`, `transport_enabled`, `reachable_on`, LoRa RF fields (`frequency`, `bandwidth`, `spreading_factor`, …), `hops`, `stamp_value`, `discovered`, `last_heard`, `heard_count`, `status` (`available`/`stale`/`unknown`), `has_coordinates`. Renderer caps at 2,000 newest rows with client-side TTL eviction.

**WS `rmap.discovery`:** sidecar polls DiscoveryStore every **10s**; emits full `{ discovered: [...] }` snapshot when JSON fingerprint changes. Stub builds return `{ discovered: [] }`.
| GET | `/api/v1/packets` | `?limit=500` (1–2500) | `{ packets: [] }` — recent wire tap ring buffer |
| DELETE | `/api/v1/packets` | | `{ ok }` — clear wire tap buffer |
| GET | `/api/v1/propagation` | | `{ propagation, preferred_id, auto_sync_interval_sec }` — `local-prop` rows include `message_count`, `storage_bytes` when live |
| POST | `/api/v1/propagation/add` | `{ destination_hash, name? }` | `{ ok, node }` — add a remote propagation node by hash |
| PUT | `/api/v1/propagation/{id}` | `{ name }` | `{ ok }` — rename a remote node (`local-prop` rejected) |
| DELETE | `/api/v1/propagation/{id}` | | `{ ok }` — remove a remote node (`local-prop` rejected; clears preferred if that id) |
| POST | `/api/v1/propagation/{id}/enable` | | `{ ok }` |
| POST | `/api/v1/propagation/{id}/disable` | | `{ ok }` |
| POST | `/api/v1/propagation/{id}/preferred` | | `{ ok }` |
| POST | `/api/v1/propagation/sync` | | `{ ok }` |
| POST | `/api/v1/propagation/sync/cancel` | | `{ ok }` |

### Nomad Network

| Method | Path                                      | Body / notes          | Response                              |
| ------ | ----------------------------------------- | --------------------- | ------------------------------------- |
| GET    | `/api/v1/nomadnetwork/nodes`              |                       | `{ nodes: [] }`                       |
| POST   | `/api/v1/nomadnetwork/nodes/favorite`     | `{ hash, favorited }` | `{ ok }`                              |
| GET    | `/api/v1/nomadnetwork/page/{hash}?path=…` |                       | page payload                          |
| GET    | `/api/v1/nomadnetwork/file/{hash}?path=…` |                       | `{ ok, file_name?, content_base64? }` |

### System

| Method | Path                           | Body / notes      | Response                         |
| ------ | ------------------------------ | ----------------- | -------------------------------- |
| GET    | `/api/v1/diagnostics`          |                   | Reticulum-native health snapshot |
| POST   | `/api/v1/system/factory-reset` |                   | `{ ok }`                         |
| GET    | `/api/v1/voice/status`         |                   | LXST stub status                 |
| GET    | `/api/v1/games/status`         |                   | LRGP stub status                 |
| GET    | `/api/v1/identities`           |                   | `{ identities: [] }`             |
| POST   | `/api/v1/identities/switch`    | `{ identity_id }` | `{ ok }`                         |

## WebSocket

`GET /ws` — server push JSON text frames:

```json
{ "type": "lxmf_message", "payload": { ... } }
```

Event types: `lxmf_message`, `lxmf_outbound_status`, `announce.received`, `peers_updated`, `stats_update`, `interface.state`, `stack_restart_requested`, `propagation_sync`, `resource.received`, `wire_packet`, `rmap.discovery` (payload `{ discovered: RmapDiscoveredWireRow[] }`).

- **`lxmf_outbound_status`:** authoritative outbound delivery updates. Payload: `{ message_hash, status, delivery_method?, to_hash? }` where `status` is `delivered` or `failed` (intermediate states are not emitted on WS). mesh-client maps `delivered` → UI Completes (`acked`) and persists `delivery_status` to SQLite; `failed` → Failed. Do **not** treat `/api/v1/lxmf/send` response `delivery_status` (`queued`/`sending`) as terminal.
- **`announce.received`:** emitted for every LXMF identity announce / path response the sidecar observes (named or nameless). Payload: `{ destination_hash, display_name?, hops }`. Display names update the peer-label cache only — announces do **not** auto-create LXMF contacts. That cache is overlayed onto `GET /api/v1/peers` / topology rows **and** onto nameless/hash-prefix rows from `GET /api/v1/contacts` (`list_contacts` may persist those fills) so path-table and contact refreshes keep announce aliases.
- **`peers_updated`:** also emitted when the live path table **gains** new destination hashes (maintenance tick). Payload may include `{ added: string[], patches: PeerRow[], count }` (added/patches capped at 1024). Renderer applies patches incrementally, including route-field changes. A full peer dump is used on connect, manual Refresh, restart, safety poll, or a `peers_updated` payload that cannot be applied incrementally: `cleared`, `demoted_from_contacts`, or a single-`hash` probe/path event. Hop/timestamp-only churn does not emit.

`lxmf_message` payload fields include `sender_hash`, `text`, `timestamp`, `message_hash`, optional `direction` (`inbound` / `outbound`), optional `delivery_status` (`sending` on optimistic outbound rows), optional `reply_to_hash` / `reply_preview_text` (from LXMF `FIELD_REPLY_TO` / `FIELD_REPLY_QUOTE`), and transport markers `received_via` / `sent_via`. Outbound `sent_via` is **path-table / PacketTap evidence**, not “any local RNode enabled”: atomic values are `rf`, `ble`, `tcp`, or `network`; multi-egress observes join with `+` (e.g. `rf+tcp`, `ble+network`). Inbound `received_via` uses the path-table interface name **matched to local interface config** (same atoms — so a TCP hub named “RNS Testnet” is `tcp`, not `network`). Never use Meshtastic-style `both` for Reticulum.

`lxmf_outbound_status` payload: `message_hash`, `status` (`delivered` / `failed` / `sending`), optional `delivery_method`, optional `sent_via` (egress evidence upgrade before Completes).

## Electron bridge

Renderer calls `electronAPI.reticulum.*`; main process proxies to this API (sandboxed renderer cannot reach localhost directly).

| IPC channel                                                     | Role                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `reticulum:start` / `stop` / `getStatus`                        | Sidecar lifecycle                                                                                         |
| `reticulum:syncInterfaceIssueScope`                             | Drop TCP/TX latch entries for disabled/removed interfaces; sticky enabled-name filter for later log lines |
| `reticulum:proxyGet` / `proxyPost` / `proxyPut` / `proxyDelete` | HTTP proxy to paths above                                                                                 |
| `reticulum:validateConfig`                                      | One-shot `validate-config --json` against `userData/reticulum/config` (read-only; safe while stack runs)  |
| `reticulum:readDefaultConfigFile`                               | Read first existing system rnsd config path                                                               |
| `reticulum:showConfigImportDialog`                              | Native file picker for config import                                                                      |
| `reticulum:showIdentityImportDialog`                            | Native file picker for 64-byte private key (`.retid`, `.key`, …)                                          |
| `reticulum:onEvent` / `onStatus`                                | WS events and sidecar status                                                                              |

`getStatus` / `onStatus` may include `interfaceIssueAlert` (TCP connect failures, TX queue drops, link-delivery timeouts, transport saturation / slow queries, **`bleBondRemoved`** stale RNode bonds). Per-entry latch timestamps use a **5-minute** stale window (`RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS`). Connection syncs **enabled** interface names via `syncInterfaceIssueScope` so disabling or removing an interface clears that name immediately and rejects re-latch from lagging log lines. Stopping the stack (or unexpected process exit) clears the tracker.

**`propagation_sync` WebSocket payload:** `{ active: boolean, progress: number, message: string | null }`. Progress uses 0–100 (Establishing ≈10, Offering ≈25, …, Complete ≈100). Sticky success after HaveAll emits `active:false, progress:100`; cancel/stall/failure emit `active:false, progress:0` (and must not emit a trailing 100). Sync `POST /api/v1/propagation/sync` may return `PROPAGATION_IDENTITY_UNKNOWN`, `PROPAGATION_TARGET_NOT_PN`, `PROPAGATION_PEERING_STAMP_FAILED`, or `LOCAL_PROPAGATION_SYNC_UNSUPPORTED`.

SQLite chat history uses separate `db:*` handlers (`getReticulumMessages`, `saveReticulumMessage`, `searchReticulumMessages`, `deleteReticulumMessage`, destination upserts), not sidecar HTTP.

| IPC channel                               | Reticulum maintenance behavior                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `db:pruneReticulumDestinationsByCount`    | Prunes excess non-favorited destinations by oldest `last_heard`; favorites are preserved.    |
| `db:deleteReticulumDestinationsByAge`     | Deletes non-favorited destinations before a calculated Unix-**seconds** `last_heard` cutoff. |
| `db:pruneReticulumIdentityActivityByAge`  | Deletes identity-activity rows before an epoch-**milliseconds** `last_seen` cutoff.          |
| `db:upsertReticulumIdentityActivityBatch` | Validates and upserts at most **500** activity rows per call.                                |

Reticulum startup maintenance runs the destination age/count prune and message retention independently. `VACUUM` runs only after the Reticulum startup prune, never on the six-hour session tick.
