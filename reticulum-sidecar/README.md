# mesh-client-reticulum sidecar

Headless Reticulum/LXMF daemon spawned by mesh-client Electron main process.

## Prerequisites

Install Rust (**1.85+**, edition 2024). Prefer [rustup](https://rustup.rs/). See [docs/development-environment.md](../docs/development-environment.md#reticulum-sidecar-optional).

## Build

**First-time setup** — from the mesh-client repo root, clone/float the repo-local `.rsstack/` workspace and apply overlays:

```bash
./scripts/clone-ratspeak-stack.sh
```

That floats `rsReticulum` / `rsLXMF` / `rsNomad` / `rsLXST` / `lrgp-rs` under `.rsstack/` to `origin/main` (override with `RS_RETICULUM_REF` / `RS_LXMF_REF` / `RS_NOMAD_REF` / `RS_LXST_REF` / `RS_LRGP_REF` for bisect). Peer default avatars use [LXMFace](https://github.com/ratspeak/LXMFace) in the **renderer** (`src/renderer/lib/reticulum/lxmface.ts`), not this sidecar.

**Default (stub stack)** — builds without `--features rns-stack`; Cargo still requires the `.rsstack/` checkouts on disk (CI runs `clone-ratspeak-stack.sh`; locally use the script above):

```bash
pnpm run reticulum:sidecar:build
```

**Full rsReticulum + rsLXMF + rsNomad + rsLXST + lrgp-rs** — repo-local workspace (Ratspeak crates + Colorado-Mesh rsNomad + LXST voice + LRGP games):

```
mesh-client/
  .rsstack/
    rsReticulum/
    rsLXMF/
    rsLXST/
    lrgp-rs/
    rsNomad/
  reticulum-sidecar/
```

Prefer `./scripts/clone-ratspeak-stack.sh` (or `./scripts/ensure-rsReticulum-patches.sh` on an existing `.rsstack` tree). Individual apply scripts remain for single-overlay work:

```bash
./scripts/apply-rsReticulum-packet-tap.sh
./scripts/apply-rsReticulum-auto-beacon-utun.sh
./scripts/apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
./scripts/apply-rsReticulum-discovery-announce-egress.sh
./scripts/apply-rsLXMF-propagation-sync-peering.sh
./scripts/apply-rsLXMF-propagation-node-policy-setters.sh
./scripts/apply-rsLXMF-propagation-node-deferred-messagestore-load.sh
```

See [patches/README.md](patches/README.md) for overlay regen against floated `origin/main` (record the short SHA in the PR).

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

**Startup order (listen-first):** bootstrap persist → bind HTTP → accept `/api/v1/status` (`status: ok`) → `attach_live` (RNS/LXMF; sets `rns_ready` / `lxmf_ready`). PN messagestore loads in the background; local-prop serve waits for that load. Electron health polls `status: ok` only — not the ready flags.

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
- **Ratspeak / Nomad / LXST / LRGP siblings:** `scripts/clone-ratspeak-stack.sh` floats `rsReticulum` / `rsLXMF` / `rsNomad` / `rsLXST` / `lrgp-rs` to `origin/main` (override with `RS_RETICULUM_REF` / `RS_LXMF_REF` / `RS_NOMAD_REF` / `RS_LXST_REF` / `RS_LRGP_REF`); overlays must apply for rsReticulum/rsLXMF.

## API

[docs/reticulum-sidecar-ipc.md](../docs/reticulum-sidecar-ipc.md)

## License

AGPL-3.0-or-later (separate process from MIT mesh-client app).
