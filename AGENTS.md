# AGENTS.md — Coding Guidelines for AI Assistants

Before substantive changes, skim [ARCHITECTURE.md](ARCHITECTURE.md) for layout and data flow. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, pre-commit hooks, **code style, and testing protocols**. This file focuses on mesh-specific scope, architecture, security, and workflow. Read relevant source before editing.

## 1. Scope & Workflow

- Only change what was asked. No drive-by refactors, reformatting, or types/comments outside scope.
- **Testing:** Ship a passing test for behavioral changes; do not call the task done without it.
- **Stateful/I/O code:** Preserve integrity on failure; document failure point, fallback, and logging where it matters.

## 2. Architecture & Domain

Electron: `src/main/` (Node, SQLite, BLE, MQTT), `src/preload/` (bridge), `src/renderer/` (React 19, Vite, Zustand). **Dual-protocol:** meshtastic and meshcore; gate UI with `ProtocolCapabilities` and `useRadioProvider(protocol)` (do not compare `protocol === 'meshcore'`). Routing/diagnostics changes must stay compatible with the Diagnostics panel (Hop Goblins, Hidden Terminals, etc.). **pnpm** only for package commands. **Never** add cryptocurrency tech or dependencies.

**Code style and testing:** [Code style & standards](CONTRIBUTING.md#code-style--standards) and [Testing protocols](CONTRIBUTING.md#testing-protocols) in [CONTRIBUTING.md](CONTRIBUTING.md).

## 3. Security & Error Handling

- Catches must log, rethrow, or `// catch-no-log-ok <reason>`. Prefer Result types over deep nesting.
- **Logging:** `console.debug` / `warn` / `error` as appropriate; no bare `console.log`.
- **Log injection:** Call `sanitizeLogMessage()` on user-controlled strings before `appendLine()` or loggers.
- **IPC:** Namespaced channels (`db:*`, `mqtt:*`, etc.); expose only via `contextBridge` in preload; **never** expose `ipcRenderer` directly.
- **System boundaries:** Follow repo security rules for subprocess APIs, DOM/HTML sinks, and dynamic code. Validate external inputs; do not over-validate internal code.

## 4. Commands & CI Checks

Use **pnpm**; scripts are in `package.json` and [Quick Commands](CONTRIBUTING.md#quick-commands) / the pre-commit list in [CONTRIBUTING.md](CONTRIBUTING.md). Before PR: `pnpm run lint`, `typecheck`, `test:run`, plus any relevant `check:*` (log-injection, db-migrations, ipc-contract, licenses).

## 5. Git & PR Workflow

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Remote: `Colorado-Mesh/meshtastic-client`. Pre-PR: refresh `README`/version metadata as needed; `gh pr create` descriptions must cover **all** commits on the branch (`git log origin/main..HEAD --oneline`), not only the last one. Subsystem maps, diagnostics detail, and troubleshooting: [ARCHITECTURE.md](ARCHITECTURE.md).

## 6. Cursor / Claude indexing and debug logs

[`.cursorignore`](.cursorignore) and [`.claudeignore`](.claudeignore) exclude noisy paths (build output, dependencies, and **Cursor debug logs under `.cursor/`**) so they are less likely to pollute default context. Ignored paths may still be read when you **open the file**, **paste an excerpt**, or **reference an explicit path** in chat (tool behavior can differ by product; prefer small excerpts for very large logs).

## 7. Optimizations

# Context Management Protocol
- **Deterministic Prefix:** Do not include timestamps, dynamic session IDs, or fluctuating environment variables in the first 2,000 tokens of this prompt.
- **Read/Glob Hygiene:** When reading files larger than 100 lines or performing wide directory globs, provide a concise summary of findings. 
- **Cold Storage Transition:** After 10 turns, if a previously read file is not the current focus, refer to it only by summary or path; do not re-read or re-dump the content unless a specific logic change is required.
- **TOIN Tagging:** Explicitly tag key architectural decisions with `#TOIN-KEY` to assist the retrieval engine in indexing compressed blocks.
