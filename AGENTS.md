# AGENTS.md — Coding Guidelines for AI Assistants

This file is self-contained. ARCHITECTURE.md and CONTRIBUTING.md are human references — read them only if you need deep subsystem detail beyond what's here.

## 1. Scope & Workflow

- Only change what was asked. No drive-by refactors, reformatting, or types/comments outside scope.
- **Testing:** Ship a passing test for behavioral changes; do not call the task done without it.
- **Stateful/I/O code:** Preserve integrity on failure; document failure point, fallback, and logging where it matters.

## 2. Architecture & Domain

Electron: `src/main/` (Node, SQLite, BLE, MQTT), `src/preload/` (bridge), `src/renderer/` (React 19, Vite, Zustand). **Dual-protocol:** meshtastic and meshcore; gate UI with `ProtocolCapabilities` and `useRadioProvider(protocol)` (do not compare `protocol === 'meshcore'`). Routing/diagnostics changes must stay compatible with the Diagnostics panel (Hop Goblins, Hidden Terminals, etc.). **pnpm** only for package commands. **Never** add cryptocurrency tech or dependencies.

**Colors:** Use Tailwind CSS utility classes (e.g., `text-green-400`, `bg-slate-700`). Custom theme colors via CSS custom properties in `styles.css` (`--color-brand-green`, etc.). Avoid inline hex colors in JSX.

**Code style and testing:** [Code style & standards](CONTRIBUTING.md#code-style--standards) and [Testing protocols](CONTRIBUTING.md#testing-protocols) in [CONTRIBUTING.md](CONTRIBUTING.md).

### Layout map

Path alias `@/*` → `src/*` (see `tsconfig.json`).

| Boundary | Path            | Role                                                                                                                                                                                                                  |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main/`     | SQLite (`database.ts`, `db-compat.ts`), BLE (`noble-ble-manager.ts`), MQTT (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`), logging (`log-service.ts`, `sanitize-log-message.ts`), IPC handlers, window, GPS, updater |
| Preload  | `src/preload/`  | `contextBridge` exposing namespaced `electronAPI` only; never expose `ipcRenderer`                                                                                                                                    |
| Renderer | `src/renderer/` | React 19 + Vite + Zustand: `components/`, `hooks/`, `stores/`, `lib/` (includes `lib/diagnostics/`, `lib/radio/`, `lib/transport/`), `workers/`                                                                       |
| Shared   | `src/shared/`   | IPC contracts (`electron-api.types.ts`), protocol-neutral helpers                                                                                                                                                     |

Entry points: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`.

### Dual protocol

Both stacks can run simultaneously. Feature-gate with `ProtocolCapabilities`:

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';
const capabilities = useRadioProvider(protocol);
```

### IPC data flow

Adding a cross-boundary feature:

1. Types in `src/shared/electron-api.types.ts`.
2. `ipcMain.handle('namespace:action', ...)` in `src/main/index.ts`.
3. Expose on `electronAPI` in `src/preload/index.ts` via `ipcRenderer.invoke`.
4. Call from renderer: `window.electronAPI...`

## 3. Security & Error Handling

- Catches must log, rethrow, or `// catch-no-log-ok <reason>`. Prefer Result types over deep nesting.
- **Logging:** `console.debug` / `warn` / `error` as appropriate; no bare `console.log`.
- **Log injection:** Call `sanitizeLogMessage()` on user-controlled strings before `appendLine()` or loggers.
- **IPC:** Namespaced channels (`db:*`, `mqtt:*`, etc.); expose only via `contextBridge` in preload; **never** expose `ipcRenderer` directly.
- **System boundaries:** Follow repo security rules for subprocess APIs, DOM/HTML sinks, and dynamic code. Validate external inputs; do not over-validate internal code.

## 4. Code Style

- **Prettier:** Semi always, single quotes, trailing commas, print width 100, tab 2, LF.
- **TypeScript:** Strict; avoid `any`; prefer `unknown` + guards; export types; prefer interfaces over type aliases.
- **React:** Function components only; `exhaustive-deps` is errors; `?.` in JSX; every interactive control needs `aria-label`.
- **Zustand:** Module-level defaults for stable refs; prefer `useStore(s => s.field)` over broad subscriptions; avoid subscribing to whole Maps when one id suffices; `persist` for localStorage, IPC from an effect for SQLite; extract time constants to `src/renderer/lib/timeConstants.ts`.
- **Performance:** No hot-path O(n); lazy cleanup when collections grow large.

