# Contributing to Mesh Client

Thank you for your interest in contributing. See [docs/development-environment.md](docs/development-environment.md) for setup.

## Quick Commands

```bash
pnpm install
pnpm run dev      # Development mode
pnpm run build    # Production build
pnpm run lint     # ESLint
pnpm run test:run # Run tests
```

## Pre-commit Hook

Before each commit, the hook runs (order matters):

1. `pnpm run format` — Prettier writes fixes
2. `pnpm run lint:md` — Markdown fixes
3. Re-stage staged files
4. `pnpm run lint`
5. `pnpm run typecheck`
6. `check:log-injection`, `check:db-migrations`, `check:ipc-contract`, `check:licenses`
7. `pnpm audit`
8. `actionlint`, `yamllint`
9. `pnpm run test:run`

Skip in emergency: `git commit --no-verify`.

## Accessibility

Every interactive element needs `aria-label`. Key rules:

- `<button>` icon-only: `aria-label="Action description"`
- `<input>` / `<select>`: `<label htmlFor="id">` or `aria-label`
- Modal: `role="dialog" aria-modal="true"`
- Error: `role="alert"`

## Testing

```bash
pnpm run test:run # Run once
pnpm test         # Watch mode
```

Renderer tests use jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main tests use node (`src/main/**/*.test.ts`).

## PR Process

1. Describe your changes and what you tested
2. Update docs if needed
3. Run `pnpm run lint` and `pnpm run test:run` first
4. Keep PR scope tight
5. A maintainer will review

## AI Tools

AI assistants (Claude Code, GitHub Copilot, etc.) are welcome for brainstorming and drafts. However:

- All AI-generated code must be reviewed and tested by a human before merging
- Never accept AI-generated IPC code without understanding it — Electron IPC security is a known weak spot
- Note briefly in the PR if you used an AI tool

---

By contributing, you agree to license under the [MIT License](LICENSE).
