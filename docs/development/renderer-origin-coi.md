# Renderer origin, isolation, and recovery

Both `pnpm start` and installed Mesh Client load `mesh-client://renderer/index.html` only after
legacy `file://` localStorage has been exported, copied, and independently verified. Failure
keeps the app on `file://`. `pnpm run dev` explicitly selects Vite for live development.

| Launch                                                           | Renderer                                                         | Storage migration and isolation                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm start`                                                     | Rebuilds and loads `mesh-client://renderer/index.html`           | Verifies migration before cutover; COI enabled              |
| Installed app                                                    | `mesh-client://renderer/index.html`                              | Same migration and verification; COI enabled                |
| `pnpm run dev`                                                   | Explicit `VITE_DEV_SERVER_URL`, normally `http://localhost:5173` | Vite sends COI headers; built-origin migration does not run |
| Explicit E2E file URL in `VITE_DEV_SERVER_URL`                   | Requested `file://` document                                     | Keeps file-origin test behavior; no COI                     |
| Built renderer with force-file or skip flag, or failed migration | Legacy `file://` document                                        | Retains recovery storage; no COI                            |

A server listening on port 5173 cannot change the default built renderer: there is no automatic
Vite probe. Only an explicit `VITE_DEV_SERVER_URL` selects a development or E2E URL. Custom-origin
startup always requires verified migration; there is no flag that bypasses the migrator. The obsolete
`MESH_CLIENT_USE_CUSTOM_PROTOCOL` opt-in has been removed; built renderer startup now migrates by default. An explicit
`mesh-client:` override also uses the canonical built renderer and its migration/health checks.

The document origin uses COOP `same-origin`, COEP **`credentialless`**, and CORP `same-origin`.
These headers also accompany custom-protocol error responses. Keep the Vite base relative (`./`)
so chunks, workers, WASM, fonts, and CSS resolve identically on both origins. `mesh-client:` is a
Chromium content scheme, separate from the operating system's `lxm:` deep-link registration.

`credentialless` lets cross-origin no-cors images, including map tiles and Giphy images, load
without cookies. Do not replace it with `require-corp`: third-party images are not guaranteed to
send the CORS/CORP opt-ins that mode requires. `mesh-ai:` and `mesh-tiles:` responses explicitly
permit cross-origin embedding. The custom renderer scheme does not bypass CSP.

## Copy and commit

`src/main/webStorageOriginMigration.ts` runs for built-renderer startup, including `pnpm start`
and installed builds. It uses hidden sandboxed
windows with context isolation, no Node integration, no preload, and the main window's default
session. `migration.html` is inert: it starts no React application or storage-writing hooks.
Each window operation has a 15-second deadline and destroys its window on success or failure.
Main creates its window before migration so closing a hidden window cannot shut down the app.

1. Export every legacy localStorage string to a snapshot under `userData/migration/`. The snapshot
   records its format, app version, capture time, key count, and SHA-256 of sorted key/value pairs.
2. Write through a restricted temporary file, flush it, and rename atomically. A new snapshot
   missing any previously exported key cannot replace the saved snapshot. An unreadable or
   checksummed-corrupt artifact fails closed and remains available for diagnosis.
3. Seed SQLite-backed durable state before importing into the new origin. This is additive;
   SQLite is already shared by both origins and is never cloned or replaced for this migration.
4. Import legacy entries, preserving target-only keys from earlier interrupted attempts. Add a
   migration marker tied to the version and export checksum. Before the first successful cutover,
   the legacy values win overlapping keys.
5. Flush storage, open a **separate** hidden window, and read the new origin back. Its entire key
   set and every value, including the marker, must match the expected merged copy. Only then write
   `verified`, followed by `completed` and the completed version.

The state phases are `pending → exported → imported → verified → completed`; failures can retry
on later launches. A saved export can resume an interrupted import even if the legacy migration
page cannot reopen. A failed export replacement, SQLite seed, quota write, verification, or state
commit never authorizes the new load URL. Empty profiles follow the same verification sequence.

