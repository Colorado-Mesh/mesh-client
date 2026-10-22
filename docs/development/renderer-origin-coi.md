# Renderer origin, isolation, and recovery

Packaged Mesh Client loads `mesh-client://renderer/index.html` only after its legacy `file://`
localStorage has been exported, copied, and independently verified. Failure keeps the app on
`file://`. Development normally uses Vite, and explicit E2E file URLs keep their existing behavior.

The document origin uses COOP `same-origin`, COEP **`credentialless`**, and CORP `same-origin`.
These headers also accompany custom-protocol error responses. Keep the Vite base relative (`./`)
so chunks, workers, WASM, fonts, and CSS resolve identically on both origins. `mesh-client:` is a
Chromium content scheme, separate from the operating system's `lxm:` deep-link registration.

`credentialless` lets cross-origin no-cors images, including map tiles and Giphy images, load
without cookies. Do not replace it with `require-corp`: third-party images are not guaranteed to
send the CORS/CORP opt-ins that mode requires. `mesh-ai:` and `mesh-tiles:` responses explicitly
permit cross-origin embedding. The custom renderer scheme does not bypass CSP.

## Copy and commit

`src/main/webStorageOriginMigration.ts` runs only for packaged builds. It uses hidden sandboxed
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
loads, the app checks its migration marker against the saved state and checksummed export.
Missing or foreign markers indicate an absent or unverified origin. One repair fills missing
keys from the recovery snapshot, preserves existing new-origin values, reinstates the marker,
and verifies the complete result in another window. A repaired live document reloads to hydrate
its stores. A failed repair demotes completion to `needsRepair` and uses `file://` for that run.

The marker deliberately replaces comparisons against historical key presence. Users can forget
connections, remove last-used devices, or delete preferences after migrating; valid marker-bearing
storage must not resurrect those deleted values on the next launch. The initial exact read-back
still verifies every copied entry. Once migration has completed, the persisted `hasCompleted`
flag survives repair failure, so retries cannot revert to overwriting newer values with the old
snapshot. Automatic repair is bounded; it does not loop indefinitely on quota or renderer errors.

If only the state file disappears, a surviving matching marker and export are reverified without
overwriting current values. The marker alone cannot authorize a new cutover. Missing or mismatched
recovery evidence fails closed, and malformed or unsupported-version state remains untouched.

Last-read watermarks, incidents, MECP blocked senders, and TAK relay preferences additionally use
SQLite as their durable source. See [Renderer storage](renderer-storage.md) for store ownership,
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

| Environment variable set to `1`     | Behavior                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `MESH_CLIENT_FORCE_FILE_ORIGIN`     | Uses legacy `file://` storage without migration.                                                                                 |
| `MESH_CLIENT_SKIP_ORIGIN_MIGRATION` | Skips migration **and stays on `file://`** in packaged builds.                                                                   |
| `MESH_CLIENT_FORCE_ORIGIN_REPAIR`   | Reapplies missing snapshot keys and verifies, preserving existing target values. Force-file and skip take priority.              |
| `MESH_CLIENT_USE_CUSTOM_PROTOCOL`   | Unpackaged builds only: loads the built custom-origin renderer without the migrator. Explicit Vite/E2E URLs still take priority. |

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
WASM thread selection. Worker origin allowlists must include `mesh-client://renderer`. Keep the
single-thread path for unavailable isolation and force-file recovery.

The renderer memory sampler uses `performance.measureUserAgentSpecificMemory` only when the
browser exposes it and isolation is active. Its bounded sample history feeds the Support memory
card and debug snapshot. These browser-specific measurements are useful for trends; the main
process's Node heap figure measures a different allocation domain. No full heap profiler or
automatic leak diagnosis is implied.

Use `performance.now()` for elapsed renderer durations such as Catch up work. Keep `Date.now()`
for persisted timestamps, message times, last-heard values, and other wall-clock records. No
Document-Isolation-Policy or JavaScript Self-Profiling dependency is needed for this cutover.

Web Serial permissions are origin-scoped: an existing serial user may need to choose the port
once after the flip. LoRa BLE uses native btleplug, so it does not have a Chromium Web Bluetooth
permission migration. About and chat HTTPS links continue through the existing main-process
handler to the system browser; they do not depend on an opener relationship with the renderer.

## Release smoke checklist

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
