# mesh-client-reticulum sidecar

Headless Reticulum/LXMF daemon spawned by mesh-client Electron main process.

## Prerequisites

Install Rust (**1.85+**, edition 2024). Prefer [rustup](https://rustup.rs/). See [docs/development-environment.md](../docs/development-environment.md#reticulum-sidecar-optional).

## Build

**Default (stub stack)** — builds without `--features rns-stack`; Cargo still requires sibling `rsReticulum`, `rsLXMF`, and `rsNomad` directories on disk (CI checkouts them automatically; locally clone next to `mesh-client`):

```bash
pnpm run reticulum:sidecar:build
```

**Full rsReticulum + rsLXMF + rsNomad** — sibling checkout (Ratspeak layout + Colorado-Mesh rsNomad):

```
parent/
  rsReticulum/
  rsLXMF/
  rsNomad/
  mesh-client/reticulum-sidecar/
```

Apply overlays (required for `rns-stack` until upstream merges):

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
./scripts/apply-rsReticulum-rnode-tcp-activity-keepalive.sh
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
./scripts/apply-rsLXMF-propagation-sync-peering.sh
```

See [patches/README.md](patches/README.md) for base SHA and regen steps.

```bash
cd reticulum-sidecar
cargo build --release --features rns-stack
```

Optional: `--features rns-stack,rns-serial,rns-ble,rns-rnode-tcp`

## Dev

```bash
pnpm run reticulum:sidecar:dev
curl -s http://127.0.0.1:19437/api/v1/status
```

Or **Reticulum tab → Connection → Start stack** (sidecar must be running before identity or Network configuration).

## Lint and coverage

Toolchain components (`clippy`, `rustfmt`, `llvm-tools-preview`) come from [`rust-toolchain.toml`](rust-toolchain.toml).

| Command | Purpose |
| ------- | ------- |
| `pnpm run reticulum:sidecar:fmt` | `cargo fmt` |
| `pnpm run reticulum:sidecar:fmt:check` | `cargo fmt --check` |
| `pnpm run reticulum:sidecar:clippy` | Clippy stub build (`-D warnings`) |
| `pnpm run reticulum:sidecar:clippy:full` | Clippy with `rns-stack,rns-ble,rns-rnode-tcp` |
| `pnpm run reticulum:rsnomad:fmt:check` | Sibling `rsNomad` `cargo fmt --check` |
| `pnpm run reticulum:rsnomad:clippy` | Sibling `rsNomad` Clippy (`-D warnings`) |
| `pnpm run check:reticulum-sidecar` | Pre-commit: rsNomad + sidecar fmt/clippy/test |
| `pnpm run reticulum:sidecar:coverage` | Optional local HTML coverage (`cargo llvm-cov`; no threshold) |

Install coverage tooling once: `cargo install cargo-llvm-cov`.

- **Pre-commit** runs sibling `rsNomad` fmt/clippy plus sidecar stub fmt/clippy/test when `cargo` is on `PATH` (no coverage).
- **CI lint** (`reticulum-sidecar.yaml`): `rsNomad` fmt/clippy, then full-feature sidecar `fmt --check` + Clippy.
- **CI coverage** (`tests.yaml`): `cargo llvm-cov --fail-under-lines 45` when sidecar paths change (ratchet toward ~52%; ignores `rsReticulum`/`rsLXMF`/`rsNomad` path deps).
- **`rsNomad` pin:** `scripts/clone-ratspeak-stack.sh` checks out `RS_NOMAD_REF` (override or `RS_NOMAD_SKIP_PIN=1` for local work).

## API

[docs/reticulum-sidecar-ipc.md](../docs/reticulum-sidecar-ipc.md)

## License

AGPL-3.0-or-later (separate process from MIT mesh-client app).
