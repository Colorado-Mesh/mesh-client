# Architecture

Project layout, data flow, and code placement for human reference. For AI coding guidelines, see [AGENTS.md](AGENTS.md) (self-contained).

## Layout map

Path alias `@/*` maps to `src/*` (see `tsconfig.json`).

| Boundary | Path            | Role                                                                                                                                                                                                                  |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main/`     | SQLite (`database.ts`, `db-compat.ts`), BLE (`noble-ble-manager.ts`), MQTT (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`), logging (`log-service.ts`, `sanitize-log-message.ts`), IPC handlers, window, GPS, updater |
| Preload  | `src/preload/`  | `contextBridge` exposing namespaced `electronAPI` only; never expose `ipcRenderer`                                                                                                                                    |
| Renderer | `src/renderer/` | React 19 + Vite + Zustand: `components/`, `hooks/`, `stores/`, `lib/` (includes `lib/diagnostics/`, `lib/radio/`, `lib/transport/`), `workers/`                                                                       |
| Shared   | `src/shared/`   | IPC contracts (`electron-api.types.ts`), protocol-neutral helpers                                                                                                                                                     |

**Entry points:** `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`.

**Repo root (not exhaustive):** `.github/workflows/`, `scripts/check-*.mjs` (IPC, migrations, log injection, etc.), `docs/`, `resources/`, `vite.config.ts`, `electron-builder.yml`, `package.json`.

## Process boundaries

- **Main:** Node runtime; all privileged I/O and IPC handlers.
- **Preload:** Thin bridge; namespaced channels (`db:*`, `mqtt:*`, `log:*`, `ble:*`, `serial:*`, `session:*`, etc.).
- **Renderer:** UI only; talk to main via `window.electronAPI` from preload.
- **Shared:** Types and safe helpers imported by main and renderer.

**Tests:** Co-located `*.test.ts` / `*.test.tsx`; update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change (see [Testing protocols](CONTRIBUTING.md#testing-protocols) in CONTRIBUTING.md).

**Package manager:** `pnpm` only.

## Dual protocol (Meshtastic + MeshCore)

Both stacks can run at once: independent connections, header switcher for focus, inactive protocol stays connected, per-protocol unread badges (Meshtastic green, MeshCore cyan). Capabilities differ (e.g. Meshtastic: Security/Modules/TAK; MeshCore: Repeaters, contact groups, MeshCore MQTT adapter).

**Feature gating:** use `ProtocolCapabilities` via `useRadioProvider(protocol)` from `src/renderer/lib/radio/providerFactory.ts`; do not branch on raw `protocol === 'meshcore'` strings.

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';

const capabilities = useRadioProvider(protocol);
```

## IPC data flow

Adding a cross-boundary feature:

1. Types in `src/shared/electron-api.types.ts`.
2. `ipcMain.handle('namespace:action', ...)` in `src/main/index.ts` (mirror existing patterns).
3. Expose on `electronAPI` in `src/preload/index.ts` via `ipcRenderer.invoke`.
4. Call from renderer: `window.electronAPI....`

Sanitize user-controlled strings before logs and IPC per [AGENTS.md](AGENTS.md).

## AI assistant quick reference

### Diagnostics

- **Engines:** `src/renderer/lib/diagnostics/`; `RoutingDiagnosticEngine.ts`, `RFDiagnosticEngine.ts`, `RemediationEngine.ts`.
- **Store:** `src/renderer/stores/diagnosticsStore.ts`; routing/RF rows, foreign LoRa, MQTT ignore, redundancy.
- **Extend:** adjust `DiagnosticRow` in `src/renderer/lib/types.ts`, add detector, wire `replaceRoutingRowsFromMap` / `replaceRfRowsForNode`; TTL defaults in `diagnosticRows.ts` (routing 24h, RF 1h).
- **Full reference** (meanings, triggers, UI surfaces): [docs/diagnostics.md](docs/diagnostics.md).

### Bug workflow

1. Reproduce (`pnpm start`); note what you see.
2. Search errors under `src/main/` or `src/renderer/`.
3. Add `console.debug` only when needed.
4. Minimal fix + co-located tests.
5. `pnpm dlx vitest run <file>` and `pnpm run lint`.

**First places to look:** `useDevice.ts` / `useMeshCore.ts` (connection); `stores/*` (UI state); `src/main/index.ts` (IPC).

### Protocols

- **Meshtastic:** `useDevice.ts`, `connection.ts` (`createConnection`).
- **MeshCore:** `useMeshCore.ts`, `@liamcottle/meshcore.js`.

### Database

- WAL SQLite; `user_version` in `database.ts`; migrations as `migration_N()`; `db-compat.ts` over `node:sqlite`. After schema changes: `pnpm run check:db-migrations`.

### BLE and serial

- Meshtastic BLE: `connection.ts` / `TransportManager`. MeshCore BLE: `noble-ble-manager.ts` (macOS/Windows), Web Bluetooth IPC on Linux. Serial: `connection.ts`, `serialPortSignature.ts`. Errors: `humanize*` in `connection.ts`. Reconnect watchdog: `useDevice.ts`.
- **ATT MTU:** Noble sessions chunk `toRadio` writes from `peripheral.mtu` / `mtu` events (`bleAttWriteLimit.ts` for spec-safe defaults). Web Bluetooth (Linux) chunks only when Chromium exposes `BluetoothRemoteGATTCharacteristic.maximumWriteValueLength`; otherwise a single `writeValue` per payload (no portable negotiated-MTU API in the web spec).

### MQTT

- Meshtastic: `mqtt-manager.ts` (AES, protobuf, dedup). MeshCore: `meshcore-mqtt-adapter.ts` (JSON v1 envelope).

### UI

- Panels: `src/renderer/components/`. New tabs: `lazyTabPanels.ts` / `lazyAppPanels.ts` + capabilities. Stores: module defaults; persist vs SQLite IPC as elsewhere.

### Common issues

| Symptom          | Where to check                                 |
| ---------------- | ---------------------------------------------- |
| Connection fails | `useDevice.ts`, `useMeshCore.ts`               |
| Send fails       | `useDevice.sendText`, `useMeshCore` send paths |
| UI stale         | Zustand store, effect deps                     |
| BLE timeout      | `noble-ble-manager.ts`, `bleConnectErrors`     |
| Serial missing   | `serialPortSignature.ts`                       |
| MQTT loop        | `mqtt-manager.ts`                              |
| DB errors        | `database.ts` migrations                       |
| Log gaps         | `log-service.ts`, log tags                     |
