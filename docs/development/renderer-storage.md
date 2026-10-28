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

The `file://` → `mesh-client://renderer` migration seeds SQLite durables before switching the built renderer origin, both for `pnpm start` and installed apps. It also copies the remaining localStorage preferences and verifies the imported values. Explicit Vite/E2E URLs do not trigger this cutover. Keep the old origin storage and migration export available for recovery. See the [startup matrix and verification steps](renderer-origin-coi.md) for each launch mode.

This migration moves chat/Rooms/RRC last-read watermarks, MECP blocks and TAK relay preferences to `app_settings`. Incidents use `emergency_incidents`, `emergency_incident_tombstones`, and the singleton `emergency_incident_storage` import marker. The marker is written in the same transaction as the seed, including for an empty store, so a later retry or old export cannot resurrect cleared incidents.

`incidentStore` retains `mesh-client:incidents` in the legacy version-3 Zustand envelope as a recovery cache. Pre-v3 incident imports mark existing rows seen, preserving the standing-alert upgrade behavior. `seedIncidentsOn` imports only before durable initialization; subsequent hydration reads SQLite even when localStorage is empty or stale. Incident rows keep queryable status/time columns and their complete event history as a JSON payload. IPC snapshots and legacy imports are limited to 16 MiB of UTF-8 JSON; oversized input fails without truncating records, replacing the database or marking an import complete. Existing row and event caps still apply; open real MAYDAY/URGENT rows are never evicted to satisfy the soft row cap.

Renderer preferences now also have a canonical `rendererPreferences` map in `app_settings`.
It covers the complete app-settings object (including fields owned by other panels), remembered
devices, MQTT metadata/profiles/presets, Reticulum client preferences, RRC nickname/hub/room
choices, maps, appearance, chat macros, watched nodes and other browser preferences. Existing
SQLite domain stores and native Reticulum configuration keep their own owners. Private identity
material, passwords, channel PSKs, encrypted backup slots, transient diagnostics and control
journals are excluded. The two backup indexes rebuild from surviving readable secure slots at
startup, independently of a connected device or open panel.

Hydrate the map before mounting protocol runtimes or lazy panels. `Storage` method write-through
keeps existing callers covered; structured values allow failed-write journals to replay individual
app-field changes over newer database values. Existing explicit renderer preferences win over old
scalar mirrors on first import; missing fields can hydrate from their established SQLite codecs.
Native-owned updater/window/AI/translation flags and all four protocols' message-retention
flags/counts keep SQLite authority, including later direct saves. Scalar renderer mirrors are
reconciled before consumers mount: fields deliberately absent from the canonical map remove
their old mirrors so late readers cannot resurrect them. Malformed legacy app records remain
untouched for startup recovery. Panels must write only fields the user changes,
not a full saved snapshot of preferences owned by other panels. Failed preparation shows the
startup recovery screen and Retry repeats validation/cache restoration.

When legacy records contain inline credentials, preparation saves only their public fields in
the recovery map and leaves the original records untouched. Secure initialization consumes those
sources before final cache restoration, preference observers, or application effects start.
An acknowledged compatibility envelope and native receipt can retire redundant inline fields
during a keyring outage; this retains the existing fallback's local-disclosure limits. An
unreadable existing encrypted row is never inferred to be a deleted credential. Its inline
source stays intact, and restoration waits at the recovery screen until the protected storage
is readable. Retry repeats this process without writing credentials into the preference map.
If a credential remains unreadable, the recovery screen also offers its removal after an explicit
acknowledgment. Only credentials that blocked the current startup attempt are eligible. Removal
uses the normal ordered credential retirement path, including retained recovery copies; unrelated
credentials and settings remain intact. Cancel does not remove anything, and failed removal remains
retryable. The user must reconfigure any credential they choose to remove.

Secure-store queries explicitly alias result columns: SQLite identifier matching ignores case,
while returned JavaScript property names can retain an existing table's casing. Real ciphertext
read-back mismatches still reject and roll back the write and retirement receipt. Errors identify
the verification stage, credential category/key, SQLite change count and returned type, without
logging credential values or ciphertext. Empty secret values are rejected: on macOS,
`safeStorage.encryptStringAsync('')` yields empty ciphertext, which must not be persisted.
Empty legacy `meshcoreRoomCredential:*` / repeater app_settings slots are dropped during
migration instead of calling `secureSecrets:set`.

Before the map is established, recovery fills missing fields in a partial app-settings blob from
the verified origin export while preserving present values. Once established, canonical removals
win over historical exports. A previously overwritten value cannot safely be distinguished from
an intentional newer choice without an untouched backup; recovery does not guess from defaults.
Historical acknowledged `durablePending:*` and incident journals are not fresh user intent.
Credential retirement commits atomically with native secret mutations, and native revisions
prevent older pending compatibility journals from restoring forgotten or superseded secrets.

## Verification

For a new durable store, cover legacy import, repeat import, database hydration with empty localStorage, mutations during hydration, ordered writes, failed writes, and clear/delete behavior after migration retry. Use a real temporary or in-memory SQLite database for transaction and schema tests. Test shared storage behavior across all three protocols; storage and migration do not depend on the host operating system.

See [EMCOMM implementation](emcomm.md) for incident safety rules, and [renderer hooks](renderer-hooks.md) for runtime ownership.

Location sharing defaults **off** when `shareMyLocation` is missing or is not a boolean `true`.
An explicit saved boolean is preserved, including legacy app-settings migration. Historical
`true` values cannot be distinguished from deliberate choices, so upgrades do not rewrite them.
Host lookup and app transmission continue to use the existing shared consent guard; local radio
GPS and saved locations remain usable for map/distance calculations without sharing.

RMAP native interface publishing is a separate saved choice. An explicit app opt-out is
reconciled when interfaces load, including partial publishing sets; native interface changes
still require the normal stack restart. With no saved app choice, an existing native publishing
opt-in is preserved and can be disabled directly without first enabling app location sharing.
Fresh profiles cannot enable publishing before app consent.