## 5. Testing

- Renderer: jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main: node (`src/main/**/*.test.ts`).
- Mock console before spying logged errors: `vi.spyOn(console, 'warn').mockImplementation(() => {})` in `beforeEach` when shared.
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.

## 6. Commands & CI Checks

**Key commands:** `pnpm run dev`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:run`.

**Pre-commit hook order:**

1. `pnpm run format` — Prettier writes fixes
2. `pnpm run lint:md` — Markdown fixes
3. Re-stage staged files
4. `pnpm run lint`
5. `pnpm run typecheck`
6. `check:log-injection`, `check:log-service-sinks`, `check:codeql-extensions`, `check:db-migrations`, `check:ipc-contract`, `check:licenses`
7. `pnpm audit`
8. `actionlint`, `yamllint`
9. `pnpm run test:run`

Before PR: `pnpm run lint`, `typecheck`, `test:run`, plus any relevant `check:*`.

## 7. Git & PR Workflow

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Remote: `Colorado-Mesh/meshtastic-client`. Pre-PR: refresh `README`/version metadata as needed; `gh pr create` descriptions must cover **all** commits on the branch (`git log origin/main..HEAD --oneline`), not only the last one.

## 8. Subsystem Quick Reference

### Diagnostics

- **Engines:** `src/renderer/lib/diagnostics/` — `RoutingDiagnosticEngine.ts`, `RFDiagnosticEngine.ts`, `RemediationEngine.ts`.
- **Store:** `src/renderer/stores/diagnosticsStore.ts` — routing/RF rows, foreign LoRa, MQTT ignore, redundancy.
- **Extend:** adjust `DiagnosticRow` in `src/renderer/lib/types.ts`, add detector, wire `replaceRoutingRowsFromMap` / `replaceRfRowsForNode`; TTL defaults in `diagnosticRows.ts` (routing 24h, RF 1h).
- **Full reference:** [docs/diagnostics.md](docs/diagnostics.md).

### First places to look

- Connection issues: `useDevice.ts` / `useMeshCore.ts`
- UI state: `stores/*`
- IPC: `src/main/index.ts`

### Protocol entry points

- **Meshtastic:** `useDevice.ts`, `connection.ts` (`createConnection`)
- **MeshCore:** `useMeshCore.ts`, `@liamcottle/meshcore.js`

### Database

WAL SQLite; `user_version` in `database.ts`; migrations as `migration_N()`; `db-compat.ts` over `node:sqlite`. After schema changes: `pnpm run check:db-migrations`.

### BLE and serial

Meshtastic BLE: `connection.ts` / `TransportManager`. MeshCore BLE: `noble-ble-manager.ts` (macOS/Windows), Web Bluetooth IPC on Linux. Serial: `connection.ts`, `serialPortSignature.ts`. Reconnect watchdog: `useDevice.ts`.

### MQTT

Meshtastic: `mqtt-manager.ts` (AES, protobuf, dedup). MeshCore: `meshcore-mqtt-adapter.ts` (JSON v1 envelope).

### UI

Panels: `src/renderer/components/`. New tabs: `lazyTabPanels.ts` / `lazyAppPanels.ts` + capabilities. Stores: module defaults; persist vs SQLite IPC as elsewhere.

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

## 9. Cursor / Claude indexing

[`.cursorignore`](.cursorignore) and [`.claudeignore`](.claudeignore) exclude noisy paths (build output, dependencies, Cursor debug logs under `.cursor/`). Ignored paths may still be read when you open the file, paste an excerpt, or reference an explicit path in chat.

## 10. Context Management

- **Read/Glob Hygiene:** When reading files larger than 100 lines or performing wide directory globs, provide a concise summary of findings.
- **Cold Storage Transition:** After 10 turns, if a previously read file is not the current focus, refer to it by summary or path; do not re-read unless a specific logic change is required.
