# AGENTS.md — Coding Guidelines for AI Assistants

Before writing code, read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the codebase map and data flow.

## 1. Strict AI Operational Guardrails (Read First)

- **The 2-Strike Rule:** If a test, build step, command, or script fails more than TWICE with the exact same error, STOP EDITING IMMEDIATELY. Explain the error and explicitly ask for guidance. Do not attempt a third fix.
- **Zero Hallucination Policy:** Do not hallucinate functions, variables, missing files, or imports. If context is missing, STOP and ask. Never assume the structure of unread files.
- **Verify Before Writing:** Before modifying any file, you MUST use tools (e.g., `read` or `grep`) to confirm the target lines and logic actually exist. Do not blindly patch based on outdated context.
- **Output Restrictions:** No sycophantic openers or closing fluff. No em dashes, smart quotes, or Unicode. ASCII only. Be concise. If unsure, say so. Never guess.
- **Git Restrictions:** Never push to a remote, force-push, or use `--no-verify` unless explicitly commanded. Always confirm before destructive operations (e.g., `reset --hard`, `branch -D`).

## 2. Scope & Workflow Execution

- **Pre-Flight:** Read all relevant files and `CONTRIBUTING.md` before writing anything. Understand the full requirement.
- **Scope Control:** Only make changes directly requested. Do not refactor, add features, reformat, or add comments/types to code outside the scope of the prompt.
- **Testing Mandate:** Test after writing. Never leave code untested. Fix errors before moving on. Never declare a task "done" without a passing test.
- **Resilient Architect Principle:** Ensure state integrity if a failure occurs mid-execution. Document the failure point, fallback, and logging strategy for stateful/I/O-bound logic.

## 3. Architecture & Domain Specifics

- **Process Boundaries:** Electron desktop app with three boundaries: `src/main/` (Node.js, SQLite, BLE, MQTT), `src/preload/` (Context bridge), and `src/renderer/` (React 19, Vite, Zustand).
- **Dual-Protocol:** Support both `meshtastic` and `meshcore` protocols. Gate UI features via `ProtocolCapabilities`. Use `useRadioProvider(protocol)` rather than string comparisons.
- **Diagnostics Integration:** When modifying networking/routing logic, ensure compatibility with the Diagnostics panel and routing anomaly detection mechanisms (e.g., Hop Goblins, Hidden Terminals).
- **Package Management:** Strictly use `pnpm` for all operations to maintain our established launch speed benchmarks.
- **Technology Bans:** Do not introduce, suggest, or integrate any cryptocurrency-based technologies, dependencies, or services under any circumstances.

## 4. Code Style & Standards

- **Formatting:** Prettier strictly enforced. Semi: always, Quotes: single, Trailing commas: all, Print width: 100, Tab width: 2 spaces, End of line: LF.
- **TypeScript:** Strict mode enabled. Avoid `any`; use `unknown` with type guards. Export types explicitly and prefer interfaces over type aliases.
- **React:** Functional components only. `react-hooks/exhaustive-deps` is an error-level rule. Use optional chaining (`?.`) for nullable values in JSX. Every interactive element requires an `aria-label`.
- **State (Zustand):** Define default values outside components at the module level for stable reference equality. Avoid subscribing to entire Maps if only a single ID is needed.
- **Magic Numbers:** Extract time constants to `src/renderer/lib/timeConstants.ts` (e.g., `MS_PER_SECOND`). Define domain-specific thresholds at the module level.
- **Performance:** Avoid O(n) operations in hot paths. Extract lazy cleanup logic into private methods triggered only when a collection exceeds a threshold.

## 5. Security & Error Handling

- **Error Handling:** Never swallow errors. Every catch must log, rethrow, or have `// catch-no-log-ok <reason>`. Prefer Result Types over deep try/catch nesting.
- **Logging:** Use `console.debug` for diagnostics, `warn` for recoverable, `error` before rethrow. No bare `console.log`.
- **Log Injection Validation:** Sanitize user-controlled data with `sanitizeLogMessage()` at the call site before passing to `appendLine()` or any logger.
- **IPC Safety:** Never expose `ipcRenderer` directly. Use namespaced channels (e.g., `db:*`). Expose minimal API surface via `contextBridge`.
- **System Boundaries:** Banned `exec`/`execSync` (use spawn APIs). No `dangerouslySetInnerHTML` or `eval()`. Validate inputs at system boundaries but do not over-validate internal code.

## 6. Testing Protocols

- **Environments:** Renderer tests use jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main tests use node (`src/main/**/*.test.ts`).
- **Console Mocking:** When testing code that logs errors, mock the console method before spying to prevent stderr noise (e.g., `vi.spyOn(console, 'warn').mockImplementation(() => {});`). Use `beforeEach` for shared setup.
- **Contract Tests:** Update `src/main/index.contract.test.ts` when changing CSP, build config, IPC limits, or log filters.

## 7. Commands & CI Checks

- **Development:** `pnpm run dev` (dev mode), `pnpm run build` (production build), `pnpm start` (build & start).
- **Quality:** `pnpm run lint` (ESLint), `pnpm run format` (Prettier), `pnpm run typecheck`, `pnpm run lint:md`.
- **Validation:** `pnpm run check:log-injection`, `pnpm run check:db-migrations`, `pnpm run check:ipc-contract`, `pnpm run check:licenses`.
- **Testing:** `pnpm test` (watch), `pnpm run test:run` (CI mode). Example single file: `pnpm dlx vitest run src/main/database.test.ts`.

## 8. Git & PR Workflow

