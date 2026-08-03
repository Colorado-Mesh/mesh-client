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

### Path medium preference and pins

Routing bias between **RF** (LoRa / RNode) and **network** (TCP/UDP/I2P/gateway/shared-instance) path slots. Backed by rsReticulum `TransportQuery::SetPathMediumPreference` / `SetPeerMediumPin` / `GetPathSlots`; persisted in `mesh_client_stack.json` as `path_medium_preference` (default `"lowest"`) and `peer_medium_pins` (`{ "<32 hex dest>": "rf" | "network" }`, max 256 entries).

| Method | Path                                      | Body / notes                                     | Response                                                                                                                                                                    |
| ------ | ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/settings/path-medium-preference` |                                                  | `{ ok, preference: "lowest"\|"network"\|"rf", pins: { "<hash>": "rf"\|"network" } }`                                                                                        |
| PUT    | `/api/v1/settings/path-medium-preference` | `{ preference: "lowest"\|"network"\|"rf" }`      | `{ ok, preference }`; **400** `{ ok: false, error: "invalid_path_medium_preference" }` on an unknown token. On success emits `path_medium_preference` WS (`{ preference }`) |
| GET    | `/api/v1/peers/{hash}/paths`              |                                                  | `{ ok, destination_hash, preference, pin, effective_preference, live, paths: PathSlot[] }`; **400** on a non-32-hex hash                                                    |
| PUT    | `/api/v1/peers/{hash}/medium-pin`         | `{ pin: "rf"\|"network"\|null }` (`null` clears) | `{ ok, destination_hash, pin }`; **400** `"pin_required"` (key absent), `"invalid_pin"`, or bad hash. Emits `peers_updated` WS                                              |

**`PathSlot` fields:** `active` (route currently used for outbound), `hops`, `via_hash` (immediate transport id, may be `null`), `interface` (live interface name), `interface_id`, `medium` (`rf` / `network`), `timestamp`, `expires`, `expired`. Slots are ranked active-first and capped by rsReticulum `MAX_PATH_SLOTS` (**3**).

**`preference` vs `effective_preference`:** `preference` is the persisted global setting and `pin` the persisted per-destination override; `effective_preference` is what the live transport actually applies for that destination (pin resolved against the global) and is `null` when the stack is not live.

**Offline / persist behavior:** When the stack is down, PUTs persist and are applied on the next live start (`LiveBridge::spawn` re-applies the preference — skipped when it is the default `lowest` — then every pin). While the stack is live, PUTs persist only if the live apply succeeds; a failed live apply rolls back the persisted value so disk/UI cannot drift ahead of the transport. `GET …/paths` returns `live: false` with an empty `paths` array when there is no live transport. `GET /api/v1/peers` stays active-route-only and does **not** embed path arrays; fetch slots per destination.

`preference` semantics (rsReticulum): `lowest` applies no medium bias and ranks purely by hops; `network` / `rf` are "prefer if possible" — when the preferred medium has no live slot the other medium becomes active without clearing the preference, so the preferred medium can reclaim the route later.

### LXMF and contacts

| Method | Path                           | Body / notes                                                                    | Response                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/v1/lxmf/send`            | `{ destination_hash, text, reply_to_hash?, reply_to_id?, reply_preview_text? }` | Live: stamps LXMF `FIELD_REPLY_TO` (0x30) / optional `FIELD_REPLY_QUOTE` (0x31) before sign; `{ ok, delivery_method?, delivery_status?, sent_via?, message? }` or `{ ok: false, error: "no_propagation_node" }`. **`delivery_status` on this response is initial enqueue state only** (`queued` or `sending`) — not delivery confirmation. Stub: `{ ok, sent_via?, message? }` |
| POST   | `/api/v1/lxmf/reaction`        | `{ destination_hash, target_hash, emoji }`                                      | `{ ok, message? }`                                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/api/v1/lxmf/recent`          | `?since_ts=` (ms, optional), `?limit=` (default 200, max 500)                   | `{ messages: [], ring_len }` — ring buffer of recent **inbound** LXMF payloads for WS lag/reconnect catch-up (not durable across sidecar restart; capped at 200); `ring_len` is current buffer occupancy                                                                                                                                                                       |
| DELETE | `/api/v1/lxmf/messages/{hash}` |                                                                                 | `{ ok }`                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/api/v1/contacts`             |                                                                                 | `{ contacts: [] }` — overlays announce/peer/Nomad labels onto nameless or hash-prefix contact `display_name` values (does not overwrite a real name) and may persist fills                                                                                                                                                                                                     |
| DELETE | `/api/v1/contacts`             |                                                                                 | `{ ok, cleared }` — clears LXMF contacts after demoting them into the peer cache (keeps Peers; does not delete chat messages)                                                                                                                                                                                                                                                  |

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
| GET | `/api/v1/propagation` | | `{ propagation, preferred_id, auto_sync_interval_sec, pn_hosting_policy }` — `local-prop` rows include `message_count`, `storage_bytes` when live |
| GET | `/api/v1/propagation/discovered` | | `{ discovered: DiscoveredPropagationRow[] }` — heard `lxmf.propagation` announces (not auto-configured) |
| POST | `/api/v1/propagation/add` | `{ destination_hash, name?, skip_probe? }` | `{ ok, node }` or `{ ok: false, error }` — probes `/offer` unless `skip_probe`; may return `PROPAGATION_OFFER_UNSUPPORTED`, `PROPAGATION_PEER_COST_EXCEEDS_MAX`, identity/path errors |
| POST | `/api/v1/propagation/hosting-policy` | `PnHostingPolicy` | `{ ok }` — persist + apply local PN hosting / peering policy |
| PUT | `/api/v1/propagation/{id}` | `{ name }` | `{ ok }` — rename a remote node (`local-prop` rejected) |
| DELETE | `/api/v1/propagation/{id}` | | `{ ok }` — remove a remote node (`local-prop` rejected; clears preferred if that id) |
| POST | `/api/v1/propagation/{id}/enable` | | `{ ok }` — for `local-prop`, starts PN serve + announce |
| POST | `/api/v1/propagation/{id}/disable` | | `{ ok }` — for `local-prop`, stops PN serve + announce |
| POST | `/api/v1/propagation/{id}/preferred` | | `{ ok }` |
| POST | `/api/v1/propagation/sync` | | `{ ok }` |
| POST | `/api/v1/propagation/sync/cancel` | | `{ ok }` |
| POST | `/api/v1/propagation/auto-sync-interval` | `{ interval_sec }` | `{ ok }` — `0` disables periodic sync; persists with stack |

