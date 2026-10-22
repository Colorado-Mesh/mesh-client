# Renderer storage

Choose storage according to the cost of losing the data. Zustand owns reactive UI state; it does not determine which persistence layer owns the durable record.

| Layer                                                | Use for                                                                                              | Examples                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| In-memory Zustand                                    | Session state and ephemeral UI                                                                       | Relay coverage, connection UI flags                                                        |
| Zustand `persist` → localStorage                     | Small, low-stakes preferences that can be recreated                                                  | Chat macros, watched nodes, bot badges, dismissed setup guides                             |
| SQLite `app_settings`, with a localStorage fast path | Settings and small keyed blobs that must survive browser storage clearing or renderer origin changes | Locale, last-read watermarks, MECP blocked senders, TAK relay preferences, MQTT client ids |
| Dedicated SQLite tables                              | Growing domain records, retention, queries and incident history                                      | Messages, nodes, path history, emergency incidents and resolution tombstones               |

SQLite is main-owned. Renderer code uses typed `electronAPI.db` methods; it never opens a database or constructs SQL. Put shared contracts and pure storage parsers in `src/shared/`, rather than importing renderer modules into main.

## Startup and writes

Hydrate durable stores before React mounts effects that depend on them. Alert watchers, message-history seeding and track retention must see stored incidents and resolution tombstones before their first run. A localStorage snapshot can provide the initial display cache, but it cannot replace an existing SQLite record just because it loads first.

Write-through operations must preserve ordering. If UI actions occur during asynchronous hydration, replay them against the database snapshot before persisting. Applying a stale full-row overlay can discard database-only history or resurrect an incident that its stored tombstone already resolved. Keep the existing synchronous Zustand selectors and mutator API where callers need them.

On a database read failure, keep the current state and log the failure; do not persist an empty fallback. On a write failure, keep the recovery cache and pending journal, then retry on a subsequent mutation, explicit flush or next launch. The incident journal holds the last database baseline and latest local snapshot (two snapshots, not an ever-growing operation log). Restart recovery applies only changed incident fields and deletions over the latest database state, preserves database-only records and events, and keeps resolution tombstones. Clear the journal only after SQLite acknowledges the write. Main IPC handlers must reject failed mutations rather than returning success.

## Origin migration

The `file://` → `mesh-client://renderer` migration seeds SQLite durables before switching the packaged renderer origin. It also copies the remaining localStorage preferences and verifies the imported values. Keep the old origin storage and migration export available for recovery.

This migration moves chat/Rooms/RRC last-read watermarks, MECP blocks and TAK relay preferences to `app_settings`. Incidents use `emergency_incidents`, `emergency_incident_tombstones`, and the singleton `emergency_incident_storage` import marker. The marker is written in the same transaction as the seed, including for an empty store, so a later retry or old export cannot resurrect cleared incidents.

`incidentStore` retains `mesh-client:incidents` in the legacy version-3 Zustand envelope as a recovery cache. Pre-v3 incident imports mark existing rows seen, preserving the standing-alert upgrade behavior. `seedIncidentsOn` imports only before durable initialization; subsequent hydration reads SQLite even when localStorage is empty or stale. Incident rows keep queryable status/time columns and their complete event history as a JSON payload. IPC snapshots and legacy imports are limited to 16 MiB of UTF-8 JSON; oversized input fails without truncating records, replacing the database or marking an import complete. Existing row and event caps still apply; open real MAYDAY/URGENT rows are never evicted to satisfy the soft row cap.

Chat macros, watched nodes, bot badges and dismissed setup guides remain in localStorage and are copied by the origin migrator. Clearing browser storage can still clear those low-stakes preferences.

## Verification

For a new durable store, cover legacy import, repeat import, database hydration with empty localStorage, mutations during hydration, ordered writes, failed writes, and clear/delete behavior after migration retry. Use a real temporary or in-memory SQLite database for transaction and schema tests. Test shared storage behavior across all three protocols; storage and migration do not depend on the host operating system.

See [EMCOMM implementation](emcomm.md) for incident safety rules, and [renderer hooks](renderer-hooks.md) for runtime ownership.
