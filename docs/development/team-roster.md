# Contact Cards & Team Roster

App-global cross-protocol person cards keyed by Unit ID (1–65535). Linking layer only —
check-in / Unit-ID packet addressing is deferred.

## Product rules

- **Contact Cards** (Network, slot `TeamContacts`): create/edit callsign, role, color, self
  flag, and **On Team Roster**; unlink individual nodes.
- **Team Roster** (Network): opt-in subset of Contact Cards (`onRoster`). Creating a card does
  **not** put it on the roster unless created via **Create on roster** / toggled on. The roster
  panel can add existing cards or create a new card already on the roster.
- **Add to Contact Card** from LoRa node detail (including your connected node) and Reticulum
  peer detail.
- A card may hold **multiple links per protocol**; a durable node key still belongs to at most
  one card.
- At most **one** `isSelf` member (cleared on upsert in SQLite).
- Distinct from MeshCore radio contacts, Reticulum `is_contact`, favorites, Contact Groups, and
  RRC room rosters.

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
| UI              | `src/renderer/components/teamRoster/`                                                                                                           |
| Tabs            | `TeamContacts` / `TeamRoster` after Nodes in Network (`navSections`)                                                                            |

Clear All Local Data also calls `clearTeamMembers`.
