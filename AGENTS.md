# AGENTS.md — Coding Guidelines for AI Assistants

## Architecture

Electron desktop app with three process boundaries:

- `src/main/` — Node.js main process: BLE (noble), serial, SQLite (`database.ts`), MQTT (`mqtt-manager.ts`), IPC handlers, auto-updater
- `src/preload/` — Context bridge exposing minimal typed IPC surface to renderer via `contextBridge`
- `src/renderer/` — React 19 UI (Vite, jsdom); hooks, components, stores (Zustand), lib utilities
- `src/shared/` — Types and constants shared across all processes

## Build / Lint / Test Commands

```bash
# Development
pnpm run dev   # Start dev mode (vite + electron)
pnpm run build # Production build (all targets)
pnpm start     # Build and start electron

# Code quality
pnpm run lint         # ESLint (type-aware)
pnpm run lint:fix     # ESLint with auto-fix
pnpm run format       # Prettier write
pnpm run format:check # Prettier check only
pnpm run typecheck    # TypeScript (renderer + main)
pnpm run lint:md      # Markdownlint for all .md files

# Checks
pnpm run check:log-injection # Verify no unsanitized error logging
pnpm run check:db-migrations # Validate SQLite migrations
pnpm run check:ipc-contract  # Verify preload/main API alignment

# Testing
pnpm test             # Vitest watch mode
pnpm run test:run     # Run all tests once (CI mode)
pnpm run test:verbose # Verbose output

# Run single test file
npx vitest run src/renderer/components/Button.test.tsx
npx vitest run src/main/database.test.ts

# Run tests matching pattern
npx vitest run --reporter=verbose -t "should render"

# Pre-commit hooks (run automatically on git commit)
pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test:run
```

## Code Style

### Formatting (Prettier)

- **Semi**: always
- **Quotes**: single
- **Trailing commas**: all
- **Print width**: 100
- **Tab width**: 2 spaces (no tabs)
- **End of line**: LF

### Imports

- Use `@/` path alias for `src/` imports (e.g., `@/renderer/components/Button`)
- Sort imports automatically (`eslint-plugin-simple-import-sort`)
- Use `import type { ... }` for type-only imports (enforced by ESLint)
- Group: external deps → internal aliases → relative imports

### TypeScript

- **Strict mode enabled** — no implicit any
- Renderer uses `tsconfig.json` (ESNext, bundler resolution, JSX)
- Main/preload uses `tsconfig.main.json` (CommonJS, Node resolution)
- Avoid `any` — use `unknown` with type guards
- Export types explicitly; prefer interfaces over type aliases for objects

### Naming Conventions

- **Components**: PascalCase (e.g., `ConnectionPanel.tsx`)
- **Hooks**: camelCase starting with `use` (e.g., `useDevice.ts`)
- **Utils/helpers**: camelCase (e.g., `parseStoredJson.ts`)
- **Constants**: SCREAMING_SNAKE_CASE for true constants
- **Types/Interfaces**: PascalCase with descriptive names
- **Files**: PascalCase for components, camelCase for utilities

### React

- Functional components with hooks
- `react-hooks/exhaustive-deps` is **error** level — fix dependency arrays
- Use `jsx-runtime` (no need to import React)
- Accessibility: every interactive element needs `aria-label` (Electron hides text from AT)
- Components must have accessible labels (axe tests enforce this)

### Error Handling

- **Log levels**: Use `console.debug` for diagnostics; `warn` for recoverable; `error` before rethrow
- **Never swallow errors**: Every catch must log, rethrow, or have `// catch-no-log-ok <reason>`
- **No bare `console.log`**: Use `console.debug` (enforced by pre-commit)
- **Log injection**: Sanitize user-controlled data with `sanitizeLogMessage()` at call site before passing to `appendLine()` or any logger

### Security

- **IPC**: Never expose `ipcRenderer` directly; use namespaced channels (`db:*`, `mqtt:*`, `meshcore:*`)
- **Preload**: Expose minimal API surface via `contextBridge`
- **XSS**: No `dangerouslySetInnerHTML`, no `innerHTML` assignment, no `eval()`
- **Child process**: Banned `exec`/`execSync`; use spawn-style APIs