**`PnHostingPolicy`** (mirrored in `src/shared/pnHostingPolicy.ts` / sidecar `pn_hosting_policy.rs`):

| Field                      | Default | Notes                                                                                                                                              |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `peering_cost`             | `18`    | Must be ≤ `max_peering_cost`                                                                                                                       |
| `max_peering_cost`         | `26`    |                                                                                                                                                    |
| `autopeer`                 | `true`  |                                                                                                                                                    |
| `autopeer_maxdepth`        | `4`     | Cap 64                                                                                                                                             |
| `max_peers`                | `20`    | 1–256                                                                                                                                              |
| `propagation_stamp_cost`   | `16`    |                                                                                                                                                    |
| `propagation_stamp_flex`   | `3`     | Must be ≤ stamp cost                                                                                                                               |
| `message_storage_limit_mb` | `256`   | 1–10240                                                                                                                                            |
| `propagation_limit_kb`     | `256`   | 1–102400                                                                                                                                           |
| `sync_limit_kb`            | `10240` | 1–102400                                                                                                                                           |
| `delivery_limit_kb`        | `1000`  | 1–102400                                                                                                                                           |
| `from_static_only`         | `false` |                                                                                                                                                    |
| `auth_required`            | `false` |                                                                                                                                                    |
| `enforce_stamps`           | `false` | Persisted for UI/compat; **not applied** on current rsLXMF tip (`set_enforce_stamps` removed upstream; stamp gating uses `set_stamp_requirements`) |
| `enforce_ratchets`         | `false` | Persisted for UI/compat; **not applied** on current rsLXMF tip (`set_enforce_ratchets` removed upstream)                                           |
| `static_peers`             | `[]`    | Lowercase 32-hex hashes (max 256)                                                                                                                  |
| `node_name`                | `null`  | Trimmed; max 128 scalar chars; no control chars                                                                                                    |
| `pn_announce_interval_sec` | `360`   | Cap 86400                                                                                                                                          |
| `announce_at_start`        | `true`  |                                                                                                                                                    |

### Nomad Network

