# Contributing

Thanks for helping improve Mesh-Client.

This page provides a docs-native contribution overview. The complete
contributor guide lives in the repository at
[CONTRIBUTING.md](https://github.com/Colorado-Mesh/mesh-client/blob/main/CONTRIBUTING.md).

## Local Setup

- Use Node 22 (`22.13.0+` recommended; see `package.json` `engines.node`).
- Install dependencies: `pnpm install`
- Start dev mode: `pnpm run dev`

## Quality Checks

For the comprehensive local gate, run **`pnpm run check:pr`** before opening a PR (lint + typecheck + `typecheck:strict-shared` + full `test:run`, plus path-aware sidecar checks when relevant):

```bash
pnpm run check:pr
```

Or run pieces individually:

```bash
pnpm run test:run
pnpm run lint
pnpm run typecheck
pnpm run format:check
```

To approximate **Linux CI** from any host, use container mode (`pnpm run act:ci`) or host mode without a container engine (`pnpm run act:ci:native`). See [CI/CD — Running locally with act](ci-cd.md#running-ci-locally-with-act).

## Documentation Workflow

- Create/activate a local Python virtualenv first (required on many macOS setups):
  - macOS/Linux: `python3 -m venv .venv && source .venv/bin/activate`
  - Windows PowerShell: `py -3 -m venv .venv; .\.venv\Scripts\Activate.ps1`
- Install docs deps: `pnpm run docs:install`
- Build docs: `pnpm run docs:build`
- Preview docs: `pnpm run docs:serve`

Reticulum-specific docs: [reticulum.md](reticulum.md), [reticulum-sidecar-ipc.md](reticulum-sidecar-ipc.md). Meshtastic/MeshCore parity: [meshcore-meshtastic-parity.md](meshcore-meshtastic-parity.md).

## Pull Requests

- Keep changes scoped and describe both what changed and why.
- Link related issues when relevant.
- Follow coding and security notes in the full
  [CONTRIBUTING.md](https://github.com/Colorado-Mesh/mesh-client/blob/main/CONTRIBUTING.md).
  For locale auto-fill (`pnpm run i18n:auto-translate`, including pre-commit), runs are incremental vs `HEAD` English unless you pass **`--all`** / **`I18N_TRANSLATE_ALL=1`**; MyMemory defaults to contact **info@coloradomesh.org** unless **`MYMEMORY_EMAIL`** is set — see [docs/agents/i18n.md](https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/agents/i18n.md).
