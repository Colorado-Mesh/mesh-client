# Contributing

Thanks for helping improve Mesh-Client.

This page provides a docs-native contribution overview. The complete
contributor guide lives in the repository at
[CONTRIBUTING.md](https://github.com/Colorado-Mesh/mesh-client/blob/main/CONTRIBUTING.md).

## Local Setup

- Use Node 22 (`22.12.0+` recommended).
- Install dependencies: `npm install`
- Start dev mode: `npm run dev`

## Quality Checks

Run these before opening a PR:

```bash
npm run test:run
npm run lint
npm run typecheck
npm run format:check
```

## Documentation Workflow

- Build docs: `npm run docs:build`
- Preview docs: `npm run docs:serve`

## Pull Requests

- Keep changes scoped and describe both what changed and why.
- Link related issues when relevant.
- Follow coding and security notes in the full
  [CONTRIBUTING.md](https://github.com/Colorado-Mesh/mesh-client/blob/main/CONTRIBUTING.md).
