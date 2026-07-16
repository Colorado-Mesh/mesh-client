# mesh-client-reticulum sidecar

Headless Reticulum/LXMF daemon spawned by mesh-client Electron main process.

## Prerequisites

Install Rust (**1.85+**, edition 2024). Prefer [rustup](https://rustup.rs/). See [docs/development-environment.md](../docs/development-environment.md#reticulum-sidecar-optional).

## Build

**Default (stub stack)** — builds without `--features rns-stack`; Cargo still requires sibling `rsReticulum` and `rsLXMF` directories on disk (CI checkouts them automatically; locally clone both next to `mesh-client`):

```bash
pnpm run reticulum:sidecar:build
```

**Full rsReticulum + rsLXMF** — sibling checkout (Ratspeak layout):

```
parent/
  rsReticulum/
  rsLXMF/
  mesh-client/reticulum-sidecar/
```

Apply overlays (required for `rns-stack` until upstream merges):

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-link-client-nomad.sh
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
| `pnpm run check:reticulum-sidecar` | Pre-commit: fmt + stub clippy + stub test |
| `pnpm run reticulum:sidecar:coverage` | Optional local HTML coverage (`cargo llvm-cov`; no threshold) |

Install coverage tooling once: `cargo install cargo-llvm-cov`.

- **Pre-commit** runs stub fmt/clippy/test when `cargo` is on `PATH` (no coverage).
- **CI lint** (`reticulum-sidecar.yaml`): full-feature `fmt --check` + Clippy.
- **CI coverage** (`tests.yaml`): `cargo llvm-cov --fail-under-lines 47` when sidecar paths change (ratchet toward ~52%).

## API

[docs/reticulum-sidecar-ipc.md](../docs/reticulum-sidecar-ipc.md)

## License

AGPL-3.0-or-later (separate process from MIT mesh-client app).
