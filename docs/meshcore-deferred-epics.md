# MeshCore deferred epics

Items tracked separately from renderer parity work (see meshcore feedback audit). No implementation schedule here—this file is for visibility and planning.

## Room / repeater "Admin" (remote URL, TCP login)

"Manage" in the UI opens node detail only. A dedicated admin URL or remote login flow is not implemented.

## DM to wrong node

Needs reliable reproduction and investigation (prefix map, tab state, pubkey collision). Not addressed in UI-only passes.
