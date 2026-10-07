# Architecture

Project layout, data flow, and code placement for human reference. For AI coding guidelines, see [AGENTS.md](AGENTS.md) (hard rules) and the subsystem references in [docs/agents/](docs/agents/README.md).

## Layout map

Path alias `@/*` maps to `src/*` (see `tsconfig.json`).

| Boundary | Path            | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main/`     | SQLite (`database.ts`, `db-compat.ts`), BLE (`gatt-sidecar-proxy.ts` + coexistence), MQTT (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`), logging (`log-service.ts`, `sanitize-log-message.ts`, `mecp-received-log.ts`), offline maps (`offline-maps/` + `ipc/offline-maps-handlers.ts`), IPC handlers (`index.ts` plus namespaced modules in `src/main/ipc/` — Reticulum, Reticulum DB, Reticulum identity, RRC DB, TAK, GPS), window, GPS, updater |
| Preload  | `src/preload/`  | `contextBridge` exposing namespaced `electronAPI` only; never expose `ipcRenderer`                                                                                                                                                                                                                                                                                                                                                                    |
| Renderer | `src/renderer/` | React 19 + Vite + Zustand: `components/`, `hooks/`, `runtime/` (protocol runtimes, single mount), `stores/`, `lib/`, `locales/`, `workers/`                                                                                                                                                                                                                                                                                                           |

| Shared | `src/shared/` | IPC contracts (`electron-api.types.ts`), protocol-neutral helpers |

**Entry points:** `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`.

**Repo root (not exhaustive):** `.github/workflows/`, `scripts/check-*.mjs` (IPC, migrations, log injection, etc.), `docs/`, `resources/`, `vite.config.mts`, `electron-builder.yml`, `package.json`.

## Process boundaries

- **Main:** Node runtime; all privileged I/O and IPC handlers.
- **Preload:** Thin bridge; namespaced channels (`db:*`, `mqtt:*`, `log:*`, `ble:*`, `serial:*`, `session:*`, etc.).
- **Renderer:** UI only; talk to main via `window.electronAPI` from preload.
- **Shared:** Types and safe helpers imported by main and renderer.

**Tests:** Co-located `*.test.ts` / `*.test.tsx`; update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change (see [Testing protocols](CONTRIBUTING.md#testing-protocols) in CONTRIBUTING.md).

**Package manager:** `pnpm` only.

## Multi-protocol (Meshtastic + MeshCore + Reticulum)

All three stacks can run at once: independent sessions, rail protocol switcher (MT / MC / RN) for focus (Meshtastic green, MeshCore cyan, Reticulum yellow), inactive protocols stay connected, per-protocol unread badges. Meshtastic and MeshCore use `ConnectionDriver` for RF/MQTT; Reticulum uses the AGPL sidecar (`useReticulumRuntime`; no MQTT for Reticulum's own connections). The sidecar owns BLE RNode/Peer **and** LoRa Meshtastic/MeshCore GATT via `btleplug` (see [docs/agents/ble-serial.md](docs/agents/ble-serial.md) **Multi-protocol BLE coexistence**). Capabilities differ (e.g. Meshtastic: full Security PKI/Modules and ATAK plugin packets; MeshCore: partial Security backup/restore, Repeaters, **Rooms** BBS; Reticulum: LXMF DMs, **Remote** rnsh/rncp (`hasReticulumRemotePanel`), **Nomad Network / My Pages** (`hasNomadNetworkPanel`), **Peers**, **RRC** hub chat (`hasRrcPanel`), propagation, RNode flasher, **Map** (RMAP v4 discovery), Topology). Tab slots are fixed in `src/renderer/lib/tabSlotIds.ts`; visibility is computed in `src/renderer/lib/appTabMappings.ts` (`computeTabMappings()` consumed from `App.tsx`) and grouped into rail sections by `src/renderer/lib/navSections.ts`; **Rooms** requires `hasRoomServersPanel`, Reticulum panels gate on `hasReticulumNetworkPanel` / `hasReticulumInterfaceConfig` / `hasReticulumDiscoveryMap` / `hasRrcPanel` / `hasReticulumRemotePanel` / `hasNomadNetworkPanel`, **Security**/`TAK` require capability flags (~17 visible tabs per protocol; TAK shows on all three; Reticulum hides LoRa-specific tabs).

**Feature gating:** use `ProtocolCapabilities` via `useRadioProvider(protocol)` from `src/renderer/lib/radio/providerFactory.ts`; do not branch on raw `protocol === 'meshcore'` strings.

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';

const capabilities = useRadioProvider(protocol);
```

## IPC data flow

Adding a cross-boundary feature:

1. Types in `src/shared/electron-api.types.ts`.
2. `ipcMain.handle('namespace:action', ...)` in `src/main/index.ts` — or in a namespaced module under `src/main/ipc/` (e.g. `reticulum-handlers.ts`, `reticulum-db-handlers.ts`, `reticulum-identity-handlers.ts`, `rrc-db-handlers.ts`, `tak-handlers.ts`, `gps-handlers.ts`) registered from `index.ts` when the handler set is large enough to warrant its own file.
3. Expose on `electronAPI` in `src/preload/index.ts` via `ipcRenderer.invoke`.
4. Call from renderer: `window.electronAPI....`

Sanitize user-controlled strings before logs and IPC per [AGENTS.md](AGENTS.md).

## AI assistant reference

AI assistant quick reference (diagnostics, bug workflow, protocol entry points, lifecycle, database, BLE/serial, MQTT, Rooms, UI, EMCOMM, offline maps) lives in [docs/agents/architecture-quick-ref.md](docs/agents/architecture-quick-ref.md); symptom lookups are in [docs/agents/common-issues.md](docs/agents/common-issues.md).
