# Fallow health cleanup

Goal: drive `pnpm exec fallow health` to **zero findings** while keeping
`fallow audit` (changed files) green for every commit.

## Current baseline

Measured at commit `abb7ab4c7` (type-aware fallow 3.48.0):

| Severity  |     Count |
| --------- | --------: |
| Critical  |       337 |
| High      |       433 |
| Moderate  |       801 |
| **Total** | **1,571** |

By threshold breached:

| Exceeded                            | Count |
| ----------------------------------- | ----: |
| all (cyclomatic + cognitive + CRAP) |   297 |
| cognitive only                      |   248 |
| CRAP only                           |   644 |
| cognitive + CRAP                    |   291 |
| cyclomatic + CRAP                   |    13 |
| cyclomatic only                     |     5 |
| both (cyclomatic + cognitive)       |    73 |

Dead code, circular dependencies, re-export cycles, unused dependencies, and
private type leaks are already at **zero**. `oxlint` (`correctness` +
`suspicious` + `perf`), typecheck, ESLint, Semgrep, i18n, and Vitest are green.

## Measurement

Coverage-backed CRAP is more accurate than the static estimate:

```bash
pnpm exec vitest run --coverage.enabled --coverage.reporter=json \
  --coverage.reporter=text-summary --coverage.reportsDirectory=coverage-json
pnpm exec fallow health --format json --coverage coverage-json/coverage-final.json
```

`coverage-json/` is git-ignored. Without `--coverage`, CRAP is estimated from
function shape and over-reports low-coverage functions.

## Workstreams

### 1. Giant components (critical `all`)

These dominate the critical list and each needs a dedicated split into child
components or extracted hooks:

- `src/renderer/App.tsx` `AppContent` (7,321 LOC, 454 hooks)
- `src/renderer/components/RadioPanel.tsx` `RadioPanel`
- `src/renderer/components/NodeDetailModal.tsx` `NodeDetailModal`
- `src/renderer/components/ConnectionPanel.tsx` `ConnectionPanel`
- `src/renderer/components/ChatPanel.tsx` `ChatPanel`
- `src/renderer/components/NodeInfoBody.tsx` `NodeInfoBody`
- `src/renderer/components/RepeatersPanel.tsx`, `RoomsPanel.tsx`, `ModulePanel.tsx`

Split by responsibility (tabs/sections/data hooks), keeping behavior and
tests unchanged. One component per PR.

### 2. Runtime handlers

- `useReticulumRuntime.handleSidecarEvent`
- `useMeshcoreRuntime`: `runMeshcoreRepeaterRpcOnce`, `buildNodesFromContacts`,
  `initConn`, `sendMessage`
- `useMeshtasticRuntime` reconnect/config paths
- `PacketRouter.dispatch` (extract per-event `apply*` helpers)

### 3. CRAP-only findings

644 findings are CRAP-only. Prefer, in order:

1. Extract branch-heavy logic into small pure helpers (also lowers cyclomatic).
2. Add focused branch tests for hardware-independent paths.
3. Only then consider a per-file `health.thresholdOverrides` with a reason for
   genuinely hardware-gated code.

### 4. Scripts and tooling

`scripts/check-i18n-quality.mjs`, `scripts/i18n-auto-translate.mjs`, and setup
scripts contain large `main`/checker functions. Extract validators and per-rule
checks; these are low-risk and independently testable.

### 5. Duplication follow-up

`fallow` reports 479 clone groups (2.5% duplicated lines). After health is under
control, extract the meaningful clone families (release tooling, MQTT managers,
Chat/Rooms panels) and ignore only test boilerplate.

## Guardrails

- Keep `fallow audit --type-aware --staged` in pre-commit; it blocks new debt.
- Use `fallow health --report-only` for local triage without failing a shell.
- Do not raise `health.maxCrap` / `maxCyclomatic` / `maxCognitive` globally to
  reach zero; use per-file overrides only with a documented reason.
- Each batch: typecheck + ESLint + related Vitest + `fallow audit` + full health
  count before commit.
