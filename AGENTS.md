# AGENTS.md — Coding Guidelines for AI Assistants

Before substantive changes, skim [ARCHITECTURE.md](ARCHITECTURE.md) for layout and data flow. Read `CONTRIBUTING.md` and relevant source before editing.

## 1. Strict AI Operational Guardrails (Read First)

- **2-Strike Rule:** If a test, build, or script fails more than twice with the same error, stop editing, explain the error, and ask for guidance. No third blind fix.
- **No hallucination:** Do not invent symbols, files, or imports. If context is missing, stop and ask. Verify with tools (`read`, `grep`) before patching.
- **Output:** No filler. ASCII only (no smart quotes, em dashes, or non-ASCII decoration). Be concise; say when unsure.
- **Git:** Never push, force-push, or `--no-verify` unless explicitly told. Confirm before destructive git (e.g. `reset --hard`, `branch -D`).

## 2. Scope & Workflow

- Only change what was asked. No drive-by refactors, reformatting, or types/comments outside scope.
- **Testing:** Ship a passing test for behavioral changes; do not call the task done without it.
- **Stateful/I/O code:** Preserve integrity on failure; document failure point, fallback, and logging where it matters.

## 3. Architecture & Domain

Electron: `src/main/` (Node, SQLite, BLE, MQTT), `src/preload/` (bridge), `src/renderer/` (React 19, Vite, Zustand). **Dual-protocol:** meshtastic and meshcore; gate UI with `ProtocolCapabilities` and `useRadioProvider(protocol)` (do not compare `protocol === 'meshcore'`). Routing/diagnostics changes must stay compatible with the Diagnostics panel (Hop Goblins, Hidden Terminals, etc.). **pnpm** only for package commands. **Never** add cryptocurrency tech or dependencies.

## 4. Code Style & Standards

- **Prettier:** Semi always, single quotes, trailing commas, print width 100, tab 2, LF.
- **TypeScript:** Strict; avoid `any`; prefer `unknown` + guards; export types; prefer interfaces over type aliases.
- **React:** Function components only; `exhaustive-deps` is errors; `?.` in JSX; **every interactive control needs `aria-label`**.
- **Zustand:** Module-level defaults for stable refs; prefer `useStore(s => s.field)` over broad subscriptions; avoid subscribing to whole Maps when one id suffices; `persist` for localStorage, IPC from an effect for SQLite; extract time constants to `src/renderer/lib/timeConstants.ts` (e.g. `MS_PER_SECOND`).
- **Performance:** No hot-path O(n); lazy cleanup when collections grow large.

## 5. Security & Error Handling

- Catches must log, rethrow, or `// catch-no-log-ok <reason>`. Prefer Result types over deep nesting.
- **Logging:** `console.debug` / `warn` / `error` as appropriate; no bare `console.log`.
- **Log injection:** Call `sanitizeLogMessage()` on user-controlled strings before `appendLine()` or loggers.
- **IPC:** Namespaced channels (`db:*`, `mqtt:*`, etc.); expose only via `contextBridge` in preload; **never** expose `ipcRenderer` directly.
- **System boundaries:** Follow repo security rules for subprocess APIs, DOM/HTML sinks, and dynamic code. Validate external inputs; do not over-validate internal code.

## 6. Testing Protocols

- Renderer: jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main: node (`src/main/**/*.test.ts`).
- Mock console before spying logged errors (e.g. `vi.spyOn(console, 'warn').mockImplementation(() => {})`; use `beforeEach` when shared).
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.

## 7. Commands & CI Checks

Use **pnpm**; full script list is in `package.json`. Before PR: `pnpm run lint`, `typecheck`, `test:run`, plus any relevant `check:*` (log-injection, db-migrations, ipc-contract, licenses). Single-file example: `pnpm dlx vitest run path/to/file.test.ts`.

## 8. Git & PR Workflow

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Remote: `Colorado-Mesh/meshtastic-client`. Pre-PR: refresh `README`/version metadata as needed; `gh pr create` descriptions must cover **all** commits on the branch (`git log origin/main..HEAD --oneline`), not only the last one.

Subsystem maps, diagnostics detail, and troubleshooting: **AI assistant quick reference** in [ARCHITECTURE.md](ARCHITECTURE.md).
