# Contributing to Mesh Client

Thank you for your interest in contributing. See [docs/development-environment.md](docs/development-environment.md) for setup.

**Coding style, testing, accessibility, security, IPC, and AI workflow:** follow [AGENTS.md](AGENTS.md). This file focuses on human setup, hooks, and PR flow.

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

## PR Process

1. Describe your changes and what you tested
2. Update docs if needed
3. Run the checks you need before review (at minimum what the pre-commit hook runs, especially `pnpm run lint` and `pnpm run test:run`)
4. Keep PR scope tight
5. A maintainer will review

## AI-assisted contributions

Follow [AGENTS.md](AGENTS.md) for all conventions. Review every line of AI-generated code before merging. Do not accept AI-generated IPC or preload changes without understanding them (Electron IPC is a common weak spot). You may note briefly in the PR if you used an AI tool.

---

By contributing, you agree to license under the [MIT License](LICENSE).
