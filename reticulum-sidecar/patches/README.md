# rsReticulum overlays

Patches applied on top of pinned [ratspeak/rsReticulum](https://github.com/ratspeak/rsReticulum) checkouts for mesh-client `rns-stack` builds.

## rsReticulum-packet-tap.patch

Wire packet tap API for the Reticulum Stats/Sniffer panel (`wire_packet` WebSocket events, `GET /api/v1/packets`).

| Field | Value |
| ----- | ----- |
| **Base commit** | `6d2b28475321bc15c8f60796513d8878b47ed3ab` |
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
git diff 6d2b28475321bc15c8f60796513d8878b47ed3ab -- \
  crates/rns-runtime/src/reticulum.rs \
  crates/rns-transport/src/messages.rs \
  crates/rns-transport/src/actor/mod.rs \
  crates/rns-transport/src/actor/inbound.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-packet-tap.patch
git -C /tmp/rsReticulum-patch-test checkout 6d2b28475321bc15c8f60796513d8878b47ed3ab
git -C /tmp/rsReticulum-patch-test apply --check ../mesh-client/reticulum-sidecar/patches/rsReticulum-packet-tap.patch
```

### Sunset

When the upstream PR merges, remove this patch, drop the CI apply step, and clone `ratspeak/rsReticulum` `main` directly in `build-rns-stack` jobs.

## rsReticulum-auto-beacon-utun.patch

Skip macOS/iOS VPN tunnel interfaces (`utun*`, `ipsec*`, `ppp*`) for AutoInterface link-local enumeration; per-interface exponential backoff and WARN→DEBUG downgrade on repeated beacon TX failures (fixes ENOBUFS log spam on macOS VPN utun).

| Field | Value |
| ----- | ----- |
| **Base commit** | `6d2b28475321bc15c8f60796513d8878b47ed3ab` |
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
git diff 6d2b28475321bc15c8f60796513d8878b47ed3ab -- crates/rns-interface/src/auto.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
git -C /tmp/rsReticulum-patch-test checkout 6d2b28475321bc15c8f60796513d8878b47ed3ab
git -C /tmp/rsReticulum-patch-test apply --check ../mesh-client/reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
```

### Sunset

When [ratspeak/rsReticulum#11](https://github.com/ratspeak/rsReticulum/pull/11) merges, remove this patch and drop the CI apply step (same as packet-tap).

## rsReticulum-link-client-nomad.patch

Recall cached destination public keys in `LinkClient` before waiting on path-response announces; GC temporary announce handlers without wiping long-lived Nomad directory listeners. Fixes Nomad page loads hanging until overall timeout.

| Field | Value |
| ----- | ----- |
| **Base commit** | `6d2b28475321bc15c8f60796513d8878b47ed3ab` |
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
git -C /tmp/rsReticulum-patch-test checkout 6d2b28475321bc15c8f60796513d8878b47ed3ab
git -C /tmp/rsReticulum-patch-test apply reticulum-sidecar/patches/rsReticulum-packet-tap.patch
git -C /tmp/rsReticulum-patch-test apply reticulum-sidecar/patches/rsReticulum-auto-beacon-utun.patch
git -C /tmp/rsReticulum-linkclient-nomad format-patch -1 --stdout \
  | git -C /tmp/rsReticulum-patch-test apply
git -C /tmp/rsReticulum-patch-test diff \
  > reticulum-sidecar/patches/rsReticulum-link-client-nomad.patch
```

### Sunset

When [ratspeak/rsReticulum#14](https://github.com/ratspeak/rsReticulum/pull/14) merges, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsReticulum-rnode-tcp-activity-keepalive.patch

Port Python `RNodeInterface` / `TCPConnection.ACTIVITY_KEEPALIVE` (3.5s idle → `detect()`): Wi‑Fi/TCP RNodes otherwise close the socket at ~`ACTIVITY_TIMEOUT` (6s), causing mesh-client / rnsd-rs up/down flaps.

| Field | Value |
| ----- | ----- |
| **Base commit** | `4095022` (`ratspeak/rsReticulum` `main` tip when generated; also applies on pin `6d2b28475321bc15c8f60796513d8878b47ed3ab`) |
| **Upstream PR** | https://github.com/ratspeak/rsReticulum/pull/15 |

**Modifies (1 file):**

- `crates/rns-interface/src/rnode.rs` — TCP activity keepalive constants + write-loop `detect()` on idle

### Apply locally

From mesh-client repo root (sibling `../rsReticulum` required):

```bash
./scripts/apply-rsReticulum-rnode-tcp-activity-keepalive.sh
```

Apply after the other rsReticulum overlays when rebuilding a pinned checkout:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
./scripts/apply-rsReticulum-rnode-tcp-activity-keepalive.sh
```

### Regenerate

```bash
cd ../rsReticulum
git fetch origin
git diff origin/main...HEAD -- crates/rns-interface/src/rnode.rs \
  > ../mesh-client/reticulum-sidecar/patches/rsReticulum-rnode-tcp-activity-keepalive.patch
```

### Sunset

When [ratspeak/rsReticulum#15](https://github.com/ratspeak/rsReticulum/pull/15) merges, remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsReticulum-ble-rnode-pairing-transition-debounce.patch

Debounce BLE RNode reconnect after mid-SMP disconnect (`BLE pairing in progress`): wait **30s** instead of **1s** so macOS/Windows OS passkey dialogs are not re-fired while the user enters the PIN.

| Field | Value |
| ----- | ----- |
| **Base commit** | applies on current `rsReticulum` tip used for mesh-client overlays (also intended for pin `6d2b28475321bc15c8f60796513d8878b47ed3ab`) |
| **Upstream PR** | none yet (mesh-client overlay) |

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
./scripts/apply-rsReticulum-rnode-tcp-activity-keepalive.sh
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

When upstream ships an equivalent debounce (or a passkey-window pause), remove this patch and drop the apply step from `clone-ratspeak-stack.sh` / `ensure-rsReticulum-patches.sh`.

## rsReticulum-discovery-announce-egress.patch

Register `rnstransport.discovery.interface` as a local destination before announcing, and defer `Announcer::register` until the discoverable interface online latch is true. Without this, Boundary hubs such as **rmap.world** silently drop discovery announces (non-local + no path), and BLE RNode can consume a multi-hour `announce_interval` on a no-op TX while still connecting.

| Field | Value |
| ----- | ----- |
| **Base commit** | `6d2b28475321bc15c8f60796513d8878b47ed3ab` (after prior overlays) |
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
./scripts/apply-rsReticulum-rnode-tcp-activity-keepalive.sh
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
