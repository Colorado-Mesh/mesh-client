# Threat model

## What this project does

mesh-client is a cross-platform Electron desktop client for off-grid mesh radio networks: Meshtastic,
MeshCore, and Reticulum (LXMF). People use it for everyday chat and for emergency communications (MECP
emergency reports, EMCOMM incident command), so integrity and availability of message handling matter.

- `src/main/` runs in the Electron main process (Node): SQLite, BLE/serial/TCP transports, MQTT, the TAK
  server, link previews, offline map tiles, logging, and all `ipcMain` handlers.
- `src/preload/` exposes a namespaced `window.electronAPI` through `contextBridge`. Renderers run with
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `src/renderer/` is the React UI, plus most protocol decoding and ingest (`src/renderer/lib/`).
- `src/shared/` holds helpers and IPC contracts used by both.
- `reticulum-sidecar/` is a Rust process that runs the Reticulum/LXMF stack (rsReticulum, rsLXMF, cloned at
  build time into `.rsstack/`) and speaks newline-delimited JSON to the main process over a loopback socket.

## Where untrusted input enters

Treat everything that arrives from the network or a radio as attacker-controlled:

- **Radio packets**: Meshtastic protobufs, MeshCore frames (contacts, adverts, paths, room/BBS posts,
  repeater admin responses), and Reticulum/LXMF messages, attachments, and announces. Any node on the mesh
  can send these, and they arrive over BLE, serial, or TCP to a radio.
- **MQTT**: Meshtastic and MeshCore envelopes from public or private brokers (`src/main/mqtt-manager.ts`,
  `src/main/meshcore-mqtt-adapter.ts`).
- **Message content rendered in the UI**: chat text, names, MECP reports, weather forecasts, location
  payloads, link URLs, and inline images. Rendering must not let a remote sender run script, escape the
  renderer sandbox, or reach `electronAPI` in an unintended way.
- **Link previews and inline images** (`src/main/fetchLinkPreview.ts`): URLs come from remote senders, so
  SSRF into loopback, private, or link-local networks is in scope.
- **TAK server** (`src/main/tak-server-manager.ts`): a TLS listener that accepts CoT XML from LAN clients.
- **Imported files**: Reticulum identity and config imports, channel URLs and QR codes, received
  attachments written to disk (path traversal is in scope).
- **Reticulum sidecar JSON** read by the main process, if a compromised or malicious peer can influence it.

Trust boundaries that matter most:

1. A remote mesh/MQTT peer reaching code execution or file read/write in the main process or sidecar.
2. A remote peer reaching script execution in the renderer, or using renderer state to call privileged IPC.
3. Renderer → main IPC: handlers must validate arguments; assume a compromised renderer is an attacker.

## Components that matter most / least

- Most important: packet and envelope decoders, IPC handlers in `src/main/index.ts` and `src/main/ipc/`,
  link-preview fetching, attachment and file path handling, the TAK server, MQTT ingest, and the Rust
  sidecar's handling of inbound LXMF/RNS data.
- Lower priority: diagnostics heuristics, UI layout, theming, localization files.
- Out of scope: `node_modules/`, the cloned `.rsstack/` upstream crates (report upstream unless the bug comes
  from how mesh-client uses them or from overlays in `reticulum-sidecar/patches/`), `e2e/`, `scripts/`,
  `docs/`, and build or packaging configuration.

## How to exercise it

- TypeScript tests: `pnpm exec vitest run --project main` (Node-side code) and `pnpm exec vitest run`
  (everything, including jsdom renderer tests). Test files sit next to the sources as `*.test.ts(x)`.
- Rust sidecar: `cd reticulum-sidecar && cargo test --offline --features rns-stack,rns-ble,rns-rnode-tcp`.
- Electron itself can't run in the scanner (no display, no radios). Exercise logic through the unit tests
  and by calling the pure decoders in `src/renderer/lib/` and `src/main/` directly.

## How we rate severity

- **Critical**: unauthenticated remote code execution, or arbitrary file write/read, triggered by a radio
  packet, MQTT message, or LXMF message with no user interaction.
- **High**: remote script execution in the renderer; privileged IPC reachable from remote content; SSRF
  that reaches loopback or private networks; path traversal from received attachments; crashes or
  persistent DoS of the app that a single remote packet triggers and that survive a restart (for example,
  poisoned database rows).
- **Medium**: remote DoS that a restart clears; spoofing of sender identity or MECP/emergency content
  beyond what the underlying protocol already allows; leaks of keys or private messages into logs.
- **Low**: issues that need local access, a malicious renderer without a remote entry point, or unusual
  configuration.
- Protocol-level weaknesses that are inherent to Meshtastic, MeshCore, or Reticulum (for example, shared
  default channel keys) are out of scope unless mesh-client makes them worse.

## Reports and patches

- Include the entry point (which packet type, IPC channel, or file), a minimal reproducer, ideally a failing
  Vitest or cargo test, and a minimal patch that follows the existing code style.
- Group findings that share a root cause into one report.
