# Contact Cards & Team Roster

App-global cross-protocol person cards keyed by Unit ID (1–65535). Linking layer only —
check-in / Unit-ID packet addressing over RF is deferred (Phase 1C).

## How to use (operator workflow)

1. **Create a Contact Card** for each teammate (Network → Contact Cards), or use **Add to
   Contact Card** from a LoRa node / Reticulum peer detail.
2. **Link every device** that person may use (handset, second radio, repeater, Reticulum peer,
   etc.). The card is the durable person hub across protocols.
3. For an event or activity, open **Team Roster** → **Add from Contact Cards** (or **Create on
   roster**), then **select only the devices in use** for that event. You cannot add a whole card
   without choosing at least one device.
4. On the roster row, **Add device** / **Manage devices** / per-device **Remove** updates the
   event set without unlinking hardware from the Contact Card.
5. **Team message** fans out DMs using each member’s **last-active event device** (roster links
   only).

## Product rules

- **Contact Cards** (Network, slot `TeamContacts`) = **person hub**: callsign, role, self flag,
  all linked devices, **aggregate / per-link presence**, unified in-memory message timeline,
  Jump to Chat, and Message (protocol/link picker defaults to **last-active** among **all** card
  links). Unlink removes a device from the card entirely.
- **Team Roster** (Network) = curated **event device subset**. A person appears on the roster when
  at least one of their links has `onRoster`. Presence columns and team fan-out use **only** those
  rostered links (so a spare repeater on the card does not drive last-active or messaging).
- Creating a card does **not** put devices on the roster. Roster add always forces a device
  multi-select (≥1).
- A card may hold **multiple links per protocol**; a durable node key still belongs to at most
  one card.
- At most **one** `isSelf` member (cleared on upsert in SQLite).
- Distinct from MeshCore radio contacts, Reticulum `is_contact`, favorites, Contact Groups, and
  RRC room rosters.

## Presence & last-active

- Resolve each `TeamMemberLink` against live `nodeStore` maps and Reticulum peer/contact/history
  hashes (`useTeamRosterLiveData` + `contactPresence.ts`).
- Status uses `getNodeStatus` with per-protocol stale/offline thresholds from radio capabilities.
- **Contact Card** presence: all links. **Team Roster** presence / fan-out:
  `resolveMemberPresence(..., { rosterLinksOnly: true })`.
- **Last-active protocol** = newest successful `lastHeardMs` within the relevant link set.

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

## Schema notes

- `team_members.on_roster` is a **derived mirror** (`1` iff any link has `on_roster = 1`).
- `team_member_links.on_roster` is the source of truth for event device selection.
- Migration: when adding the link column, members already with `on_roster = 1` get **all** existing
  links marked `on_roster = 1` (preserves prior whole-card roster behavior). New adds never
  auto-select every link.
- IPC: `db:setTeamMemberLinkRoster` toggles one link; upsert with `onRoster: false` clears every
  link flag for that member.

## Code map

| Area            | Path                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Types           | `src/shared/teamRosterTypes.ts` (`rosterLinksOf`)                                                                                               |
| Schema + IPC    | `src/main/ipc/team-roster-handlers.ts` → sibling `team-roster-handlers.js` (`ensureTeamRosterTables` + `db:*`; kept out of measured `index.js`) |
| Store + hydrate | `src/renderer/stores/teamRosterStore.ts` (from `main.tsx`)                                                                                      |
| Durable helpers | `src/renderer/lib/teamRoster/durableKey.ts`                                                                                                     |
| Presence        | `src/renderer/lib/teamRoster/contactPresence.ts`, `useTeamRosterLiveData.ts`                                                                    |
| History         | `src/renderer/lib/teamRoster/contactMessageHistory.ts`                                                                                          |
| Team fan-out    | `src/renderer/lib/teamRoster/teamMessageFanOut.ts`                                                                                              |
| UI              | `src/renderer/components/teamRoster/` (`TeamContactsPanel`, `TeamRosterPanel`, `TeamRosterDevicePickerDialog`, `TeamContactDetailDialog`)       |
| Tabs            | `TeamContacts` / `TeamRoster` after Nodes in Network (`navSections`)                                                                            |

Clear All Local Data also calls `clearTeamMembers`.

## Out of scope (for now)

- No new RF Unit-ID / check-in wire format.
- No merged persisted cross-protocol thread store.
- Roster does not embed the full Contact Card timeline (open the card instead).
