# Contributing to Mesh Client

Thank you for your interest in contributing. See [docs/development-environment.md](docs/development-environment.md) for setup.

**Where conventions live:** [AGENTS.md](AGENTS.md) is self-contained for AI assistants (code style, testing, architecture, and security all inlined). **This file** covers human setup, hooks, and PR flow.

## Code style & standards

- **Prettier:** Semi always, single quotes, trailing commas, print width 100, tab 2, LF.
- **TypeScript:** Strict; avoid `any`; prefer `unknown` + guards; export types; prefer interfaces over type aliases.
- **React:** Function components only; `exhaustive-deps` is errors; `?.` in JSX; **every interactive control needs `aria-label`**.
- **Colors:** Use Tailwind CSS utility classes (e.g., `text-green-400`, `bg-slate-700`). Custom theme colors via CSS custom properties from `styles.css` (`--color-brand-green`, `--color-deep-black`, etc.). Avoid inline hex colors in JSX.
- **Zustand:** Module-level defaults for stable refs; prefer `useStore(s => s.field)` over broad subscriptions; avoid subscribing to whole Maps when one id suffices; `persist` for localStorage, IPC from an effect for SQLite; extract time constants to `src/renderer/lib/timeConstants.ts` (e.g. `MS_PER_SECOND`).
- **Performance:** No hot-path O(n); lazy cleanup when collections grow large.

## Testing protocols

- Renderer: jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main: node (`src/main/**/*.test.ts`).
- Mock console before spying logged errors (e.g. `vi.spyOn(console, 'warn').mockImplementation(() => {})`; use `beforeEach` when shared).
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.

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
6. `check:log-injection`, `check:log-service-sinks`, `check:codeql-extensions`, `check:db-migrations`, `check:ipc-contract`, `check:licenses`
7. `pnpm audit`
8. `actionlint`, `yamllint`
9. `pnpm run test:run`

Skip in emergency: `git commit --no-verify`.

## PR Process

1. Describe your changes and what you tested
2. Update docs if needed
3. Run the checks you need before review (at minimum what the pre-commit hook runs, especially `pnpm run lint` and `pnpm run test:run`)
4. Keep PR scope tight
5. A maintainer will review

## AI-assisted contributions

Follow [AGENTS.md](AGENTS.md) for mesh-specific and security expectations, and this file for code style and testing conventions. Review every line of AI-generated code before merging. Do not accept AI-generated IPC or preload changes without understanding them (Electron IPC is a common weak spot). You may note briefly in the PR if you used an AI tool.

Avoid duplicating always-on Cursor or editor rules with this repo's docs; merge overlaps and prefer **requestable** rules over always-on where possible to reduce fixed context size.

---

By contributing, you agree to license under the [MIT License](LICENSE).
