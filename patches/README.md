# pnpm patchedDependencies

Local overlays applied via `pnpm-workspace.yaml` → `patchedDependencies`. When bumping a patched package version, regenerate the patch hash under `patches/` and keep `WATCH_ENTRIES` in `scripts/update.sh` in sync.

| Patch | Upstream | Upstream PR / status |
| ----- | -------- | -------------------- |
| `@liamcottle__meshcore.js@1.13.0.patch` | [meshcore-dev/meshcore.js](https://github.com/meshcore-dev/meshcore.js) | Open: [#30](https://github.com/meshcore-dev/meshcore.js/pull/30), [#31](https://github.com/meshcore-dev/meshcore.js/pull/31), [#33](https://github.com/meshcore-dev/meshcore.js/pull/33); [#29](https://github.com/meshcore-dev/meshcore.js/pull/29) closed (unnecessary); [#32](https://github.com/meshcore-dev/meshcore.js/pull/32) closed (not carried — firmware does not push LoginFail) |
| `@jsr__meshtastic__core@2.6.6.patch` | [meshtastic/web](https://github.com/meshtastic/web) (`packages/sdk`) | [#1312](https://github.com/meshtastic/web/pull/1312) |
| `@jsr__meshtastic__transport-web-serial@0.2.5.patch` | [meshtastic/web](https://github.com/meshtastic/web) (`packages/transport-web-serial`) | Fixed on upstream `main` (per-instance `toDeviceStream` + abort); keep patch until npm/`@jsr` package bump includes it |
| `usb@2.18.0.patch` | [node-usb/node-usb](https://github.com/node-usb/node-usb) | [#964](https://github.com/node-usb/node-usb/pull/964) |
| `readable-stream@4.7.0.patch` | [nodejs/readable-stream](https://github.com/nodejs/readable-stream) | **Intentionally local** — upstream uses `require('process/')` for browser bundlers; Electron/Node needs bare `process` |
| `debug@4.4.3.patch` | [debug-js/debug](https://github.com/debug-js/debug) | **Intentionally local** — inlines `ms`/`humanize` so electron-vite does not fail resolving the `ms` dependency |

## @liamcottle/meshcore.js@1.13.0

Protocol / companion-radio fixes. Upstreamed as focused PRs (npm package name remains `@liamcottle/meshcore.js`; repo lives under `meshcore-dev`).

| PR | Change | Status |
| -- | ------ | ------ |
| [#29](https://github.com/meshcore-dev/meshcore.js/pull/29) | Empty login password → zero-byte payload (read-only ACL) | **Closed unnecessary** — stock `writeString("")` already emits 0 bytes; hunk removed from this patch. Room/repeater login uses in-app `buildSendLoginFrame`. |
| [#30](https://github.com/meshcore-dev/meshcore.js/pull/30) | TraceData SNR count from `path_sz` flags | Open — still in this patch |
| [#31](https://github.com/meshcore-dev/meshcore.js/pull/31) | DeviceInfo v3+ fields + `setPathHashMode` (cmd 61) | Open — still in this patch |
| [#32](https://github.com/meshcore-dev/meshcore.js/pull/32) | `LoginFail` (0x86) push handler | **Closed** — not carried; stock room/repeater firmware does not reply on bad credentials (client timeout). Hunk removed from this patch. |
| [#33](https://github.com/meshcore-dev/meshcore.js/pull/33) | `readString` stops at embedded NUL | Open — still in this patch |

**Kept local-only (not upstreamed):** silence companion push codes `25` / `0x8E` / `0x8F`, and downgrade unhandled-frame `console.log` → `console.debug`.

### Sunset

When [#30](https://github.com/meshcore-dev/meshcore.js/pull/30), [#31](https://github.com/meshcore-dev/meshcore.js/pull/31), and [#33](https://github.com/meshcore-dev/meshcore.js/pull/33) merge and a release newer than `1.13.0` includes them, drop the corresponding hunks (or the whole patch if only local-only hunks remain), bump the dependency, and remove this entry from `WATCH_ENTRIES` if no patch remains. Do not re-add the #29 empty-password or #32 LoginFail hunks.

## @jsr/meshtastic__core@2.6.6

Abort `fromDevice.pipeTo(decodePacket)` on disconnect so serial/BLE ports are not left locked (“port is already open” on reconnect).

| Field | Value |
| ----- | ----- |
| **Upstream PR** | https://github.com/meshtastic/web/pull/1312 (ported to `MeshClient` in the monorepo; JSR `@meshtastic/core` 2.6.6 still ships legacy `MeshDevice`) |

### Sunset

When a published `@meshtastic/core` / `@jsr/meshtastic__core` release includes equivalent inbound-pipe abort on disconnect, remove the patch and bump the dependency.

## @jsr/meshtastic__transport-web-serial@0.2.5

Per-instance `toDeviceStream` (instead of shared `Utils.toDeviceStream`) and swallow pipe errors on disconnect so Web Serial reconnects cleanly.

| Field | Value |
| ----- | ----- |
| **Upstream status** | Already fixed on [meshtastic/web](https://github.com/meshtastic/web) `main` (`packages/transport-web-serial`); not yet in the pinned `@jsr` `0.2.5` package |

### Sunset

When the published `@jsr/meshtastic__transport-web-serial` (or successor package) includes per-instance framing + abort teardown, remove the patch and bump the dependency.

## usb@2.18.0

Bump native build flags from C++14 / `c++1y` to C++17 (`cflags_cc`, macOS `OTHER_CFLAGS`, Windows `/std:c++17`) for current Clang/MSVC/Electron toolchains.

| Field | Value |
| ----- | ----- |
| **Upstream PR** | https://github.com/node-usb/node-usb/pull/964 |

### Sunset

When the PR merges and a release (or a version bump past `2.18.0` that includes C++17 flags) ships, remove the patch and bump `usb`.

## readable-stream@4.7.0

Replace `require('process/')` with `require('process')` in stream internals.

**Intentionally local.** Upstream deliberately uses the `process/` package path for browser bundler compatibility; changing that would break browser consumers. mesh-client needs the Node built-in under Electron packaging (see also `docs/troubleshooting.md` Linux asar notes).

### Sunset

Only if packaging/bundling no longer requires the bare `process` require, or upstream offers a Node-first build entry that avoids `process/`.

## debug@4.4.3

Inline a minimal `ms`/`humanize` implementation instead of `require('ms')`.

**Intentionally local.** electron-vite / the main-process bundle path can fail to resolve the transitive `ms` package; inlining avoids that without changing upstream’s dependency graph for all consumers.

### Sunset

Only if the bundler resolves `ms` reliably without the inline, or upstream ships a build that does not require a separate `ms` package at runtime.
