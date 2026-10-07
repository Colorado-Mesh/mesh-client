# Reticulum troubleshooting

AGPL Rust sidecar (`mesh-client-reticulum`), interfaces, LXMF, RRC, and RNode Wi‑Fi. For general connection, log analysis, and bug-report help, see [Troubleshooting](troubleshooting.md). See also [reticulum.md](reticulum.md) and [Reticulum sidecar IPC](reticulum-sidecar-ipc.md).

## RRC connect stuck / Cancel

**Symptoms**: Hub stays on **Connecting…** / **Awaiting welcome**; Cancel appears in the RRC header.

**Cause**: Path discovery, Link handshake, and WELCOME can take up to the proxy timeout (~60 s). A previous connect may still be aborting.

**What to do**:

1. Click **Cancel** — renderer sets disconnect intent and calls `POST /api/v1/rrc/disconnect` for that hub hash so the in-flight connect is aborted.
2. Confirm the destination hash is 32 hex and the stack has a path (Peers / Topology).
3. Retry connect; check sidecar logs for `rrc` timeouts (`path lookup`, `link proof`, `WELCOME`).

## RRC hub dropped vs Disconnect

**Symptoms**: Hub shows **Reconnecting…** with an error, rooms still listed; or the hub disappears after you clicked Disconnect. Coming back after idle may also show a fresh `room …: registered` NOTICE and `/who` member list even though the laptop did not sleep and the hub process stayed up.

**Cause (idle flaps):** RRC session lifetime is the RNS Link. Initiator keepalive/stale (RTT-scaled; on a fast TCP path this can be ~5s keepalive / ~10s stale) tears the Link when keepalive echoes miss — Wi‑Fi power save, brief NAT stalls, or a pinned next-hop iface that died while another path to the hub still works. Sidecar then emits `rrc.disconnected` with `will_reconnect: true`, re-HELLO/JOINs, and the client re-arms `/who`. Log `reason=` values: `timeout` (keepalive/stale), `transport_error` (iface/endpoint terminal), `remote_close` (hub closed Link). A historical `resource_offers_closed` label was usually a raced real `Closed` reason (fixed in `rrc_link`).

**What to do**:

1. **Unintended drop** (`will_reconnect: true`): sidecar retries with backoff (~2–30 s), DropPath+RequestPath on timeout/transport/remote close so the next Link can attach on a live interface, preserves desired rooms (including join keys), and rejoins after WELCOME. Wait for **Active** or check `rrc.error` / link-close reasons in the log (`[useReticulumRuntime] rrc.disconnected … reason=`).
2. **Explicit Disconnect / Cancel** (`local_disconnect` or `will_reconnect: false`): that hub session is removed from the UI. Reconnect manually or rely on hub auto-join when the stack starts.
3. Failed initial connect also clears the hub slot so it cannot exhaust the 8-session cap.
4. If flaps are frequent on multi-iface stacks, check Connection → Interfaces for Auto/TCP competition and prefer a stable path to the hub.

## RRC false self-PART / hubParted banner

**Symptoms**: Busy rooms show repeated “Left the room (hub parted you)” / self leave when other members part; or an involuntary hub PART looks like a kick/ban.

**Cause**: Older logic treated member-fanout `PARTED` as self-leave. Sidecar now classifies actor-facing self PARTED vs other-member fanout (`parted_concerns_self`); involuntary self-PART while the room is still desired queues silent rejoin and the UI uses neutral `rrc.moderation.hubParted` (not kick/ban copy).

**What to do**: Upgrade / restart the sidecar. If the banner appears after a true hub PART, re-join the room (or wait for auto-rejoin when still desired). Kick/ban wording is reserved for moderation notice paths only.

## RRC history shows fewer messages than Retention

**Symptoms**: App → Retention keeps **10,000** RRC messages, but opening a room only shows ~**500**.

**Cause**: Per-room UI hydrate caps at `RRC_ROOM_HISTORY_LOAD_COUNT` (**500**) via `rrcRoomHistory.ts`. SQLite may still hold up to the retention count; older rows are not all loaded into the session store.

**What to do**: This is expected. Retention prune (`db:pruneRrcMessagesByCount` / age) controls disk; the 500 cap is a session/UI hydrate limit, not a wipe.

## Reticulum sidecar won't start or health poll times out

**Symptoms**: Connection tab **Start stack** fails; logs show `[ReticulumSidecar]` health poll timeout; `reticulum:getStatus` reports `lastError`. Identity **Generate** / **Import** errors with `Reticulum sidecar is not running`.