| Method | Path                                          | Body / notes                                                  | Response                                                                                                           |
| ------ | --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/nomadnetwork/nodes`                  |                                                               | `{ nodes: [] }`                                                                                                    |
| POST   | `/api/v1/nomadnetwork/nodes/favorite`         | `{ hash, favorited }`                                         | `{ ok }`                                                                                                           |
| GET    | `/api/v1/nomadnetwork/page/{hash}?path=…`     | optional `data`, `force_path_refresh=true` (stale-path retry) | page payload                                                                                                       |
| GET    | `/api/v1/nomadnetwork/file/{hash}?path=…`     | optional `force_path_refresh=true`                            | `{ ok, file_name?, content_base64? }`                                                                              |
| GET    | `/api/v1/nomadnetwork/serving`                |                                                               | `{ ok, serving }` (local host status; includes `content_source`, `content_layout`, `watcher_status`, `last_error`) |
| PUT    | `/api/v1/nomadnetwork/serving`                | `{ enabled, display_name? }`                                  | `{ ok, serving }`                                                                                                  |
| PUT    | `/api/v1/nomadnetwork/serving/content-source` | `{ path: string }`                                            | `{ ok, serving }` — set watched folder (site root or pages dir); required before start; restarts host if running   |
| GET    | `/api/v1/nomadnetwork/serving/pages`          |                                                               | `{ ok, pages: [] }` — My Pages lists these read-only; edit pages on disk in the watched folder                     |
| PUT    | `/api/v1/nomadnetwork/serving/pages`          | `{ path, content }`                                           | `{ ok }` — sidecar-only; not exposed in the My Pages UI                                                            |
| DELETE | `/api/v1/nomadnetwork/serving/pages?path=…`   |                                                               | `{ ok }` — sidecar-only; not exposed in the My Pages UI                                                            |
| GET    | `/api/v1/nomadnetwork/serving/page?path=…`    |                                                               | `{ ok, path, content }`                                                                                            |
| GET    | `/api/v1/nomadnetwork/serving/files`          |                                                               | `{ ok, files: [] }` — My Pages lists these read-only                                                               |
| PUT    | `/api/v1/nomadnetwork/serving/files`          | `{ path, content_base64 }`                                    | `{ ok }` — sidecar-only; not exposed in the My Pages UI                                                            |
| DELETE | `/api/v1/nomadnetwork/serving/files?path=…`   |                                                               | `{ ok }` — sidecar-only; not exposed in the My Pages UI                                                            |

Auto-restore order when the live stack comes up: load `nomad_serving_content_source` → if `nomad_serving_enabled` and a content source is set, start hosting → start FS watcher on `pages/` (and `files/` when that directory exists). If enabled without a content source, set `last_error=content_source_required` and do not start. Other failures keep `enabled=true` with `running=false` and `last_error` set; logs use the `[nomad-serving]` tag.

### RRC (Reticulum Relay Chat)

Multi-hub sessions are keyed by lowercase 32-hex `hub_dest_hash`. Soft cap: **8** simultaneous hubs. Nick / room / body lengths are capped at the API boundary.

| Method | Path                        | Body / notes                                                       | Response                          |
| ------ | --------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| GET    | `/api/v1/rrc/hubs`          |                                                                    | `{ hubs: RrcHubInfo[] }`          |
| POST   | `/api/v1/rrc/hubs`          | `{ dest_hash, label?, favorited? }`                                | `{ ok, hub? }`                    |
| POST   | `/api/v1/rrc/hubs/favorite` | `{ dest_hash, favorited }` — `dest_hash` must be exact 32 hex      | `{ ok }`                          |
| POST   | `/api/v1/rrc/connect`       | `{ dest_hash, nickname? }`                                         | `{ ok }` / `{ ok: false, error }` |
| POST   | `/api/v1/rrc/disconnect`    | `{ dest_hash? }` — omit/empty tears down every hub                 | `{ ok }`                          |
| GET    | `/api/v1/rrc/status`        |                                                                    | `{ sessions: [], identity_hash }` |
| POST   | `/api/v1/rrc/join`          | `{ hub_dest_hash, room, key? }`                                    | `{ ok }`                          |
| POST   | `/api/v1/rrc/part`          | `{ hub_dest_hash, room }`                                          | `{ ok }`                          |
| POST   | `/api/v1/rrc/send`          | `{ hub_dest_hash, room?, body, type?, dst_hash? }`                 | `{ ok }`                          |
| POST   | `/api/v1/rrc/nick`          | `{ nickname, hub_dest_hash? }` — omit hub applies to every session | `{ ok }`                          |
| GET    | `/api/v1/rrc/rooms`         | `?hub_dest_hash=` optional                                         | `{ rooms: [] }`                   |

Typed renderer wrappers: `electronAPI.reticulum.rrc.*` (`listHubs`, `upsertHub`, `setFavorite`, `connect`, `disconnect`, `getStatus`, `join`, `part`, `send`, `setNickname`, `getRooms`).

### Remote — rnsh (shell) and rncp (file transfer)

Stock Reticulum utility clients hosted by the sidecar. Paths are filesystem paths only (never file bytes in JSON). Electron gates `rncp.send` / `rncp.fetch` / `rncp.listener` mutations behind picker-allowlisted IPC (`electronAPI.reticulum.rncp.*`).

| Method | Path                             | Body / notes                                                                        | Response                                                                                         |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/api/v1/rnsh/connect`           | `{ destination_hash }`                                                              | `{ ok, session_id?, identity_hash?, fingerprint?, error? }`                                      |
| POST   | `/api/v1/rnsh/input`             | `{ session_id, data, encoding? }` — `encoding: "base64"` optional                   | `{ ok, error? }`                                                                                 |
| POST   | `/api/v1/rnsh/resize`            | `{ session_id, rows?, cols? }`                                                      | `{ ok, error? }`                                                                                 |
| POST   | `/api/v1/rnsh/disconnect`        | `{ session_id }`                                                                    | `{ ok, error? }`                                                                                 |
| GET    | `/api/v1/rnsh/status`            |                                                                                     | `{ sessions: [] }`                                                                               |
| POST   | `/api/v1/rncp/send`              | `{ destination_hash, path }`                                                        | `{ ok, transfer_id?, error? }`                                                                   |
| POST   | `/api/v1/rncp/fetch`             | `{ destination_hash, remote_path, save_path? }`                                     | `{ ok, transfer_id?, error? }`                                                                   |
| POST   | `/api/v1/rncp/cancel`            | `{ transfer_id }`                                                                   | `{ ok, error? }`                                                                                 |
| POST   | `/api/v1/rncp/accept`            | `{ transfer_id }`                                                                   | `{ ok, … }` / `{ ok: false, error }`                                                             |
| POST   | `/api/v1/rncp/reject`            | `{ transfer_id }`                                                                   | `{ ok, error? }`                                                                                 |
| GET    | `/api/v1/rncp/status`            |                                                                                     | `{ transfers: [] }`                                                                              |
| POST   | `/api/v1/rncp/announce`          | `{}`                                                                                | `{ ok }` / `{ ok: false, error: "listener_not_enabled" }`                                        |
| GET    | `/api/v1/rncp/listener`          |                                                                                     | `{ enabled, destination_hash?, inbound_mode, allowed, blocked }`                                 |
| POST   | `/api/v1/rncp/listener`          | `{ enabled, save_dir?, allow_fetch?, fetch_jail?, overwrite?, allowed?, blocked? }` | `{ ok, error? }`                                                                                 |
| POST   | `/api/v1/remote/path-capability` | `{ destination_hash }`                                                              | `PathCapability` JSON (`speed`, `via_atoms`, `transfer_allowed`, `shell_allowed`, `reason_key?`) |
| GET    | `/api/v1/remote/identity`        |                                                                                     | `{ identity_hash, rncp_receive_hash? }`                                                          |