The legacy localStorage and export are retained after success. Export files use mode `0600`
where supported and contain private settings; keep their contents out of ordinary log output.

## Health and repair

Before a completed installation uses the new origin, and again after its actual main document
loads, the app checks its migration marker against the saved state and checksummed export, and
checks every exported critical key for presence. A surviving marker alone is not healthy.
Missing or foreign markers indicate an absent or unverified origin. One repair fills missing
keys from the recovery snapshot, preserves existing new-origin values, reinstates the marker,
and verifies the complete result in another window. A repaired live document reloads to hydrate
its stores. A failed repair demotes completion to `needsRepair` and uses `file://` for that run.

Intentional Forget actions record per-key deletion intent in SQLite `app_settings` and a synchronous
localStorage journal before removing the key. Every journal has an ID and originating renderer origin.
The canonical flag and acknowledgment receipts commit together under SQLite `FULL` durability;
ordinary writes restore the prior synchronous mode afterward. Recreating a value clears the flag.

Before the first origin copy, main also durably pins the copied source intent. That receipt survives
later edits, so an untouched file-origin journal or an imported copy left by a crash cannot replay an
old Forget action. Renderer writes cannot remove these pinned receipts; explicit data reset clears them.
Health checks honor only pending, unacknowledged current intents. Historical journals inside a recovery
export or prior partial import never override newer SQLite state. Before first cutover, a readable live
legacy origin stays authoritative. Failed IPC writes retain the local intent for another edit or startup.
The initial exact read-back still verifies every copied entry. Once migration has completed, the persisted `hasCompleted`
flag survives repair failure, so retries cannot revert to overwriting newer values with the old
snapshot. Automatic repair is bounded; it does not loop indefinitely on quota or renderer errors.

If only the state file disappears, a surviving matching marker and export are reverified without
overwriting current values. The marker alone cannot authorize a new cutover. Missing or mismatched
recovery evidence fails closed, and malformed or unsupported-version state remains untouched.

A nonempty custom origin without a marker or state is repaired automatically. If no recovery export
exists, the app first exports and flushes the legacy file-origin storage. It then records repair
state before writing the target, retains existing custom-origin values on conflicts, fills missing
keys from the export, and independently verifies the result. Interrupted repairs keep this same
precedence on retry. A failed export or repair retains `file://` and the existing data. Historical
legacy deletion journals do not override current custom-origin values during this repair.
`MESH_CLIENT_FORCE_ORIGIN_REPAIR=1` remains available to request repair explicitly.

Last-read watermarks, incidents, MECP blocked senders, TAK relay preferences and the complete
nonsecret renderer-preference map additionally use SQLite as their durable source. Partial legacy
app-settings blobs recover missing fields from the verified export before the preference map is
established; existing values and later canonical removals keep precedence. Backup lookup indexes
rebuild from surviving readable secure keys for both radio protocols. See [Renderer storage](renderer-storage.md) for store ownership,
hydration, and write-through behavior.

## Explicit data reset

**Clear All Local Data & Cache** intentionally replaces the retained recovery baseline. Before
clearing anything, main atomically records a pending `migration/renderer-storage-reset.json`.
It fences renderer IPC and unloads the old document so in-memory persistence retries cannot
recreate cleared values. It clears Chromium storage for both origins, resets the newly durable
watermarks/preferences/incidents (including tombstones), and writes an empty export and migration
state before recording reset completion. Existing unrelated SQLite preferences are retained.
The app then loads a fresh renderer and verifies migration normally.

An interrupted reset retries before any UI loads, including when force-file or skip is enabled.
A failed reset stays pending and cannot invoke snapshot repair or open an old profile. Unsupported
reset journals also fail closed. Completed resets are not repeated on future launches, and the
new empty baseline prevents later storage-loss repair from resurrecting intentionally deleted data.

## Support recovery

Fully quit Mesh Client before relaunching it with a recovery flag. Environment variables apply to
the process that launches Electron; set them in that shell or platform launcher.

