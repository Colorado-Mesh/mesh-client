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

```bash
cd reticulum-sidecar
cargo build --release --features rns-stack
```

Optional: `--features rns-stack,rns-serial,rns-ble`

## Dev

```bash
pnpm run reticulum:sidecar:dev
curl -s http://127.0.0.1:19437/api/v1/status
```

Or **Reticulum tab → Connection → Start stack** (sidecar must be running before identity or Radio configuration).

## API

[docs/reticulum-sidecar-ipc.md](../docs/reticulum-sidecar-ipc.md)

## License

AGPL-3.0-or-later (separate process from MIT mesh-client app).