WS event types (in addition to the list below): `rnsh.stdout`, `rnsh.stderr`, `rnsh.status`, `rnsh.closed`, `rnsh.error`, `rncp.offer`, `rncp.progress`, `rncp.completed`, `rncp.failed`, `rncp.cancelled`. Payloads always include `session_id` or `transfer_id`.

Caps (local policy): max **8** shells, max **3** concurrent transfers, default **25 MiB** file size; LoRa/BLE-only destinations refuse transfers (`path_constrained`) before opening a link.

Listener persistence: a successful `POST /api/v1/rncp/listener` stores the config (`rncp_listener_*` keys in `mesh_client_stack.json`); the live stack restores the listener on start, so the inbound mode survives sidecar/app restarts. `enabled: false` persists only the flag and keeps the last dir/policy fields.

### System

| Method | Path                           | Body / notes        | Response                                                                                                                                                                                                                                                             |
| ------ | ------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/diagnostics`          |                     | Reticulum-native health snapshot — includes `announce_ws` coalesce pressure (`last_window_ingress` / `unique` / `overflow`, `last_storm_at_ms`, `last_flush_at_ms`). Renderer Diagnostics emits `reticulum/announce-bus-pressure` when lag/storm/overflow is recent. |
| POST   | `/api/v1/system/factory-reset` |                     | `{ ok }` — Electron UI must call `electronAPI.reticulum.factoryReset` (generic `proxyPost` blocks this path)                                                                                                                                                         |
| GET    | `/api/v1/voice/status`         |                     | LXST stub status                                                                                                                                                                                                                                                     |
| GET    | `/api/v1/games/status`         |                     | LRGP stub status                                                                                                                                                                                                                                                     |
| GET    | `/api/v1/identities`           |                     | `{ identities: […] }` — slots under `config/identities/<id>/` + `active_identity`; working key remains `config/identity`; flat identity migrates to `identities/default/`                                                                                            |
| POST   | `/api/v1/identities`           | `{ display_name? }` | `{ ok, id, identity }` or `{ ok: false, error }` — `rns-stack` only; stage slot → apply working key → commit pointer last (rollback on failure). Cap 16 slots. Errors: `identity_slot_limit_reached`, `display_name_*`. Emits restart.                               |
| POST   | `/api/v1/identities/switch`    | `{ identity_id }`   | `{ ok }` or `{ ok: false, error }` — stash, install target → working, reconcile, then commit pointer. Errors: `identity_slot_not_configured`, `identity_not_found`                                                                                                   |
| POST   | `/api/v1/identities/delete`    | `{ identity_id }`   | `{ ok }` or `{ ok: false, error }` — refuses `cannot_delete_active_identity` / `cannot_delete_last_identity`                                                                                                                                                         |

## WebSocket

`GET /ws` — server push JSON text frames:

```json
{ "type": "lxmf_message", "payload": { ... } }
```

Event types: `lxmf_message`, `lxmf_outbound_status`, `events_lagged` (WS subscriber skipped N broadcast frames — client should `GET /api/v1/lxmf/recent`), `announce.received`, `peers_updated`, `path_medium_preference` (global preference changed; payload `{ preference }`), `stats_update`, `interface.state`, `stack_restart_requested`, `propagation_sync`, `propagation.discovered` (heard `lxmf.propagation` announce), `resource.received`, `rmap.discovery` (payload `{ discovered: RmapDiscoveredWireRow[] }`), `nomadnetwork.node` (Nomad peer announce heard), `nomad.serving_start` / `nomad.serving_stop` (local hosting lifecycle; payload includes `destination_hash` / `display_name` on start — renderer currently polls serving status via HTTP), RRC: `rrc.hub`, `rrc.connected`, `rrc.disconnected`, `rrc.room.joined`, `rrc.room.parted`, `rrc.message`, `rrc.error`, plus Remote: `rnsh.stdout` / `rnsh.stderr` / `rnsh.status` / `rnsh.closed` / `rnsh.error`, `rncp.offer` / `rncp.progress` / `rncp.completed` / `rncp.failed` / `rncp.cancelled`.

**Note:** Live `wire_packet` frames are **not** pushed on `/ws` (they starved critical `lxmf_message` events on large meshes). Sniffer/Stats poll `GET /api/v1/packets` while those panels are mounted. PacketTap rows still feed the sidecar packet log and LXMF egress evidence.

- **`rrc.disconnected`:** payload `{ hub_dest_hash, reason, will_reconnect? }`. When `will_reconnect` is `false` (or `reason` is `local_disconnect`), the renderer drops that hub session. When `true` (or omitted on older sidecars), the UI shows reconnecting and keeps volatile rooms until WELCOME.

- **`lxmf_outbound_status`:** authoritative outbound delivery updates. Payload: `{ message_hash, status, delivery_method?, to_hash?, sent_via? }` where `status` is `delivered`, `failed`, or intermediate `sending` (egress upgrade or Direct→PN fallback). mesh-client maps `delivered` → UI Completes (`acked`) and persists `delivery_status` (+ `delivery_method` when present) to SQLite; Propagated Completes show **Stored at propagation node**; `failed` → Failed. Do **not** treat `/api/v1/lxmf/send` response `delivery_status` (`queued`/`sending`) as terminal. After Direct failure with a preferred remote PN, the sidecar re-queues once as Propagated and emits `sending` + `delivery_method: "propagated"` before a final `delivered`/`failed`.
- **`announce.received`:** coalesced WS notify for LXMF identity announces / path responses (named or nameless). Sidecar applies identity-key + display-name cache updates immediately, but emits **at most one** WS frame per coalesce window (500ms normal / 1000ms when >256 distinct destinations are pending) so announce storms stay O(1) bus pressure on large meshes (~100k). Payload is either a single `{ destination_hash, display_name?, hops, aspect?, identity_hash? }` (legacy / one-row flush) or `{ announces: [{ destination_hash, display_name?, hops, aspect?, identity_hash? }, ...] }` (capped at 1024, named preferred; overflow dropped — slow peer poll recovers). `aspect` is set when announce `name_hash` maps to a known app name (`lxmf.delivery`, `lxmf.propagation`, `nomadnetwork.node`, `rrc.hub`); omitted for path responses / unknown hashes (clients must not invent `"unknown"`). `identity_hash` is the hex identity recovered from the validated announce when present. Each flush publishes pressure counters under `GET /api/v1/diagnostics` → `announce_ws` (ingress/unique/overflow + storm/flush timestamps) for the Diagnostics `reticulum/announce-bus-pressure` warning. Display names update the peer-label cache only — announces do **not** auto-create LXMF contacts. That cache is overlayed onto `GET /api/v1/peers` / topology rows **and** onto nameless/hash-prefix rows from `GET /api/v1/contacts` (`list_contacts` may persist those fills) so path-table and contact refreshes keep announce aliases.
- **`peers_updated`:** also emitted when the live path table **gains** new destination hashes (maintenance tick). Payload may include `{ added: string[], patches: PeerRow[], count }` (added/patches capped at 1024). Renderer applies patches incrementally, including route-field changes. A full peer dump is used on connect, manual Refresh, restart, safety poll, or a `peers_updated` payload that cannot be applied incrementally: `cleared`, `demoted_from_contacts`, or a single-`hash` probe/path event. Hop/timestamp-only churn does not emit.

`lxmf_message` payload fields include `sender_hash`, `text`, `timestamp`, `message_hash`, optional `direction` (`inbound` / `outbound`), optional `delivery_status` (`sending` on optimistic outbound rows), optional `reply_to_hash` / `reply_preview_text` (from LXMF `FIELD_REPLY_TO` / `FIELD_REPLY_QUOTE`), and transport markers `received_via` / `sent_via`. Outbound `sent_via` is **path-table / PacketTap evidence**, not “any local RNode enabled”: atomic values are `rf`, `ble`, `tcp`, or `network`; multi-egress observes join with `+` (e.g. `rf+tcp`, `ble+network`). Inbound `received_via` uses the path-table interface name **matched to local interface config** (same atoms — so a TCP hub named “RNS Testnet” is `tcp`, not `network`). Never use Meshtastic-style `both` for Reticulum.

`lxmf_outbound_status` payload: `message_hash`, `status` (`delivered` / `failed` / `sending`), optional `delivery_method`, optional `sent_via` (egress evidence upgrade before Completes).

## Electron bridge

Renderer calls `electronAPI.reticulum.*`; main process proxies to this API (sandboxed renderer cannot reach localhost directly). Lifecycle / proxy / Remote / factory-reset handlers live in `src/main/ipc/reticulum-handlers.ts`. Reticulum destination / Remote address / inbound-policy DB handlers are in `src/main/ipc/reticulum-db-handlers.ts`; RRC room history uses `src/main/ipc/rrc-db-handlers.ts`.

| IPC channel                                                        | Role                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `reticulum:start` / `stop` / `getStatus`                           | Sidecar lifecycle                                                                                            |
| `reticulum:syncInterfaceIssueScope`                                | Drop TCP/TX latch entries for disabled/removed interfaces; sticky enabled-name filter for later log lines    |
| `reticulum:proxyGet` / `proxyPost` / `proxyPut` / `proxyDelete`    | HTTP proxy to paths above                                                                                    |
| `reticulum:factoryReset`                                           | Factory reset (generic `proxyPost` blocks `/api/v1/system/factory-reset`; UI must use this channel)          |
| `reticulum:validateConfig`                                         | One-shot `validate-config --json` against `userData/reticulum/config` (read-only; safe while stack runs)     |
| `reticulum:readDefaultConfigFile`                                  | Read first existing system rnsd config path                                                                  |
| `reticulum:showConfigImportDialog`                                 | Native file picker for config import                                                                         |
| `reticulum:showIdentityImportDialog`                               | Native file picker for 64-byte private key (`.retid`, `.key`, …)                                             |
| `reticulum:showNomadContentSourceDialog`                           | Native folder picker for Nomad My Pages content source (site root or `pages/` dir); records picker allowlist |
| `reticulum:setNomadContentSource`                                  | Apply Nomad watched content source; path must match last folder-picker result (blocks arbitrary proxyPut)    |
| `reticulum:rncpSend` / `rncpFetch` / `setRncpListener`             | Picker-gated rncp send/fetch/listener (path must match `reticulum-remote-paths` allowlist)                   |
| `reticulum:showRncpOpenFileDialog` / `showRncpSaveDirectoryDialog` | Native pickers that seed the rncp send-file / save-dir+fetch-jail allowlists                                 |
| `reticulum:revealInFolder`                                         | Reveal a path in the OS file manager when it matches an rncp picker allowlist                                |
| `reticulum:onEvent` / `onStatus`                                   | WS events and sidecar status                                                                                 |

`getStatus` / `onStatus` may include `interfaceIssueAlert` (TCP connect failures, TX queue drops, link-delivery timeouts, transport saturation / slow queries, **`bleBondRemoved`** stale RNode bonds, **`blePairingTimedOut`** OS passkey / TX-read timeouts). Per-entry latch timestamps use a **5-minute** stale window (`RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS`). Connection syncs **enabled** interface names via `syncInterfaceIssueScope` so disabling or removing an interface clears that name immediately and rejects re-latch from lagging log lines. Stopping the stack (or unexpected process exit) clears the tracker.

**`propagation_sync` WebSocket payload:** `{ active: boolean, progress: number, message: string | null }`. Progress uses 0–100 (Establishing ≈10, Offering ≈25, …, Complete ≈100). Sticky success after HaveAll emits `active:false, progress:100`; cancel/stall/failure emit `active:false, progress:0` (and must not emit a trailing 100). Sync `POST /api/v1/propagation/sync` may return `PROPAGATION_IDENTITY_UNKNOWN`, `PROPAGATION_TARGET_NOT_PN`, `PROPAGATION_PEERING_STAMP_FAILED`, `PROPAGATION_PEER_COST_EXCEEDS_MAX`, or `LOCAL_PROPAGATION_SYNC_UNSUPPORTED`. Add may return `PROPAGATION_OFFER_UNSUPPORTED` / probe timeout failures.

SQLite chat history uses separate `db:*` handlers (`getReticulumMessages`, `saveReticulumMessage`, `searchReticulumMessages`, `deleteReticulumMessage`, destination upserts), not sidecar HTTP. Remote saved addresses / inbound policy and RRC room history also use dedicated `db:*` handlers (not sidecar HTTP).

| IPC channel                                                           | Reticulum maintenance behavior                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `db:pruneReticulumDestinationsByCount`                                | Prunes excess non-favorited destinations by oldest `last_heard`; favorites are preserved.    |
| `db:deleteReticulumDestinationsByAge`                                 | Deletes non-favorited destinations before a calculated Unix-**seconds** `last_heard` cutoff. |
| `db:pruneReticulumIdentityActivityByAge`                              | Deletes identity-activity rows before an epoch-**milliseconds** `last_seen` cutoff.          |
| `db:upsertReticulumIdentityActivityBatch`                             | Validates and upserts at most **500** activity rows per call.                                |
| `db:listReticulumRemoteAddresses` / upsert / delete                   | Saved Remote (rnsh/rncp) addresses.                                                          |
| `db:listReticulumInboundPolicy` / upsert / delete                     | Per-identity inbound allow/block policy for rncp.                                            |
| `db:listRrcMessages` / `insertRrcMessage` / `deleteRrcMessagesByRoom` | Persist / clear RRC room history (`rrc_messages`).                                           |
| `db:pruneRrcMessagesByCount` / `db:pruneRrcMessagesByAge`             | RRC retention (default enabled, 10,000 count / 30-day age).                                  |

Reticulum startup maintenance runs the destination age/count prune, Reticulum message retention, and RRC message retention independently. `VACUUM` runs only after the Reticulum startup prune, never on the six-hour session tick.