| Environment variable set to `1`     | Behavior                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `MESH_CLIENT_FORCE_FILE_ORIGIN`     | Uses legacy `file://` storage without migration.                                                                    |
| `MESH_CLIENT_SKIP_ORIGIN_MIGRATION` | Skips migration **and stays on `file://`** for built-renderer startup, including `pnpm start`.                      |
| `MESH_CLIENT_FORCE_ORIGIN_REPAIR`   | Reapplies missing snapshot keys and verifies, preserving existing target values. Force-file and skip take priority. |

Recovery artifacts are relative to Electron's actual `app.getPath('userData')`:

- `migration/renderer-origin-migration.json`
- `migration/legacy-file-origin-web-storage-v1.json`
- `migration/renderer-storage-reset.json` (present after an explicit local data reset)

The usual macOS location is `~/Library/Application Support/mesh-client/migration/`; custom userData
paths and development launches can differ. Do not delete the migration directory during support.
If a completed migration is missing its export or its export/state cannot be validated, the app
uses the legacy origin rather than silently replacing recovery evidence.

Force-file recovery exposes the retained pre-cutover localStorage snapshot, so preferences
changed later only at the new origin may appear older. SQLite-backed records are shared. This is
a recovery fallback; no automatic reverse copy or destructive cleanup occurs.

## Capabilities and device permissions

With `crossOriginIsolated === true`, SharedArrayBuffer enables the existing bundled Catch up
WASM thread selection. Worker origin allowlists must include `mesh-client://renderer`. Dedicated-worker messages have
an empty `MessageEvent.origin` in Chromium; that path is accepted only when the worker itself
has an allowlisted origin. The legacy encoder currently has no production importer; artifact
tests compile its exact source for a synthetic message and decode the result. Keep the
single-thread path for unavailable isolation and force-file recovery.

Renderer memory sampling has two paths. **Sample now** (and export / visibility-settle
samples) may use `performance.measureUserAgentSpecificMemory` when the browser exposes it
and isolation is active; otherwise it uses the renderer process working-set from
[`app.getAppMetrics()`](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics).
Each renderer-taken sample also records optional `performance.memory` JS heap totals and a
DOM node count when available. Electron may expose the browser API but reject it with
`SecurityError`; then — and on force-file recovery without isolation — only the process
metric is used for the primary total. Separately, the **main process** records process
working-set samples about every two hours (`RENDERER_MEMORY_AUTO_SAMPLE_INTERVAL_MS`)
whether or not the window is backgrounded, writes them to SQLite `renderer_memory_samples`
(retention capped; nullable `js_heap_bytes` / `total_js_heap_bytes` / `dom_nodes`), and
pushes each sample to the renderer Support ring (enriched with live heap/DOM on ingest).
Becoming visible triggers an immediate sample plus a settle sample after
`RENDERER_MEMORY_VISIBILITY_SETTLE_MS`. Support bundles include the live ring as
`rendererMemory` and the durable summary plus timestamped rows as `rendererMemoryDurable`.
The Support sparkline is time-scaled and breaks across `RENDERER_MEMORY_CHART_GAP_MS`. The
UI and sample `source` explicitly identify physical process RAM, and histories reset if
measurement scope changes. These measurements are useful for trends; the main process's
Node heap figure measures a different allocation domain. No full heap profiler or automatic
leak diagnosis is implied.

Use `performance.now()` for elapsed renderer durations such as Catch up work and the Support
`rendererTimings` ring. Keep `Date.now()` for persisted timestamps, message times, last-heard
values, and other wall-clock records. When isolated, a SAB-backed analysis worker pool can offload
topology layout and diagnostics analyze batches; without isolation the same jobs run inline. Catch
up WASM thread count and isolation state are shown on App → Support. No
Document-Isolation-Policy or JavaScript Self-Profiling dependency is needed for this cutover.

Web Serial permissions are origin-scoped: an existing serial user may need to choose the port
once after the flip. LoRa BLE uses native btleplug, so it does not have a Chromium Web Bluetooth
permission migration. About and chat HTTPS links continue through the existing main-process
handler to the system browser; they do not depend on an opener relationship with the renderer.

## Release smoke checklist

