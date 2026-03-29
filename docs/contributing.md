# Contributing

Thanks for helping improve Mesh-Client.

This page provides a docs-native contribution overview. The complete
contributor guide lives in the repository at
[CONTRIBUTING.md](https://github.com/Colorado-Mesh/mesh-client/blob/main/CONTRIBUTING.md).

## Local Setup

- Use Node 22 (`22.12.0+` recommended).
- Install dependencies: `pnpm install`
- Start dev mode: `pnpm run dev`

## Quality Checks

Run these before opening a PR:

```bash
pnpm run test:run
pnpm run lint
pnpm run typecheck
pnpm run format:check
```

## Documentation Workflow

- Create/activate a local Python virtualenv first (required on many macOS setups):
  - macOS/Linux: `python3 -m venv .venv && source .venv/bin/activate`
  - Windows PowerShell: `py -3 -m venv .venv; .\.venv\Scripts\Activate.ps1`
- Install docs deps: `pnpm run docs:install`
- Build docs: `pnpm run docs:build`
- Preview docs: `pnpm run docs:serve`

## Pull Requests

- Keep changes scoped and describe both what changed and why.
- Link related issues when relevant.
- Follow coding and security notes in the full
  [CONTRIBUTING.md](https://github.com/Colorado-Mesh/mesh-client/blob/main/CONTRIBUTING.md).
