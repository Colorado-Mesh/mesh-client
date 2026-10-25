# rsReticulum / rsLXMF overlays

Patches applied on top of [ratspeak/rsReticulum](https://github.com/ratspeak/rsReticulum) / [ratspeak/rsLXMF](https://github.com/ratspeak/rsLXMF) checkouts for mesh-client `rns-stack` builds (`.rsstack/rsNomad` from [Colorado-Mesh/rsNomad](https://github.com/Colorado-Mesh/rsNomad) is also required for Nomad hosting; no mesh-client overlay today). Checkouts live in the repo-local `.rsstack/` gitignored workspace, keeping a standalone `rsReticulum` mirror (if present) pristine.

By default `scripts/clone-ratspeak-stack.sh` verifies the reviewed full SHAs in `../ratspeak-stack-pins.env` and then applies these overlays (fails loud if a pin cannot be fetched or a patch will not apply). A manual local bisect requires the relevant `RS_*_REF` plus `MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE=1`; CI and release builds reject overrides. Per-overlay **Base commit** tables below record regeneration baselines. Update the authoritative pin manifest only through a reviewed dependency change after the full-feature sidecar checks pass.

The repo-root `flake.nix` uses the same pins and runs every script in `scripts/lib/ratspeak-overlay-apply-list.sh`, so register new overlays there and nowhere else. In the Nix build the apply scripts run in an offline sandbox, against single-commit `git init` snapshots of each checkout, with no upstream history or remotes. Apply scripts must not fetch or rely on upstream commit ancestry.

Open upstream feature PRs that mesh-client needs before they land on `main` (for example [rsReticulum#26](https://github.com/ratspeak/rsReticulum/pull/26) ReplyFile, [rsLXMF#7](https://github.com/ratspeak/rsLXMF/pull/7) multi-file attachments) are carried as **overlays** below — same apply path as other patches. `pnpm run update` tracks them in `RATSPEAK_PATCH_ENTRIES` and reports upstream changes, but an upstream merge alone never authorizes removing an overlay. First advance the authoritative pin to a reviewed full SHA that contains the replacement, rerun the full-feature sidecar checks with the remaining overlays, and include the pin bump and overlay removal in the same reviewed change. Colorado-Mesh/rsNomad uses its reviewed pin with **no** mesh-client overlay (NomadNet `/media` is already upstream).

Every **Sunset** section below inherits that rule: keep the overlay until `ratspeak-stack-pins.env` is reviewed and advanced to a commit that contains the equivalent behavior. Do not build or regenerate against a floating branch tip.

## Development — overlays/patches

Overlays require **git checkouts** in the repo-local `.rsstack/` workspace (not a bare Cargo cache path):

- `.rsstack/rsReticulum` — verified `RS_RETICULUM_PIN` plus overlays
- `.rsstack/rsLXMF` — verified `RS_LXMF_PIN` plus overlays
- `.rsstack/rsNomad` — verified `RS_NOMAD_PIN`

**First-time setup:**

```bash
# From mesh-client repo root — verifies the pinned .rsstack workspace and applies known overlays
./scripts/clone-ratspeak-stack.sh
# Or ensure patches on an existing .rsstack tree:
./scripts/ensure-rsReticulum-patches.sh
```

When a `.rsstack` checkout (rsReticulum, rsLXMF, or rsNomad) is not at its reviewed pin, for example after a pin bump lands on `main`, `ensure-rsReticulum-patches.sh` re-pins automatically by running `clone-ratspeak-stack.sh` (network fetch). External `RS_*_DIR` clones and active `RS_*_REF` bisect overrides are left alone.

Apply a single overlay when developing that patch:

```bash
./scripts/apply-rsReticulum-discovery-announce-egress.sh
git -C .rsstack/rsReticulum status --short
```

If a patch is skipped or conflicts after an upstream bump, CI/`ensure-rsReticulum-patches.sh` will fail. Rebase the overlay, regenerate the `.patch` file per the section below, then re-run the apply script.

## Upstream tracking (no mesh-client overlay yet)

Discovering Interfaces keys documented in the Reticulum manual but **not** implemented in rsReticulum — do not invent behavior in mesh-client:

- `autoconnect_interface_mode`
- `autoconnect_announces_to_internal`

mesh-client already exposes library-supported consume knobs (`autoconnect_discovered_interfaces`, `required_discovery_value`, `interface_discovery_sources`, `network_identity`, `bootstrap_only`). When Ratspeak adds the missing keys, extend Network stack settings — do not reimplement autoconnect in the sidecar.

## rsReticulum-reply-file-query-metadata.patch

Carry [ratspeak/rsReticulum#26](https://github.com/ratspeak/rsReticulum/pull/26) on the reviewed `RS_RETICULUM_PIN`: `RequestOutcome::ReplyFile`, `pack_file_name_metadata`, 4-arg `set_request_handler_ex` (remote identity), and `LinkClient::query` Resource metadata. Required for Colorado-Mesh/rsNomad NomadNet `/file` and `/media` response Resources.

| Field | Value |
| ----- | ----- |
| **Base commit** | `799e946ac997f388395fec4e8c49ea55a03e5bc8` (`ratspeak/rsReticulum` v1.3.0; PR #26 diff rebased onto upstream's let-chain `fetch_spec` block) |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/26 |

**Adds (8 files):**

- `crates/rns-runtime/src/link_manager.rs` — `ReplyFile`, `pack_file_name_metadata`, handler remote identity
- `crates/rns-runtime/src/link_client.rs` — query metadata / `LinkQueryResponse`
- `crates/rns-runtime/src/{lib,reticulum,rncp}.rs` — re-exports and call sites
- `crates/rns-tools/src/commands/{rnpath,rnstatus}.rs` — tool updates
- `api/snapshots/rns-runtime.txt` — API snapshot

### Apply locally

```bash
./scripts/apply-rsReticulum-reply-file-query-metadata.sh
```

### Regenerate

```bash
# From a clean checkout of the reviewed pin recorded above:
gh pr diff 26 --repo ratspeak/rsReticulum \
  > reticulum-sidecar/patches/rsReticulum-reply-file-query-metadata.patch
git -C .rsstack/rsReticulum apply --check \
  "$(pwd)/reticulum-sidecar/patches/rsReticulum-reply-file-query-metadata.patch"
```

### Sunset

After [ratspeak/rsReticulum#26](https://github.com/ratspeak/rsReticulum/pull/26) merges, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch, `scripts/apply-rsReticulum-reply-file-query-metadata.sh`, the apply-list entry, and the `RATSPEAK_PATCH_ENTRIES` row.

## rsReticulum-packet-tap.patch

Wire packet tap API for the Reticulum Stats/Sniffer panel (`wire_packet` WebSocket events, `GET /api/v1/packets`).

| Field | Value |
| ----- | ----- |
| **Base commit** | `799e946ac997f388395fec4e8c49ea55a03e5bc8` (`ratspeak/rsReticulum` v1.3.0) |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/10 |

**Adds (4 files):**

- `crates/rns-transport/src/messages.rs` — `PacketTapDirection`, `PacketTapEvent`, `SetPacketTap`
- `crates/rns-transport/src/actor/mod.rs` — tap storage, RX/TX emit
- `crates/rns-transport/src/actor/inbound.rs` — RX tap on inbound
- `crates/rns-runtime/src/reticulum.rs` — `ReticulumHandle::register_packet_tap`

### Apply locally

From mesh-client repo root (`.rsstack/rsReticulum` required):

```bash
./scripts/apply-rsReticulum-packet-tap.sh
```

### Regenerate

Regenerate against the reviewed `RS_RETICULUM_PIN` (record the full SHA in the PR):

```bash
cd .rsstack/rsReticulum
source ../../reticulum-sidecar/ratspeak-stack-pins.env
git fetch origin "${RS_RETICULUM_PIN}"
git reset --hard "${RS_RETICULUM_PIN}" && git clean -fd
# apply local packet-tap edits, then:
git diff -- \
  crates/rns-runtime/src/reticulum.rs \
  crates/rns-transport/src/messages.rs \
  crates/rns-transport/src/actor/mod.rs \
  crates/rns-transport/src/actor/inbound.rs \
  > ../../reticulum-sidecar/patches/rsReticulum-packet-tap.patch
# smoke-check on a clean tip clone:
git -C /tmp/rsReticulum-patch-test fetch origin "${RS_RETICULUM_PIN}"
git -C /tmp/rsReticulum-patch-test checkout --detach "${RS_RETICULUM_PIN}"
git -C /tmp/rsReticulum-patch-test apply --check ../../reticulum-sidecar/patches/rsReticulum-packet-tap.patch
```

### Sunset

After the upstream PR merges, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-auto-beacon-utun.patch

Skip macOS/iOS VPN tunnel interfaces (`utun*`, `ipsec*`, `ppp*`) for AutoInterface link-local enumeration; per-interface exponential backoff and WARN→DEBUG downgrade on repeated beacon TX failures (fixes ENOBUFS log spam on macOS VPN utun).

| Field | Value |
| ----- | ----- |
| **Base commit** | `9928abed269a83ec5a7ef165ff1142d938cad706` |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/11 |

**Modifies (1 file):**

- `crates/rns-interface/src/auto.rs` — tunnel iface filter, beacon TX backoff, log downgrade

### Apply locally

From mesh-client repo root (`.rsstack/rsReticulum` required):

```bash
./scripts/apply-rsReticulum-auto-beacon-utun.sh
```

Apply after the packet-tap patch when both overlays are needed:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
```

### Regenerate

Regenerate against the reviewed `RS_RETICULUM_PIN` (record the full SHA in the PR):

```bash
cd .rsstack/rsReticulum
source ../../reticulum-sidecar/ratspeak-stack-pins.env
git fetch origin "${RS_RETICULUM_PIN}"
git reset --hard "${RS_RETICULUM_PIN}" && git clean -fd
# after implementing the utun filter/backoff, then:
git diff -- crates/rns-interface/src/auto.rs \
  > ../../reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
git -C /tmp/rsReticulum-patch-test fetch origin "${RS_RETICULUM_PIN}"
git -C /tmp/rsReticulum-patch-test checkout --detach "${RS_RETICULUM_PIN}"
git -C /tmp/rsReticulum-patch-test apply --check ../../reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
```

### Sunset

After [ratspeak/rsReticulum#11](https://github.com/ratspeak/rsReticulum/pull/11) merges, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## Removed: rsReticulum-link-client-nomad.patch

Sunset after the reviewed `RS_RETICULUM_PIN` moved `LinkClient::query` to handler-free `resolve_destination_on_transport` (no HasPath gate, no temporary announce handlers) — the overlay's `discover_remote_public_key` + `await_path` + announce-handler GC is fully superseded. [ratspeak/rsReticulum#14](https://github.com/ratspeak/rsReticulum/pull/14) was closed as superseded; mesh-client no longer carries the overlay or `scripts/apply-rsReticulum-link-client-nomad.sh`. Tracked entry removed from `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` after pin-based sunset confirmation.

## rsReticulum-link-client-proof-budget.patch

Keep `LinkClient::query` proof wait on the **remaining overall deadline** (v5.25.0 / release parity). Earlier overlays capped at `establishment_timeout` (hops×6) or `max(establishment, 30s)` and false-failed multi-hop TCP hub Nomad pages (e.g. Northern Ireland) that need the rest of the MeshChat 45s window. The apply script migrates those older caps to remaining-deadline.

On the current reviewed `RS_RETICULUM_PIN`, proof wait is `timeout(time_remaining(deadline)?, wait_for_valid_proof(...))`. The apply script is a **no-op** in that case; keep the patch for older pins.

| Field | Value |
| ----- | ----- |
| **Upstream PR** | (mesh-client local) |

### Apply locally

```bash
./scripts/apply-rsReticulum-link-client-proof-budget.sh
```

## Removed: rsReticulum-rnode-tcp-activity-keepalive.patch

Sunset after the reviewed `RS_RETICULUM_PIN` included upstream `RNodeIdleProbe` (`88d3d38` — *rnode: restore TCP application idle probes*). [ratspeak/rsReticulum#15](https://github.com/ratspeak/rsReticulum/pull/15) was closed as superseded; mesh-client no longer carries that overlay. Tracked entry removed from `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` after pin-based sunset confirmation.

## rsReticulum-ble-rnode-pairing-transition-debounce.patch

Debounce BLE RNode reconnect after mid-SMP disconnect (`BLE pairing in progress`): wait **30s** instead of **1s** so macOS/Windows OS passkey dialogs are not re-fired while the user enters the PIN.

| Field | Value |
| ----- | ----- |
| **Base commit** | `799e946ac997f388395fec4e8c49ea55a03e5bc8` (`ratspeak/rsReticulum` v1.3.0; after prior overlays) |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/20 |

**Modifies (1 file):**

- `crates/rns-interface/src/ble_rnode.rs` — `PAIRING_TRANSITION_RETRY_WAIT = 30`

### Apply locally

From mesh-client repo root (`.rsstack/rsReticulum` required):

```bash
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
```

Apply after the other rsReticulum overlays when rebuilding against the reviewed pin:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
./scripts/apply-rsReticulum-discovery-announce-egress.sh
```

### Regenerate

Regenerate against the reviewed `RS_RETICULUM_PIN` (record the full SHA in the PR):

```bash
cd .rsstack/rsReticulum
source ../../reticulum-sidecar/ratspeak-stack-pins.env
git fetch origin "${RS_RETICULUM_PIN}"
git reset --hard "${RS_RETICULUM_PIN}" && git clean -fd
# apply local debounce edit, then:
git diff -- crates/rns-interface/src/ble_rnode.rs \
  > ../../reticulum-sidecar/patches/rsReticulum-ble-rnode-pairing-transition-debounce.patch
```

### Sunset

After [ratspeak/rsReticulum#20](https://github.com/ratspeak/rsReticulum/pull/20) merges, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-ble-rnode-bond-desync.patch

Detect CoreBluetooth **Peer removed pairing information**, skip the TX-char SMP probe when an OS bond may already exist (optimistic on Apple/Windows; fall back to pairing if subscribe fails with auth), and **keep retrying** while mesh-client pauses LoRa GATT / attempts OS unbond (`POST /api/v1/ble/handle-ltk-desync`). Apply **after** the pairing-transition debounce overlay.

| Field | Value |
| ----- | ----- |
| **Base commit** | `199eeb4` (`ratspeak/rsReticulum` `origin/main`) + `rsReticulum-ble-rnode-pairing-transition-debounce.patch` |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/21 |

The upstream PR is **standalone off `main`** (independent of [#20](https://github.com/ratspeak/rsReticulum/pull/20) — the bond-desync code does not touch `PAIRING_TRANSITION_RETRY_WAIT`). The local overlay is regenerated on top of the pairing-transition debounce overlay against the generation-owner BLE connect path (`DesktopPairingTrigger` / `run_generation_operation`), so apply it **after** that overlay here.

**Modifies (1 file):**

- `crates/rns-interface/src/ble_rnode.rs` — `is_bond_removed_error`, optimistic `session_already_bonded`, bond-removed retry (no permanent halt)

### Apply locally

```bash
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
./scripts/apply-rsReticulum-ble-rnode-bond-desync.sh
```

## rsReticulum-discovery-announce-egress.patch

Register `rnstransport.discovery.interface` as a local destination before announcing, and defer `Announcer::register` until the discoverable interface online latch is true. Without this, Boundary hubs such as **rmap.world** silently drop discovery announces (non-local + no path), and BLE RNode can consume a multi-hour `announce_interval` on a no-op TX while still connecting.

| Field | Value |
| ----- | ----- |
| **Base commit** | `799e946ac997f388395fec4e8c49ea55a03e5bc8` (`ratspeak/rsReticulum` v1.3.0; apply script no-ops — upstream `run_discovery_publisher` already registers the discovery destination and gates `Announcer::register` on the online latch) |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/19 |

**Modifies (3 files when the overlay still applies on older pins):**

- `crates/rns-runtime/src/reticulum.rs` — online latch on `LocalDiscoveryInterface`, `take_online_discovery_interfaces`, `discovery_local_destination_registration`, deferred announcer
- `crates/rns-transport/src/actor/mod.rs` — outbound discovery announce egress regression tests
- `crates/rns-transport/src/discovery/announcer.rs` — RateLimit-after-discard regression test

### Apply locally

From mesh-client repo root (`.rsstack/rsReticulum` required):

```bash
./scripts/apply-rsReticulum-discovery-announce-egress.sh
```

On the reviewed v1.3.0 pin the apply script **no-ops** when `run_discovery_publisher` + discovery destination registration + `online: Option<Arc<AtomicBool>>` are already present. Keep the patch until [PR #19](https://github.com/ratspeak/rsReticulum/pull/19) closes and the entry is dropped from `RATSPEAK_PATCH_ENTRIES`.

### Sunset

After [ratspeak/rsReticulum#19](https://github.com/ratspeak/rsReticulum/pull/19) merges (or is closed as superseded by the v1.3.0 publisher), drop this patch, its apply step, and the `RATSPEAK_PATCH_ENTRIES` row after full-feature sidecar checks pass.

## rsLXMF-file-attachments-list.patch

Carry [ratspeak/rsLXMF#7](https://github.com/ratspeak/rsLXMF/pull/7) on the reviewed `RS_LXMF_PIN`: multi-file `set_file_attachments_field` / `file_attachments` (single-file helper remains).

| Field | Value |
| ----- | ----- |
| **Base commit** | `e609864d8898d70d0a67072e527aa012055edcab` (`ratspeak/rsLXMF` `origin/main`) |
| **Upstream PR** | https://github.com/ratspeak/rsLXMF/pull/7 |

**Adds (2 files):**

- `crates/lxmf-core/src/message.rs` — multi-file attachment pack/list APIs + tests
- `README.md` — field table for typed media setters

### Apply locally

```bash
./scripts/apply-rsLXMF-file-attachments-list.sh
```

### Regenerate

```bash
gh pr diff 7 --repo ratspeak/rsLXMF \
  > reticulum-sidecar/patches/rsLXMF-file-attachments-list.patch
git -C .rsstack/rsLXMF apply --check \
  "$(pwd)/reticulum-sidecar/patches/rsLXMF-file-attachments-list.patch"
```

### Sunset

After [ratspeak/rsLXMF#7](https://github.com/ratspeak/rsLXMF/pull/7) merges, advance `RS_LXMF_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch, `scripts/apply-rsLXMF-file-attachments-list.sh`, the apply-list entry, or the `RATSPEAK_PATCH_ENTRIES` row.

## rsLXMF-propagation-sync-peering.patch

LinkIdentify + peering stamp before LXMF `/offer`, sticky offer/finish fields, plus Establishing diagnostics (`last_establish_error` + warn when LRPROOF is ignored for missing identity or invalid proof) so mesh-client can complete remote PN sync and surface non-generic failures.

| Field | Value |
| ----- | ----- |
| **Base commit** | historical (`68ad7c8…`); tip uses `set_identity` / `send_identify` instead |
| **Upstream PR** | https://github.com/ratspeak/rsLXMF/pull/4 |

**Modifies (1 file):**

- `crates/lxmf-core/src/propagation_sync.rs` — identify/stamp before `/offer` on older checkouts. On current `main`, apply script no-ops when `set_identity` is already present.

### Apply locally

From mesh-client repo root (`.rsstack/rsLXMF` required):

```bash
./scripts/apply-rsLXMF-propagation-sync-peering.sh
```

`clone-ratspeak-stack.sh` and `ensure-rsReticulum-patches.sh` invoke this automatically.

### Regenerate

On the current reviewed `RS_LXMF_PIN`, the apply script **no-ops** when `set_identity` is already present — regenerate only if you still need the overlay for an older pin:

```bash
cd .rsstack/rsLXMF
source ../../reticulum-sidecar/ratspeak-stack-pins.env
git fetch origin "${RS_LXMF_PIN}"
git reset --hard "${RS_LXMF_PIN}" && git clean -fd
# only needed for older pins without set_identity / send_identify:
git diff -- crates/lxmf-core/src/propagation_sync.rs \
  > ../../reticulum-sidecar/patches/rsLXMF-propagation-sync-peering.patch
```

### Sunset

After the reviewed `RS_LXMF_PIN` includes identify/stamp before `/offer`, pass the full-feature checks before removing this patch or its apply step.

## rsLXMF-propagation-node-policy-setters.patch

Live mutators for local PN hosting policy updates (`set_peering_cost`, `set_max_storage`, `set_max_message_size`). The reviewed rsLXMF pin only exposes `set_min_stamp_cost`; mesh-client `pn_hosting_apply` needs the others so policy edits apply without recreating the node.

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_LXMF_PIN` at regeneration time |
| **Upstream PR** | https://github.com/ratspeak/rsLXMF/pull/6 |

**Modifies (1 file):**

- `crates/lxmf-core/src/propagation_node.rs` — three policy setters on `PropagationNode`

### Apply locally

From mesh-client repo root (`.rsstack/rsLXMF` required):

```bash
./scripts/apply-rsLXMF-propagation-node-policy-setters.sh
```

`clone-ratspeak-stack.sh` and `ensure-rsReticulum-patches.sh` invoke this automatically.

### Regenerate

```bash
cd .rsstack/rsLXMF
source ../../reticulum-sidecar/ratspeak-stack-pins.env
git fetch origin "${RS_LXMF_PIN}"
git reset --hard "${RS_LXMF_PIN}" && git clean -fd
# apply local setter edits, then:
git diff -- crates/lxmf-core/src/propagation_node.rs \
  > ../../reticulum-sidecar/patches/rsLXMF-propagation-node-policy-setters.patch
```

### Sunset

After [ratspeak/rsLXMF#6](https://github.com/ratspeak/rsLXMF/pull/6) merges, advance `RS_LXMF_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsLXMF-propagation-node-deferred-messagestore-load.patch

`PropagationNode::with_storage_unloaded` + `load_messagestore_from_disk` so mesh-client can mark live/RRC ready before scanning a large on-disk PN messagestore (tens of thousands of files). `with_storage` remains eager (loads immediately) for callers that need a full store up front.

| Field | Value |
| ----- | ----- |
| **Base commit** | `f9ed81e` (`ratspeak/rsLXMF` `origin/main`) + `rsLXMF-propagation-node-policy-setters` overlay |
| **Upstream PR** | (none yet — mesh-client local API) |

**Modifies (1 file):**

- `crates/lxmf-core/src/propagation_node.rs` — deferred messagestore open/load APIs

### Apply locally

From mesh-client repo root (`.rsstack/rsLXMF` required; apply policy-setters first):

```bash
./scripts/apply-rsLXMF-propagation-node-deferred-messagestore-load.sh
```

`clone-ratspeak-stack.sh` and `ensure-rsReticulum-patches.sh` invoke this automatically after policy-setters.

### Sunset

After upstream grows an equivalent deferred-load API, advance `RS_LXMF_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsLXMF-link-delivery-has-pending-to.patch

Expose `LinkDeliveryManager::has_pending_to` so the sidecar can serialize packed Propagated deposits (and propagation sync) against an in-flight Link to the same PN. The reviewed rsLXMF pin only has `delivery_link_available` (reusable idle link), which is the wrong predicate for one-shot packed sessions.

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_LXMF_PIN` at regeneration time |
| **Upstream PR** | (none yet — mesh-client local API) |

**Modifies (1 file):**

- `crates/lxmf-core/src/link_delivery.rs` — `has_pending_to(&[u8; 16]) -> bool`

### Apply locally

```bash
./scripts/apply-rsLXMF-link-delivery-has-pending-to.sh
```

`clone-ratspeak-stack.sh` and `ensure-rsReticulum-patches.sh` invoke this automatically.

### Regenerate

```bash
cd .rsstack/rsLXMF
source ../../reticulum-sidecar/ratspeak-stack-pins.env
git fetch origin "${RS_LXMF_PIN}"
git reset --hard "${RS_LXMF_PIN}" && git clean -fd
# apply local has_pending_to edit, then:
git diff -- crates/lxmf-core/src/link_delivery.rs \
  > ../../reticulum-sidecar/patches/rsLXMF-link-delivery-has-pending-to.patch
```

### Sunset

After upstream ships `has_pending_to` (or an equivalent), advance `RS_LXMF_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-path-medium-slots.patch

Ranked multi-path slots (up to 3 per destination) plus global / per-peer RF-vs-network medium preference in `rns-transport`. Apply **after** the other rsReticulum overlays (packet-tap, discovery egress, …).

| Field | Value |
| ----- | ----- |
| **Base commit** | `306eaa8` (`ratspeak/rsReticulum` `origin/main`) + prior mesh-client overlays through discovery-announce-egress |
| **Upstream PR** | none yet (mesh-client-local) |

**Touches:** `constants.rs`, `path_table.rs`, `messages.rs`, `actor/{inbound,mod,rpc,outbound,persistence}.rs`

### Apply locally

```bash
./scripts/apply-rsReticulum-path-medium-slots.sh
```

### Sunset

After ratspeak/rsReticulum lands equivalent multi-slot ranking and medium preference, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-inbound-raw-saturation-log.patch

Log when `LinkManager` opportunistic inbound-raw `try_send` fails because the bounded channel is full (tokio mpsc drops the **newest** packet; not drop-oldest).

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_RETICULUM_PIN` at regeneration time |
| **Upstream PR** | none yet (mesh-client-local) |

**Touches:** `crates/rns-runtime/src/link_manager.rs`

### Apply locally

```bash
./scripts/apply-rsReticulum-inbound-raw-saturation-log.sh
```

### Sunset

After upstream logs (or otherwise surfaces) inbound-raw saturation equivalently, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-interface-tx-queue-stats.patch

Expose host outbound TX mpsc fill on `GetInterfaceStats` as `tx_queue_used` / `tx_queue_max` (for mesh-client header Q badge + buffering indicator).

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_RETICULUM_PIN` at regeneration time |
| **Upstream PR** | none yet (mesh-client-local) |

**Touches:** `crates/rns-transport/src/messages.rs`, `crates/rns-transport/src/actor/rpc.rs`

### Apply locally

```bash
./scripts/apply-rsReticulum-interface-tx-queue-stats.sh
```

Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`.

### Sunset

After ratspeak/rsReticulum exposes equivalent live TX queue depth on interface stats, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-slow-rf-announce-filter.patch

Non-standard mesh-client announce policy (default **on**; stack setting `slow_rf_announce_filter`, toggled live via `TransportQuery::SetSlowRfAnnounceFilter`). Unsolicited announces learned on fast interfaces are not queued for rebroadcast onto slow RF interfaces (bitrate ≤ 10 kbps, e.g. LoRa RNode), whose `ANNOUNCE_CAP` spacing can never drain an internet-scale backlog. Local destinations and destinations learned over RF/internal edges are still queued; internet destinations remain reachable from RF peers on demand via attached cached path responses (`admit_cached_response`), which bypass the announce queue. Enabling the filter also prunes already-queued inadmissible entries.

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_RETICULUM_PIN` at regeneration time |
| **Upstream PR** | none yet (mesh-client-local) |

**Touches:** `crates/rns-transport/src/messages.rs`, `crates/rns-transport/src/actor/mod.rs`, `crates/rns-transport/src/actor/rpc.rs`

### Apply locally

```bash
./scripts/apply-rsReticulum-slow-rf-announce-filter.sh
```

Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`.

### Sunset

After ratspeak/rsReticulum adopts an equivalent slow-interface announce admission policy upstream, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## Removed: rsReticulum-pathless-link-exclude-rf.patch

Sunset when [ratspeak/rsReticulum#22](https://github.com/ratspeak/rsReticulum/issues/22) landed `921eac4` (*transport: bind established Links to exact interfaces*). Established Link TX uses `SendLinkEndpoint` on the establishment interface; generic unattached Link packets are dropped (`dropping unattached locally-originated Link packet`) instead of broadcasting onto every OUT iface. Tracked entry removed from `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` after sunset confirmation.

## Removed: rsReticulum-announce-rebroadcast-exclude-rf.patch

Sunset when [ratspeak/rsReticulum#24](https://github.com/ratspeak/rsReticulum/issues/24) landed in rsReticulum [v1.3.0](https://github.com/ratspeak/rsReticulum/releases/tag/v1.3.0) (`799e946` — *transport: repair discovery and bound background radio admission*). Upstream keeps learned mesh announces out of the ordinary RNode control/data backlog with announce admission, bitrate-aware `ANNOUNCE_CAP` spacing, and generation-specific ownership, so the local `iface_is_rf_sink` skip in `broadcast_announce_on_interfaces` is no longer needed. Tracked entry removed from `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` after pin-based sunset confirmation.

## rsLXMF-propagation-client-abort-transfer.patch

Adds `PropagationClient::abort_transfer` so Cancel / mid-transfer abort leaves the client **Idle**. Without it, a cancelled Sync can leave `/get` stuck busy and the next Sync returns `PROPAGATION_RETRIEVE_BUSY` forever (or Auto falsely concludes there are no PNs).

| Field | Value |
| ----- | ----- |
| **Base commit** | `f9ed81e` (`ratspeak/rsLXMF` `origin/main`) |
| **Upstream PR** | none yet (mesh-client-local; watch ratspeak/rsLXMF) |

**Touches:** rsLXMF `PropagationClient` (abort in-flight list/get transfer → Idle)

### Apply locally

```bash
./scripts/apply-rsLXMF-propagation-client-abort-transfer.sh
```

Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`. Sidecar `PropagationBridge::cancel_client_download` must call `abort_transfer`.

### Sunset

After upstream rsLXMF exposes equivalent abort/cancel mid-transfer cleanup, advance `RS_LXMF_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsLXMF-propagation-client-lrproof-diagnostics.patch

Adds sticky `last_establish_error` on `PropagationClient` so client `/get` Sync surfaces `LrproofIdentityMissing`, `LrproofInvalid`, and `LrproofInvalidKey` instead of a generic `NoLinkProof` (parity with peer `/offer` via `rsLXMF-propagation-sync-peering.patch`). An invalid LRPROOF only records `LrproofInvalid` and keeps the client `LinkEstablishing`, so a later valid proof can still bind (upstream `invalid_client_lrproof_allows_later_valid_binding_before_lrrtt`).

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_LXMF_PIN` @ `74dc13f` (v1.3.0) after other rsLXMF overlays (incl. abort-transfer) |
| **Upstream PR** | none yet (mesh-client-local; watch ratspeak/rsLXMF) |

**Touches:** rsLXMF `PropagationClient` (`drain_events` / `handle_link_proof` establish diagnostics)

### Apply locally

```bash
./scripts/apply-rsLXMF-propagation-client-lrproof-diagnostics.sh
```

Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`. Sidecar `PropagationBridge::poll_client_download` reads `client.last_establish_error()`.

### Sunset

After upstream rsLXMF exposes equivalent PropagationClient LRPROOF diagnostics, advance `RS_LXMF_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsLXMF-propagation-client-link-hops.patch

Path-scales `Link::new_initiator` hops on `PropagationClient::start_download_with_limit` (was hard-coded `hops=1` → 6s establish) and stamps `LinkEstablishTimeout` when the Link closes with `CloseReason::Timeout` during `LinkEstablishing` without a prior LRPROOF sticky error. Sidecar passes Nomad-style TCP hop floors (`propagation_link_initiator_hops`) so multi-hop TCP/RMAP Sync is not false-`NoLinkProof`.

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_LXMF_PIN` @ `74dc13f` (v1.3.0) after `rsLXMF-propagation-client-lrproof-diagnostics` |
| **Upstream PR** | none yet (mesh-client-local; watch ratspeak/rsLXMF) |

**Touches:** rsLXMF `PropagationClient` (`start_download_with_limit` hops arg; `tick` Closed(Timeout) → `LinkEstablishTimeout`)

### Apply locally

```bash
./scripts/apply-rsLXMF-propagation-client-link-hops.sh
```

Must run after `apply-rsLXMF-propagation-client-lrproof-diagnostics.sh`. Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`.

### Sunset

After upstream rsLXMF accepts path-scaled initiator hops and a distinct establish-timeout sticky error, advance `RS_LXMF_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## Removed: rsLXMF-propagation-client-request-resource.patch

Sunset when [ratspeak/rsLXMF#8](https://github.com/ratspeak/rsLXMF/issues/8) landed in rsLXMF [v1.3.0](https://github.com/ratspeak/rsLXMF/releases/tag/v1.3.0) (`74dc13f` via `5fe094c` — *propagation: transfer oversized requests as bounded Resources*). Upstream `PropagationClient::send_get_path_request` sends packed `/get` bodies larger than the Link MDU as request Resources (`flags.is_request`), so the local overlay is fully superseded. Tracked entry removed from `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` after pin-based sunset confirmation.

## rsReticulum-ble-rnode-flow-control-ready-timeout.patch

When BLE RNode `flow_control` is on, wait up to 2s for `CMD_READY`, then release the one-packet permit so NUS links that never deliver READY cannot freeze the host 256-slot TX queue after the first frame. Still paces bursts when READY works.

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_RETICULUM_PIN` @ `799e946` (v1.3.0) after other rsReticulum overlays (rebased onto background-permitted OR `claim_ble_packet_permit`) |
| **Upstream PR** | none yet (mesh-client-local; watch ratspeak/rsReticulum) |

**Touches:** `crates/rns-interface/src/ble_rnode.rs` (main + native bridge TX loops)

### Apply locally

```bash
./scripts/apply-rsReticulum-ble-rnode-flow-control-ready-timeout.sh
```

Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`.

### Sunset

After upstream rsReticulum lands an equivalent BLE READY timeout/non-blocking FC fix, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-ble-rnode-host-rssi-cache.patch

Cache advertisement / resolve-time host↔RNode RSSI so mesh-client Interface **Signal** meters can show a seed after GATT connect stops advertising (CoreBluetooth leaves `PeripheralProperties.rssi` unset while connected).

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_RETICULUM_PIN` @ `799e946` (v1.3.0) after other rsReticulum overlays (incl. flow-control READY timeout) |
| **Upstream PR** | none yet (mesh-client-local; watch ratspeak/rsReticulum) |

**Touches:** `crates/rns-interface/src/ble_rnode.rs` — `remember_host_rssi` / `cached_host_rssi`, fill on `scan_ble_devices` + `resolve_ble_target`

### Apply locally

```bash
./scripts/apply-rsReticulum-ble-rnode-host-rssi-cache.sh
```

Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`. Sidecar `attach_ble_rnode_host_rssi` copies cache values onto online `ble://` `InterfaceRow.host_rssi`.

### Sunset

After upstream rsReticulum exposes equivalent host-RSSI caching for connected BLE RNodes, advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-response-resource-window-fast.patch

Promote inbound **response** Resources to `WINDOW_MAX_FAST` (75) when Link RTT is ≤ 1s. `grow()` only leaves `WINDOW_MAX_SLOW` (10) after four rounds above `RATE_FAST` (6250 B/s). A 2-hop TCP hub at ~200–300ms RTT stays around 8–20 KB/s, so a ~480 KB Nomad `/media` Resource crawls ~16–20s. Jumping the window matches the observed TCP-class path without changing RF slow-start.

| Field | Value |
| ----- | ----- |
| **Base commit** | `9bc7ee5` (`ratspeak/rsReticulum` `origin/main`) |
| **Upstream PR** | none yet (mesh-client-local; watch ratspeak/rsReticulum) |

**Touches:** `crates/rns-protocol/src/resource.rs` (`WindowState::promote_fast`), `crates/rns-runtime/src/link_session.rs` (`inbound_transfer_from_advertisement`)

### Apply locally

```bash
./scripts/apply-rsReticulum-response-resource-window-fast.sh
```

Listed in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh`. Sidecar Nomad browse reuses one `LinkSession` per dest so this window applies to page + queued `/media` on the same Link.

### Sunset

After upstream rsReticulum promotes TCP-class response Resources (or otherwise reaches `WINDOW_MAX_FAST` without waiting on `RATE_FAST`), advance `RS_RETICULUM_PIN` through review to a full SHA containing it and pass the full-feature checks before removing this patch or its apply step.

## rsReticulum-rncp-picker-pinned-jail.patch

Preserves Linux `/proc/self/fd/...` and macOS `/.vol/...` picker-capability paths through RNCP fetch-jail resolution. Canonicalizing those paths would reopen the user-visible pathname and reintroduce a replace-before-read race.

```bash
./scripts/apply-rsReticulum-rncp-picker-pinned-jail.sh
```

Remove after the reviewed rsReticulum pin has equivalent handle-relative fetch-jail resolution and the replacement-race sink test.

## rsNomad-picker-pinned-roots.patch

Preserves picker handle aliases through rsNomad page/file storage reads, writes, and deletes. Component validation still rejects traversal and symlinks, while the final filesystem operation remains rooted at the approved directory handle. `NomadNode::shutdown` also aborts and joins its background tasks so the embedder can release the old capability only after every sink has stopped.

```bash
./scripts/apply-rsNomad-picker-pinned-roots.sh
```

Remove after the reviewed rsNomad pin has equivalent handle-relative content-root resolution and the content-store replacement-race test.

## Removed: rsLXMF-propagation-client-link-attached-tx.patch

Sunset after the reviewed `RS_LXMF_PIN` included PropagationClient link-scoped TX with `SendLinkEndpoint` plus `attached_interface` (interface-pinned link TX). That superseded the local `OutboundAttached` / `queue_link_outbound` overlay for the same pathless-Link flood as [ratspeak/rsReticulum#22](https://github.com/ratspeak/rsReticulum/issues/22). Tracked entry removed from `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` after pin-based sunset confirmation.

## rsReticulum-rncp-inbound-admission.patch

Moves RNCP receive policy ahead of Resource acceptance. The listener requires an authenticated sender, rejects blocked, oversized, over-concurrent, and over-reserved advertisements before parts arrive, bounds cumulative actual data and metadata before each segment is acknowledged or retained, rechecks final payload sizes, and can hand the verified bytes to mesh-client without writing them first. The stock `rns-tools rncp --listen` path remains in `SaveToDirectory` compatibility mode.

| Field | Value |
| ----- | ----- |
| **Base commit** | reviewed `RS_RETICULUM_PIN` `799e946ac997f388395fec4e8c49ea55a03e5bc8` (v1.3.0) after the other rsReticulum overlays |
| **Upstream PR** | none yet (mesh-client-local; watch ratspeak/rsReticulum) |

**Touches:** `crates/rns-runtime/src/rncp.rs`, `crates/rns-runtime/src/link_manager.rs`, `crates/rns-tools/src/commands/rncp.rs`, the generated API snapshots for earlier stacked overlays, and `api/stability.json`

### Apply locally

```bash
./scripts/apply-rsReticulum-rncp-inbound-admission.sh
```

Listed last in `scripts/lib/ratspeak-overlay-apply-list.sh` and `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` because its RNCP API snapshot includes earlier runtime overlays.

### Sunset

When upstream rsReticulum provides equivalent pre-advertisement identity, byte, concurrency, and reservation limits plus an application-owned payload handoff, remove this patch and its apply step.