- Verify `pnpm start` directly using the steps below, and verify the installed app separately.
- Upgrade a profile with unread watermarks, an incident, a blocked sender, TAK preferences, theme,
  macros, connection settings, MQTT settings, and launcher pins. Verify the data after migration.
- Check the packaged document origin, `crossOriginIsolated`, worker messages, Catch up thread
  availability, and relative WASM/font/worker loading.
- Relaunch after editing settings and forgetting a connection; changes and deletions must persist.
- Simulate quota/import/read-back failures in an isolated test profile; completion must not be
  recorded and the main app must use `file://`.
- Clear only the custom-origin localStorage in a test profile; verify bounded repair or fallback.
- Use Clear All Local Data, relaunch, and use force-file recovery; old data must remain cleared.
- Verify fresh-profile startup, both file-origin recovery flags, and forced repair.
- Check serial re-selection, native BLE, maps, Giphy images, and About/chat links.
- Check the Support memory card and snapshot both when isolated and under force-file recovery.

Unit tests exercise these migration failure points with temporary profiles and actual execution
of the serialized storage scripts. Packaged Electron smoke remains a separate validation step.

### Verify the normal local start

Fully quit other Mesh Client instances. Use an isolated test profile for migration/reset exercises.
Remove `VITE_DEV_SERVER_URL` and origin recovery flags from the launch environment, then run the
actual start script with a free local debugging port. This Bash example creates a fresh profile:

```bash
mesh_start_profile=$(mktemp -d "${TMPDIR:-/tmp}/mesh-start.XXXXXX")
pnpm start --remote-debugging-port=9222 --user-data-dir="$mesh_start_profile"
```

The script rebuilds before launching Electron. Inspect the renderer through a Chromium browser's
`chrome://inspect` page, configured for `localhost:9222`, and evaluate this in its Console:

```javascript
({
  url: location.href,
  origin: location.origin,
  isolated: crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer,
});
```

Expect `mesh-client://renderer/index.html`, `mesh-client://renderer`, `true`, and `"function"`.
Confirm the startup log reports `app.isPackaged: false`, the intended test `userData` directory,
and the final `renderer loaded` URL. The final `renderer load source` line includes `phase` and
the actual `crossOriginIsolated` result: `failed` identifies migration failure, `skipped` an
override, and `health-failed` a failed post-load check. Do not redefine `app.isPackaged` or set a custom renderer URL
for this check: either would miss the normal `pnpm start` path.

In that profile, verify `migration/renderer-origin-migration.json` records `phase: "completed"`,
`hasCompleted: true`, and the current migration version. Confirm the recovery export exists without
printing its private values. For an upgrade test, seed known preferences at the legacy file origin
before normal startup, verify their imported values, edit/delete a preference, and relaunch to check
persistence. Test force-file and skip separately; both must load `file://` without losing the export.

Run `pnpm run dev` separately and check its explicit localhost origin, `crossOriginIsolated`, and
SharedArrayBuffer. Vite isolation, a packaged-mode test fixture, and a signed or unsigned installed
app are distinct checks; none substitutes for the direct `pnpm start` verification above. Quit the
test instance after inspection so its debugging port closes.

### Test an actual packaged artifact

The regular renderer-origin tests exercise production startup through a test bootstrap; their
`app.isPackaged` override does not qualify a shipped bundle. The separate artifact smoke launches
the executable directly, asserts a real packaged ASAR, and covers legacy upgrade, COI, synthetic
Meshtastic encoding, partial critical-key loss, retained newer settings, unchanged recovery export,
and force-file recovery. On Apple silicon after packaging:

```bash
MESH_PACKAGED_EXECUTABLE="$PWD/release/mac-arm64/Mesh-client.app/Contents/MacOS/Mesh-client" \
  pnpm exec playwright test e2e/packaged-artifact.spec.ts
```

Use the corresponding executable on Windows/Linux. The test creates and removes only its own
profile. Hands-on checks of external-browser opening, rendered third-party images, actual model
inference, native BLE, and physical serial remain separate from this automated smoke. Record the
artifact hash and the result of each check; list any unavailable platform or device explicitly.
