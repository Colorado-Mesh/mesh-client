# Contributing to Mesh Client

Thank you for your interest in contributing. This document covers setup, testing requirements, and the PR process.

## Getting Started

See [docs/development-environment.md](docs/development-environment.md) for full setup instructions including shared requirements, platform-specific steps, and troubleshooting.

**Node version:** Use **Node 22** (22.12.0+ recommended). CI (`.github/workflows/`) runs on Node 22 for build, test, and release; using the same version locally avoids environment drift and Linux-specific failures (e.g. native rebuilds) on older Node.

```bash
pnpm install
pnpm run dev          # Start in development mode
pnpm run build        # Production build
pnpm run lint         # Run ESLint (type-aware; see Code style below)
pnpm run typecheck    # TypeScript check (renderer + main/preload)
pnpm run format       # Prettier write — ts, tsx, js, jsx, json, css, md
pnpm run format:check # Prettier check only (no writes)
pnpm run rebuild      # Rebuild native modules (@stoprocent/noble) for current Electron
```

**Main process bundle:** `build:main` / `build:main:prod` use esbuild on `src/main/index.ts`. Large dependencies (`node-forge`, `jszip`, `mqtt`, `@meshtastic/protobufs`, `@bufbuild/protobuf`) are passed as `--external` so they are **not** concatenated into `dist-electron/main/index.js`; Node resolves them from `node_modules` at runtime (they remain packaged in the app asar). Analyze bundle composition with `pnpm run build:main:meta` (writes `dist-electron/main/metafile.json` for [esbuild’s metafile analyzer](https://esbuild.github.io/analytics/); it rebuilds `dist-electron/main/index.js` without minify — run `pnpm run build:main:prod` afterward if you need the minified main for `pnpm start` / `dist`). Compare dev vs minified outfile sizes with `pnpm run build:main:compare-size`.

**Running CI locally:** With [act](https://github.com/nektos/act) installed, run `act --container-architecture linux/amd64` so Linux jobs use the correct architecture. The test-results artifact upload step is skipped when running under act (actor `nektos/act`); all other steps run as on GitHub.

## CI/CD Workflows

GitHub Actions workflows run on every push and pull request to `main`. See [docs/ci-cd.md](docs/ci-cd.md) for a complete reference.

- **ci.yaml**: Lint, typecheck, build — must pass before merge
- **tests.yaml**: Run unit tests, upload results artifact
- **release.yaml**: Build & publish releases on version tags (`v*`)
- **docs.yml**: Deploy MkDocs to GitHub Pages on merge to main
- **dependency-submission.yml**: Submit Python deps to GitHub dependency graph

For release process details, see [docs/release-process.md](docs/release-process.md).

## Dependabot

Automated dependency updates are configured in `.github/dependabot.yml`:

- **Schedule:** Weekly on Saturdays
- **npm dependencies:** Grouped PRs — `electron` separate, all other npm deps together
- **GitHub Actions:** Grouped into one PR
- **Limit:** 10 open PRs maximum

**Testing Dependabot PRs locally:**

Use **pnpm** (never npm) to test dependabot PRs:

```bash
git checkout <dependabot-branch>
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:run
```

Do not use `npm install` — it creates a `package-lock.json` and may not respect pnpm's lockfile format.

**actionlint:** Install [actionlint](https://github.com/rhysd/actionlint) so the pre-commit hook can lint GitHub Actions workflows.

Recommended (auto-install): `pnpm run setup:actionlint` (installs into `.githooks/bin` so the hook can find it).

Manual fallback:

- macOS: `brew install actionlint`
- Windows/Linux: see [releases](https://github.com/rhysd/actionlint/releases) for prebuilt binaries.

**yamllint:** Install [yamllint](https://github.com/adrienverge/yamllint) so the pre-commit hook can lint YAML files.

All platforms (requires Python): `pip install yamllint`

Manual fallback:

- macOS: `brew install yamllint`
- Debian/Ubuntu: `sudo apt install yamllint`
- Fedora: `sudo dnf install yamllint`

After `pnpm install`, the repo's git hooks are enabled (`core.hooksPath` → `.githooks`). On every commit, the **pre-commit** hook runs in order:

1. **`pnpm run format`** — Prettier **writes** to matching files (not `format:check`).
2. **`pnpm run lint:md`** — markdownlint-cli2 fixes all `.md` files (installed via devDependencies).
3. **Re-stage** — Only files that were already staged are re-added, so unstaged WIP is not swept in.
4. **`pnpm run lint`**
5. **`pnpm run typecheck`** — TypeScript check for renderer and main/preload.
6. **`pnpm run check:log-injection`** — Ensures main-process `console.*` calls do not pass raw error variables (`err`, `e`, `error`, `reason`) without `sanitizeLogMessage()` at the call site. See [Log injection (CodeQL js/log-injection)](#log-injection-codeql-jslog-injection) below.
7. **`pnpm run check:db-migrations`** — Validates SQLite migrations when touching `database.ts`.
8. **`pnpm run check:ipc-contract`** — Verifies preload/main API alignment.
9. **`pnpm run check:licenses`** — Shows license summary for dependencies.
10. **`pnpm audit`** — Fails the commit if pnpm reports vulnerabilities.
11. **`actionlint`** — Lints `.github/workflows/*.yml`; must be installed (see above).
12. **`yamllint`** — Lints all YAML files (`-f github -s`); must be installed (see above).
13. **`pnpm run test:run`** — Fails the commit if tests fail.

To skip the hook in an emergency: `git commit --no-verify`.

If `@stoprocent/noble` or other native addons fail after changing Node or Electron versions, run `pnpm run rebuild` (same script as `postinstall`).

**Windows**: If `dist:win` or `rebuild` fails with “space in the path” or `EPERM`, use a path **without spaces**, close Electron/Node processes, and see README troubleshooting. For “Could not find any Python installation to use”, install Python 3 and add it to PATH — see README Windows prerequisites and troubleshooting.

**Linux sandbox / SIGILL**: If `pnpm install` fails with `electron exited with signal SIGILL`, use `MESHTASTIC_SKIP_ELECTRON_REBUILD=1 pnpm install`, then run `pnpm run rebuild` where the Electron binary runs (see README Linux troubleshooting).

**npm 11 — `Unknown env config "devdir"`:** npm only recognizes its own config keys. `devdir` is a legacy node-gyp setting; if it appears in `~/.npmrc` or as `npm_config_devdir` / `NPM_CONFIG_DEVDIR` in the environment (some IDEs or sandboxes inject it), npm 11 prints a warning. Fix:

1. Remove from npm user config if saved there: `npm config delete devdir` and `npm config delete devdir --global`.
2. Optionally unset in your shell profile: `unset npm_config_devdir NPM_CONFIG_DEVDIR 2>/dev/null || true`.

The repo’s **pre-commit** hook unsets those variables before running npm so local commits are quiet when the environment sets `devdir`.

## Code style

Run `pnpm run lint` before pushing. ESLint is configured with:

- **Import order** — `eslint-plugin-simple-import-sort` on imports and exports; no duplicate imports; newline after imports.
- **Type-only imports** — `@typescript-eslint/consistent-type-imports` (use `import type { … }` where appropriate).
- **TypeScript (type-aware)** — `eslint.config.mjs` enables `typescript-eslint` `recommendedTypeChecked`, `stylisticTypeChecked`, and `strictTypeChecked` using both `tsconfig.json` and `tsconfig.main.json`. Renderer TSX adds `eslint-plugin-react` (jsx-runtime), `eslint-plugin-jsx-a11y`, and `react-hooks`. `scripts/**` uses `disableTypeChecked` so one-off scripts are not tied to the full program. A few strict rules are intentionally relaxed to keep signal high without churn (see the file): e.g. `no-unsafe-*` off at the project level, `no-unnecessary-condition` off for DOM/runtime patterns, `no-misused-promises` with `checksVoidReturn.attributes: false` for React event handlers, and `prefer-nullish-coalescing` with `ignorePrimitives` / mixed logical expressions.
- **Security** — `eslint-plugin-security` detects Node.js security patterns (unsafe file operations, regex issues, etc.).
- **Vitest** — `eslint-plugin-vitest` enforces test-specific rules (valid assertions, expect usage).
- **Secrets detection** — `eslint-plugin-no-secrets` flags potential hardcoded secrets/API keys.
- **Electron** — `eslint-plugin-electron` enforces Electron-specific security rules (contextBridge patterns, IPC safety).
- **Renderer only** — `react-hooks/exhaustive-deps` is an **error**; fix dependency arrays rather than disabling. **Exception:** If an effect must _not_ re-run when a dependency changes (e.g. intentional one-shot on mount, or avoiding stale closure without widening deps), you may use `eslint-disable-next-line react-hooks/exhaustive-deps` **only** with an inline comment on the same line or immediately above explaining why (what is intentionally omitted and why). Prefer refs or splitting effects first; disable as a last resort.
- **Ignored by lint** — `scripts/**`, `dist-electron/**`, and `*.config.*` files are excluded; change those configs only when needed.

**Path alias:** `@/` maps to `src/` (see `tsconfig.json`, `tsconfig.main.json`, and `vitest.config.ts`). Prefer `@/renderer/...` or `@/main/...` over long relative paths when adding imports.

**Diagnostics work:** The Network Diagnostics tab is driven by `diagnosticRows` in `diagnosticsStore` (routing + RF rows merged in `useDevice`). Row TTL and pruning live in `src/renderer/lib/diagnostics/diagnosticRows.ts`; mesh congestion copy is shared via `MeshCongestionAttributionBlock.tsx`. **Foreign LoRa detection** (cross-protocol) is implemented in `src/renderer/lib/foreignLoraDetection.ts` and stored in `diagnosticsStore.foreignLoraDetections`; it classifies raw LoRa payloads (MeshCore 0x3c, Meshtastic header, or unknown) and surfaces detections in the Node Detail modal. If you add a new routing or RF finding, extend the `DiagnosticRow` union and ensure the panel table renders the new kind — see existing tests in `DiagnosticsPanel.test.tsx` and `diagnosticRows.test.ts`. Note: routing anomalies are Meshtastic-only — `RoutingDiagnosticEngine` accepts an optional `capabilities` parameter and skips protocol-incompatible detectors (e.g. `impossible_hop` is skipped for MeshCore because `hops_away` does not exist in that protocol).

**Dual-protocol architecture:** The app supports two protocols: `meshtastic` (default) and `meshcore`. The active protocol is stored in `localStorage['mesh-client:protocol']` and drives which hook (`useDevice` vs `useMeshCore`) powers the app. Both hooks expose the same top-level shape so components stay protocol-agnostic wherever possible. Protocol-specific divergences are handled via the `ProtocolCapabilities` descriptor from `src/renderer/lib/radio/BaseRadioProvider.ts` — add capabilities there (not as string comparisons) when gating UI on protocol.

- `useDevice.ts` — Meshtastic-specific; uses `@meshtastic/core`; connections created via `createConnection()` in `src/renderer/lib/connection.ts` (BLE/Serial/HTTP).
- `useMeshCore.ts` — MeshCore-specific; uses `@liamcottle/meshcore.js`; connections created inside the hook (BLE, Web Serial, or TCP via main-process IPC). No use of `connection.ts`.
- `useRadioProvider(protocol)` — returns a memoized `ProtocolCapabilities` object; pass this down into components and engines rather than comparing `protocol === 'meshcore'` strings everywhere.

**Dual-mode UI:** `App.tsx` chooses the active hook by protocol and renders the same shell (tabs, Log panel, status). Tab 5 is **Modules** (Meshtastic: `ModulePanel`) or **Repeaters** (MeshCore: `RepeatersPanel`). Meshtastic also shows **Security** after **Telemetry** (`SecurityPanel`, gated by `hasSecurityPanel`); MeshCore omits that tab. **MeshCore Import Contacts** (JSON nickname bulk import) lives on the **Nodes** tab (`NodeListPanel`) — do not reattach it to `RepeatersPanel`. Panels such as `RadioPanel`, `ConnectionPanel`, and `NodeDetailModal` accept optional props (e.g. `onApplyLoraParams`, `onSetOwner`) that are set only for the active protocol; when adding protocol-specific UI, gate on `capabilities` or the presence of these handlers rather than on the protocol string.

**MeshCore IPC channels:** Main-process TCP bridge for MeshCore uses `meshcore:tcp-connect`, `meshcore:tcp-write`, `meshcore:tcp-disconnect`, `meshcore:tcp-data` (renderer push), and `meshcore:tcp-disconnected` (renderer push). These are handled in `src/main/index.ts` and wired into the renderer via `window.electronAPI.meshcore.tcp.*` in the preload. `meshcore:tcp-write` returns a `Promise` that resolves after the socket `write` callback succeeds and rejects if there is no active socket or the write fails (so callers can surface errors).

**MeshCore MQTT:** Broker fields in the Connection tab (including **LetsMesh** / **Ripple Networks** / **Custom** presets in `ConnectionPanel.tsx`) must stay consistent with what `src/main/mqtt-manager.ts` and `src/main/meshcore-mqtt-adapter.ts` expect: `mqttTransportProtocol: 'meshcore'`, optional `useWebSocket` (e.g. LetsMesh on 443), and `tlsInsecure` when connecting to TLS brokers with non–public CAs (Ripple preset). **LetsMesh** credentials are built in `src/renderer/lib/letsMeshJwt.ts` using `@michaelhart/meshcore-decoder` `createAuthToken` (same contract as [meshcore-mqtt-broker](https://github.com/michaelhart/meshcore-mqtt-broker)); JWT `aud` is the MQTT server hostname for LetsMesh presets (see [docs/letsmesh-mqtt-auth.md](docs/letsmesh-mqtt-auth.md)); username is `v1_<public key hex>`, not a short node id. Adding or changing a preset should be reflected in [README.md](README.md) and [docs/meshcore-meshtastic-parity.md](docs/meshcore-meshtastic-parity.md).

**MeshCore database:** MeshCore contacts and messages are stored in `meshcore_contacts` and `meshcore_messages` (see `src/main/database.ts` for current schema version). The `saveMeshcoreContact` IPC upserts with `INSERT … ON CONFLICT(node_id) DO UPDATE` and keeps existing `favorited` / merged `nickname`; `updateMeshcoreContactAdvert` does a targeted `UPDATE` of `last_advert`, `adv_lat`, `adv_lon` only — used by the periodic advert push event (128) to avoid overwriting contact metadata with partial data. `updateMeshcoreContactFavorited` sets `favorited` and can `INSERT` a minimal row when the contact is not yet in the table (requires `public_key` hex from the renderer). `meshcore_messages.received_via` stores how a message was observed (`rf`, `mqtt`, or `both`) for chat transport badges and history. The partial unique index on meshcore messages includes `payload` so distinct lines in the same second (same stub `sender_id` and channel) are not dropped by `INSERT OR IGNORE`.

**Stores used by both protocols:** `positionHistoryStore` holds the 60-minute position trail and path-overlay visibility; `diagnosticsStore` holds `foreignLoraDetections` (cross-protocol foreign LoRa detection). MeshCore-only: `repeaterSignalStore` caches repeater status for the Repeaters panel. See `src/renderer/stores/`.

### MeshCore internals

This subsection is a contributor reference for working on MeshCore-specific features. Read it alongside `src/renderer/hooks/useMeshCore.ts`.

**BLE routing by platform:** MeshCore BLE uses two backends:

- **Linux:** Web Bluetooth in the renderer (`TransportWebBluetoothIpc` + `MeshcoreWebBluetoothConnection`) with the custom picker flow (`select-bluetooth-device` bridge).
- **macOS/Windows:** Noble IPC via `NobleBleManager` in the main process.

On Noble-backed platforms, if you connect the **same** peripheral for one protocol while the other protocol still holds the GATT link, `NobleBleManager` disconnects the other session first and then connects the requested session.

- **MeshCore NUS on Windows:** When `fromRadio` supports **notify**, the manager uses a notify-first strategy and **does not issue redundant GATT reads** on that characteristic on `win32` (WinRT can misbehave when mixing reads and notifications on the Nordic UART TX path). Other platforms may still use read pumps where needed.
- **Renderer retry policy:** `useMeshCore` applies bounded retries for both Linux Web Bluetooth and Noble IPC paths. Noble retryability is classified in `src/renderer/lib/bleConnectErrors.ts` (`isMeshcoreRetryableBleErrorMessage`). Extend that helper (and tests) when adding new recoverable BLE error text from the stack.
- **Disconnect during `initConn`:** `meshcoreSetupGenerationRef` increments on `disconnect()`; long awaits in `initConn` are wrapped so setup aborts promptly instead of sitting until `getChannels` / similar timeouts fire. User-visible cancel uses `DOMException` + `AbortError` with `MESHCORE_SETUP_ABORT_MESSAGE` from `bleConnectErrors.ts`; `ConnectionPanel` treats that as a silent cancel (no inline error banner).

The ideal upstream fix remains for `@liamcottle/meshcore.js` to perform the first BLE write only after `gatt.connect()` has resolved; contributors can consider opening an issue or PR upstream for that behavior.

#### `useMeshCore` — state and refs

**Exported state** (visible to callers via the hook's return value):

| Field                   | Type                       | Description                                  |
| ----------------------- | -------------------------- | -------------------------------------------- |
| `nodes`                 | `Map<number, MeshNode>`    | Keyed by `pubkeyToNodeId()`                  |
| `messages`              | `ChatMessage[]`            | Channel + DM history                         |
| `channels`              | `{index, name}[]`          | Channel list from device                     |
| `selfInfo`              | `MeshCoreSelfInfo \| null` | Device identity, radio params, battery       |
| `deviceLogs`            | `DeviceLogEntry[]`         | Capped at `MAX_DEVICE_LOGS` (500)            |
| `telemetry`             | `TelemetryPoint[]`         | Battery telemetry; cap 50                    |
| `signalTelemetry`       | `TelemetryPoint[]`         | SNR/RSSI telemetry; cap 50                   |
| `meshcoreTraceResults`  | `Map<number, …>`           | Per-hop SNR trace results keyed by nodeId    |
| `meshcoreNodeStatus`    | `Map<number, …>`           | On-demand repeater status keyed by nodeId    |
| `meshcoreNodeTelemetry` | `Map<number, …>`           | On-demand sensor data keyed by nodeId        |
| `meshcoreNeighbors`     | `Map<number, …>`           | Neighbor list results keyed by nodeId        |
| `manualAddContacts`     | `boolean`                  | `true` = manual approval; `false` = auto-add |

**Key internal refs** (not returned, used inside the hook only):

| Ref                  | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `connRef`            | The active `MeshCoreConnection`                                                      |
| `pubKeyMapRef`       | `Map<number, Uint8Array>` — nodeId → full 32-byte public key (used when sending)     |
| `pubKeyPrefixMapRef` | `Map<string, number>` — 6-byte hex prefix → nodeId (for DM routing from push events) |
| `pendingAcksRef`     | `Map<number, {timeoutId}>` — in-flight ACK tracking keyed by `expectedAckCrc`        |
| `nodesRef`           | Stable ref to current `nodes` map (prevents stale closures in event listeners)       |

When adding new device state: add a `useState` / `useRef` entry, expose it in the return value, and update the matching return-type shape.

#### `MeshCoreConnection` API

The connection object exposes these methods. Call them via `connRef.current` inside callbacks:

| Method                              | Purpose                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `getSelfInfo()`                     | Fetch device identity, radio params, battery                             |
| `getContacts()`                     | Fetch all contacts from device                                           |
| `getChannels()`                     | Fetch channel list                                                       |
| `getWaitingMessages()`              | Drain queued messages on connect                                         |
| `sendFloodAdvert()`                 | Broadcast presence to mesh                                               |
| `sendTextMessage(pubKey, text)`     | DM; returns `{expectedAckCrc, estTimeout}`                               |
| `sendChannelTextMessage(idx, text)` | Channel broadcast                                                        |
| `removeContact(pubKey)`             | Delete a contact                                                         |
| `setAdvertName(name)`               | Set device display name                                                  |
| `setRadioParams(freq, bw, sf, cr)`  | Apply radio config; `freq` in kHz (e.g. 910525), `bw` in Hz (e.g. 62500) |
| `setTxPower(power)`                 | Set TX power                                                             |
| `setAdvertLatLong(lat, lon)`        | Set broadcast position                                                   |
| `reboot()`                          | Reboot device                                                            |
| `tracePath(pubKeys)`                | Per-hop SNR trace                                                        |
| `getStatus(pubKey)`                 | Repeater status                                                          |
| `getTelemetry(pubKey)`              | CayenneLPP sensor data                                                   |
| `getNeighbours(pubKey)`             | Neighbor list (Repeater-only)                                            |
| `setManualAddContacts()`            | Switch to manual contact approval                                        |
| `setAutoAddContacts()`              | Switch to automatic contact approval                                     |

**Adding a new device command:** add the method signature to `MeshCoreConnection` in `useMeshCore.ts`, implement the call in a callback (using `connRef.current`), and expose the callback in the hook's return value.

#### Push event numbering

MeshCore devices emit push events as numeric codes. Register listeners with `conn.on(EVENT_CODE, handler)`:

| Code         | Name                     | Description                                                                                                          |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `0x80` (128) | Periodic advert          | Contact presence update; call `updateMeshcoreContactAdvert` IPC (partial update — do not overwrite contact metadata) |
| `0x81` (129) | Path update              | Routing path changed                                                                                                 |
| `0x82` (130) | Send confirmed           | ACK received; resolve the pending entry in `pendingAcksRef`                                                          |
| `0x83` (131) | Message waiting          | Incoming message queued; fetch via `getWaitingMessages()`                                                            |
| `0x8A` (138) | New contact              | New contact discovered; call `saveMeshcoreContact` IPC                                                               |
| `7`          | Incoming DM              | Direct message received                                                                                              |
| `8`          | Incoming channel message | Channel message received                                                                                             |
| `0x88` (136) | RF packet event          | Signal telemetry (SNR/RSSI); source of `signalTelemetry`                                                             |

When adding a handler for a new push event code, register it in the `conn.on(…)` block in `useMeshCore.ts` alongside the existing listeners.

#### ACK tracking pattern

`sendTextMessage()` returns `{expectedAckCrc, estTimeout}`. The expected flow after sending a DM:

1. Update the message status to `'pending'`.
2. Store `{timeoutId}` in `pendingAcksRef` keyed by `expectedAckCrc`.
3. When push event `0x82` fires with matching CRC → mark message `'acked'` and clear the timeout.
4. On timeout expiry → mark message `'failed'`.

Do **not** use a sequential packet ID here. MeshCore uses the CRC of the expected ACK, not a sequential ID.

#### `meshcoreUtils.ts` helpers

Reference file: `src/renderer/lib/meshcoreUtils.ts`

- **`pubkeyToNodeId(key: Uint8Array): number`** — XOR-folds a 32-byte public key into a stable 32-bit node ID. Use this as the map key in `nodes`, `meshcoreNodeStatus`, and similar maps. Never inline the XOR-fold math.
- **`meshcoreContactToMeshNode(contact): MeshNode`** — Converts a raw MeshCore contact (from device or DB) to the unified `MeshNode` type consumed by shared components.
- **`CONTACT_TYPE_LABELS`** — `{0: 'None', 1: 'Chat', 2: 'Repeater', 3: 'Room'}`. Displayed in the `hw_model` field in the node list. Use this map instead of inlining the label strings.

#### `IpcTcpConnection`

TCP transport is implemented as a class inside `useMeshCore.ts` (not a separate file). It wraps `SerialConnection` from `meshcore.js` and routes bytes through the main-process TCP bridge. The default MeshCore TCP port is **5000**.

Data flow when TCP is selected:

1. `IpcTcpConnection.connect()` → `meshcore:tcp-connect` IPC → `net.Socket` opened in main process.
2. Incoming bytes: `meshcore:tcp-data` push → `instance.onDataReceived()`.
3. Outgoing bytes: `instance.write()` → `meshcore:tcp-write` IPC.
4. Disconnect: `meshcore:tcp-disconnected` push → `instance.onDisconnected()`.

#### `ProtocolCapabilities` guidance

When a new MeshCore feature requires UI gating:

1. Add the capability flag to `ProtocolCapabilities` in `src/renderer/lib/radio/BaseRadioProvider.ts`.
2. Set it in both `MESHTASTIC_CAPABILITIES` and `MESHCORE_CAPABILITIES`.
3. Consume it via `useRadioProvider(protocol)` in components — **never** use `protocol === 'meshcore'` string comparisons.

Current MeshCore-specific capabilities that differ from Meshtastic: `hasPerHopSnr`, `hasRepeaterStatus`, and `hasOnDemandNodeStatus` are `true`; all config-related capabilities (`hasChannelConfig`, `hasModemPresets`, `hasBluetoothConfig`, etc.) are `false`.

#### Type declarations for `meshcore.js`

`src/renderer/types/meshcore.d.ts` declares the `@liamcottle/meshcore.js` module's exported classes (`WebBleConnection`, `WebSerialConnection`, `SerialConnection`, `CayenneLpp`). When upgrading the library or using a new export, add or update declarations there.

**Dual TypeScript configs:** Renderer code uses `tsconfig.json` (bundler resolution, JSX). Main and preload use `tsconfig.main.json` (CommonJS, Node resolution). Do not assume the same module settings in main/preload as in the Vite renderer.

## Accessibility Requirements

Every interactive element added or modified must have an accessible label. This applies to all contributors — human and AI.

**Electron (Chromium):** On this platform, `aria-label` on an element **replaces** the accessible name that would otherwise come from its text contents for assistive tech. **Every visible control should still have an explicit `aria-label`.** Set that label to the **same string a sighted user reads** (including punctuation, counts, and dynamic values). You can still use `<label htmlFor="…">` / `aria-labelledby` for association and tests; add a matching `aria-label` on the control when Electron would otherwise hide inner text from the accessible name. Icon-only controls use an `aria-label` that states the action in plain language (there is no conflicting visible text).

### Required ARIA/HTML for common patterns

| Element type                             | What to add                                                    |
| ---------------------------------------- | -------------------------------------------------------------- |
| `<button>` with icon only (no text)      | `aria-label="Descriptive action"`                              |
| `<button>` that toggles state            | `aria-pressed={boolean}` + `aria-label`                        |
| `<input>` / `<select>` / `<textarea>`    | `<label htmlFor="id">` + matching `id`, **or** `aria-label`    |
| Status that changes dynamically          | Wrap in `<div role="status" aria-live="polite">`               |
| Error message                            | `role="alert"` on the element                                  |
| Modal / dialog                           | `role="dialog" aria-modal="true" aria-labelledby="heading-id"` |
| Confirmation dialog                      | `role="alertdialog"` instead of `role="dialog"`                |
| Color-only indicator (status dot, badge) | `aria-label="Online"` / `"Offline"` etc.                       |
| Decorative icon inside a labelled button | `aria-hidden="true"` on the `<svg>`                            |
| Sortable `<th>`                          | `scope="col"` + `aria-sort="ascending"\|"descending"\|"none"`  |
| `<table>`                                | `<caption className="sr-only">Description</caption>`           |
| SVG icon used as an image                | `role="img" aria-label="..."`                                  |

### Rule: never add a new `<input>` without a label

If the input has a visible label element next to it, use `htmlFor`/`id`. If it's standalone (search bars, inline number fields), use `aria-label`. The axe tests will catch missing labels on every commit — fix them before the commit goes through.

### Running the tests

Vitest runs two projects (see `vitest.config.ts`): **renderer** (`src/renderer/**/*.test.{ts,tsx}`, jsdom) and **main** (`src/main/**/*.test.ts`, node). Add or extend tests in the matching project when you change renderer or main-process behavior.

If you are fixing a regression, always add or update a test that reproduces the regression and verifies the fix so it does not happen again.

**Accessibility tests:** `src/renderer/vitest.setup.ts` registers **vitest-axe**. New or heavily changed panels should include a test that renders the component and asserts no axe violations, following existing component tests (e.g. `await axe(container)` and `expect(results).toHaveNoViolations()`).

```bash
pnpm run test:run     # run once (also runs automatically on git commit)
pnpm test             # watch mode
pnpm run test:verbose # verbose output with full violation details
```

## AI Tools Policy

AI coding assistants (Claude Code, GitHub Copilot, etc.) are welcome for brainstorming, boilerplate, and first drafts. However:

- **Electron IPC security is a known weak spot for AI tools.** AI models are confidently wrong about what is and isn't safe to expose via `contextBridge`. Never accept AI-generated IPC code without understanding it yourself.
- **Log injection (CodeQL):** AI often suggests sanitizing only inside the logging function. CodeQL requires sanitization at the **call site** — pass `sanitizeLogMessage(...)` around any user-controlled value before it is passed into `appendLine()` or similar. See [Log injection (CodeQL js/log-injection)](#log-injection-codeql-jslog-injection) above.
- All AI-generated code must be reviewed and manually tested by a human before merging.
- If you used an AI tool, note it briefly in the PR body — not required, just helpful for reviewers.

## Human-First Testing Requirement

Every PR must be manually tested before review. No exceptions for "trivial" changes.

1. Run the app locally and exercise the changed functionality end-to-end (`pnpm start`). On Linux, Bluetooth uses Web Bluetooth which requires no special setup.
2. Open Chrome DevTools for **both** the Main process (via the terminal) and the Renderer process (Ctrl/Cmd+Shift+I) — confirm no new errors or warnings.
3. If you changed connection logic, test on an actual or emulated device if possible.

## Electron-Specific Checks

Before submitting a PR that touches IPC or the preload layer:

- **contextBridge exposure**: Only expose the minimum API surface needed. Never expose `ipcRenderer` directly or pass arbitrary channel names to the renderer.
- **Channel naming**: Main-process **invoke** handlers use namespaced channels (e.g. `db:*`, `mqtt:*`, `meshcore:*`, `update:*`). Preload exposes a single `electronAPI` object with nested namespaces (`db`, `mqtt`, `meshcore`, …) that wrap `ipcRenderer.invoke` — see `src/preload/index.ts`. When adding IPC, add the handler in main **and** the typed method on the matching preload namespace **and** the corresponding entry in the `Window.electronAPI` type declaration in `src/renderer/lib/types.ts` so the renderer stays on a minimal, reviewed, typed surface.
- **Main→renderer events**: One-way `webContents.send` / `ipcRenderer.on` channels sometimes use **kebab-case** without a domain prefix (e.g. `bluetooth-devices-discovered`, `serial-ports-discovered`) for historical or Chromium-callback wiring. **Invoke** channels should stay `domain:action`; when adding new **events**, prefer a consistent prefix (e.g. `ble:devices-discovered`) if you are touching both main and preload anyway; otherwise document the channel in the preload API.
- **Cross-platform UI**: Test or at minimum visually verify your changes on your platform; flag in the PR if you could not test on other OSes.
- **Platform-specific error guidance**: Each transport has a `humanize*Error()` helper in `src/renderer/lib/connection.ts` (`humanizeBleError`, `humanizeSerialError`, `humanizeHttpError`). When adding new error paths for a transport, extend the relevant helper rather than inlining error strings in components. Use `process.platform` (injected via main-process IPC or `window.electronAPI.session`) to gate platform-specific copy: Linux `dialout` guidance for Serial; WinRT/Device Manager guidance for BLE on Windows; Bonjour/iTunes hint for HTTP `.local` resolution on Windows.
- **Build check**: Confirm `pnpm run build` completes without errors.

## Error boundaries and logging

Wrap **boundaries** where failure is possible and must not be silent: IPC handlers, `JSON.parse` on persisted strings (e.g. `localStorage`), and main-process I/O (`fs`, `dialog`, `shell.openExternal`). Use a consistent pattern so logs are searchable and severity matches recoverability.

### Convention

| Situation                                                   | try block                                                                                                       | catch block                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Entering a risky block (IPC handler, parse persisted state) | `console.debug('[context] operation', …)` once at **entry** to the try (avoids flooding logs on every success). |                                                                                |
| Recoverable (corrupt storage → default; optional fallback)  | Same as above if you add debug.                                                                                 | `console.warn('[context] …', err)` — app continues with fallback.              |
| Re-throw or invariant (DB/IPC failure; caller must handle)  | Debug at entry optional.                                                                                        | `console.error('[context] …', err)` then rethrow or return a structured error. |
| Never                                                       |                                                                                                                 | Swallow without logging unless documented as intentionally ignorable.          |

**warn vs error**

- **warn**: Fallback applied (defaults, ignore corrupt cache, transient errors already handled elsewhere).
- **error**: Operation failed and you rethrow, or the main-process path surfaces as an IPC rejection without structured recovery.

Main-process IPC handlers that rethrow should log with `console.error` before rethrowing so the main terminal shows context when the renderer sees a rejected promise (aligned with existing `db:*` handlers in `src/main/index.ts`).

For repeated `localStorage` + `JSON.parse` in the renderer, prefer `parseStoredJson` from `src/renderer/lib/parseStoredJson.ts` so debug/warn behavior stays consistent.

### Log injection (CodeQL js/log-injection)

GitHub Code scanning (CodeQL) reports **log injection** when user-controlled or untrusted data flows into a log sink (e.g. `appendLine` in `src/main/log-service.ts`) without being sanitized. CodeQL tracks data flow **to** the sink; it does **not** treat sanitization that happens **inside** the sink as clearing taint from the caller.

**Rule:** Sanitize at the **call site**. Any value that is or may be user-controlled (console arguments, IPC payloads, network data, file paths from user input, etc.) must be passed through `sanitizeLogMessage()` **before** being passed to `appendLine()` or any other logger. Do not rely on sanitization only inside the logging function — that is correct for safety but does not satisfy CodeQL and will keep the code-scanning alert open.

- **Helper:** `sanitizeLogMessage(message: unknown): string` in `src/main/log-service.ts` strips control characters (including newlines) and normalizes whitespace. Use it for every log message and source string that is derived from untrusted input.
- **Example:** In `patchMainConsole()`, console overrides pass `sanitizeLogMessage(stringifyArgs(args))` into `appendLine()`, not `stringifyArgs(args)` alone.
- **Before you commit:** If you added or changed any main-process logging (`src/main/**/*.ts`) that passes error-like values (e.g. `err`, `e`, `error`, `reason`) into `console.log` / `console.warn` / `console.error`, wrap the value in `sanitizeLogMessage(...)` at the call site. The pre-commit hook runs `pnpm run check:log-injection`, which flags such calls; fix any reported lines before committing.
- **Local check:** Run `pnpm run check:log-injection` to scan `src/main` for unsanitized `console.*(..., err|e|error|reason)` patterns. To suppress a false positive, add `// log-injection-ok` with a short reason on the same line as the console call.
- **Checks:** Code scanning runs on push (GitHub default setup). If you add or change code that feeds into the log pipeline, ensure the **first** use of untrusted data in that path is wrapped in `sanitizeLogMessage()` at the call site.
- **Tests:** When adding or changing code that feeds into the log pipeline (e.g. new call sites of `appendLine`, `console.*` in main, or renderer→main log forwarding), add or extend tests so that log injection is caught by the suite. Pre-commit runs `pnpm run test:run`, which includes `src/renderer/lib/sanitize-log-message.test.ts`: that file tests both `sanitizeLogMessage` and `sanitizeForLogSink` (used by the console overrides in log-service) and runs the log-injection script so that regressions fail the test run. Add or extend tests there (or equivalent) so regressions are caught. AI and reviewers should ensure such tests exist or are added.

### Network data written to file (CodeQL js/http-to-file-access)

Code scanning may report this query on `fs.promises.appendFile` / `fs.writeFileSync` in `src/main/log-service.ts` when taint from HTTP responses reaches the **data argument** of those calls. The query does not model `sanitizeLogPayloadForDisk` as a barrier. We still route every log payload through that helper before disk I/O.

**Suppressions:** `// codeql[js/http-to-file-access]` does **not** clear these alerts on GitHub: path-problem results anchor on a sub-expression (the data argument), while CodeQL’s suppression matcher expects whole-line locations. Do not rely on inline comments for this rule.

**Configuration:** `.github/codeql/codeql-config.yml` excludes `js/http-to-file-access` when analysis is run with that config (**advanced** CodeQL + `config-file` on `github/codeql-action/init`). **Default setup does not load the file**, so you may still see alerts until you dismiss them in the Security / PR UI (document why) or switch to advanced setup. See `.github/codeql/README.md`.

**Pre-commit:** `src/main/log-service.contract.test.ts` locks disk-write wiring (`sanitizeLogPayloadForDisk`, `data` / `diskLine` at the sinks).

### Silent-catch check

`scripts/check-silent-catches.mjs` scans `src/` for `catch` blocks that contain no `console.*` call, no rethrow, and no suppression comment. It runs automatically on every commit as part of `pnpm run test:run`.

**Rule:** Every catch block must either log the error, rethrow it, or carry a suppression comment explaining why silence is intentional.

- **Suppression format:** Add `// catch-no-log-ok <reason>` on the first line inside the catch block (or on the same line as a one-liner catch). Keep the reason brief — it exists so reviewers can judge whether silence is truly safe.
- **When silence is acceptable:** localStorage fallbacks where a missing/corrupt key is expected and harmless, teardown paths (`dialog.showErrorBox`, cleanup in `will-quit`) where a secondary failure must not mask the primary one, and AES key-iteration loops where a single key failing to import is normal protocol behaviour.
- **When silence is not acceptable:** Any path where the error represents unexpected state, a failed IPC call, or a condition that would cause silent data loss or a broken UI.

### console.log check

`scripts/check-console-log.mjs` bans bare `console.log()` calls in `src/`. All diagnostic trace output must use `console.debug` so users can filter it separately in the App Log panel (`debug` is hidden by default). `console.warn` and `console.error` are allowed. The check runs as part of `pnpm run test:run`.

- **Suppression:** Add `// log-level-ok <reason>` on the same line to allow a specific `console.log` where promotion to `warn`/`error` would be misleading and `debug` would be too noisy to filter.

### XSS patterns check

`scripts/check-xss-patterns.mjs` bans React's raw HTML injection prop, direct DOM `innerHTML` assignment, and dynamic code execution from all source files. There are zero current violations. The check has no suppression mechanism — if you believe an exception is warranted, discuss it with a maintainer before adding the pattern. The check runs as part of `pnpm run test:run`.

### Log panel filter contract

`scripts/check-log-panel-filter.mjs` scans `noble-ble-manager.ts`, `mqtt-manager.ts`, and `meshcore-mqtt-adapter.ts` for `[TAG]` prefixes in `console.*` calls and asserts each tag is handled by `isDeviceEntry()` in `LogPanel.tsx` (so device logs stay on the Device tab per protocol). It is invoked from `LogPanel.filtering.test.ts` as part of `pnpm run test:run`. When you add a new tagged log line in those files, extend the matching Meshtastic or MeshCore branch in `isDeviceEntry`.

### Renderer CSP and Vite build contracts

`src/renderer/index.html.test.ts` locks the Content-Security-Policy in `src/renderer/index.html` (for example, `connect-src` must not use a blanket `http://*`). `src/main/vite-config.contract.test.ts` asserts the production Vite build keeps `sourcemap: false`. If you relax or tighten CSP or change the build’s sourcemap setting, update those tests.

### IPC payload size limits (DoS guards)

`src/main/index.contract.test.ts` asserts BLE-to-radio and MeshCore TCP write byte caps remain defined in `src/main/index.ts` and used in the corresponding handlers. If you rename limits or handlers, update the contract test.

### MQTT publish (nonce and gatewayId)

- When modifying `MQTTManager.publish` or `publishEncryptedData` in `src/main/mqtt-manager.ts`, always normalize `from`, `to`, and `channel` to numbers (for example, `const fromId = Number(from) >>> 0;`) before using them in AES-CTR nonce construction or MeshPacket fields.
- The AES-CTR nonce and `gatewayId`/MQTT topic must be derived from the **true sender node ID** so other nodes can decrypt MQTT-originated packets. Do not reintroduce positional arguments or string IDs into the MQTT publish path; use the structured `MqttPublishOptions` and keep IDs numeric end-to-end.

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix      | When to use                                     |
| ----------- | ----------------------------------------------- |
| `feat:`     | New feature                                     |
| `fix:`      | Bug fix                                         |
| `docs:`     | Documentation only                              |
| `chore:`    | Maintenance, deps, config                       |
| `refactor:` | Code change that is neither a fix nor a feature |
| `test:`     | Adding or updating tests                        |

For `feat:` and `fix:` commits, include a footer referencing the issue if applicable:

```
feat: add GPS auto-refresh

Fixes #35
```

## PR Process

1. **Describe your changes** — What did you change and why? What did you test?
2. **Update docs** — If you added or changed a feature, update README.md or relevant `/docs` files. If you touch docs content, create/activate a local Python virtualenv first (recommended on macOS/Homebrew Python; avoids `externally-managed-environment`), then install MkDocs deps (`pnpm run docs:install`) and run `pnpm run docs:build` before opening the PR.
3. **Follow existing code style** — Run `pnpm run lint` (and let pre-commit run `format` or run `pnpm run format` yourself). Fix import-sort, type-imports, and hook dependency issues before pushing.
4. **Keep scope tight** — Avoid refactoring unrelated code in the same PR. One concern per PR makes review faster.
5. **Await review** — A maintainer will review and may request changes before merging.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
