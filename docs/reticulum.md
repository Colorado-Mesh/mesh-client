# Reticulum in mesh-client

Tracking: [#593](https://github.com/Colorado-Mesh/mesh-client/issues/593)

mesh-client ships Reticulum as a **third protocol tab** (amber chrome). The stack is an **AGPL Rust sidecar** (`mesh-client-reticulum`) spawned by Electron main; the MIT renderer talks to it through `electronAPI.reticulum` (HTTP/WS proxy). Chat history and contacts persist in the main-process SQLite database.

**Primary interop target:** [Ratspeak](https://github.com/ratspeak/Ratspeak) peers on rsReticulum/rsLXMF.

## Architecture

```mermaid
flowchart TB
  subgraph ui [Renderer MIT]
    App[App.tsx]
    RT[useReticulumRuntime]
    Stack[ReticulumStackPanel]
    Radio[ReticulumRadioPanel]
    Admin[ReticulumAdminPanel]
    App --> RT
    App --> Stack
    App --> Radio
    App --> Admin
  end
  subgraph main [Electron main MIT]
    IPC[reticulum:* IPC]
    DB[(SQLite reticulum_* tables)]
    IPC --> DB
  end
  subgraph rust [Sidecar AGPL]
    Daemon[mesh-client-reticulum]
    StackH[StackHandle + optional LiveBridge]
    Daemon --> StackH
  end
  RT <-->|electronAPI| IPC
  IPC <-->|localhost| Daemon
```

## User flow

1. **Reticulum → Connection** (`ReticulumStackPanel`): click **Start stack** (or enable **Auto-start** for next visit). **Stop stack** shuts down the sidecar without quitting the app; **Disconnect & quit** stops the sidecar (when running) and exits mesh-client.
2. **Reticulum → Radio** (`ReticulumRadioPanel`): create or import identity; add/edit/delete/enable interfaces; import or export rnsd-style config; adjust stack settings and announce interval; manage peers and propagation.
3. **Reticulum → Admin** (`ReticulumAdminPanel`): RNode firmware flasher and stack factory reset (danger zone).
4. **Chat:** DM-only LXMF text, reactions, file attachments, and voice clips (recorded as LXMF attachments).

**Diagnostics tab** shows Reticulum-native interface/path/LXMF health (not Meshtastic Hop Goblins). **Topology tab** builds a best-effort graph from the RNS path table: each row supplies one immediate next-hop (`via_hash`, a transport relay id that may differ from a hub’s destination hash). The sidecar infers `self → relay` links when a relay is only referenced as `via`. Layout uses BFS over edges with a `hops` fallback when a node is not reachable from `self`. This is not a full multi-hop trace—RNS exposes only the next hop per destination. Sidebar **Peers** tab ([`ReticulumPeerListPanel`](src/renderer/components/ReticulumPeerListPanel.tsx)) lists network path-table peers and LXMF contacts in separate sub-tabs.

## Panels

| Tab (sidebar) | Component                | Purpose                                                                                             |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| Connection    | `ReticulumStackPanel`    | Stack start/stop, auto-start, disconnect & quit, connection status                                  |
| Nomad Network | `NomadNetworkPanel`      | Favourites / Announces list, search, favourite toggle (MeshChat-style)                              |
| Peers         | `ReticulumPeerListPanel` | Network path-table peers and LXMF contacts (sub-tabs); path/probe; opens `ReticulumPeerDetailModal` |
| Radio         | `ReticulumRadioPanel`    | Identity, interfaces, stack settings, announce controls, peer summary, propagation, config import   |
| Admin         | `ReticulumAdminPanel`    | RNode firmware flasher; stack factory reset (danger zone)                                           |

## Interface management (Radio tab)

Interfaces are stored in the sidecar rnsd config under Electron `userData/reticulum/config/`. The Radio tab **Interfaces** section supports:

| Action           | UI                                                            | Sidecar API                      |
| ---------------- | ------------------------------------------------------------- | -------------------------------- |
| Add              | Type selector (TCP / Auto / RNode) + form + **Add interface** | `POST /api/v1/interfaces`        |
| Edit             | **Edit** on a row → inline form                               | `PUT /api/v1/interfaces/{id}`    |
| Enable / disable | Per-row toggle                                                | `POST …/enable` or `…/disable`   |
| Delete           | **Delete** + confirmation modal                               | `DELETE /api/v1/interfaces/{id}` |

**Edit fields by type:**

- **All:** display name
- **TCP:** host, port
- **RNode:** serial port (enumerated when available), LoRa preset, callsign
- **Auto:** name only (minimal discovery interface)

For bulk changes or migrating from Ratspeak/rsReticulum, use **Config import** (merge or replace) on the Radio tab, or paste from a file picked via the system config paths below.

## Stack settings and announces (Radio tab)

**Stack settings** (`enable_transport`, `share_instance`, `loglevel`) are saved via `PUT /api/v1/stack/settings`. The UI merge-reads current settings so `announce_interval_sec` is preserved when saving transport/log options.

**Announce controls** ([`ReticulumAnnounceControls`](src/renderer/components/ReticulumAnnounceControls.tsx)): set announce interval (`announce_interval_sec`, 0–86400) and **Clear announces** (`DELETE /api/v1/announces`). With the **stub** sidecar, clear announces empties the persisted peer cache. With **`rns-stack`**, the live path table may repopulate on the next refresh until RNS path-table clear is wired.

## RNode firmware flasher (Admin tab)

The **Reticulum → Admin** tab lists **RNode Firmware Flasher** as a collapsible section (visible before the stack starts). It uses the renderer **Web Serial API** to:

1. Flash nRF52 devices (DFU touch + zip manifest) or ESP32 devices (`esptool-js`).
2. **Provision** EEPROM on new hardware (device info, MD5 checksum, lock byte).
3. **Set firmware hash** after each flash (reads hash from device).
4. Optional advanced tools: Bluetooth, TNC mode, display read/rotation, EEPROM wipe.

**Serial port contention:** stop the Reticulum stack (or disable the active RNode interface) before flashing—the sidecar holds the serial port when an RNode interface is enabled. Disconnect Meshtastic or MeshCore USB serial on the same device.

Firmware `.zip` files are selected locally (in-app GitHub download is deferred).

## Peers and sidecar storage

- **`GET /api/v1/peers`**: with **`rns-stack`**, returns the live RNS path table (including empty); the sidecar updates its in-memory cache on each successful fetch. On fetch failure, the last cached peers are returned. With the **stub** stack, peers come from persisted state.
- **Your node is not listed as a peer:** the path table contains routes to **remote** destinations only. Your LXMF hash appears under **Radio → Identity**; the topology graph uses a synthetic **You** center node. The `interface` column on a peer row means “path learned via this interface,” not “peers attached to this serial port.”
- **Stub storage file:** `userData/reticulum/storage/mesh_client_stack.json` — identity (including mnemonic in plaintext for backup UX), stub peers, and local LXMF message cache. Treat this file as sensitive.

## LXMF outbound delivery (Chat DMs)

With **`rns-stack`**, `POST /api/v1/lxmf/send` chooses delivery method from the path table:

| Destination in path table?                | Delivery method                               | UI                                                                        |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Yes                                       | **Direct** (LinkDeliveryManager)              | RF/TCP/NET badge while sending; **Delivered** after link completion       |
| No, preferred propagation node configured | **Propagated** (handoff to PN)                | **PN** badge, “Queued at propagation node” until sidecar reports delivery |
| No, no propagation node                   | `{ ok: false, error: "no_propagation_node" }` | Toast prompts user to set a preferred propagation node on the Radio tab   |

The chat UI keeps outbound messages in **Sending** until the sidecar emits `lxmf_outbound_status` (`delivered` / `failed`). This follows Reticulum’s async LXMF model—no TCP-style “connection refused” when a contact is offline; configure a propagation node for store-and-forward instead.

## LXMF attachments and voice clips

- **Send:** Chat composer paperclip (files) or mic button (voice clip, max ~60 s) on Reticulum DMs. Outbound uses `POST /api/v1/lxmf/resource` with `FIELD_FILE_ATTACHMENTS` on the live stack.
- **Receive:** Inbound attachments are cached under `userData/reticulum/attachments/`; chat shows playback for audio and **Save attachment** / **Show in folder** actions.
- **Realtime voice calls (LXST/Codec2):** not in scope; the Radio tab no longer shows a voice-call stub.

## Propagation nodes

- **Preferred node:** offline DMs route to the preferred propagation node when the destination is not in the path table.
- **Sync:** Per-node **Sync messages** on the Radio tab; progress via `propagation_sync` WebSocket events (also surfaced in Chat while syncing).
- **Local inbox:** Enable **Local propagation (offline inbox)** on the Radio tab to serve as a propagation node (`rns-stack`); stats show queued count and storage used.
- **Add remote node:** Paste a 32-character destination hash in the propagation section to add a known MeshChat/Ratspeak propagation node.

## Building the sidecar

### Stub (CI / no siblings)

```bash
cd reticulum-sidecar && cargo test && cargo build
```

Uses a file-backed local stack (full API surface for dev/UI).

### Full rsReticulum stack (dev)

Sibling layout (same as Ratspeak):

```
parent/
  rsReticulum/          # git clone https://github.com/ratspeak/rsReticulum
  rsLXMF/               # git clone https://github.com/ratspeak/rsLXMF
  mesh-client/
    reticulum-sidecar/
```

```bash
pnpm run reticulum:sidecar:build -- --features rns-stack
# or: cd reticulum-sidecar && cargo build --features rns-stack
```

Optional: `rns-serial`, `rns-ble` features for RNode and BLE peering.

CI builds both **stub** and **`rns-stack`** matrix jobs on linux x64, macOS arm64, and Windows x64/arm64 (see `.github/workflows/reticulum-sidecar.yaml`). Each job runs `cargo test` before release build.

## IPC contract

See [reticulum-sidecar-ipc.md](reticulum-sidecar-ipc.md). Renderer must not call localhost directly (sandbox). Main-process proxy paths must start with `/api/v1/`.

## SQLite

- `reticulum_destinations` — contact rows (hash, display name, favorited).
- `reticulum_messages` — LXMF chat history (`message_hash`, `reply_to_hash` for threads/reactions).

## Config import

Default system paths (main process reads; renderer imports via sidecar):

| Platform      | Paths                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| macOS / Linux | `~/.reticulum/config`, `~/.config/rsReticulum/config`, `~/.rsReticulum/config` |
| Windows       | `%APPDATA%\Reticulum\config`, `%APPDATA%\rsReticulum\config`                   |

The sidecar stores the active config under Electron `userData/reticulum/config/` (rnsd INI format).

## Out of scope / in progress

- **LXST voice** and **LRGP games**: API status endpoints exist; full rsLXST/lrgp-rs integration is tracked separately.
- **Hardware identity (YubiKey/PIV)**: not yet wired.
- **Interface hot-reload** under `rns-stack`: CRUD updates config on disk; restart the stack for live RNS to pick up changes.
- **Meshtastic/MeshCore RF paths**: ConnectionDriver, MQTT hybrid, channel config, Rooms BBS, Hop Goblins diagnostics.
