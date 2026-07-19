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

## rsLXMF-propagation-sync-peering.patch

LinkIdentify + peering stamp before LXMF `/offer`, plus `set_local_identity` / `configure_peering` / `last_offer_error` / `last_finished_ok` on `PropagationSyncTask` so mesh-client can complete remote PN sync and distinguish HaveAll success from Failed after Complete→Idle cleanup.

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