- **Commits:** Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- **Remote Tracking:** Ensure operations are tracked against the correct remote (`Colorado-Mesh/meshtastic-client`).
- **Pre-PR Sweep:** Update `README.md`, bump versions if warranted, and group metadata changes into a single commit before opening a PR.
- **PR Descriptions:** When executing `gh pr create`, the description MUST include details for all commits in the branch (`git log origin/main..HEAD --oneline`), not just the most recent one.

## 9. Diagnostics Debugging

- **Engines:** `lib/diagnostics/` — `RoutingDiagnosticEngine.ts` (hop anomalies), `RFDiagnosticEngine.ts` (RF), `RemediationEngine.ts` (fixes).
- **Store:** `diagnosticsStore.ts` holds routing rows, RF rows, foreign LoRa, MQTT ignore, packet redundancy.
- **Adding a finding:** Extend `DiagnosticRow` in `types.ts`, add detector in engine, add to store via `replaceRoutingRowsFromMap` or `replaceRfRowsForNode`.
- **TTL:** Routing 24h, RF 1h — configure in `diagnosticRows.ts`.
- **Debug:** Add `console.debug` in detector. Check store in DevTools. Routing requires GPS on both nodes.

## 10. Bug Fix Workflow

1. **Reproduce:** Developer runs `pnpm start` and exercises the failing path. Report findings to AI.
2. **Locate:** Search error text in `main/*.ts` or `renderer/**/*.tsx`.
3. **Log:** Add `console.debug` only if needed to trace execution flow.
4. **Fix:** Apply minimum change needed.
5. **Test:** Add test in same directory (`*.test.ts` or `*.test.tsx`).
6. **Verify:** Run `pnpm dlx vitest run <test-file>` and `pnpm run lint`.

- Connection bugs: `useDevice.ts` / `useMeshCore.ts`.
- UI state bugs: matching store in `stores/`.
- IPC failures: `index.ts`.

## 11. Protocol-Specific Work

- **Meshtastic:** `useDevice.ts` + `createConnection()` in `connection.ts`.
- **MeshCore:** `useMeshCore.ts` + `MeshCoreConnection` from `@liamcottle/meshcore.js`.
- **Capability gating:** Use `useRadioProvider(protocol)` from `providerFactory.ts`. Returns `ProtocolCapabilities`.
- **Never:** Compare `protocol === 'meshcore'` strings.

## 12. Database Changes

- **Schema:** SQLite with WAL mode. Version in `db.pragma('user_version')`.
- **Migration:** Add `migration_N()` in `database.ts`, increment version.
- **API:** Use `db-compat.ts` (wraps `node:sqlite`). Never `better-sqlite3`.
- **Test:** Run `pnpm run check:db-migrations` after changes.

## 13. BLE/Serial Communication

- **Meshtastic BLE:** `connection.ts` → `createBleConnection()` → `TransportManager`.
- **MeshCore BLE:** macOS/Windows: `noble-ble-manager.ts`. Linux: Web Bluetooth via `TransportWebBluetoothIpc`.
- **Serial:** `createSerialConnection()` in `connection.ts`. Port identity: `serialPortSignature.ts`.
- **Errors:** `humanizeBleError`, `humanizeSerialError`, `humanizeHttpError` in `connection.ts`.
- **Reconnect:** Watchdog in `useDevice.ts` (BLE_STALE_THRESHOLD_MS, BLE_DEAD_THRESHOLD_MS).

## 14. MQTT

- **Meshtastic:** `mqtt-manager.ts`. Handles AES decryption, protobuf decode, dedup (10-min window in `seenPacketIds`).
- **MeshCore:** `meshcore-mqtt-adapter.ts`. JSON v1 envelope format.
- **Debug:** Tagged logs `[MQTT]` in mqtt-manager.ts. Check `MQTTStatus` in UI.

## 15. UI Component Development

- **Location:** `components/*.tsx`. Tests co-located as `*.test.tsx`.
- **State:** Use Zustand stores in `stores/`. Define defaults at module level.
- **Rules:** Every interactive element needs `aria-label`. Functional components only. No `dangerouslySetInnerHTML`.
- **Adding a panel:** Add to `lazyTabPanels.ts` or `lazyAppPanels.ts`. Gate via `ProtocolCapabilities`.

## 16. IPC/Preload Extensions

- **Types:** Define in `electron-api.types.ts`.
- **Handler:** Add in `index.ts` with namespaced channel (`db:*`, `mqtt:*`, `meshcore:*`, etc.).
- **Expose:** Add to `preload/index.ts` via `contextBridge.exposeInMainWorld`.
- **Contract test:** Update `index.contract.test.ts` if changing CSP, IPC limits, or log filters.
- **Never:** Expose `ipcRenderer` directly.

## 17. Zustand Store Changes

- **Location:** `stores/*.ts`.
- **Pattern:** `create<Name>((set, get) => ({ ... }))`. Define defaults at module level.
- **Persistence:** Use `persist` middleware for localStorage. For SQLite, call IPC from an effect.
- **Subscriptions:** Prefer selecting specific fields (`useStore(s => s.field)`) over entire store.

## 18. Common Issues Reference

| Issue                  | Where to look                              |
| ---------------------- | ------------------------------------------ |
| Connection fails       | `useDevice.ts` / `useMeshCore.ts`          |
| Messages not sending   | `useDevice.sendText` / `useMeshCore...`    |
| UI not updating        | Zustand store, React useEffect dependency  |
| BLE timeout            | `noble-ble-manager.ts`, `bleConnectErrors` |
| Serial port not found  | `serialPortSignature.ts`                   |
| MQTT reconnect loop    | `mqtt-manager.ts`                          |
| Database error         | `database.ts` migrations                   |
| Log panel missing data | `log-service.ts`, check `[TAG]` prefixes   |
