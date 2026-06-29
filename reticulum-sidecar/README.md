# mesh-client-reticulum sidecar

Headless Reticulum/LXMF daemon spawned by mesh-client Electron main process.

## Prerequisites

Install Rust so `cargo` is on your `PATH`. **Prefer [rustup](https://rustup.rs/)** (matches CI). On macOS, `brew install rust` also works — do not install both rustup and Homebrew rust. See [docs/development-environment.md](../docs/development-environment.md#reticulum-sidecar-optional).

## Build

From repo root (debug binary used by Electron dev):

```bash
pnpm run reticulum:sidecar:build
```

Or manually:

```bash
cd reticulum-sidecar
cargo build
cargo build --release
```

Default build is a **stub** HTTP/WS server (no rsReticulum). For the full stack:

```bash
cargo build --release --features rns-stack
```

Requires pinned git deps in `Cargo.toml` (coordinate with [Ratspeak](https://github.com/ratspeak/Ratspeak) releases).

## Dev

From repo root:

```bash
pnpm run reticulum:sidecar:dev
curl -s http://127.0.0.1:19437/api/v1/status
```

Or start the stack from the app: **Reticulum** tab → **Connection** → **Start stack**.

`pnpm run update` runs `rustup update` (when installed) and rebuilds this crate.

## Sibling checkout (Ratspeak layout)

```
ratspeak-src/
  rsReticulum/
  rsLXMF/
  mesh-client/reticulum-sidecar/
```

## API

See [docs/reticulum-sidecar-ipc.md](../docs/reticulum-sidecar-ipc.md).

## License

AGPL-3.0-or-later (separate process from MIT mesh-client app).
