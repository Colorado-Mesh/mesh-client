# rsReticulum / rsLXMF overlays

Patches applied on top of [ratspeak/rsReticulum](https://github.com/ratspeak/rsReticulum) / [ratspeak/rsLXMF](https://github.com/ratspeak/rsLXMF) checkouts for mesh-client `rns-stack` builds (sibling [Colorado-Mesh/rsNomad](https://github.com/Colorado-Mesh/rsNomad) is also required for Nomad hosting; no mesh-client overlay today).

By default `scripts/clone-ratspeak-stack.sh` floats siblings to **`origin/main`** and applies these overlays (fails loud if a patch will not apply). Use `RS_RETICULUM_REF` / `RS_LXMF_REF` / `RS_NOMAD_REF` to pin a known-good SHA for bisect. Per-overlay **Base commit** tables below record the last regeneration baseline, not a permanent pin — when regenerating, prefer floated `origin/main` and record the short SHA in the PR.

## Development — overlays/patches

Overlays require **git checkouts** of sibling repos next to this clone (not a bare Cargo cache path):

- `../rsReticulum` — floated to `origin/main` unless `RS_RETICULUM_REF` is set
- `../rsLXMF` — floated to `origin/main` unless `RS_LXMF_REF` is set
- `../rsNomad` — floated to `origin/main` unless `RS_NOMAD_REF` is set

**First-time setup:**

```bash
# From mesh-client repo root — clones/floats siblings and applies known overlays
./scripts/clone-ratspeak-stack.sh
# Or ensure patches on an existing sibling tree:
./scripts/ensure-rsReticulum-patches.sh
```

Apply a single overlay when developing that patch:

```bash
./scripts/apply-rsReticulum-discovery-announce-egress.sh
git -C ../rsReticulum status --short
```

If a patch is skipped or conflicts after an upstream bump, CI/`ensure-rsReticulum-patches.sh` will fail. Rebase the overlay, regenerate the `.patch` file per the section below, then re-run the apply script.

## rsReticulum-packet-tap.patch

Wire packet tap API for the Reticulum Stats/Sniffer panel (`wire_packet` WebSocket events, `GET /api/v1/packets`).

| Field | Value |
| ----- | ----- |
| **Base commit** | `9928abed269a83ec5a7ef165ff1142d938cad706` |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/10 |

**Adds (4 files):**

- `crates/rns-transport/src/messages.rs` — `PacketTapDirection`, `PacketTapEvent`, `SetPacketTap`
- `crates/rns-transport/src/actor/mod.rs` — tap storage, RX/TX emit
- `crates/rns-transport/src/actor/inbound.rs` — RX tap on inbound
- `crates/rns-runtime/src/reticulum.rs` — `ReticulumHandle::register_packet_tap`

### Apply locally

From mesh-client repo root (sibling `../rsReticulum` required):

```bash
./scripts/apply-rsReticulum-packet-tap.sh
```

### Regenerate

Regenerate against floated `origin/main` (record the short SHA in the PR):

```bash
cd ../rsReticulum
git fetch origin && git checkout --detach origin/main
# apply local packet-tap edits, then:
git diff -- \
  crates/rns-runtime/src/reticulum.rs \
  crates/rns-transport/src/messages.rs \
  crates/rns-transport/src/actor/mod.rs \
  crates/rns-transport/src/actor/inbound.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-packet-tap.patch
# smoke-check on a clean tip clone:
git -C /tmp/rsReticulum-patch-test fetch origin
git -C /tmp/rsReticulum-patch-test checkout --detach origin/main
git -C /tmp/rsReticulum-patch-test apply --check ../mesh-client/reticulum-sidecar/patches/rsReticulum-packet-tap.patch
```

### Sunset

When the upstream PR merges and floated `origin/main` includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsReticulum-auto-beacon-utun.patch

Skip macOS/iOS VPN tunnel interfaces (`utun*`, `ipsec*`, `ppp*`) for AutoInterface link-local enumeration; per-interface exponential backoff and WARN→DEBUG downgrade on repeated beacon TX failures (fixes ENOBUFS log spam on macOS VPN utun).

| Field | Value |
| ----- | ----- |
| **Base commit** | `9928abed269a83ec5a7ef165ff1142d938cad706` |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/11 |

**Modifies (1 file):**

- `crates/rns-interface/src/auto.rs` — tunnel iface filter, beacon TX backoff, log downgrade

### Apply locally

From mesh-client repo root (sibling `../rsReticulum` required):

```bash
./scripts/apply-rsReticulum-auto-beacon-utun.sh
```

Apply after the packet-tap patch when both overlays are needed:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
```

### Regenerate

Regenerate against floated `origin/main` (record the short SHA in the PR):

```bash
cd ../rsReticulum
git fetch origin && git checkout --detach origin/main
# after implementing the utun filter/backoff, then:
git diff -- crates/rns-interface/src/auto.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
git -C /tmp/rsReticulum-patch-test fetch origin
git -C /tmp/rsReticulum-patch-test checkout --detach origin/main
git -C /tmp/rsReticulum-patch-test apply --check ../mesh-client/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
```

### Sunset

When [ratspeak/rsReticulum#11](https://github.com/ratspeak/rsReticulum/pull/11) merges and floated `origin/main` includes it, remove this patch and drop the apply step (same as packet-tap).

## rsReticulum-link-client-nomad.patch

Recall cached destination public keys in `LinkClient` before waiting on path-response announces; GC temporary announce handlers without wiping long-lived Nomad directory listeners. Fixes Nomad page loads hanging until overall timeout.

| Field | Value |
| ----- | ----- |
| **Base commit** | `9928abed269a83ec5a7ef165ff1142d938cad706` |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/14 |

**Modifies (4 files):**

- `crates/rns-runtime/src/link_client.rs` — recall + `await_path`; safe announce-handler GC
- `crates/rns-transport/src/messages.rs` — `RecallDestinationPublicKey`, `PublicKeyResult`
- `crates/rns-transport/src/actor/rpc.rs` — recall handler
- `crates/rns-transport/src/actor/mod.rs` — unit tests

### Apply locally

From mesh-client repo root (sibling `../rsReticulum` required):

```bash
./scripts/apply-rsReticulum-link-client-nomad.sh
```

Apply after packet-tap + auto-beacon when rebuilding against floated `origin/main`:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
```

### Regenerate

Regenerate against floated `origin/main` (record the short SHA in the PR):

```bash
# From a clean tip with the other overlays applied, then the LinkClient edits:
git -C /tmp/rsReticulum-patch-test fetch origin
git -C /tmp/rsReticulum-patch-test checkout --detach origin/main
git -C /tmp/rsReticulum-patch-test apply reticulum-sidecar/patches/rsReticulum-packet-tap.patch
git -C /tmp/rsReticulum-patch-test apply reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
git -C /tmp/rsReticulum-linkclient-nomad format-patch -1 --stdout \
  | git -C /tmp/rsReticulum-patch-test apply
git -C /tmp/rsReticulum-patch-test diff \
  > reticulum-sidecar/patches/rsReticulum-link-client-nomad.patch
```

### Sunset

When [ratspeak/rsReticulum#14](https://github.com/ratspeak/rsReticulum/pull/14) merges and floated `origin/main` includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsReticulum-link-client-proof-budget.patch

Keep `LinkClient::query` proof wait on the **remaining overall deadline** (v5.25.0 / release parity). Earlier overlays capped at `establishment_timeout` (hops×6) or `max(establishment, 30s)` and false-failed multi-hop TCP hub Nomad pages (e.g. Northern Ireland) that need the rest of the MeshChat 45s window. Apply **after** the LinkClient Nomad overlay; the apply script migrates those older caps to remaining-deadline.

| Field | Value |
| ----- | ----- |
| **Depends on** | `rsReticulum-link-client-nomad.patch` |
| **Upstream PR** | (mesh-client local; fold into #14 follow-up when possible) |

### Apply locally

```bash
./scripts/apply-rsReticulum-link-client-proof-budget.sh
```

## Removed: rsReticulum-rnode-tcp-activity-keepalive.patch

Sunset when upstream landed `RNodeIdleProbe` (`88d3d38` — *rnode: restore TCP application idle probes*). [ratspeak/rsReticulum#15](https://github.com/ratspeak/rsReticulum/pull/15) was closed as superseded; mesh-client no longer carries that overlay (floated `origin/main` already includes idle probes). Tracked entry removed from `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` after sunset confirmation.

## rsReticulum-ble-rnode-pairing-transition-debounce.patch

Debounce BLE RNode reconnect after mid-SMP disconnect (`BLE pairing in progress`): wait **30s** instead of **1s** so macOS/Windows OS passkey dialogs are not re-fired while the user enters the PIN.

| Field | Value |
| ----- | ----- |
| **Base commit** | `9928abed269a83ec5a7ef165ff1142d938cad706` (after prior overlays) |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/20 |

**Modifies (1 file):**

- `crates/rns-interface/src/ble_rnode.rs` — `PAIRING_TRANSITION_RETRY_WAIT = 30`

### Apply locally

From mesh-client repo root (sibling `../rsReticulum` required):

```bash
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
```

Apply after the other rsReticulum overlays when rebuilding against floated `origin/main`:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
./scripts/apply-rsReticulum-discovery-announce-egress.sh
```

### Regenerate

Regenerate against floated `origin/main` (record the short SHA in the PR):

```bash
cd ../rsReticulum
git fetch origin && git checkout --detach origin/main
# apply local debounce edit, then:
git diff -- crates/rns-interface/src/ble_rnode.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-ble-rnode-pairing-transition-debounce.patch
```

### Sunset

When [ratspeak/rsReticulum#20](https://github.com/ratspeak/rsReticulum/pull/20) merges and floated `origin/main` includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsReticulum-discovery-announce-egress.patch

Register `rnstransport.discovery.interface` as a local destination before announcing, and defer `Announcer::register` until the discoverable interface online latch is true. Without this, Boundary hubs such as **rmap.world** silently drop discovery announces (non-local + no path), and BLE RNode can consume a multi-hour `announce_interval` on a no-op TX while still connecting.

| Field | Value |
| ----- | ----- |
| **Base commit** | `9928abed269a83ec5a7ef165ff1142d938cad706` (after prior overlays) |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/19 |

**Modifies (3 files):**

- `crates/rns-runtime/src/reticulum.rs` — online latch on `LocalDiscoveryInterface`, `take_online_discovery_interfaces`, `discovery_local_destination_registration`, deferred announcer
- `crates/rns-transport/src/actor/mod.rs` — outbound discovery announce egress regression tests
- `crates/rns-transport/src/discovery/announcer.rs` — RateLimit-after-discard regression test

### Apply locally

From mesh-client repo root (sibling `../rsReticulum` required):

```bash
./scripts/apply-rsReticulum-discovery-announce-egress.sh
```

Apply **after** the other rsReticulum overlays (packet-tap also touches `reticulum.rs`):

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
./scripts/apply-rsReticulum-discovery-announce-egress.sh
```

### Regenerate

Regenerate against floated `origin/main` (record the short SHA in the PR):

```bash
# After applying prior overlays on tip, implement the discovery fix, then:
cd ../rsReticulum
git fetch origin && git checkout --detach origin/main
git diff -- \
  crates/rns-runtime/src/reticulum.rs \
  crates/rns-transport/src/actor/mod.rs \
  crates/rns-transport/src/discovery/announcer.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-discovery-announce-egress.patch
```

### Sunset

When [ratspeak/rsReticulum#19](https://github.com/ratspeak/rsReticulum/pull/19) merges and floated `origin/main` includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsLXMF-propagation-sync-peering.patch

LinkIdentify + peering stamp before LXMF `/offer`, sticky offer/finish fields, plus Establishing diagnostics (`last_establish_error` + warn when LRPROOF is ignored for missing identity or invalid proof) so mesh-client can complete remote PN sync and surface non-generic failures.

| Field | Value |
| ----- | ----- |
| **Base commit** | historical (`68ad7c8…`); tip uses `set_identity` / `send_identify` instead |
| **Upstream PR** | https://github.com/ratspeak/rsLXMF/pull/4 |

**Modifies (1 file):**

- `crates/lxmf-core/src/propagation_sync.rs` — identify/stamp before `/offer` on older checkouts. On current `main`, apply script no-ops when `set_identity` is already present.

### Apply locally

From mesh-client repo root (sibling `../rsLXMF` required):

```bash
./scripts/apply-rsLXMF-propagation-sync-peering.sh
```

`clone-ratspeak-stack.sh` and `ensure-rsReticulum-patches.sh` invoke this automatically.

### Regenerate

On current floated `origin/main`, the apply script **no-ops** when `set_identity` is already present — regenerate only if you still need the overlay for an older pin:

```bash
cd ../rsLXMF
git fetch origin && git checkout --detach origin/main
# only needed for older pins without set_identity / send_identify:
git diff -- crates/lxmf-core/src/propagation_sync.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsLXMF-propagation-sync-peering.patch
```

### Sunset

When floated `origin/main` always includes identify/stamp before `/offer` (tip already does via `set_identity`), remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsLXMF-propagation-node-policy-setters.patch

Live mutators for local PN hosting policy updates (`set_peering_cost`, `set_max_storage`, `set_max_message_size`). Floated rsLXMF tip only exposes `set_min_stamp_cost`; mesh-client `pn_hosting_apply` needs the others so policy edits apply without recreating the node.

| Field | Value |
| ----- | ----- |
| **Base commit** | tip of `ratspeak/rsLXMF` `main` (regenerated for float-to-main) |
| **Upstream PR** | https://github.com/ratspeak/rsLXMF/pull/6 |

**Modifies (1 file):**

- `crates/lxmf-core/src/propagation_node.rs` — three policy setters on `PropagationNode`

### Apply locally

From mesh-client repo root (sibling `../rsLXMF` required):

```bash
./scripts/apply-rsLXMF-propagation-node-policy-setters.sh
```

`clone-ratspeak-stack.sh` and `ensure-rsReticulum-patches.sh` invoke this automatically.

### Regenerate

```bash
cd ../rsLXMF
git fetch origin && git checkout --detach origin/main
# apply local setter edits, then:
git diff -- crates/lxmf-core/src/propagation_node.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsLXMF-propagation-node-policy-setters.patch
```

### Sunset

When [ratspeak/rsLXMF#6](https://github.com/ratspeak/rsLXMF/pull/6) merges and floated `origin/main` includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsLXMF-link-delivery-has-pending-to.patch

Expose `LinkDeliveryManager::has_pending_to` so the sidecar can serialize packed Propagated deposits (and propagation sync) against an in-flight Link to the same PN. Floated rsLXMF tip only has `delivery_link_available` (reusable idle link), which is the wrong predicate for one-shot packed sessions.

| Field | Value |
| ----- | ----- |
| **Base commit** | tip of `ratspeak/rsLXMF` `main` (regenerated for float-to-main) |
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
cd ../rsLXMF
git fetch origin && git checkout --detach origin/main
# apply local has_pending_to edit, then:
git diff -- crates/lxmf-core/src/link_delivery.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsLXMF-link-delivery-has-pending-to.patch
```

### Sunset

When upstream ships `has_pending_to` (or an equivalent) on floated `origin/main`, remove this patch and drop the apply step.

## rsReticulum-path-medium-slots.patch

Ranked multi-path slots (up to 3 per destination) plus global / per-peer RF-vs-network medium preference in `rns-transport`. Apply **after** the other rsReticulum overlays (packet-tap, discovery egress, …).

| Field | Value |
| ----- | ----- |
| **Base commit** | `9928abed269a83ec5a7ef165ff1142d938cad706` (+ prior mesh-client overlays) |
| **Upstream PR** | none yet (mesh-client-local) |

**Touches:** `constants.rs`, `path_table.rs`, `messages.rs`, `actor/{inbound,mod,rpc,outbound,persistence}.rs`

### Apply locally

```bash
./scripts/apply-rsReticulum-path-medium-slots.sh
```

### Sunset

When ratspeak/rsReticulum lands equivalent multi-slot ranking + medium preference, remove this patch and the apply step from `ensure-rsReticulum-patches.sh` / `clone-ratspeak-stack.sh` / `update.sh`.

## rsReticulum-inbound-raw-saturation-log.patch

Log when `LinkManager` opportunistic inbound-raw `try_send` fails because the bounded channel is full (tokio mpsc drops the **newest** packet; not drop-oldest).

| Field | Value |
| ----- | ----- |
| **Base commit** | floated `origin/main` (regenerate; record short SHA in PR) |
| **Upstream PR** | none yet (mesh-client-local) |

**Touches:** `crates/rns-runtime/src/link_manager.rs`

### Apply locally

```bash
./scripts/apply-rsReticulum-inbound-raw-saturation-log.sh
```

### Sunset

When upstream logs (or otherwise surfaces) inbound-raw saturation the same way, remove this patch and the apply step.
