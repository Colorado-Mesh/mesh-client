# Team Contacts & Team Roster

App-global cross-protocol person cards keyed by Unit ID (1–65535). Linking layer only —
check-in / Unit-ID packet addressing is deferred.

## Product rules

- **Team Contacts** (Network): create/edit callsign, role, color, self flag; unlink protocols.
- **Team Roster** (Network): same store, read-focused list by Unit ID.
- **Suggest to Team Contact** from LoRa node detail and Reticulum peer detail.
- At most **one link per protocol** per Unit ID; a durable node key belongs to at most one member.
- At most **one** `isSelf` member (cleared on upsert in SQLite).
- Distinct from MeshCore radio contacts, Reticulum `is_contact`, favorites, Contact Groups, and RRC room rosters.

## Durable keys

| Protocol   | `durable_key`                       |
| ---------- | ----------------------------------- |
| Meshtastic | Decimal node number string          |
| MeshCore   | 64-hex pubkey (lowercase)           |
| Reticulum  | 32-hex destination hash (lowercase) |

Do not use Reticulum’s synthetic uint32 alone as the durable identity.

## Code map

| Area            | Path                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Types           | `src/shared/teamRosterTypes.ts`                                                                                                                 |
| Schema + IPC    | `src/main/ipc/team-roster-handlers.ts` → sibling `team-roster-handlers.js` (`ensureTeamRosterTables` + `db:*`; kept out of measured `index.js`) |
| Store + hydrate | `src/renderer/stores/teamRosterStore.ts` (from `main.tsx`)                                                                                      |
| Durable helpers | `src/renderer/lib/teamRoster/durableKey.ts`                                                                                                     |
| UI              | `src/renderer/components/teamRoster/`                                                                                                           |
| Tabs            | `TeamContacts` / `TeamRoster` after Nodes in Network (`navSections`)                                                                            |

Clear All Local Data also calls `clearTeamMembers`.