### Testing

- **Renderer tests**: `src/renderer/**/*.test.{ts,tsx}` (jsdom environment)
- **Main tests**: `src/main/**/*.test.ts` (node environment)
- **Accessibility**: Include axe tests for new panels (`expect(results).toHaveNoViolations()`)
- **Contract tests**: Update when changing CSP, build config, IPC limits, or log filters

## Project-Specific Rules

### Dual-Protocol Architecture

- Support both `meshtastic` and `meshcore` protocols
- Gate UI features via `ProtocolCapabilities` (never string compare `protocol === 'meshcore'`)
- Use `useRadioProvider(protocol)` to get capabilities object

### Electron IPC Channels

- **Invoke handlers**: Use `domain:action` naming (e.g., `db:query`, `mqtt:publish`)
- **Main→renderer events**: Prefer consistent prefixes (e.g., `ble:devices-discovered`)
- Add handler in main, preload namespace, AND `Window.electronAPI` type declaration
- **Contract tests**: Update `src/main/index.contract.test.ts` when adding or renaming channels

### Log Injection (CodeQL)

When logging user-controlled data:

```typescript
// CORRECT: sanitize at call site
appendLine('info', 'main', sanitizeLogMessage(userInput));

// INCORRECT: sanitizing inside appendLine doesn't clear CodeQL taint
appendLine('info', 'main', userInput); // CodeQL will flag this
```

### Commit Style

Use Conventional Commits:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `chore:` maintenance/config
- `refactor:` code change (neither fix nor feature)
- `test:` adding/updating tests

For `feat:` and `fix:`, include issue reference in footer if applicable.

### Pull Requests

When creating a PR, the description **must** include details for **all commits** in the branch, not just the most recent one. Use `git log origin/main..HEAD --oneline` to see all commits that will be included in the PR.

## Pre-Commit Checklist

1. `pnpm run format` — auto-formats staged files (including `.sh` files)
2. `pnpm run lint:md` — markdownlint fixes all .md files
3. `pnpm run lint` — passes with no errors
4. `pnpm run typecheck` — TypeScript compiles
5. `pnpm run check:log-injection` — no unsanitized error logging
6. `pnpm run check:db-migrations` — SQLite migrations valid; run when touching `database.ts`
7. `pnpm run check:ipc-contract` — preload/main API alignment
8. `pnpm audit --audit-level=high` — no high/critical vulnerabilities
9. `actionlint` — GitHub workflow linting
10. `yamllint -f github -s .` — YAML linting
11. `pnpm run test:run` — all tests pass

## Quick Reference

- **Node version**: 22.x (CI uses 22.12.0+)
- **Test environments**: renderer (jsdom), main (node)
- **Path alias**: `@/` → `src/`
- **Prettier config**: `.prettierrc` (includes `prettier-plugin-sh` for shell scripts)
- **ESLint config**: `eslint.config.mjs`
- **Vitest config**: `vitest.config.ts`
- **Native rebuild**: Run `pnpm run rebuild` after changing Node or Electron versions
- **Actionlint**: Install with `pnpm run setup:actionlint` — commits fail without it

---

# Strict AI Operational Guardrails

## 1. The 2-Strike Loop-Breaking Rule

- If a test, build step, command, or script fails more than TWICE with the exact same error, **STOP EDITING IMMEDIATELY**.
- Do not attempt a third fix. Do not guess.
- Explain the error to the user and explicitly ask for guidance or missing context.

## 3. Zero Hallucination Policy

- Do not hallucinate functions, variables, missing files, or imports.
- If a dependency, file, or piece of context is missing, **STOP** and ask the user to provide it.
- Never assume the structure of a file you haven't read.

## 4. Verify Before Writing (Build Mode)

- Before modifying any file in Build mode, you MUST use your tools (like `read` or `grep`) to confirm the target lines and logic actually exist.
- Do not blindly write or patch files based on outdated context.
