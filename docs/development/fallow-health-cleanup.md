# Fallow health cleanup

Goal: drive `pnpm exec fallow health` to **zero complexity findings**
(cyclomatic and cognitive) while keeping `fallow audit` (changed files) green
for every commit.

**CRAP policy (2026-11):** `health.maxCrap` is set to `0` in `.fallowrc.jsonc`,
which is fallow's documented "disable CRAP enforcement" value. CRAP-only
findings were ~690 of ~1,580 total findings, almost all uncovered small
functions that no amount of splitting clears (a new helper needs cyclomatic
`<= 5` to stay under CRAP 30, so splits usually just traded one finding for
another). Cyclomatic and cognitive thresholds still report and gate. Review
coverage debt with the coverage-backed command below instead.

## Current baseline

Measured at commit `abb7ab4c7` (type-aware fallow 3.48.0), before CRAP was
disabled; kept for the historical shape of the debt:

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
function shape and over-reports low-coverage functions. Because the committed
config disables CRAP enforcement, pass `--max-crap 30` alongside `--coverage`
when you want CRAP findings back for a coverage review.

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

- `useReticulumRuntime.handleSidecarEvent` (41 event types; group by prefix and
  split `rrc.message`'s notice/error/system/msg branches in the same pass)
- `useMeshcoreRuntime`: `runMeshcoreRepeaterRpcOnce`, `buildNodesFromContacts`,
  `initConn`, `sendMessage`
- `useMeshtasticRuntime` reconnect/config paths
- `PacketRouter.dispatch` (extract per-event `apply*` helpers)

Already split (kept below thresholds): `PacketRouter.dispatch`, MeshCore
`buildNodesFromContacts`, MeshCore send paths, MeshCore LPP telemetry, MeshCore
text ingest, MECP incident upsert, CoreScope normalization, live-traffic
scheduler update, Reticulum diagnostic row building, MeshCom settings parsers,
and the MQTT manager's decoded/JSON paths.

### 3. CRAP-only findings

644 findings are CRAP-only. Prefer, in order:

1. Extract branch-heavy logic into small pure helpers (also lowers cyclomatic).
2. Add focused branch tests for hardware-independent paths.
3. Only then consider a per-file `health.thresholdOverrides` with a reason for
   genuinely hardware-gated code.

**Measured lesson (2026-11):** extraction alone does not always reduce the
reported count.

- `fallow health` without coverage estimates CRAP from function shape, so every
  newly extracted helper with a few branches shows up as a new CRAP finding even
  when the same code was previously inside one big finding. Splitting a
  140-complexity function into twelve 12-complexity helpers can _raise_ the
  reported total while lowering severity.
- `fallow audit --staged` (the pre-commit gate) compares against `HEAD` and
  fails on **introduced** high/critical findings. Extract only when the new
  helpers land at moderate severity; otherwise the gate blocks the commit until
  the whole area is decomposed in one pass (e.g. `useReticulumRuntime.handleSidecarEvent`
  needs its `rrc.message` branch split at the same time as the namespace grouping).
- Functions already below every threshold contribute no findings, so prefer
  refactors that push a function fully under `cyclomatic <= 20` and
  `cognitive <= 15` rather than moving branches into new medium-sized
  functions.

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
- Do not raise `maxCyclomatic` / `maxCognitive` globally to reach zero; use
  per-file overrides only with a documented reason. `maxCrap` is intentionally
  disabled (see the CRAP policy note above) and is reviewed via the
  coverage-backed command, not by the default gate.
- Each batch: typecheck + ESLint + related Vitest + `fallow audit` + full health
  count before commit.
