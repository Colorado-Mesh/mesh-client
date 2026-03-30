# Comprehensive Repo Audit — Remediation Plan

## Context

A full three-pass audit was run across `src/main/`, `src/renderer/`, `src/shared/`, `src/preload/`, test files, CI workflows, and packaging config. The codebase is generally in good shape. This plan captures **only real, actionable findings** — no speculative refactors.

Findings are bucketed by priority. Each bucket can be committed independently.

---

## Bucket 1: Dead Code Removal

**Files**: `src/main/index.ts`, `src/shared/meshtasticMqttReconnect.ts`

### Empty event handlers (`src/main/index.ts`)

Six no-op event registrations that do nothing — likely leftover from refactors or never implemented:

| Line | Handler                                                  |
| ---- | -------------------------------------------------------- |
| 270  | `app.on('browser-window-created', () => {})`             |
| 276  | `process.on('exit', () => {})`                           |
| 1221 | `mainWindow.webContents.on('did-finish-load', () => {})` |
| 1222 | `mainWindow.webContents.on('did-fail-load', () => {})`   |
| 1228 | `mainWindow.webContents.on('destroyed', () => {})`       |
| 3713 | `app.on('quit', () => {})`                               |

Lines 1221/1222 are especially confusing — real, non-empty handlers for the same events already exist at lines 895 (`did-finish-load`) and 1167 (`did-fail-load`). The empty duplicates suggest incomplete code.

**Action**: Delete all six lines.

### Deprecated re-export (`src/shared/meshtasticMqttReconnect.ts`)

`MESHTASTIC_MQTT_MAX_RECONNECT_ATTEMPTS` is marked `@deprecated` and re-exports `MQTT_MAX_RECONNECT_ATTEMPTS`. No file imports it anywhere in the repo.

**Action**: Delete the deprecated alias line.

---

## Bucket 2: Silent Failure Fixes

### `src/renderer/hooks/useTakServer.ts:38-39` — initial fetch swallows rejections

```ts
void window.electronAPI.tak.getStatus().then(setStatus);
void window.electronAPI.tak.getConnectedClients().then(setClients);
```

Neither call has a `.catch()`. If the IPC call rejects (e.g., main process not ready), the failure is silently swallowed. The component's `error` state is only driven by `onStatus` events — initial-fetch failures leave the UI with no explanation.

**Action**: Add `.catch((e) => setError(e instanceof Error ? e.message : String(e)))` to each call.

### `src/renderer/components/MapPanel.tsx:565` — history load failure is invisible

```ts
void loadHistoryFromDb();
```

If the DB read fails, position history silently stays empty with no user-visible feedback and no log.

**Action**: Chain `.catch((e) => console.warn('[MapPanel] loadHistoryFromDb failed:', String(e)))`.

---

## Bucket 3: GitHub Actions — Pin to SHA

**Files**: `.github/workflows/ci.yaml`, `tests.yaml`, `docs.yml`, `release.yaml`, `dependency-submission.yml`

Actions pinned to major version tags (`v4`, `v6`) can receive unexpected commits when upstream maintainers push to that tag — real supply-chain risk for release workflows.

**Unpinned (needs SHA):**

- `actions/checkout@v4` / `@v6`
- `actions/setup-node@v4` / `@v6`
- `actions/upload-artifact@v7`
- `actions/setup-python@v6`

**Already SHA-pinned (leave alone):**

- `pnpm/action-setup@f40ffcd9...` ✓
- `advanced-security/component-detection-dependency-submission-action@v0.1.3` ✓

**Action**: Resolve current SHA for each unpinned action (`gh api /repos/actions/checkout/git/refs/tags/v4`) and pin in format `actions/checkout@<sha> # v4.x.x`.

---

## Bucket 4: ElectronAPI Return Types

**File**: `src/shared/electron-api.types.ts`

Highest-usage IPC methods return `Promise<unknown>`, which forces callers into `as any` casts throughout the renderer. The two highest-value targets:

- `getMessages` — return `Promise<SavedMessage[]>`
- `getNodes` — return `Promise<SavedNode[]>`
- `tak.pushNodeUpdate` — narrow `Record<string, unknown>` to a typed `TAKNodeUpdate` interface

**Note**: Do NOT tighten until the main-side DB layer types in `src/main/database.ts` are verified to match. Tighten the DB return type first, then the IPC type, then remove callers' `as any` casts.

---

## Not Actioned (with rationale)

| Finding                                                   | Why Deferred                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| 100+ `protocol === 'meshcore'` string comparisons         | Correct behavior; capabilities-based refactor is a separate, large effort |
| macOS notarization not configured                         | Needs Apple Developer account + CI secrets; infra work                    |
| Windows code signing not configured                       | Same — certs/infra, not code                                              |
| `skipLibCheck: true`                                      | Removing cascades into third-party `.d.ts` errors; Dependabot mitigates   |
| `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` | Widespread false positives; low ROI without broader type discipline first |

---

## Verification (after each bucket)

1. `pnpm run typecheck`
2. `pnpm run lint`
3. `pnpm run test:run`
4. Bucket 3 only: confirm each pinned SHA resolves to the correct tag before merging
