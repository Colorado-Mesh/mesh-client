# Contributing to Meshtastic Client

Thank you for your interest in contributing. This document covers setup, testing requirements, and the PR process.

## Getting Started

See [README.md](README.md) for full setup instructions including prerequisites and platform-specific steps.

**Node version:** Use **Node 22** (22.12.0+ recommended). CI (`.github/workflows/`) runs on Node 22 for build, test, and release; using the same version locally avoids environment drift and Linux-specific failures (e.g. native rebuilds) on older Node.

```bash
npm install
npm run dev       # Start in development mode
npm run build     # Production build
npm run lint      # Run ESLint (type-aware; see Code style below)
npm run typecheck # TypeScript check (renderer + main/preload)
npm run format    # Prettier write — ts, tsx, js, jsx, json, css, md
npm run format:check   # Prettier check only (no writes)
npm run rebuild   # Rebuild native modules (better-sqlite3) for current Electron
```

**Running CI locally:** With [act](https://github.com/nektos/act) installed, run `act --container-architecture linux/amd64` so Linux jobs use the correct architecture. The test-results artifact upload step is skipped when running under act (actor `nektos/act`); all other steps run as on GitHub.

**actionlint:** Install [actionlint](https://github.com/rhysd/actionlint) so the pre-commit hook can lint GitHub Actions workflows (e.g. `brew install actionlint` on macOS; see [releases](https://github.com/rhysd/actionlint/releases) for Windows/Linux binaries).

After `npm install`, the repo’s git hooks are enabled (`core.hooksPath` → `.githooks`). On every commit, the **pre-commit** hook runs in order:

1. **`npm run format`** — Prettier **writes** to matching files (not `format:check`).
2. **Re-stage** — Only files that were already staged are re-added, so unstaged WIP is not swept in.
3. **`npm run lint`**
4. **`npm run typecheck`** — TypeScript check for renderer and main/preload.
5. **`npm run check:log-injection`** — Ensures main-process `console.*` calls do not pass raw error variables (`err`, `e`, `error`, `reason`) without `sanitizeLogMessage()` at the call site. See [Log injection (CodeQL js/log-injection)](#log-injection-codeql-jslog-injection) below.
6. **`npm audit`** — Fails the commit if npm reports vulnerabilities.
7. **`actionlint`** — Lints `.github/workflows/*.yml`; must be installed (see above).
8. **`npm run test:run`** — Fails the commit if tests fail.

To skip the hook in an emergency: `git commit --no-verify`.

If `better-sqlite3` or other native addons fail after changing Node or Electron versions, run `npm run rebuild` (same script as `postinstall`).

**Windows**: If `dist:win` or `rebuild` fails with “space in the path” or `EPERM` unlink on `better_sqlite3.node`, try `npm run dist:win` again (beforeBuild clears `better-sqlite3/build` before the packaging rebuild), or `npm run dist:win:skip-rebuild` if postinstall already built the native module. If it still fails, use a path **without spaces**, close Electron/Node processes, and see README troubleshooting. For "Could not find any Python installation to use", install Python 3 and add it to PATH — see README Windows prerequisites and troubleshooting.

**Linux sandbox / SIGILL**: If `npm install` fails with `electron exited with signal SIGILL`, use `MESHTASTIC_SKIP_ELECTRON_REBUILD=1 npm install`, then run `npm run rebuild` where the Electron binary runs (see README Linux troubleshooting).

## Code style

Run `npm run lint` before pushing. ESLint is configured with:

- **Import order** — `eslint-plugin-simple-import-sort` on imports and exports; no duplicate imports; newline after imports.
- **Type-only imports** — `@typescript-eslint/consistent-type-imports` (use `import type { … }` where appropriate).
- **Renderer only** — `react-hooks/exhaustive-deps` is an **error**; fix dependency arrays rather than disabling. **Exception:** If an effect must _not_ re-run when a dependency changes (e.g. intentional one-shot on mount, or avoiding stale closure without widening deps), you may use `eslint-disable-next-line react-hooks/exhaustive-deps` **only** with an inline comment on the same line or immediately above explaining why (what is intentionally omitted and why). Prefer refs or splitting effects first; disable as a last resort.
- **Ignored by lint** — `scripts/**`, `dist-electron/**`, and `*.config.*` files are excluded; change those configs only when needed.

**Path alias:** `@/` maps to `src/` (see `tsconfig.json`, `tsconfig.main.json`, and `vitest.config.ts`). Prefer `@/renderer/...` or `@/main/...` over long relative paths when adding imports.

**Diagnostics work:** The Network Diagnostics tab is driven by `diagnosticRows` in `diagnosticsStore` (routing + RF rows merged in `useDevice`). Row TTL and pruning live in `src/renderer/lib/diagnostics/diagnosticRows.ts`; mesh congestion copy is shared via `MeshCongestionAttributionBlock.tsx`. **Foreign LoRa detection** (cross-protocol) is implemented in `src/renderer/lib/foreignLoraDetection.ts` and stored in `diagnosticsStore.foreignLoraDetections`; it classifies raw LoRa payloads (MeshCore 0x3c, Meshtastic header, or unknown) and surfaces detections in the Node Detail modal. If you add a new routing or RF finding, extend the `DiagnosticRow` union and ensure the panel table renders the new kind — see existing tests in `DiagnosticsPanel.test.tsx` and `diagnosticRows.test.ts`. Note: routing anomalies are Meshtastic-only — `RoutingDiagnosticEngine` accepts an optional `capabilities` parameter and skips protocol-incompatible detectors (e.g. `impossible_hop` is skipped for MeshCore because `hops_away` does not exist in that protocol).

**Dual-protocol architecture:** The app supports two protocols: `meshtastic` (default) and `meshcore`. The active protocol is stored in `localStorage['mesh-client:protocol']` and drives which hook (`useDevice` vs `useMeshCore`) powers the app. Both hooks expose the same top-level shape so components stay protocol-agnostic wherever possible. Protocol-specific divergences are handled via the `ProtocolCapabilities` descriptor from `src/renderer/lib/radio/BaseRadioProvider.ts` — add capabilities there (not as string comparisons) when gating UI on protocol.

- `useDevice.ts` — Meshtastic-specific; uses `@meshtastic/core`; connections created via `createConnection()` in `src/renderer/lib/connection.ts` (BLE/Serial/HTTP).
- `useMeshCore.ts` — MeshCore-specific; uses `@liamcottle/meshcore.js`; connections created inside the hook (BLE, Web Serial, or TCP via main-process IPC). No use of `connection.ts`.
- `useRadioProvider(protocol)` — returns a memoized `ProtocolCapabilities` object; pass this down into components and engines rather than comparing `protocol === 'meshcore'` strings everywhere.

**Dual-mode UI:** `App.tsx` chooses the active hook by protocol and renders the same shell (tabs, Log panel, status). Tab 6 is **Modules** (Meshtastic: `ConfigPanel`, `ModulePanel`) or **Repeaters** (MeshCore: `RepeatersPanel`). Panels such as `RadioPanel`, `ConnectionPanel`, and `NodeDetailModal` accept optional props (e.g. `onApplyLoraParams`, `onSetOwner`) that are set only for the active protocol; when adding protocol-specific UI, gate on `capabilities` or the presence of these handlers rather than on the protocol string.

**MeshCore IPC channels:** Main-process TCP bridge for MeshCore uses `meshcore:tcp-connect`, `meshcore:tcp-write`, `meshcore:tcp-disconnect`, `meshcore:tcp-data` (renderer push), and `meshcore:tcp-disconnected` (renderer push). These are handled in `src/main/index.ts` and wired into the renderer via `window.electronAPI.meshcore.tcp.*` in the preload.

**MeshCore database:** MeshCore contacts and messages are stored in `meshcore_contacts` and `meshcore_messages` (see `src/main/database.ts` for current schema version). The `saveMeshcoreContact` IPC does a full `INSERT OR REPLACE` (preserves `favorited`); `updateMeshcoreContactAdvert` does a targeted `UPDATE` of `last_advert`, `adv_lat`, `adv_lon` only — used by the periodic advert push event (128) to avoid overwriting contact metadata with partial data.

**Stores used by both protocols:** `positionHistoryStore` holds the 60-minute position trail and path-overlay visibility; `diagnosticsStore` holds `foreignLoraDetections` (cross-protocol foreign LoRa detection). MeshCore-only: `repeaterSignalStore` caches repeater status for the Repeaters panel. See `src/renderer/stores/`.

### MeshCore internals

This subsection is a contributor reference for working on MeshCore-specific features. Read it alongside `src/renderer/hooks/useMeshCore.ts`.

**BLE:** The app retries BLE connect once on "Connection already in progress" or "disconnected during GATT init" (see `useMeshCore.ts`). The ideal fix is for `@liamcottle/meshcore.js` to perform the first BLE write only after `gatt.connect()` has resolved; contributors can consider opening an issue or PR upstream for that behavior.

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

TCP transport is implemented as a class inside `useMeshCore.ts` (not a separate file). It wraps `SerialConnection` from `meshcore.js` and routes bytes through the main-process TCP bridge. The default MeshCore TCP port is **4403**.

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

Vitest is configured to run **renderer** tests only: `src/renderer/**/*.test.{ts,tsx}` (see `vitest.config.ts`). Main-process code is not covered by the current vitest include glob; add or adjust tests there if you introduce main-only logic that should be automated.

**Accessibility tests:** `src/renderer/vitest.setup.ts` registers **vitest-axe**. New or heavily changed panels should include a test that renders the component and asserts no axe violations, following existing component tests (e.g. `await axe(container)` and `expect(results).toHaveNoViolations()`).

```bash
npm run test:run      # run once (also runs automatically on git commit)
npm test              # watch mode
npm run test:verbose  # verbose output with full violation details
```

## AI Tools Policy

AI coding assistants (Claude Code, GitHub Copilot, etc.) are welcome for brainstorming, boilerplate, and first drafts. However:

- **Electron IPC security is a known weak spot for AI tools.** AI models are confidently wrong about what is and isn't safe to expose via `contextBridge`. Never accept AI-generated IPC code without understanding it yourself.
- **Log injection (CodeQL):** AI often suggests sanitizing only inside the logging function. CodeQL requires sanitization at the **call site** — pass `sanitizeLogMessage(...)` around any user-controlled value before it is passed into `appendLine()` or similar. See [Log injection (CodeQL js/log-injection)](#log-injection-codeql-jslog-injection) above.
- All AI-generated code must be reviewed and manually tested by a human before merging.
- If you used an AI tool, note it briefly in the PR body — not required, just helpful for reviewers.

## Human-First Testing Requirement

Every PR must be manually tested before review. No exceptions for "trivial" changes.

1. Run `npm start` locally and exercise the changed functionality end-to-end.
2. Open Chrome DevTools for **both** the Main process (via the terminal) and the Renderer process (Ctrl/Cmd+Shift+I) — confirm no new errors or warnings.
3. If you changed connection logic, test on an actual or emulated device if possible.

## Electron-Specific Checks

Before submitting a PR that touches IPC or the preload layer:

- **contextBridge exposure**: Only expose the minimum API surface needed. Never expose `ipcRenderer` directly or pass arbitrary channel names to the renderer.
- **Channel naming**: Main-process **invoke** handlers use namespaced channels (e.g. `db:*`, `mqtt:*`, `meshcore:*`, `update:*`). Preload exposes a single `electronAPI` object with nested namespaces (`db`, `mqtt`, `meshcore`, …) that wrap `ipcRenderer.invoke` — see `src/preload/index.ts`. When adding IPC, add the handler in main **and** the typed method on the matching preload namespace **and** the corresponding entry in the `Window.electronAPI` type declaration in `src/renderer/lib/types.ts` so the renderer stays on a minimal, reviewed, typed surface.
- **Main→renderer events**: One-way `webContents.send` / `ipcRenderer.on` channels sometimes use **kebab-case** without a domain prefix (e.g. `bluetooth-devices-discovered`, `serial-ports-discovered`) for historical or Chromium-callback wiring. **Invoke** channels should stay `domain:action`; when adding new **events**, prefer a consistent prefix (e.g. `ble:devices-discovered`) if you are touching both main and preload anyway; otherwise document the channel in the preload API.
- **Cross-platform UI**: Test or at minimum visually verify your changes on your platform; flag in the PR if you could not test on other OSes.
- **Build check**: Confirm `npm run build` completes without errors.

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
- **Before you commit:** If you added or changed any main-process logging (`src/main/**/*.ts`) that passes error-like values (e.g. `err`, `e`, `error`, `reason`) into `console.log` / `console.warn` / `console.error`, wrap the value in `sanitizeLogMessage(...)` at the call site. The pre-commit hook runs `npm run check:log-injection`, which flags such calls; fix any reported lines before committing.
- **Local check:** Run `npm run check:log-injection` to scan `src/main` for unsanitized `console.*(..., err|e|error|reason)` patterns. To suppress a false positive, add `// log-injection-ok` with a short reason on the same line as the console call.
- **Checks:** Code scanning runs on push (GitHub default setup). If you add or change code that feeds into the log pipeline, ensure the **first** use of untrusted data in that path is wrapped in `sanitizeLogMessage()` at the call site.
- **Tests:** When adding or changing code that feeds into the log pipeline (e.g. new call sites of `appendLine`, `console.*` in main, or renderer→main log forwarding), add or extend tests so that log injection is caught by the suite. Pre-commit runs `npm run test:run`, which includes `src/renderer/lib/sanitize-log-message.test.ts`: that file tests both `sanitizeLogMessage` and `sanitizeForLogSink` (used by the console overrides in log-service) and runs the log-injection script so that regressions fail the test run. Add or extend tests there (or equivalent) so regressions are caught. AI and reviewers should ensure such tests exist or are added.

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
2. **Update docs** — If you added or changed a feature, update README.md or relevant `/docs` files.
3. **Follow existing code style** — Run `npm run lint` (and let pre-commit run `format` or run `npm run format` yourself). Fix import-sort, type-imports, and hook dependency issues before pushing.
4. **Keep scope tight** — Avoid refactoring unrelated code in the same PR. One concern per PR makes review faster.
5. **Await review** — A maintainer will review and may request changes before merging.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