**Health vs live ready:** Electron health only requires `GET /api/v1/status` → `status: "ok"` (HTTP listening). That is **not** the same as `rns_ready` / `lxmf_ready` (true only after live RNS/LXMF attach). A green/configured Connection after Start means the API is up + identity known; Chat LXMF and RRC may still need a few seconds for live attach. Diagnostics may show `reticulum/rns-not-ready` / `reticulum/lxmf-not-ready` briefly — see [requires live right after start](#reticulum-rrclxmf-requires-live-rns-stack-right-after-start).

**Checks**:

0. **Identity wizard**: click **Start stack** at the top of the Reticulum Connection panel before generating or importing a mnemonic. The sidecar must be running for `reticulum:proxyGet` / `proxyPost` identity routes.
1. **Dev — binary missing**: build once from repo root: `pnpm run reticulum:sidecar:build` (requires [Rust](https://rustup.rs/); see [development-environment.md](development-environment.md#reticulum-sidecar-optional)). Electron **Start stack** can auto-run `cargo build` on first click, but you need `cargo` on `PATH`. Error text `sidecar binary not found` means `reticulum-sidecar/target/debug/mesh-client-reticulum` does not exist yet.
2. **Dev — run / health**: `pnpm run reticulum:sidecar:dev` or confirm `curl http://127.0.0.1:19437/api/v1/status` after **Start stack** (`status` should be `ok`; `rns_ready`/`lxmf_ready` may still be `false` for a short window).
3. **Packaged app — sidecar missing from installer**: older Electron releases (before CI bundled the sidecar) ship without `mesh-client-reticulum` under `resources/reticulum-sidecar/`; the UI shows a message about a missing bundled sidecar — **upgrade to a newer release** (or use Flatpak on Linux). WoA needs the **arm64** installer (`Mesh-client-Setup-{version}-arm64.exe`) with an **arm64** sidecar inside, not the x64 binary.
4. **Packaged app — verify install**: confirm `mesh-client-reticulum` (or `.exe` on Windows) exists under the app resources (`reticulum-sidecar/` beside the executable).
5. **macOS Gatekeeper**: unsigned local sidecar builds may need `xattr -cr` on the binary or ad-hoc signing for dev.
6. **Port conflict**: sidecar picks an ephemeral port; stale processes under `~/Library/Application Support/mesh-client/reticulum/` are rare — quit the app fully and retry.

Keep Rust current with `pnpm run update` (runs `rustup update` and rebuilds the sidecar when `cargo` is available).

## Reticulum RRC/LXMF requires live rns-stack right after start

**Symptoms**: For the first few seconds after **Start stack**, Chat DM send/reaction or RRC hub connect fails with `lxmf send requires live rns-stack sidecar`, `lxmf reaction requires live rns-stack sidecar`, or `rrc connect requires live rns-stack sidecar` (humanized toasts). Connection may already show **configured**.

**Cause**: Listen-first startup — HTTP is up (`status: ok`) and the UI marks configured when identity is known, but `attach_live` has not finished. LXMF/RRC fail closed until the live bridge is ready. RRC auto-connect retries about every **500 ms** while hubs are pending and wakes on the configured event.

**What to do**: Wait a few seconds and retry (or let RRC auto-join settle). If errors persist after `rns_ready`/`lxmf_ready` are true in `/api/v1/status`, treat as a real stack failure (restart stack; check logs).

## Reticulum Cancel then Connect stuck on START_ABORTED

**Symptoms**: Click **Cancel** during **Start stack** (especially while cargo is building), then **Connect** / **Start** again; UI or logs show `RETICULUM_SIDECAR_START_ABORTED` and the stack never comes up.

**Cause (fixed):** Older builds rejoined the aborted start promise. Current builds set an abort flag and return from **Cancel** without waiting on cargo/BLE; the next **start** waits for the doomed promise to clear, then starts fresh. Cancel during cargo does not tear down Meshtastic/MeshCore GATT; LoRa BLE uses `ensureForBle()` independently of Reticulum UI Start.

**What to do**: Upgrade to a build with listen-first Cancel fix. If you still see `START_ABORTED` after Cancel+Connect on a current build, quit the app fully and **Start stack** once.

## Reticulum sidecar cargo build fails (`register_packet_tap` / `RETICULUM_CARGO_BUILD_FAILED`)

**Symptoms**: **Start stack** fails; logs show `RETICULUM_CARGO_BUILD_FAILED` or Rust errors such as `method not found in ReticulumHandle`, `register_packet_tap`, or `PacketTapEvent`. Electron may surface `RETICULUM_RNS_PATCH_MISSING` after upgrading mesh-client.

**Cause**: Full-stack (`rns-stack`) dev builds call `register_packet_tap` in the sidecar, but that API lives in a local rsReticulum overlay ([`reticulum-sidecar/patches/rsReticulum-packet-tap.patch`](../reticulum-sidecar/patches/rsReticulum-packet-tap.patch)) until [ratspeak/rsReticulum#10](https://github.com/ratspeak/rsReticulum/pull/10) merges. CI applies overlays via `clone-ratspeak-stack.sh`; a `.rsstack/rsReticulum` checkout without the overlay fails to compile.

**Fix** (canonical recover path):

1. From mesh-client repo root, re-float the `.rsstack/` workspace and re-apply overlays:
   ```bash
   ./scripts/clone-ratspeak-stack.sh
   pnpm run reticulum:sidecar:build
   ```
   `clone-ratspeak-stack.sh` floats `rsReticulum` / `rsLXMF` / `rsNomad` to `origin/main` (override with `RS_*_REF` for bisect) and fails if an overlay will not apply.
2. If the `.rsstack/` checkouts already exist and you only need overlays: `./scripts/ensure-rsReticulum-patches.sh` then `pnpm run reticulum:sidecar:build`.
3. **Manual apply** (single overlay):
   ```bash
   git -C .rsstack/rsReticulum apply ../../reticulum-sidecar/patches/rsReticulum-packet-tap.patch
   pnpm run reticulum:sidecar:build
   ```
4. On **newer rsReticulum** checkouts that already include the auto-beacon utun fix upstream, only the packet-tap patch is required — `apply-rsReticulum-auto-beacon-utun.sh` is a no-op.

Quit mesh-client fully, reopen, and click **Start stack** again.

## Reticulum AutoInterface log spam on macOS (VPN utun / ENOBUFS)

**Symptoms**: Log panel floods with `[ReticulumSidecar] auto: beacon TX failed` on `utun0`, `utun4`, or similar every ~1.6 s. Error text may include `No buffer space available (os error 55)`. Diagnostics may show an **AutoInterface beacon** info row for VPN tunnel interfaces.

**Cause**: Reticulum **AutoInterface** discovers link-local IPv6 on macOS VPN tunnel interfaces (`utun*`). Those interfaces often cannot transmit IPv6 multicast beacons, so the sidecar retries indefinitely and fills `mesh-client.log`.

**Fix**:

1. **Update mesh-client** to a build that includes the rsReticulum overlay `rsReticulum-auto-beacon-utun.patch` (skips `utun*` during enumeration and backs off repeated TX failures).
2. **Dev rebuild**: from repo root, prefer the canonical recover path, then rebuild:
   ```bash
   ./scripts/clone-ratspeak-stack.sh
   pnpm run reticulum:sidecar:build
   ```
   Or apply individual overlays (`./scripts/apply-rsReticulum-packet-tap.sh`, `./scripts/apply-rsReticulum-auto-beacon-utun.sh`, `./scripts/apply-rsReticulum-link-client-proof-budget.sh`, …) then `pnpm run reticulum:sidecar:build`.
3. **Workaround on old builds**: disable **AutoInterface** under Connection → Interfaces if LAN discovery is not needed (TCP/RNode paths still work).
4. **Physical NIC failures** (`en0`, `wlan0`, …): restart the stack; check firewall/multicast permissions — that indicates real LAN discovery failure, not VPN noise.
5. **Local DMs hang with Auto + LAN TCP hub** — see [Reticulum local DMs hang with AutoInterface + private TCP hub](#reticulum-local-dms-hang-with-autointerface--private-tcp-hub).

Log path: `~/Library/Application Support/mesh-client/mesh-client.log` (macOS).

## Reticulum local DMs hang with AutoInterface + private TCP hub

**Symptoms**: LXMF Direct to a LAN peer stalls on **Sending** (or takes minutes) while **AutoInterface** is enabled and a **private** TCP/UDP hub is also up (e.g. local transport at `192.168.x.x`). Disabling Auto and restarting the stack makes the same DMs work over the hub (`received_via` / path interface shows TCP). Announce flood is not required to reproduce.

**Cause**: AutoInterface peers are normal Reticulum **0-hop** neighbors. Transport prefers fewest hops; Auto and TCP are both `network` medium. A fresher Auto path can stay **active** even when a private hub path to the same peer is also 0-hop (equal-hop tie / learn order). If that Auto link is unhealthy (multicast, carrier, beacon issues), Direct waits on Auto while the private hub path sits unused as a backup. A 0-hop path **to the hub itself** does not mean Direct already chose the hub for the peer.

**Automatic recovery** (mesh-client sidecar):

1. **Health preempt** — If Auto looks degraded for delivery (beacon/carrier/status) and a live **private** path exists (RFC1918 / IPv6 ULA or link-local / `.local` TCP/UDP), suppress Auto and open Direct on that private path before waiting out a full Auto link hang.
2. **Failure failover** — If Direct still fails or times out on Auto, exhaust backups **private non-Auto → public hubs → preferred PN** (does not preempt healthy Auto to the internet).

Healthy Auto is left preferred (RNS default). Public hubs are never chosen by the health preempt.

**Manual workaround**: Connection → Interfaces → disable **Auto** → restart stack if prompted. Keep the private hub up; confirm it is not `ECONNREFUSED` in the log (`hostLink` TCP probe).

## Reticulum public hub TCP blocked (fast-flapping client)

**Symptoms**: A public TCP hub (e.g. **Ratspeak**, **RMAP World**) shows **down** in Connection → Interfaces. The amber Connection banner says **TCP hub unreachable** (the remote instance may be offline **or blocking connections**, including after frequent app/stack restarts) or, after five stack starts in 12 hours, **hub likely blocked your IP after frequent stack restarts**. Sidecar logs may show `TCP read: EOF`, `Connection reset by peer`, and `reconnecting in 5s name = …` in a loop. A host TCP probe can still succeed while the RNS session is rejected.

**Cause**: Reticulum **1.4.0+** `BackboneInterface` listeners block client IPs that **fast-flap** — by default, **five TCP sessions shorter than ~20 seconds within 12 hours** triggers a **12-hour IP block** ([Interfaces manual](https://reticulum.network/manual/interfaces.html)). Hubs upgraded to 1.4.0 (RMAP World mid-2025; Ratspeak more recently) enforce this policy. Common mesh-client triggers:

- **Quick mesh-client or stack restarts** — each restart drops the RNS TCP session; if the hub saw a short session, it counts as one flap.
- **Share instance / duplicate Reticulum apps** — competing sessions connect and drop.
- **Reconnect or auto-recovery loops** — repeated stack restarts while the hub is already rejecting make it worse.

mesh-client counts **stack starts** (persisted across app restarts), not sidecar log timestamps and not whether each run lasted under 20 seconds. Testers who restart the client often still hit the notice. After five stack starts in 12 hours it shows the lockout banner, hides **Restart stack** on that alert, and skips auto stack restart. Host TCP probes run only before the sidecar is ready.

**What to do**:

1. **Stop restarting** the app or stack — more restarts add flaps and extend the block.
2. Connection → Interfaces → **disable** the affected hub temporarily.
3. Fully quit mesh-client and any other Reticulum apps (MeshChatX, Ratspeak, standalone `rnsd`) if **Share instance** is enabled.
4. **Wait up to 12 hours** before re-enabling the hub (matches default hub `fast_flapping_block_time`).
5. If you need connectivity sooner, use a different network path (another hub, LAN transport, or RF) — the block is per **source IP**, not identity.

## Reticulum DM shows "Stored at propagation node" but the reply never arrives (PN island / preferred mismatch)

**Symptoms**: A propagated DM Completes as **Stored at propagation node** on the sender, and the sender's periodic **Propagation sync** also Completes, yet the reply never lands in Chat. Direct (path-based) DMs between the same two apps work; only store-and-forward replies go missing. Often seen when two peers each prefer a **different** PN (e.g. one on `0e972735…`, the other syncing `11111111…`), or when an external app (Sideband, Columba, Retichat) reports "single checkmark / parked at PN".

**Cause**: "Stored at PN" only means the message was deposited on the **sender's** chosen deposit node. The recipient only receives it if they **sync (or peer) that same PN island**. If the recipient's Preferred / sync target is a different PN, and those PNs are not peered/replicating, a successful sync on the recipient's node retrieves nothing for that deposit. Sync **Completing ≠ retrieving that specific deposit**. Shared, enabled backup PNs (e.g. both have `deadbeef` enabled) do **not** help when the cascade already succeeded on the first preferred remote and stopped there.

**Diagnose**:

1. On both sides, note the **Preferred** PN hash in **Network → Propagation nodes** (and mode: Off / Auto / Manual). For external apps, ask the peer for **their** preferred/inbox PN hash.
2. In a **Developer** support bundle: `debug-snapshot.json` → `propagationClient` shows each side's `mode`, `preferredId`, `resolvedSyncTargetId`, `autoTarget`, and `lastSyncError`; `reticulum/lxmf-outbound.log` shows `propagation-deposit … pn_hash=… cascade_step=… delivery_method=…` (the **actual deposit island**) and `propagation-retrieve` lines for what sync pulled.
3. Compare the sender's deposit `pn_hash` against the recipient's `resolvedSyncTargetId`. A mismatch with non-peered PNs is the island gap.

**Fix**: Put both peers on a **shared** propagation node (same Preferred hash, or PNs known to peer/replicate), or switch mode to **Auto** so each side tracks the best commonly-reachable PN. When testing against external apps, record their preferred PN hash and align it with mesh-client's Preferred.

**Repro matrix** (sender deposit island vs recipient sync target):

| Sender Preferred     | Recipient sync target | PNs peered? | Reply retrieved?      |
| -------------------- | --------------------- | ----------- | --------------------- |
| `0e972735…`          | `11111111…`           | no          | **No** (island gap)   |
| `0e972735…`          | `11111111…`           | yes         | Yes (peers replicate) |
| `deadbeef…` (shared) | `deadbeef…` (shared)  | n/a         | Yes (same island)     |
| `0e972735…`          | `0e972735…`           | n/a         | Yes (same node)       |

Force the propagated path (peer offline / Direct disabled) and compare the sender's `propagation-deposit … pn_hash` against the recipient's `propagation-retrieve` / `propagationClient.resolvedSyncTargetId` in a Developer bundle to confirm which row applies.

## Reticulum Nomad Network or topology API returns 404

**Symptoms**: Device log shows `sidecar GET /api/v1/nomadnetwork/nodes failed: 404` or `/api/v1/topology` **404** while the sidecar process is running. Nomad Network tab may show **API unavailable**.

**Cause**: The running `mesh-client-reticulum` binary is **older than** the Rust sources in `reticulum-sidecar/` (routes were added after the binary was built). Dev auto-build only ran when the binary was missing, or you have not rebuilt since pulling.

**Fix**:

1. From repo root: `pnpm run reticulum:sidecar:build`
2. Quit mesh-client fully, reopen, **Connection → Start stack**
3. Confirm with `curl` against the sidecar port from logs: `/api/v1/nomadnetwork/nodes` and `/api/v1/topology` return JSON 200

In dev, **Start stack** now rebuilds when `reticulum-sidecar/src/**/*.rs` or `Cargo.toml` is newer than the debug binary.

## Nomad My Pages hosting enabled but not serving

**Symptoms**: After relaunch, **Nomad Network → My Pages** shows no green **Serving to network** chip even though you left serving on; or Start serving fails after choosing a folder. Status may show `last_error` such as `content_source_required` / `content_source_unavailable` / `invalid_content_source`.

**Cause**: Hosting requires a watched folder. The remembered content folder is missing, moved, or invalid (neither `pages/` nor `.mu` files), serving was enabled without a content source, or auto-restore failed after the Reticulum stack came up. Preference `nomad_serving_enabled` may stay true so hosting can retry once the folder is fixed.

**Fix**:

1. Open **My Pages**, click **Choose folder**, and select the site root (directory with `pages/`) or the `pages/` directory.
2. Click **Start serving** if it did not auto-resume (Start stays disabled until a folder is chosen).
3. Check **Log → Analyze** (Reticulum protocol) for **Nomad Page Hosting Issues** (`[nomad-serving]` / `[NomadHosting]`), or **Export for GitHub** — those lines are in `mesh-client.log`.

## Nomad page that used to show my name is now generic (or "not allowed")

**Symptoms**: A Nomad page that used to greet you by name, show your account, or let you in now shows a generic version, asks you to log in, or returns the node's "not allowed" page.

**Cause**: mesh-client now browses Nomad nodes **anonymously by default**. Earlier builds sent your Reticulum identity to every node; now a node only receives it if you turn on identification for that node.

**Fix**:

1. Open the node and click the **fingerprint** button in the browser toolbar, then confirm. The page reloads with your identity.
2. To stop later, click the fingerprint button again or the **Identifying** badge in the node list. This only affects future connections — the node keeps any identity it already received.

**Hosting your own page restricted with Access?** Self-preview (**Open in browser** in My Pages) ignores `.allowed` lists, so test restrictions from another node. An `.allowed` file with no valid 32-character hashes blocks everyone.

## Nomad Network pages hang or almost never load

**Symptoms**: Most Nomad pages spin for a long time then fail; a few nearby nodes load quickly. UI shows humanized errors (via `nomadPageErrorHumanize.ts`) instead of raw sidecar codes when recognized.

**Humanized error categories** (sidecar code → user message):

| Sidecar code            | Meaning                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path_timeout`          | No route to the node (path lookup timed out)                                                                                                                                                                                                    |
| `pubkey_not_found`      | Destination identity key not cached yet — wait for a Nomad announce                                                                                                                                                                             |
| `link_timeout`          | Link could not be established in time (UI may say path OK vs stale)                                                                                                                                                                             |
| `response_timeout`      | Link opened but page payload did not arrive in time                                                                                                                                                                                             |
| `missing_identity_hash` | No remembered identity for the node yet                                                                                                                                                                                                         |
| `network_not_ready`     | No usable path/interface yet — wait for hub/path or restart stack                                                                                                                                                                               |
| `nomad_not_serving`     | Remote node is not serving Nomad pages                                                                                                                                                                                                          |
| `invalid_url`           | Malformed Nomad page/file URL                                                                                                                                                                                                                   |
| `transport_unavailable` | Reticulum transport unavailable — restart stack                                                                                                                                                                                                 |
| `sidecar_not_running`   | Sidecar not running — start stack from Connection                                                                                                                                                                                               |
| `response_too_large`    | Remote response exceeded the sidecar size cap                                                                                                                                                                                                   |
| `nomad_busy`            | Another Nomad page/file query still holds the link lock, or a page navigation preempted an in-flight query. In-page `/media` images queue (do not cancel each other); rebuild sidecar if multiple images fail with this code on an older build. |

Unrecognized codes pass through unchanged.

**Images reload every revisit:** Page/image LRUs are **in-memory only** (lost on Close viewer, Clear caches, or app restart). `/media` blobs larger than **2 MiB base64** (~1.5 MiB binary) are shown once but never stored — see [reticulum.md § Nomad browser caches](reticulum.md#nomad-browser-caches).

TCP/network Nomad Links use path-scaled initiator hops (`link_hops = clamp(path_hops, 3, 7)`) and a LinkClient proof wait of the **remaining overall MeshChat deadline** (~45s TCP after instant pubkey recall), matching v5.25.0. Do not cap LRPROOF at hops×6 or a 30s floor — that false-failed multi-hop hub pages that still load on release. First attempts use a cached path when present (no DropPath storm); missing paths RequestPath briefly and may return `path_timeout`. On TCP `link_timeout`, the sidecar suppresses the dead iface, drops the failed via, promotes ranked path-slot backups / other live hubs (extra RequestPath when another TCP/RF iface is up), then retries inside the same fetch. LXMF Direct chat uses the same path exhaustion before the **multi-PN cascade**. `force_path_ok=true` means rediscovered after absence only (cache hits log `force_path_ok=false`). Failure logs (`[nomadNetworkStore] … fetch failed` and sidecar `Nomad Link query failed`) include `path_hops`, `link_hops`, `proof_budget_secs`, `force_path_ok`, `path_ensure_kind`, `elapsed_ms`, `tried_interfaces`, `failover_rounds`, `iface`, and `raw=`. UI errors distinguish cached-path vs rediscovered-path link failures.

**Cause**: Older `LinkClient` always waited for a fresh path-response announce for the destination public key, even when Nomad announces had already cached it. Successful fetches could also deregister all `nomadnetwork.node` announce handlers. Distant/high-hop nodes can still time out at the path stage (expected RF/mesh reachability limits).

**Fix**:

1. Ensure `.rsstack/rsReticulum` is on floated `origin/main` — handler-free `resolve_destination_on_transport` in `crates/rns-runtime/src/link_client.rs` supersedes the retired `rsReticulum-link-client-nomad` overlay (see [patches/README.md](../reticulum-sidecar/patches/README.md)).
2. Rebuild sidecar: `pnpm run reticulum:sidecar:build`, restart stack.
3. Prefer low-hop nodes while testing; hop count is shown in the Nomad list.
4. Match the humanized message to the table above — `path_timeout` / high hops often mean RF reachability limits, not a mesh-client bug.
5. For TCP `link_timeout`, check log fields `tried_interfaces` / `failover_rounds` / `iface` first (primary signal after path failover), then `path_hops` / `link_hops` / `proof_budget_secs` / `raw=` — UI hop counts can lag the path table; trust `path_hops`. Persistent fails after the full proof budget usually mean the peer/hub did not return LRPROOF.

## Reticulum sidecar stops during dev (Vite HMR)

**Symptoms**: After saving a file in `pnpm run dev`, many `[ReticulumIPC] proxyGet failed: Reticulum sidecar is not running` lines appear; Nomad Network / Network (propagation, identity) panels fail until you restart the stack.

**Cause**: Hot module reload remounted the Reticulum runtime, which previously called `reticulum:stop` on every unmount.

**Fix**: Current dev builds **preserve** the sidecar across HMR remounts. If you still see this on an older build, click **Start stack** again on Connection. Explicit **Disconnect** / app quit still stops the sidecar.

## Reticulum `proxyGet` fetch failed / many `[ReticulumIPC] start` lines

**Symptoms**: Device log or devtools shows `Error occurred in handler for 'reticulum:proxyGet': TypeError: fetch failed`, often in bursts of three or more at once. The app log may also show dozens of `[ReticulumIPC] start` entries within a few seconds while Nomad/Network/Peers panels stay empty or stale.

**Cause**: Overlapping sidecar start attempts restart the process before its HTTP server is ready (start/reconnect storm). Panels keep calling `proxyGet` against a dead or stale localhost port during the churn.

**Fix**: Current builds serialize sidecar start in the main process and suppress autostart/reconnect feedback loops during an in-flight start. If you still see this: disable **Autostart stack** on Connection, click **Start stack** once, wait up to ~30s for the health poll, then reopen other Reticulum tabs.

## Reticulum announce interval resets after saving stack settings

**Symptoms**: You set an announce interval on the Network tab, then saved **Stack settings** (transport / log level) and the interval returned to **0**.

**Cause**: Older sidecars treated `PUT /api/v1/stack/settings` as a full replace. A partial JSON body omitted `announce_interval_sec`, which deserialized as **0**.

**Fix**: Current builds merge omitted fields on the sidecar under a config lock. Clients should PUT only the fields they intend to change. `GET /api/v1/stack/settings` and missing keys in rnsd config default to **3600** s (1 h) after bootstrap migration — a value of **0** in the UI means an explicit setting.

## Clear announces does not empty the Peers tab under rns-stack

**Symptoms**: **Clear announces** on Network succeeds but peers reappear after refresh.

**Cause**: With the full **`rns-stack`** build, `DELETE /api/v1/announces` clears the stub cache only; the live RNS path table repopulates on the next `GET /api/v1/peers`.

**Workaround**: Expect peers to return while connected to a live network; use the stub sidecar for offline UI testing of an empty peer list.

## Reticulum identity hash mismatch (stub vs live stack)

**Symptoms**: UI shows a configured identity hash that does not match Ratspeak/rsReticulum on disk, or LXMF peers cannot reach you.

**Cause**: The stub stack can mark identity configured in `mesh_client_stack.json` before `config/identity` exists; the live bridge may spawn a fresh RNS identity until the identity file is written.

**Fix**: Generate or import identity with the stack running; restart the stack after identity changes. Compare `GET /api/v1/identity/status` with your Ratspeak identity file.

## Reticulum `.rsi` / raw identity backup restore fails

**Symptoms**: Importing a Ratspeak `.rsi` fails with an incorrect PIN message, or raw identity file import rejects the file.

**Cause / fix**:

1. **`.rsi` PIN** — use the same PIN (≥6 characters) chosen at export; wrong PIN or a tampered vault fails closed. Raw identity export also requires this PIN gate on the sidecar API.
2. **mesh-client.identity.v1** — metadata-only backups are no longer supported; re-export from a current build (`.rsi` or raw 64-byte identity).
3. **Private key text vs file picker** — the Network panel textarea accepts **hex / base64 / URL-safe base64 / base32** text. `reticulum:showIdentityImportDialog` accepts only a **raw binary 64-byte** identity file (not a text file of hex/base64).
4. **Oversized `.rsi`** — import is size-capped; use a normal Ratspeak/mesh-client backup, not an unrelated huge JSON dump.

## Reticulum Map empty or no markers

**Symptoms**: Map tab shows empty state, sidebar list only, or no markers despite peers on the Peers tab.

1. **Stack not running** — start the stack from Connection; Map ingest requires live `rns-stack`.
2. **No discovery announces heard yet** — only interfaces with `discoverable=yes` appear. Wait for transport propagation; stack identity re-announce default is **3600 s (1 h)** when unset (RMAP publish interval remains separate; see Network → RMAP controls).
3. **LoRa without TCP hub** — Diagnostics / config audit may show `rmap_no_tcp_hub`. Enable `rmap.world:4242` or another TCP hub and restart the stack.
4. **Missing GPS in announce** — nodes without latitude/longitude appear in the list panel only (no map marker).
5. **Global coverage** — the in-app map shows **heard** opt-in nodes only; use **Global map** (rmap.world) for worldwide view.
6. **`discover_interfaces`** — sidecar enables `discover_interfaces = Yes` on bootstrap; restart the stack after upgrading if the Map tab stays empty on an old config.
7. **Stub sidecar** — dev builds without `rns-stack` return an empty discovered list.
8. **Filter empty** — interface-type filter pills may exclude all rows; try **All**.
9. **Refresh errors** — transient sidecar errors show inline `refreshFailed` without clearing last-good markers.
10. **No publish-capable interface** — Auto and outbound TCP client types cannot publish RMAP discovery. Eligible types are RNode / KISS / AX.25 KISS (with serial), I2P, and Backbone (requires `reachable_on`). UDP, pipe, BLE peer, and RNode Multi are not advertizable by rsReticulum.
11. **Partial publishing (amber X of Y)** — Connection shows **publishing X of Y** in amber when some but not all eligible interfaces have `discoverable=yes`. TCP hubs never count toward Y. Use Network → **Publish on RMAP v4** (check again while indeterminate) or per-interface **RMAP** toggles on Connection to sync the rest.

## Reticulum BLE RNode blocks Meshtastic/MeshCore BLE

**Symptoms**: Reticulum stack is running with an enabled BLE RNode; Meshtastic or MeshCore BLE scan/connect fails with `scan_busy` / “Bluetooth scan in progress (reticulum)” or `mac_conflict`.

**Cause**: The app checks BLE device ownership and serializes app-requested scans and LoRa connection setup. A conflicting configured address or active scan can block Connect. LoRa GATT and Reticulum run in the same sidecar process with separate centrals; Reticulum's autonomous discovery/reconnect does not use the app's scan lease. The inverse is also normal: RNode Signal meter advertisement polls may see `scan_busy (gatt)` while Meshtastic/MeshCore GATT connect holds the scan mutex — that is expected contention (logged at debug), not a stuck lease; meters already seeded from connect-time `host_rssi` skip those polls.

**Fix**:

1. Wait for the Reticulum BLE scan/connect to finish, then retry Meshtastic/MeshCore Connect.
2. Stop the Reticulum stack or disable the BLE RNode if you need exclusive LoRa BLE access.
3. Check Device logs for `[BleCoexistence]` / `[GATT]` and sidecar `scan_busy` / `mac_conflict` codes.
4. Ensure Meshtastic/MeshCore and the RNode use **different** Bluetooth addresses.

## Reticulum BLE RNode pairing fails (wrong PIN / no PIN on display / not in macOS list)

**Symptoms**: BLE RNode stays offline; logs show `peripheral.connect() ok` then `[pair] TX read err` / `BLE pairing in progress` / `BLE pairing timed out`; Connection may show a pairing-timed-out sidecar alert. The RNode does not appear under System Settings → Bluetooth. Admin **Start pairing** does not put a code on the radio display.

**Cause**: RNode generates a **new** 6-digit PIN each pairing — there is **no** default. Users sometimes enter **123456** (Meshtastic’s fixed default). Admin **Start pairing** shows the PIN in the **Admin Bluetooth panel over USB** (radio display often stays blank). Discovery uses the sidecar BLE scan (`ble://…`), not the macOS Settings device list. The OS passkey dialog appears when the stack triggers SMP (TX-char read).

**Fix**:

1. Stop the stack (or disable the BLE RNode) so reconnect does not thrash while you prepare.
2. Forget any half-paired RNode in System Settings → Bluetooth.
3. Get a real PIN: USB → Admin → Bluetooth → **Start pairing** (watch the **Admin panel**, not the radio screen), **or** ~7 s button hold on display boards for an on-screen PIN.
4. Start the stack **once**, enter that PIN in the OS dialog within ~60 seconds — never `123456`.
5. The device may only show as Paired in System Settings **after** a successful bond.
6. For repeated offline BLE interfaces, **remove the interface and add it back** (**Pick device**) to refresh the stored Bluetooth address before retrying pairing.

## Reticulum BLE RNode bond is stale (OS still shows Paired)

**Symptoms**: Connection / Diagnostics show a BLE bond-stale banner for an RNode interface; Connect fails; System Settings still lists the device as Paired.

**Cause**: Sidecar latched `interfaceIssueAlert.bleBondRemoved` (“Peer removed pairing information”). The OS bond no longer matches the radio.

**Fix**:

1. Forget the RNode in System Settings → Bluetooth (macOS will not clear Paired automatically).
2. Prefer USB serial or Wi‑Fi (`tcp://`) when possible to avoid BLE bonds.
3. On Admin → Bluetooth: **Clear paired devices** (USB `CMD_BT_UNPAIR`, ESP32) if available, then **Start pairing**. Connection issue banners also link to Admin Bluetooth.
4. **Remove and re-add** the BLE interface (**Pick device**) so the saved `ble://` id refreshes.
5. Restart the Reticulum stack and enter the new 6-digit PIN when prompted.

Bond-stale **TX queue full** hints (`txQueueDropsHintBleBondStale`) point at the same Forget / Clear paired / Start pairing path. Sidecar overlay `rsReticulum-ble-rnode-bond-desync` stops BLE reconnect until stack restart when bond removal is detected — see [reticulum-sidecar/patches/README.md](../reticulum-sidecar/patches/README.md). `bleBondRemoved` stays sticky until stack stop / interface remove (not only the generic 5‑minute log latch).

## Reticulum LXMF duplicate Sending / orphaned pending rows

**Symptoms**: Chat shows a stuck `reticulum-pending-*` Sending row beside the real LXMF hash row after send completes.

**Cause**: Optimistic pending id was not deleted when the sidecar assigned `message_hash`.

**Fix**: Upgrade to a build that passes `replaces_message_hash` on SQLite upsert (`db:saveReticulumMessage` deletes the prior pending hash atomically). Restarting the app also marks stale `sending` rows failed on startup.

**Symptoms**: LXMF `[file:…:image/…]` bubble shows the filename label but no inline image.

**Cause / checks**: File missing from `userData/reticulum/attachments/`, SVG/unsupported MIME, path outside the jail, magic-byte mismatch, IPC rate limit, or read failure (UI falls back to label only).

**Fix**: Confirm the attachment was cached inbound, that the MIME is a supported raster type (not SVG), and retry after scrolling away and back. Check Device logs for `chat:readReticulumAttachmentAsDataUrl`.

## Reticulum remote propagation sync fails or never completes

**Symptoms**: **Sync messages** stays Establishing, fails with “not an LXMF propagation node”, “no link proof”, “no network path”, or marks Complete incorrectly after cancel.

**Cause / behavior**:

- User Sync is **client `/get`-primary** (inbox into Chat). Peer `/offer` inventory push is Host peer-loop only when serving.
- **No path yet** → `PROPAGATION_PATH_UNKNOWN` (hard-fail after announce settle; UI `syncPathUnknown`) — not a 45s Establishing stall. Wait for a path / **Announce now**, retry.
- Remote sync needs a known identity. Missing identity → `PROPAGATION_IDENTITY_UNKNOWN`.
- Destinations that announce as delivery/other (including TCP hubs) → `PROPAGATION_TARGET_NOT_PN`. Add a destination that announces `lxmf.propagation`.
- Establishing with **no LRPROOF** often means the PN lacks a reverse path to your LXMF identity. Sync always sends an LXMF delivery announce and waits ~10s before Linking; if that still stalls, use the Propagation recovery callout (**Announce now**, wait, **Retry Sync**), or Network → **Announce now** and retry. Auto stops cascading other remotes after this class of establish failure (client reverse-path). Dual enabled TCP backbones can cause announce/Link asymmetry — try one backbone.
- Soft-defer `PROPAGATION_RETRIEVE_BUSY` means Host silent `/get` or another retrieve owns the client — wait or Cancel; Cancel must call rsLXMF `abort_transfer` or the next Sync stays busy.
- Auto keeps picking a bad Discovered PN → **Ignore for Auto** on that row (Manual Prefer/Sync still works).
- HaveAll / Complete is success (not failure). Cancel or Establishing stall (~45s) must not advance “last synced”.
- Transfer-phase hangs use a renderer hard ceiling (~180s) plus lxmf-core’s own timeouts.
- Auto/Manual **Sync** runs a multi-step cascade that waits for each attempt to settle (terminal WS frame or stall/ceiling). Failed remotes are omitted for ~15 minutes; the remote half of a cascade is capped (~5 min budget, ~60s per remote attempt) before falling through to local-prop. Soft defer `PROPAGATION_SYNC_OUTBOUND_BUSY` / `PROPAGATION_RETRIEVE_BUSY` / `PROPAGATION_STACK_NOT_LIVE` does **not** start that backoff — the next tick may retry the same node.
- Auto-sync interval counts from the last _successful_ sync; failed attempts only apply a short cooldown (~2 min). Nothing-to-sync (`syncNoTarget` / local messagestore still loading / retrieve busy) is not treated as a full remote success.

**Fix**: Prefer a discovered `lxmf.propagation` node, wait for an announce/path, retry **Sync** (or **Announce now** then Sync), and check Device logs for `propagation-retrieve` (`retrieve_mode=get`) and path-gate `PROPAGATION_PATH_UNKNOWN`. Peer `/offer` errors under `propagation-sync` apply to Host peer loop, not the Sync button. If Add fails with **offer unsupported**, the destination does not speak LXMF `/offer`. If Sync/Add fails with **peering cost exceeds max**, raise **Network → Advanced PN hosting → Max peering cost**.

## Reticulum local PN hosting not discoverable

**Symptoms**: Local Host propagation node is enabled but peers never hear your PN announce / cannot `/offer` or `/get`.

**Cause**: Hosting requires a live stack with identity signing key; enable starts `lxmf.propagation` LinkManager + announce loop (Resource deposit ingress + stamp validation into the local store, `/offer` admission, outbound peer inventory sync when idle, auto inbox drain into Chat, and sequenced post-peer `/get` after host `/offer` Completes).

**Fix**: Confirm sidecar is running, identity is configured, **Network → Propagation → Host propagation node** is Enabled, and check logs for `[propagation-serve]` / `[propagation-announce]` / `[propagation-deposit]` / auto-drain / `get_post_peer` / `get_periodic`. Tune announce interval under **Advanced PN hosting**. Peers depositing to your host should see your `lxmf.propagation` hash; bad stamps are rejected and logged under `propagation-deposit`.

## Reticulum: Stored at PN but Sync leaves Chat empty

**Symptoms**: Sender shows **Stored at propagation node** (Propagated Completes). Recipient runs **Sync messages** (progress reaches Complete / HaveAll) but the DM never appears in Chat. Preferred PN hashes may differ between the two clients.

**Cause (any-node model)**: LXMF does **not** require both parties to prefer the same PN. Deposit on PN A and retrieve via Sync from PN B is valid when autopeer/static peering moves inventory. Empty Chat after Sync is usually a fabric/retrieve/ingest gap (mail never reached the synced node, stamp/admission drop on a host PN, or inbound ring not catch-up’d into Chat) — not “wrong preferred PN.”

**Progress bar = client `/get` retrieval.** User Sync against a remote PN drives the progress bar from the **client `/get` download** (inbox mail into Chat). Peer `/offer` inventory replication runs on the **local Host peer loop** when you are serving a PN — not on the Sync button — so a nonempty messagestore cannot hang Sync at AwaitingResponse against remotes that are not your peers. Look for `propagation-retrieve` `/get` Completes in Device logs for retrieve counts.

**Host PN auto Chat path:** With **Host propagation node** enabled, mail that lands in the local store via peer Resource ingress should appear in Chat via **auto-drain** (`local-prop inbox auto-drain Completes`, `retrieve_mode=local`) without pressing Sync on local-prop. After your host peer `/offer` Completes to a peered remote, a **silent** client `/get` to that peer may also run (`retrieve_mode=get_post_peer`, no Sync UI bar). While Host is on and quiet, a **~90s** periodic silent `/get` (`retrieve_mode=get_periodic`) revisits Prefer/peered remotes for inbox catch-up — this is not a 2s poll and does not re-`/offer` an unchanged store. Host peer `/offer` re-runs when the local messagestore generation advances (or after a failed/partial sync), with lxmd-style peer Idle bookkeeping. Explicit Sync remains `/get`-primary (Prefer / cascade).

**Do not** tell users they must share the same preferred PN. Prefer log correlation instead:

1. Sender Device log: `propagation-deposit` with `message_hash`, `transient_id`, `pn_hash` (deposit Completes).
2. Recipient log (the real retrieval): `propagation-retrieve … retrieve_mode=get|get_post_peer|get_periodic pn_hash=… listed=N downloaded=N delivered=N` (the client `/get` download; `listed=0` is a valid empty-inbox success). Per-message `propagation-retrieve` with matching `message_hash` / `transient_id` fires as each downloaded message hits the delivery callback. Host auto-drain / `local-prop` Sync logs `retrieve_mode=local`. The peer-offer side logs `propagation-sync … peer_outcome=have_all|transfer` — that is **not** retrieval.
3. Renderer: `[catchUpRecentInboundLxmf] … reason=propagation_sync` or `propagation-retrieve catch-up after sync Completes count=N` (`count=0 (empty ring)` means Sync Completes with no new inbound for Chat).
4. Confirm remote Sync Completes and that Host PN (if used) shows `[propagation-deposit] local PN accepted stamped propagated blob` plus auto-drain / post-peer / periodic retrieve lines when expecting Chat without a manual Sync.

**Fix**: Retry Sync after path/announce settle; if using local Host, confirm ingress + auto-drain / silent `/get` (`get_post_peer` / `get_periodic`) logs and peer sync ticks (`local host queued outbound peer inventory sync`). Export developer bundles from both sides and `rg 'propagation-deposit|propagation-retrieve'`.

## Reticulum PN hosting policy apply fails

**Symptoms**: Saving **Network → Advanced PN hosting** (peering cost, storage limits, static peers, announce interval) fails or reverts; Device log shows hosting-policy errors.

**Cause / checks**:

- Sidecar rejected the policy (`peering_cost_exceeds_max`, `stamp_flex_exceeds_cost`, range limits, or invalid 32-hex static peer). The renderer now validates the same rules before PUT; failure surfaces via the panel error path.
- Stack/identity not ready (hosting apply needs a live sidecar). BLE/USB hubs themselves are unrelated — policy is local lxmf-core config, but the stack must be running to persist it.
- Invalid `node_name` (control characters or longer than 128 characters).

**Fix**: Fix the invalid field (keep peering cost ≤ max; stamp flex ≤ stamp cost; static peers as lowercase 32-hex). Confirm Reticulum stack is **running**, then re-apply. Check logs for `[reticulumPropagationStore] hosting policy` / sidecar `hosting-policy` responses.

## Reticulum last synced time looks wrong after update

**Symptoms**: Propagation UI shows a far-future or absurdly old “last synced” time after a sidecar upgrade or clock skew.

**Cause**: `last_propagation_sync_at` comes from the sidecar as Unix seconds. A future clock (or bad stamp) was previously accepted wholesale; refresh now clamps future values to local `Date.now()`.

**Fix**: Run **Refresh** / reopen Propagation after fixing the system clock. Trigger a successful **Sync** to rewrite a sane stamp.

## MeshCore Colorado Mesh / LetsMesh won't connect after upgrade

**Symptoms**: MeshCore MQTT preset worked before upgrade; broker connection fails on port **1883** or wrong topic.

**Cause**: Colorado Mesh moved to **wss port 443** with topic **`meshcore/DEN`**; LetsMesh uses **`meshcore/test`**. Stale `mesh-client:mqttSettings:meshcore` may retain old port/topic. Malformed topic prefixes (not `meshcore/{IATA}` or `meshcore/test`) also block Connect on device-signing brokers. A **stale WebSocket path** blocks Connect too: LetsMesh / MeshMapper / Colorado use `/ws`, while Waev / Meshat.se / MeshCore.CA / EastMesh use `/mqtt` — a mismatch gives a clear "requires WebSocket path …" error plus the amber deviation banner.

**Fix**: Re-select the preset on the Connection tab (or, for MeshCore.CA/LetsMesh, click the broker/region toggle) to repair `wsPath`/`tlsEnabled`, or clear `mesh-client:mqttSettings:meshcore` in devtools Application → Local Storage and reconnect. Migrations run on app start via `connectionPanelStorageMigrations.ts` (port/topic repair + IATA shape normalize + preset reconcile).

## MeshCore Colorado Mesh one-time region prompt

**Symptoms**: After upgrade, a dialog asks whether you are in Colorado when MQTT is set to Colorado Mesh. MQTT Auto-connect is deferred until you answer.

**Cause**: Colorado Mesh is a **regional** broker. mesh-client prompts existing Colorado-preset (or Colorado host) users once so non-Colorado users can switch to **LetsMesh**. Auto-launch will not connect to Colorado until that choice is stored.

**Fix**: Choose **I am in Colorado** to keep the preset (Auto-connect resumes if enabled), or **Switch to LetsMesh**. The choice is stored in `mesh-client:coloradoMqttRegionAck-v1` and is not shown again. Selecting Colorado Mesh later shows a confirm that the preset is for Colorado-area users and publishes under `meshcore/DEN`.

## Reticulum: announces / Nomad / RRC work but Chat fails both ways

**Symptoms**: Both mesh-client instances hear announces, Nomad pages and RRC work, probes look reachable, but Chat DMs never arrive either way. Developer bundles show outbound `to_hash` values that are **not** the peer’s Network **LXMF** hash. Pasting the peer’s **identity** hash and their **LXMF** hash opens **two** Chat tabs. Diagnostics may list **Direct LXMF link … timed out** against a hash that identity activity marks as `lxst.telephony` (or against the RNS identity hash). When **MeshChatX** (or another RNS app) runs on one side, the other may briefly show **Delivered** via RF — that Complete is for MeshChatX’s LXMF identity, not mesh-client Chat. **Delivered to a MeshChatX-era favorite (e.g. `d010ea44…` / Ceorl-wired) is not delivery into a different mesh-client LXMF (e.g. `e3359f…` / Ceorl-test).** Peers may appear in the list (announce heard) while Network topology shows **no** RF edge (`hops` null / no path). Prefer **RF** is not the same as disabling TCP hubs.

**Cause**: The RNS path table lists **every** destination aspect. Opening **Peers → Message** (or a stale DM) on an `lxst.telephony` row, or pasting the peer’s **RNS identity** hash, used to send LXMF Chat to a non-`lxmf.delivery` destination. mesh-client remaps identity and telephony to the peer’s `lxmf.delivery` hash when identity activity knows it; without an LXMF announce it refuses send. A peer coming online after the other side’s hourly announce can miss the reverse LXMF path until **Announce now**. With Propagation **Off**, Direct timeout has no PN cascade. A prior link-timeout failure bridge could also leave later Sends stuck on **Sending** for the same dest until a new outbound clears that dedupe. Favoriting an older MeshChatX LXMF while the peer’s live mesh-client identity uses a new LXMF produces green **Delivered** Completes that never appear in the other app’s Chat.

**Fix / retest checklist**:

1. **Fully quit** MeshChatX / other Reticulum apps on both machines during a mesh-client ↔ mesh-client test.
2. On **Network**, confirm each side’s **LXMF** hash (not only the identity hash). Example pair: upstairs `ac978c…` ↔ downstairs `e3359f…`.
3. Both sides **Announce now**, then wait until each sees the peer’s **LXMF** row with a path (hops ≥ 0) or Probe succeeds.
4. Open Chat from Peers **Message** (or paste the peer’s 32-character **LXMF** hash — not the identity hash). The DM header shows copyable **LXMF** and **identity** prefixes — the LXMF prefix must match Network, not a MeshChatX-era favorite or a Voice-only row.
5. If Direct still fails, set Propagation to **Auto** or **Manual** with a usable PN (Propagation **Off** has no cascade after Direct timeout). Prefer RF does not disable TCP — turn TCP hubs off on Connection → Interfaces when testing RF-only.
6. Export **both** Developer bundles; check `reticulum_messages.to_hash` against `reticulum_identity_activity` (`lxmf.delivery` vs identity / `lxst.telephony`) and `reticulum/lxmf-outbound.log` for Direct Completes / Failed lines. Stuck `reticulum-pending-*` / `sending` rows after link timeouts are a client bridge bug (fixed builds clear dest dedupe on each new Send).

## Reticulum DM stuck on Sending (MeshChatX / shared instance)

**Symptoms**: Outbound Reticulum DMs stay **Sending**; Device log shows `link delivery timed out` with `link establishment timeout`, and many `failed to queue path request for LXMF delivery` lines. **Diagnostics** may list per-peer **Direct LXMF link … timed out** rows (warning). Connection may show **sidecar interface issues** only for stack health (TX queue drops, transport saturated, TCP hub failures) — not single-peer link timeouts. Sniffer may show a **Link Request** that never completes.

**Cause**: Usually **RNS transport overload**, not a missing mesh-client chat handshake. Common triggers:

1. **Shared instance conflict** — `share_instance = Yes` with another Reticulum app still running (MeshChatX, Ratspeak, standalone `rnsd`) fighting the same IPC socket. mesh-client may attach as `SharedInstanceClient` and **not spawn** local TCP hubs (Connection then shows misleading “TCP hub unreachable”).
2. **Dead TCP hub still enabled** — outbound queue fills; path requests fail with _no available capacity_.
3. **No PN cascade capacity** — when Direct fails and there are no enabled cascade candidates (preferred/other remotes or local-prop), the row fails with no store-and-forward retry. With remotes (and/or enabled local-prop), the sidecar cascades after Direct exhausts (see **Stale path + Failed via TCP** below). Developer bundles include `reticulum/lxmf-outbound.log` (filtered LXMF outbound / PN cascade lines).

**Fix**:

1. **Fully quit** other Reticulum apps (MeshChatX, Ratspeak, any `rnsd` tray process) — not just close the window — **or** turn off **Share Reticulum instance** (Connection banner / Network → stack settings) and restart the stack.
2. **Stop and restart** the mesh-client Reticulum stack (Connection → **Restart stack** or stop/start). Stopping (or an unexpected sidecar exit) clears the interface-issue tracker immediately.
3. Disable unreachable TCP interfaces on Connection → Interfaces (only when not in shared-instance client mode). Disabling or removing a hub drops that name from the TCP/TX latch **immediately** (and keeps it from reappearing while logs catch up); each latch also ages out after a **5-minute** per-entry TTL (`RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS`), not a single global timestamp.
4. Retry the DM; use **Peers → Request path / Probe** if the peer is reachable but the path is stale.
5. Configure a **propagation node** on Network → Propagation for offline delivery.

New/incomplete configs default to `share_instance = No` and `instance_name = mesh-client` so mesh-client does not attach to system `\0rns/default`. **Upgrades are not auto-migrated** when Share is already `Yes` or `instance_name` is already `default` — turn Share off (banner / Network / Diagnostics repair) and restart, or fully quit the other RNS app. Use Network → **Check config** (or `pnpm run reticulum:config:check`) to lint the on-disk INI.

Export for GitHub (`reticulum.sidecar.interfaceIssueAlert`, link-timeout counts) helps confirm transport saturation vs. a single peer outage.

## Reticulum: no propagation node configured

**Symptoms**: Chat shows a persistent amber **propagation** notice; send failures toast _No propagation node configured_; offline peers never receive LXMF.

**Cause**: Direct LXMF links require a live path. When the peer is offline or unreachable, mesh-client needs a **remote propagation node** (lxmd store-and-forward) — not a TCP transport hub.

**Fix**:

1. Open **Network → Propagation** (Chat notice **Set up propagation** jumps there).
2. Add a **32-character LXMF destination hash** from whoever runs the propagation node you trust.
3. Pick a **Propagation mode** in the same section. Fresh installs default to **Off** (no automatic Preferred, no periodic sync). **Upgrades keep any saved mode** (including legacy **Auto**). Set **Preferred** manually and use **Manual** to sync that pin (or the closest added node when none is preferred), or use **Auto** to one-time sync the best **Discovered** node by hash (**without** adding it or changing Preferred), then configured remotes, then the local inbox. Set preferred / Add & prefer stay available in Auto. See [PN island / preferred mismatch](#reticulum-dm-shows-stored-at-propagation-node-but-the-reply-never-arrives-pn-island--preferred-mismatch) if both peers use different PNs.
4. **Local propagation hosting** is a full LXMF Propagation Node (announce, admit deposits, peer `/offer` sync, client `/get`) — wire-compatible with official Python/`lxmd`. Clients **need not Prefer you**; Auto discovering your announce is enough. It is **last** in the sender’s Direct→PN cascade (`stored_locally` = deposited on your hosted node, amber house badge — not “outbox only”). Fabric delivery to peers who sync other PNs depends on **peering / PN↔PN propagation health**, not on recipients Preferring your local hash. Preferring Local still shows a warning toast (you become the Prefer pin for _your_ outbound cascade).

**Stale path + Failed via TCP:** When a path exists, mesh-client tries **Direct** first. If Direct fails, the sidecar **cascades** preferred remote → other enabled remotes (hop-sorted) → in **Auto** only, up to 3 heard-but-not-added **Discovered** PNs (hop-sorted) → local-prop last. Remote deposits Complete as `delivered` (**Stored at propagation node**); local-prop Completes as `stored_locally` (hosted on your PN; peer sync may still propagate). Prefer PN link timeouts **advance** the cascade when other candidates remain (they do not hammer the same Prefer hash until `syncTimedOut`). The renderer link-timeout Failed bridge skips while cascade capacity remains. Without any cascade candidates, the row stays **Failed**. Check developer-bundle `reticulum/lxmf-outbound.log` for cascade lines. Persistent `proxyGet`/`proxyPost` storms may hit the shared **900/min** proxy ceiling (LXMF recent catch-up uses a dedicated **120/min** bucket; renderer backs off on rate-limit errors).

**Not the same as transport:** Ratspeak TCP hubs (e.g. `rns.ratspeak.org:4242`) and [rathole](https://github.com/ratspeak/rathole) are **connectivity / transport** tools, not LXMF propagation. mesh-client does not ship a default community propagation hash.

## Reticulum: Ratspeak DMs work but mesh-client stays silent

**Symptoms**: Another Reticulum client (Ratspeak, Sideband, MeshChat, **Columba**, **Retichat**) exchanges DMs with a mobile peer after both sides announce; mesh-client shows outbound stuck **Sending** / **Queued** / **Failed**, **zero inbound**, or a Chat contact that never appears under **Peers**.

**First reply Ack’d, second shows**: After mesh-client sends a **Direct** DM, the peer’s first reply often shows **Ack** on their client but never appears in mesh-client Chat/SQLite; a second reply usually lands. That reply rides the **outbound-initiated reusable Direct link**. The sidecar must wire `LinkDeliveryManager::set_inbound_packet_sender` (live stack start → `spawn_lxmf_outbound_backchannel`) so plaintext reaches the same unpack path as peer-initiated `lxmf.delivery` links — otherwise rsLXMF still sends **LinkProof** (Ack) and drops the payload. Upgrade / rebuild the sidecar and **Restart stack**. Developer bundles: look for `LXMF outbound-link backchannel packet` after the peer’s first reply; inbound ring catch-up cannot recover messages that never entered the ring.

**Cause**: LXMF requires (1) an **`lxmf.delivery` announce** so peers learn a path _to_ this identity and (2) inbound destination registration (`RegisterDestination` + LinkManager) so link payloads reach Chat. Older sidecars stored announce interval in config without scheduling announces; current builds send startup + periodic delivery announces and register `lxmf.delivery`. Short messages from Python clients (Sideband/Columba) often use **opportunistic** DATA — current sidecars wire `set_inbound_raw_channel` (lxmd parity) so those packets are not dropped after proof.

**Checks**:

1. Upgrade / rebuild the sidecar (`pnpm run reticulum:sidecar:build`) and **Restart stack**.
2. On Network, use **Announce now**; on the other client, confirm mesh-client’s **LXMF** hash (Network identity → LXMF destination, not only the identity hash) appears after the announce.
3. Same fabric: enable the same TCP hub / Auto / RNode paths on both clients when A/B testing.
4. Contact named in Chat but missing from Peers → path dead; use **Peers → Request path / Probe**, or wait for the peer’s announce on that fabric.
5. **Auto interface up ≠ Auto peers.** Auto “up” means LAN multicast carrier works; peer rows appear only when another RNS node announces onto that Auto group (or paths are owned by that interface). Multi-hop peers labeled with a TCP hub name and a shared `via` are hub fanout, not LAN neighbors.
6. Configure a remote **propagation node** if the peer is often offline (does not replace missing announces).
7. **Columba / Sideband opportunistic triage** (developer bundle, default `RUST_LOG=warn`): after a send from the phone, look for `[ReticulumSidecar]` lines:
   - `LXMF inbound opportunistic packet` — frame reached the raw channel
   - `opportunistic LXMF decrypt failed` (+ `error=…`) — ciphertext did not decrypt to this identity
   - `inbound data not an LXMF message` with `via=opportunistic` — decrypt OK, unpack failed
   - `inbound LXMF queued for clients` — sidecar accepted the message (if Chat still empty, look at renderer ingest / identity)
   - **None of the above** after a Columba send → packet never hit `lxmf.delivery` (wrong dest hash on the phone, missing reverse path/announce, or not opportunistic/link traffic at all)

## Reticulum interface add/edit/delete fails

**Symptoms**: Connection tab **Add interface**, **Edit**, or **Delete** shows an inline error; interface list does not refresh.

**Checks**:

1. **Stack running**: start the sidecar from **Connection → Start stack** before editing interfaces. Identity routes on the Network tab also require a live sidecar (`reticulum:proxyGet` / `proxyPut` / `proxyDelete`).
2. **Edit validation**: name is required; TCP needs a reachable host and valid port; RNode needs a serial port path when adding (edit can update preset/callsign without re-plugging). **I2P** peers must be comma-separated `.b32.i2p` hostnames (max **512** characters); inline errors: `i2pPeersRequired`, `i2pPeersInvalid`, `i2pPeersTooLong`. Invalid **mode** values are rejected by the sidecar (`invalid interface mode: …`); use the Connection mode select (or clear to omit). For TCP hub reachability / path seeking, prefer **Boundary** — **Add default backbones** sets/repairs missing mode to `boundary` (does not overwrite a valid user-chosen mode).
3. **Delete**: confirm in the modal; if the interface id changed after config import, refresh by stopping and restarting the stack.
4. **Logs**: filter Device logs for `[ReticulumIPC]` or `[ReticulumSidecar]`; sidecar returns `{ ok: false, error }` for parse or unknown-interface failures.

**TCP / UDP / I2P / Auto / Pipe not active after add**: Sidecar live `apply_interfaces` only hot-applies **BLE Peer**; other types are written to config and require a stack restart. The Connection UI auto-restarts after add/enable/edit/delete for those types (`reticulumInterfaceChangeRequiresStackRestart`). If a transport still does not appear, use **Stop stack** then **Start stack**, or check the amber restart hint. **Add default backbones** still shows the hint only (no auto-restart).

For bulk fixes, use Network **Config import** (merge) instead of hand-editing individual rows. See [reticulum.md — Interface management](reticulum.md#interface-management-connection-tab).

## Reticulum I2P interface stays down

**Symptoms**: Connection → Interfaces shows an enabled I2P row (e.g. **RNS I2P Hub A**) as **down**; Diagnostics may list `reticulum/interface-down`. The I2P router appears running and “clients” look ready, but mesh-client never comes up.

**Checks**:

1. **Interface enabled**: default hub presets (including **RNS I2P Hub A**) are added **disabled**. Enable the row after configuring SAM, then let the UI restart the stack (or Stop/Start).
2. **SAM application bridge**, not I2PTunnel: HTTP/HTTPS proxies on `127.0.0.1:4444` / `4445` (and similar “Client ready” lines) are classic I2PTunnel clients. Reticulum needs the **SAM** bridge (default **`127.0.0.1:7656`** on the mesh-client machine). In the I2P Router Console → **Clients**, enable **SAM application bridge** (Run on load). The Connection ⓘ tooltip on I2P rows covers the local case.
3. **Remote SAM (optional)**: if I2P runs on another LAN host, do **not** put that IP in the typed Host field (that field is hub **peers** / `.b32.i2p`). Edit the I2P interface → **Advanced** and set:

   ```ini
   i2p_sam_host = 192.168.1.86
   i2p_sam_port = 7656
   ```

   Use rsReticulum keys `i2p_sam_host` / `i2p_sam_port` (not Python RNS `sam_address` / `sam_port`). On the I2P router, bind SAM to the LAN address or `0.0.0.0` (localhost-only SAM is unreachable remotely). Confirm from the mesh-client host: `nc -z <sam-host> 7656`. See [reticulum.md — Interface management](reticulum.md#interface-management-connection-tab).

4. **Restart I2P after enabling SAM**: flipping SAM on while the router is already running often does not open `7656` until you fully restart I2P. Confirm something listens on the configured SAM address/port. SAM may also delay ~2 minutes after router boot (`delay=120` in the SAM client config).
5. **Restart the Reticulum stack** after SAM is listening (stack restart alone cannot help while SAM is refused).
6. **Tunnel build time**: first connect to a hub `.b32.i2p` peer can take a while on a fresh router. Sidecar / Device logs may show `I2P client:` / `I2P server:` messages (`failed to connect to SAM bridge`, `STREAM CONNECT failed`, `stream connected`).

## Reticulum Peers stale or slow with many hubs or testnets

**Symptoms**: Peers looks briefly stale after opening the tab, or—after enabling several public hubs or testnets—shows thousands of path-table rows and scrolling, search, or refresh feels sluggish. UI may remain responsive on **History**, **Contacts**, or **Favorites** because those tabs show a smaller set than the full path table.

**Checks**:

1. **Refresh model**: opening Peers uses the sidecar’s short-lived soft cache. Click **Refresh** to force a live path-table read (`?refresh=1`). mesh-client virtualizes peer rows above 100 entries (never mounts the full DOM when the virtualizer is not ready), prepares labels once before filter/sort, and does **not** reload the full path table on high-frequency `stats_update` / `interface.state` WS events. The sidecar still maintains the full RNS path table (often 3k–10k rows on busy hubs). Background peer refresh runs every 30 s while the stack is configured (60 s above 2,000 peers), plus announce/`peers_updated` debounced updates.
2. **Reduce noise**: disable unused TCP/community hub interfaces on **Connection → Interfaces** and restart the stack so RNS drops stale TCP clients. The Amsterdam official testnet hub remains decommissioned (red **decommissioned** badge; **Enable** is blocked) and is auto-disabled on stack start and by **Add default backbones** — focus remaining noise on community hubs you enabled. If an old Amsterdam row keeps turning off, that is expected; use the picker or **Directory ↗** for live hubs.
3. **History vs Contacts**: messaging stamps **History** (`last_heard`) only. Peers you DM show under **History** until you open peer details and choose **Save as contact** (**Contacts** = `is_contact`). **Favorites** pins a short list. Removing a contact keeps History/chat messages.
4. **Search**: the peer search box debounces input and filters the full prepared list (not only the visible window) — wait a moment after typing before judging filter performance on very large lists.
5. **Topology**: automatic topology rebuilds pause above the large-mesh threshold; use its manual **Refresh** after a significant route change.

## RNode Wi-Fi interface offline or won't connect

**Symptoms**: Connection tab shows a Wi-Fi RNode interface as **down**; logs may show TCP connect failures to the configured host.

**Checks**:

1. **Interface type**: use **RNode** with transport **Wi-Fi** (`tcp://192.168.x.x:7633`), not **TCP Client** (mesh upstream on port **4242**).
2. **Provisioning**: Wi-Fi is disabled after flashing until you configure station or AP mode (**Admin → Wi-Fi**, AP + `http://10.0.0.1`, or `rnodeconf`).
3. **IP address**: DHCP may change the RNode IP — update the host on Connection → Interfaces, or set a static IP in Admin → Wi-Fi advanced.
4. **LAN reachability**: the computer running mesh-client must be on the same network as the RNode; check firewall rules for outbound TCP to port **7633**.
5. **Sidecar build**: packaged builds include `rns-rnode-tcp`; dev builds need `pnpm run reticulum:sidecar:build` with `rns-stack,rns-ble,rns-rnode-tcp` features.

See [reticulum.md — RNode over Wi-Fi](reticulum.md#rnode-over-wi-fi).

## Reticulum Admin: RNode flasher timeout or stalled transfer

**Symptoms**: **Reticulum → Admin → RNode flasher** fails with a timeout or stall message after you pick a port and start flashing. UI copy maps internal error tags to i18n hints (`flasher.errors.*`).

| Error tag                   | Typical cause                                                                        | Recovery                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`RNODE_COMMAND_TIMEOUT`** | Board not responding on serial (boot loop, wrong port, stack still holding the port) | **Stop stack** (or disable the RNode interface) so the sidecar releases USB; quit other serial tools; wait for boot to finish; retry. Command window: **30 s** (`RNODE_COMMAND_TIMEOUT_MS`). BLE pairing uses a separate **90 s** cap (`RNODE_BT_PAIRING_TIMEOUT_MS`). |
| **`ESP32_FLASH_STALLED`**   | ESP32-S3 flash wrote no progress for **60 s**                                        | Different USB cable/port; hold **BOOT (0)**, tap **RESET (EN)**, release **BOOT** for bootloader mode; flash again.                                                                                                                                                    |
| **`NRF52_DFU_STALLED`**     | nRF52 DFU wrote no progress for **60 s**                                             | Same cable/port/bootloader steps as ESP32; confirm you selected the DFU-capable port.                                                                                                                                                                                  |

**Before flashing**: stop the Reticulum stack or disable the **USB serial** RNode interface — the sidecar holds that port while the stack runs (`flasher.errors.blockedByStack`). Enabled BLE or Wi‑Fi RNodes do not block the USB flasher. After a failed flash, power-cycle the board and re-enter bootloader if the port disappears.

**Provision / Set firmware hash**: Flash success unlocks Provision for the rest of the app session (survives leaving and returning to Admin). Changing product, model, or firmware file clears that unlock. If EEPROM is locked with a bad checksum, wipe EEPROM first (`PROVISION_WIPE_REQUIRED`). If Provision reports success but Set hash still says not provisioned, power-cycle and retry — or wipe and provision again (`PROVISION_VERIFY_FAILED`).

## Reticulum Remote transfer fails or `path_constrained`

**Symptoms**: **Reticulum → Remote** rnsh/rncp (or Chat DM send-file) fails with `Path constrained`, `Path unknown`, `Not announced`, or `Timeout`; the path-capability chip is red.

**Cause**: rnsh/rncp gate on the destination's link speed and path table (`stack::path_speed::PathCapability`). A `path_constrained` reason means the known path is too slow/limited for the transfer; other reasons map to `reticulumRemote.reasons.*` via `useRemotePathCapability`.

**What to do**:

1. Confirm the destination is announced and has a path (Peers / Topology); **Probe** it if the chip is stale.
2. For `path_constrained`, prefer a faster interface or wait for a better path; large files over slow links may not be attempted.
3. Check sidecar logs for `rnsh`/`rncp` link errors; the `reticulum:rncpSend` / `rncpFetch` IPC returns the reason key surfaced in the toast.

**Chat DM note**: the destination field is the peer's **`rncp.receive`** hash, not their LXMF/Chat hash. Prefer **Request enable** (mesh-client peers share the receive hash after they accept) or paste from their Remote → **My rncp receive destination**.

**Request enable / 422**: `sendRncpRequestEnable` must POST LXMF with a `text` field (not `content`) — wrong key → HTTP **422**. After you send request-enable, the peer's `mesh-client:rncp-receive-dest:v1:<hash>` reply is applied when present (prefer a pending mark from `rncpReceiveDestSharePending` in this session; shares without that mark are still applied so older peers / pasted hashes autofill). Inbound enable-request modal enqueue and dest-share apply are deduped by LXMF `message_hash` so periodic catch-up / WS duplicates do not re-open the modal or re-toast; when the peer is already listening, dest is auto-shared at most once per peer per outbound request-enable cooldown.

**Sleep / wake**: Suspend clears in-memory rnsh sessions and rncp transfers; reopen Remote (or wait for resume reconnect) after wake. See [Sleep, wake, and long-running sessions](troubleshooting.md#sleep-wake-and-long-running-sessions).

## Reticulum Remote inbound rncp blocked (Ask mode / policy)

**Symptoms**: Incoming file offers never arrive, or an offer is auto-declined; a peer reports their send was rejected.

**Cause**: Inbound rncp is gated by the listener mode (`RncpInboundMode`: `off` / `ask` / `allow_all_listed`) plus a per-identity allow/block policy (`reticulumInboundPolicyStore`, persisted via `db:*ReticulumInboundPolicy`). `off` drops all offers; `ask` prompts (`RncpEnableRequestModal`); `allow_all_listed` accepts only allow-listed identities.

**What to do**:

1. **Reticulum → Remote → settings**: set the inbound mode and review the allow/block list.
2. In **Ask** mode, respond to the enable-request prompt; a blocked identity stays blocked until you change its policy row.
3. The listener config persists in `mesh_client_stack.json` (`rncp_listener_*`) and restores on live stack start — re-enable after a factory reset.

## Reticulum hung-sidecar watchdog restart

**Symptoms**: Logs show `[reticulumSidecarWatchdog] hung poll failure` then `restarting hung sidecar`; the stack briefly drops and recovers on its own.

**Cause**: The main-process watchdog (`reticulumSidecarWatchdog.ts`) polls `/api/v1/status` every **30 s** while the sidecar process is alive. After **2** consecutive unresponsive polls (5 s fetch timeout) it attempts **one** restart. Process-exit crashes are not handled here — those are owned by the renderer autostart path.

**What to do**: Usually no action; the watchdog recovers a wedged-but-alive sidecar. If restarts loop, check for a stuck link/interface or resource exhaustion in the sidecar log and **Stop stack** to clear state.

## Reticulum LXMF paper create/ingest fails

**Symptoms**: Chat **Share as paper** errors; Scan paper / Network QR / OS `lxm://` toast fails; paper badge missing after restart.

| Sidecar / UI error                                 | Likely cause                                               | Fix                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `identity_unknown` / `shareAsPaperIdentityUnknown` | Peer pubkey not in `known_identities`                      | Import peer `lxma://` contact QR or wait for an announce, then retry              |
| `decrypt_failed` / `paperDecryptFailed`            | Paper encrypted to a different identity                    | Switch to the recipient identity slot (Network) that matches the paper            |
| `paper_too_large` / `shareAsPaperTooLarge`         | Message exceeds LXMF paper size cap                        | Shorten the text and recreate                                                     |
| `invalid_uri` / `paperInvalidUri`                  | Truncated or non-paper `lxm://` blob                       | Rescan / recopy the full QR or URI                                                |
| `identity_not_configured`                          | No local LXMF identity                                     | Generate/import identity on Network, ensure stack is running                      |
| Paper badge gone after restart                     | Older builds stripped `received_via: paper` on SQLite save | Update to a build that allowlists `paper` in `reticulumMessageTransport` / DB IPC |

See [reticulum.md](reticulum.md#chat-lxmf) and [sidecar IPC](reticulum-sidecar-ipc.md) paper routes.

## Reticulum Games challenge fails or board does not update

- **Stack not running / games disabled:** Games need a live `rns-stack` sidecar with sibling `lrgp-rs`. Check Connection → Start stack and `GET` status via Games tab (or logs for `games requires live rns-stack`).
- **`unsupported_app`:** Peer lacks that LRGP app (mesh-client and Ratspeak ship Tic-Tac-Toe, Chess, and Four in a Row). Challenge with `ttt`, `chess`, or `four_in_a_row`.
- **`not_your_turn` / `invalid_move`:** Local validation rejected the move before send; wait for opponent or pick a legal cell/UCI move.
- **Challenge never arrives:** Path/Direct delivery required for reliable LRGP; ensure a path to the peer (Peers → Probe) or preferred PN fallback. Confirm peer Games tab / unread session list (sidebar Games badge + DM-style ping on inbound challenge).
- **Accept does nothing / session stays Pending:** After a stack restart the Games tab can still list SQLite sessions; the sidecar now rehydrates those into memory on spawn. If Accept still fails, check the action error toast (`unknown_session` / `no_propagation_node`) and that the stack is running.
- **Resend after restart:** Last outbound LRGP envelope is persisted in `reticulum/storage/lrgp/games_outbound.db`. Resend should still work after Stop/Start stack. If you still get `no_previous_action`, send a new move first (nothing was committed before restart).
- **Delivery chips (Sending / Offline Inbox / Retry needed):** Session `delivery_state` tracks LXMF outbound status. **Retry needed** enables Resend for the last committed envelope.
- **Board jumped then snapped back:** Client optimistic paint rolls back when enqueue fails (`games.action_result` ok:false or IPC error).
- **Promotion chooser:** Pawn to last rank opens queen/rook/bishop/knight (filtered by `legal_moves`); Escape cancels.
- **Claim threefold / 50-move:** When Chess metadata `draw_offer_reason` is `3fr` or `50m`, Claim replaces Offer Draw and sends `draw_offer` with `{ r }`.
- **IPC blocked on proxy:** Renderer must use `electronAPI.reticulum.games.*` (`reticulum:games*`); generic `proxyGet`/`proxyPost` to `/api/v1/games/*` is rejected by design.
- **Interop with Ratspeak:** Same LRGP v1 wire (`lrgp.v1` + `0xFB`/`0xFD`). See [reticulum-games-parity.md](reticulum-games-parity.md).

## Reticulum LXST voice call fails or is silent

- **Stack not running:** Call needs a live Reticulum sidecar (`available` + `enabled` + `running` from `/api/v1/voice/status`). Start the stack from Connection.
- **Peer identity unknown:** Dial uses a 32-hex **identity** hash (not only the LXMF destination). Wait for an announce or Probe the peer from Peers / Chat DM, then try Call again.
- **Busy / rejected / no answer:** Line-busy and reject play distinct tones; discovery/ring timeouts surface as no-answer toasts. Only one local call at a time — Hang up before dialing again.
- **Call progress tones (outbound):** Expect **dial tone → peer-derived DTMF burst → UK double-ring** while connecting. **Busy / no-answer** uses a short busy cadence; **connect-fail / unexpected drop** uses a fast reorder tone (not the same as busy). Hearing dial/ring without two-way audio is often still connecting — wait for Established before assuming failure.
- **One-way or silent audio:** Confirm microphone permission ([Permission messages in the console](troubleshooting.md#permission-messages-in-the-console)). **Answer** only warms `AudioContext` on the click; **microphone capture/TX begins after `voice.update: established`** (Call click warms contexts before dial). If capture still fails after Established, check OS privacy and that another app is not exclusive-locking the mic. TX drops increment `localTxDrops` under IPC pressure — hang up and retry on a quieter link.
- **Inbound accept fails (Columba / Python LXST):** mesh-client→peer may work while peer→mesh-client fails on Answer. Current builds defer mic/TX until Established and soft-drop pre-establish PCM (older packages could fatal-error lxst with `active call is not established` on Answer). Rebuild sidecar + app, then retry. If it still fails, check developer-bundle logs for `[ReticulumSidecar]` `call start role=incoming`, `call failed` / `call terminated`, and renderer `[reticulumVoice] voice.error message=…` / `answer failed`. Generic UI toast **Voice call failed** hides the raw rsLXST reason — the log line is definitive.
- **Interop:** Peer must run LXST telephony (Sideband, Ratspeak, Columba, or mesh-client with rsLXST). This is not an LXMF voice-note clip.
