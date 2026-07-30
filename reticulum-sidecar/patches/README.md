# rsReticulum overlays

Patches applied on top of pinned [ratspeak/rsReticulum](https://github.com/ratspeak/rsReticulum) checkouts for mesh-client `rns-stack` builds.

## Development — overlays/patches

Overlays require **git checkouts** of sibling repos next to this clone (not a bare Cargo cache path):

- `../rsReticulum` — rsReticulum source at the pinned commit used by `clone-ratspeak-stack.sh`
- `../rsLXMF` — when applying LXMF overlays

**First-time setup:**

```bash
# From mesh-client repo root — clones/pins siblings and applies known overlays
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

```bash
cd ../rsReticulum
git fetch origin
git diff 9928abed269a83ec5a7ef165ff1142d938cad706 -- \
  crates/rns-runtime/src/reticulum.rs \
  crates/rns-transport/src/messages.rs \
  crates/rns-transport/src/actor/mod.rs \
  crates/rns-transport/src/actor/inbound.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-packet-tap.patch
git -C /tmp/rsReticulum-patch-test checkout 9928abed269a83ec5a7ef165ff1142d938cad706
git -C /tmp/rsReticulum-patch-test apply --check ../mesh-client/reticulum-sidecar/patches/rsReticulum-packet-tap.patch
```

### Sunset

When the upstream PR merges, remove this patch, drop the CI apply step, and clone `ratspeak/rsReticulum` `main` directly in `build-rns-stack` jobs.

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

```bash
cd ../rsReticulum
# after implementing on top of RS_RETICULUM_REF
git diff 9928abed269a83ec5a7ef165ff1142d938cad706 -- crates/rns-interface/src/auto.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
git -C /tmp/rsReticulum-patch-test checkout 9928abed269a83ec5a7ef165ff1142d938cad706
git -C /tmp/rsReticulum-patch-test apply --check ../mesh-client/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
```

### Sunset

When [ratspeak/rsReticulum#11](https://github.com/ratspeak/rsReticulum/pull/11) merges, remove this patch and drop the CI apply step (same as packet-tap).

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

Apply after packet-tap + auto-beacon when rebuilding a pinned checkout:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
```

### Regenerate

```bash
# From a clean pin with the other overlays applied, then the upstream commit:
git -C /tmp/rsReticulum-patch-test checkout 9928abed269a83ec5a7ef165ff1142d938cad706
git -C /tmp/rsReticulum-patch-test apply reticulum-sidecar/patches/rsReticulum-packet-tap.patch
git -C /tmp/rsReticulum-patch-test apply reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
git -C /tmp/rsReticulum-linkclient-nomad format-patch -1 --stdout \
  | git -C /tmp/rsReticulum-patch-test apply
git -C /tmp/rsReticulum-patch-test diff \
  > reticulum-sidecar/patches/rsReticulum-link-client-nomad.patch
```

### Sunset

When [ratspeak/rsReticulum#14](https://github.com/ratspeak/rsReticulum/pull/14) merges, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## Removed: rsReticulum-rnode-tcp-activity-keepalive.patch

Sunset when upstream landed `RNodeIdleProbe` (`88d3d38` — *rnode: restore TCP application idle probes*). [ratspeak/rsReticulum#15](https://github.com/ratspeak/rsReticulum/pull/15) was closed as superseded; mesh-client no longer carries that overlay (pin `9928abed269a83ec5a7ef165ff1142d938cad706` or later already includes idle probes). `RATSPEAK_PATCH_ENTRIES` in `scripts/update.sh` still tracks `#15` so `pnpm run update` warns on closed-without-merge until the entry is dropped after sunset is confirmed.

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

Apply after the other rsReticulum overlays when rebuilding a pinned checkout:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
./scripts/apply-rsReticulum-discovery-announce-egress.sh
```

### Regenerate

```bash
cd ../rsReticulum
git diff -- crates/rns-interface/src/ble_rnode.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-ble-rnode-pairing-transition-debounce.patch
```

### Sunset

When [ratspeak/rsReticulum#20](https://github.com/ratspeak/rsReticulum/pull/20) merges and the clone pin includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

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

```bash
# After applying prior overlays on the pin, implement the discovery fix, then:
cd ../rsReticulum
git diff -- \
  crates/rns-runtime/src/reticulum.rs \
  crates/rns-transport/src/actor/mod.rs \
  crates/rns-transport/src/discovery/announcer.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-discovery-announce-egress.patch
```

### Sunset

When [ratspeak/rsReticulum#19](https://github.com/ratspeak/rsReticulum/pull/19) merges and the clone pin includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsLXMF-propagation-sync-peering.patch

LinkIdentify + peering stamp before LXMF `/offer`, sticky offer/finish fields, plus Establishing diagnostics (`last_establish_error` + warn when LRPROOF is ignored for missing identity or invalid proof) so mesh-client can complete remote PN sync and surface non-generic failures.

| Field | Value |
| ----- | ----- |
| **Base commit** | `68ad7c835187c052c763bb28c41b04a655f35c64` |
| **Upstream PR** | https://github.com/ratspeak/rsLXMF/pull/4 |

**Modifies (1 file):**

- `crates/lxmf-core/src/propagation_sync.rs` — identify/stamp before `/offer`; sync task peering + sticky finish fields

### Apply locally

From mesh-client repo root (sibling `../rsLXMF` required):

```bash
./scripts/apply-rsLXMF-propagation-sync-peering.sh
```

`clone-ratspeak-stack.sh` and `ensure-rsReticulum-patches.sh` invoke this automatically.

### Regenerate

```bash
cd ../rsLXMF
git fetch origin
git diff 68ad7c835187c052c763bb28c41b04a655f35c64 -- crates/lxmf-core/src/propagation_sync.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsLXMF-propagation-sync-peering.patch
```

### Sunset

When [ratspeak/rsLXMF#4](https://github.com/ratspeak/rsLXMF/pull/4) merges, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsLXMF-propagation-node-policy-setters.patch

Live mutators for local PN hosting policy updates (`set_peering_cost`, `set_max_storage`, `set_max_message_size`). Upstream pin only exposes `set_min_stamp_cost`; mesh-client `pn_hosting_apply` needs the others so policy edits apply without recreating the node.

| Field | Value |
| ----- | ----- |
| **Base commit** | `68ad7c835187c052c763bb28c41b04a655f35c64` |
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
git fetch origin
git diff 68ad7c835187c052c763bb28c41b04a655f35c64 -- crates/lxmf-core/src/propagation_node.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsLXMF-propagation-node-policy-setters.patch
```

### Sunset

When [ratspeak/rsLXMF#6](https://github.com/ratspeak/rsLXMF/pull/6) merges and the clone pin includes it, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsLXMF-link-delivery-has-pending-to.patch

Expose `LinkDeliveryManager::has_pending_to` so the sidecar can serialize packed Propagated deposits (and propagation sync) against an in-flight Link to the same PN. Pinned rsLXMF only has `delivery_link_available` (reusable idle link), which is the wrong predicate for one-shot packed sessions.

| Field | Value |
| ----- | ----- |
| **Base commit** | `68ad7c835187c052c763bb28c41b04a655f35c64` |
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
git fetch origin
git diff 68ad7c835187c052c763bb28c41b04a655f35c64 -- crates/lxmf-core/src/link_delivery.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsLXMF-link-delivery-has-pending-to.patch
```

### Sunset

When upstream ships `has_pending_to` (or an equivalent) on the clone pin, remove this patch and drop the apply step.
