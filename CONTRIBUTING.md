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

After `npm install`, the repo’s git hooks are enabled (`core.hooksPath` → `.githooks`). On every commit, the **pre-commit** hook runs in order:

1. **`npm run format`** — Prettier **writes** to matching files (not `format:check`).
2. **Re-stage** — Only files that were already staged are re-added, so unstaged WIP is not swept in.
3. **`npm run lint`**
4. **`npm run typecheck`** — TypeScript check for renderer and main/preload.
5. **`npm run test:run`** — Fails the commit if tests fail.

To skip the hook in an emergency: `git commit --no-verify`.

If `better-sqlite3` or other native addons fail after changing Node or Electron versions, run `npm run rebuild` (same script as `postinstall`).

**Windows**: If `dist:win` or `rebuild` fails with “space in the path” or `EPERM` unlink on `better_sqlite3.node`, try `npm run dist:win` again (beforeBuild clears `better-sqlite3/build` before the packaging rebuild), or `npm run dist:win:skip-rebuild` if postinstall already built the native module. If it still fails, use a path **without spaces**, close Electron/Node processes, and see README troubleshooting.

**Linux sandbox / SIGILL**: If `npm install` fails with `electron exited with signal SIGILL`, use `MESHTASTIC_SKIP_ELECTRON_REBUILD=1 npm install`, then run `npm run rebuild` where the Electron binary runs (see README Linux troubleshooting).

## Code style

Run `npm run lint` before pushing. ESLint is configured with:

- **Import order** — `eslint-plugin-simple-import-sort` on imports and exports; no duplicate imports; newline after imports.
- **Type-only imports** — `@typescript-eslint/consistent-type-imports` (use `import type { … }` where appropriate).
- **Renderer only** — `react-hooks/exhaustive-deps` is an **error**; fix dependency arrays rather than disabling. **Exception:** If an effect must _not_ re-run when a dependency changes (e.g. intentional one-shot on mount, or avoiding stale closure without widening deps), you may use `eslint-disable-next-line react-hooks/exhaustive-deps` **only** with an inline comment on the same line or immediately above explaining why (what is intentionally omitted and why). Prefer refs or splitting effects first; disable as a last resort.
- **Ignored by lint** — `scripts/**`, `dist-electron/**`, and `*.config.*` files are excluded; change those configs only when needed.

**Path alias:** `@/` maps to `src/` (see `tsconfig.json`, `tsconfig.main.json`, and `vitest.config.ts`). Prefer `@/renderer/...` or `@/main/...` over long relative paths when adding imports.

**Diagnostics work:** The Network Diagnostics tab is driven by `diagnosticRows` in `diagnosticsStore` (routing + RF rows merged in `useDevice`). Row TTL and pruning live in `src/renderer/lib/diagnostics/diagnosticRows.ts`; mesh congestion copy is shared via `MeshCongestionAttributionBlock.tsx`. If you add a new routing or RF finding, extend the `DiagnosticRow` union and ensure the panel table renders the new kind — see existing tests in `DiagnosticsPanel.test.tsx` and `diagnosticRows.test.ts`.

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
- **Channel naming**: Main-process **invoke** handlers use namespaced channels (e.g. `db:*`, `mqtt:*`, `update:*`). Preload exposes a single `electronAPI` object with nested namespaces (`db`, `mqtt`, …) that wrap `ipcRenderer.invoke` — see `src/preload/index.ts`. When adding IPC, add the handler in main **and** the typed method on the matching preload namespace so the renderer stays on a minimal, reviewed surface.
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
