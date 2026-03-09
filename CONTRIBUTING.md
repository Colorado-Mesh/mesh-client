# Contributing to Meshtastic Client

Thank you for your interest in contributing. This document covers setup, testing requirements, and the PR process.

## Getting Started

See [README.md](README.md) for full setup instructions including prerequisites and platform-specific steps.

```bash
npm install
npm run dev       # Start in development mode
npm run build     # Production build
npm run lint      # Run ESLint + Prettier checks
```

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

The vitest suite covers main-process utilities including GPS helpers (`src/main/gps.ts`).

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
- **Cross-platform UI**: Test or at minimum visually verify your changes on your platform; flag in the PR if you could not test on other OSes.
- **Build check**: Confirm `npm run build` completes without errors.

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
3. **Follow existing code style** — Run `npm run lint` and fix any issues before pushing.
4. **Keep scope tight** — Avoid refactoring unrelated code in the same PR. One concern per PR makes review faster.
5. **Await review** — A maintainer will review and may request changes before merging.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
