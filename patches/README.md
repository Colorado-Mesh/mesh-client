# pnpm patchedDependencies

Local overlays applied via `package.json` → `pnpm.patchedDependencies`. When bumping a patched package version, regenerate the patch hash under `patches/` and keep `WATCH_ENTRIES` in `scripts/update.sh` in sync.

| Patch | Upstream | Upstream PR / status |
| ----- | -------- | -------------------- |
| `@liamcottle__meshcore.js@1.13.0.patch` | [meshcore-dev/meshcore.js](https://github.com/meshcore-dev/meshcore.js) | Split: [#29](https://github.com/meshcore-dev/meshcore.js/pull/29), [#30](https://github.com/meshcore-dev/meshcore.js/pull/30), [#31](https://github.com/meshcore-dev/meshcore.js/pull/31), [#32](https://github.com/meshcore-dev/meshcore.js/pull/32), [#33](https://github.com/meshcore-dev/meshcore.js/pull/33) |
| `@jsr__meshtastic__core@2.6.6.patch` | [meshtastic/web](https://github.com/meshtastic/web) (`packages/sdk`) | [#1312](https://github.com/meshtastic/web/pull/1312) |
| `@jsr__meshtastic__transport-web-serial@0.2.5.patch` | [meshtastic/web](https://github.com/meshtastic/web) (`packages/transport-web-serial`) | Fixed on upstream `main` (per-instance `toDeviceStream` + abort); keep patch until npm/`@jsr` package bump includes it |
| `@stoprocent__noble@2.5.7.patch` | [stoprocent/noble](https://github.com/stoprocent/noble) | [#94](https://github.com/stoprocent/noble/pull/94) |
| `usb@2.18.0.patch` | [node-usb/node-usb](https://github.com/node-usb/node-usb) | [#964](https://github.com/node-usb/node-usb/pull/964) |
| `readable-stream@4.7.0.patch` | [nodejs/readable-stream](https://github.com/nodejs/readable-stream) | **Intentionally local** — upstream uses `require('process/')` for browser bundlers; Electron/Node needs bare `process` |
| `debug@4.4.3.patch` | [debug-js/debug](https://github.com/debug-js/debug) | **Intentionally local** — inlines `ms`/`humanize` so electron-vite does not fail resolving the `ms` dependency |

## @liamcottle/meshcore.js@1.13.0

Protocol / companion-radio fixes. Upstreamed as five focused PRs (npm package name remains `@liamcottle/meshcore.js`; repo lives under `meshcore-dev`).

| PR | Change |
| -- | ------ |
| [#29](https://github.com/meshcore-dev/meshcore.js/pull/29) | Empty login password → zero-byte payload (read-only ACL) |
| [#30](https://github.com/meshcore-dev/meshcore.js/pull/30) | TraceData SNR count from `path_sz` flags |
| [#31](https://github.com/meshcore-dev/meshcore.js/pull/31) | DeviceInfo v3+ fields + `setPathHashMode` (cmd 61) |
| [#32](https://github.com/meshcore-dev/meshcore.js/pull/32) | `LoginFail` (0x86) push handler |
| [#33](https://github.com/meshcore-dev/meshcore.js/pull/33) | `readString` stops at embedded NUL |

**Kept local-only (not upstreamed):** silence companion push codes `25` / `0x8E` / `0x8F`, and downgrade unhandled-frame `console.log` → `console.debug`.

### Sunset

When the five PRs merge and a release newer than `1.13.0` includes them, drop the corresponding hunks (or the whole patch if only local-only hunks remain), bump the dependency, and remove this entry from `WATCH_ENTRIES` if no patch remains.

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

## @stoprocent/noble@2.5.7

Windows `binding.gyp`: drop `/await` under `/std:c++20`, add `_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS`.

| Field | Value |
| ----- | ----- |
| **Upstream PR** | https://github.com/stoprocent/noble/pull/94 |

### Sunset

When the PR merges and a release includes it, remove the patch and bump `@stoprocent/noble`.

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
