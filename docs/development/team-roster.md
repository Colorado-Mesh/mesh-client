# Contact Cards & Team Roster

App-global cross-protocol person cards keyed by Unit ID (1–65535). Linking layer only —
check-in / Unit-ID packet addressing over RF is deferred (Phase 1C).

## Product rules

- **Contact Cards** (Network, slot `TeamContacts`) = **person hub**: callsign, role, color,
  self flag, **On Team Roster**, linked protocols, **aggregate / per-link presence**, unified
  in-memory message timeline, Jump to Chat, and Message (protocol/link picker defaults to
  **last-active** link). Unlink individual nodes from the list or manage links in the editor.
- **Team Roster** (Network) = curated **volunteer / event ops** subset (`onRoster`). Columns:
  presence, Unit ID, callsign, role (spot/assignment), last-active protocol, actions. Creating a
  card does **not** put it on the roster unless created via **Create on roster** / toggled on.
  The roster panel can add existing cards or create a new card already on the roster.
- **Team message** (Roster): body + multi-select / `@callsign` chips. Fan-out sends **N
  protocol-native DMs** via each recipient’s last-active linked protocol (fallback: first
  resolved link). Skips members with no usable link / destination. No cross-protocol packet.
- **Add to Contact Card** from LoRa node detail (including your connected node) and Reticulum
  peer detail.
- A card may hold **multiple links per protocol**; a durable node key still belongs to at most
  one card.
- At most **one** `isSelf` member (cleared on upsert in SQLite).
- Distinct from MeshCore radio contacts, Reticulum `is_contact`, favorites, Contact Groups, and
  RRC room rosters.

## Presence & last-active

- Resolve each `TeamMemberLink` against live `nodeStore` maps and Reticulum peer/contact/history
  hashes (`useTeamRosterLiveData` + `contactPresence.ts`).
- Status uses `getNodeStatus` with per-protocol stale/offline thresholds from radio capabilities.
- **Last-active protocol** = link with newest successful `lastHeardMs`.

## Message history

- `contactMessageHistory.ts` merges in-memory `uiMessagesByProtocol` rows that touch any linked
  peer (cap 200). Prefer this over peer-scoped DB queries (LoRa `getMessages` is channel-scoped).
- Timeline taps reuse `openChatFromNotification` / Chat jump. Full thread: Open in Chat.

## Durable keys

| Protocol   | `durable_key`                                                            |
| ---------- | ------------------------------------------------------------------------ |
| Meshtastic | Decimal node number string                                               |
| MeshCore   | 64-hex pubkey (lowercase) when known; otherwise decimal node id (no key) |
| Reticulum  | 32-hex destination hash (lowercase)                                      |

Do not use Reticulum’s synthetic uint32 alone as the durable identity.

## Code map

| Area            | Path                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Types           | `src/shared/teamRosterTypes.ts`                                                                                                                 |
| Schema + IPC    | `src/main/ipc/team-roster-handlers.ts` → sibling `team-roster-handlers.js` (`ensureTeamRosterTables` + `db:*`; kept out of measured `index.js`) |
| Store + hydrate | `src/renderer/stores/teamRosterStore.ts` (from `main.tsx`)                                                                                      |
| Durable helpers | `src/renderer/lib/teamRoster/durableKey.ts`                                                                                                     |
| Presence        | `src/renderer/lib/teamRoster/contactPresence.ts`, `useTeamRosterLiveData.ts`                                                                    |
| History         | `src/renderer/lib/teamRoster/contactMessageHistory.ts`                                                                                          |
| Team fan-out    | `src/renderer/lib/teamRoster/teamMessageFanOut.ts`                                                                                              |
| UI              | `src/renderer/components/teamRoster/` (`TeamContactsPanel`, `TeamRosterPanel`, `TeamContactDetailDialog`)                                       |
| Tabs            | `TeamContacts` / `TeamRoster` after Nodes in Network (`navSections`)                                                                            |

Clear All Local Data also calls `clearTeamMembers`.

## Out of scope (for now)

- No new RF Unit-ID / check-in wire format.
- No merged persisted cross-protocol thread store.
- Roster does not embed the full Contact Card timeline (open the card instead).
