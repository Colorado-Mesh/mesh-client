# Scheduled Broadcasts

Recurring one-packet mesh broadcasts (channels, MeshCore rooms, RRC rooms) driven by a
renderer-mounted scheduler. The app must be running with the target radio connected.

## Product rules

- **Skip-missed:** occurrences that elapsed while closed/asleep are recorded as `missed`, not sent late.
- **At-most-once:** SQLite `claimDue` advances `next_due_at` before transmit.
- **No chunking:** save and send reject text that exceeds any enabled target’s single-packet limit.
- **No DMs.** Device factory reset does not wipe rows; App → Danger Zone → Clear All Local Data does
  (and turns the master switch off).
- **Import merge** does not copy `scheduled_broadcasts` (allow-list is only `nodes`/`messages`).
  Export snapshots include the table.

## Code map

| Area            | Path                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| Schema          | `src/main/db-schema-sync.ts` (`scheduled_broadcasts`; no `CURRENT_SCHEMA_VERSION` bump) |
| IPC             | `src/main/ipc/scheduled-broadcast-handlers.ts`                                          |
| Types           | `src/shared/scheduledBroadcastTypes.ts`                                                 |
| Store + hydrate | `src/renderer/stores/scheduledBroadcastsStore.ts` (awaited from `main.tsx`)             |
| Recurrence      | `src/renderer/lib/scheduledBroadcasts/recurrence.ts`                                    |
| Scheduler       | `src/renderer/lib/scheduledBroadcasts/scheduler.ts` + `useScheduledBroadcastScheduler`  |
| Deliver         | `src/renderer/lib/scheduledBroadcasts/deliver.ts` + `resolveChannelTarget.ts`           |
| Boot            | `src/renderer/lib/scheduledBroadcasts/bootScheduler.ts` (from `main.tsx`, not App)      |
| UI              | `src/renderer/components/scheduledBroadcasts/`                                          |
| Tab             | `ScheduledBroadcasts` last under Chat section                                           |

Channel targets store `channelKey` (identity digest) plus a cached `channelIndex`. Deliver
resolves the live slot via `liveChannelKeyStore`; missing keys after a radio remap yield
`channel-missing` for that target only.

MeshCore room targets in the picker are limited to rooms that can post (logged in) or have a
saved guest password — including intentional blank guest (`isScheduledBroadcastMeshcoreRoomEligible`).
Admin-only credentials are not listed. Deliver uses `meshcoreRoomTryEnsureCanPost` (session guest
login, then saved guest credential; skips a same-password credential retry after explicit auth
rejection) before `sendRoomPost`. The open picker re-filters when session or credential storage
changes (including Forget).

## Protocol parity

Reticulum has no LXMF “channel”; RRC rooms are the broadcast surface. Gate pickers with
`ProtocolCapabilities` / identity `protocol.type`, never `protocol === 'meshcore'`.

## Timer accuracy

Chromium may throttle background timers. The scheduler uses a 60 s safety interval and re-arms on
power resume / settings / slot edits. Sub-minute accuracy is not guaranteed.
