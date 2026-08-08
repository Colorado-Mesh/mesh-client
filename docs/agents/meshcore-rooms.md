# Agent reference: MeshCore Rooms (BBS)

Deep subsystem reference for AI assistants. Open this when a task touches MeshCore Rooms login/post, session RPCs, saved passwords, auto-sync scheduling, or room wire text. Hard rules live in [`AGENTS.md`](../../AGENTS.md).

- **UI:** `RoomsPanel.tsx` — login overlay, post composer (`ChatComposer`), admin CLI, auto-sync toggles; sidebar badge via `meshcoreRoomsUnread.ts` (`mesh-client:meshcoreRoomsUnread`).
- **Session / RPC:** `meshcoreRoomSession.ts`, `meshcoreRoomLoginRpc.ts`, `meshcoreRoomPostRpc.ts`, `meshcoreRoomLogoutRpc.ts`, `meshcoreRoomLoginQueue.ts`, `meshcoreRoomLoginPathSync.ts`, `meshcoreRoomSentWait.ts`; credentials in `meshcoreRoomCredentialStorage.ts` / `meshcoreRoomSyncStorage.ts`.
- **Saved passwords:** `meshcoreRoomSavedSecrets.ts` — sidebar/overlay **Forget** / **Stop auto-login**; `forgetMeshcoreRoomSavedSecrets` clears credential + disables auto-login and auto-sync; `disableMeshcoreRoomLoginAfterAuthFailure` disables both without clearing password or in-memory failure UI.
- **Scheduler:** `meshcoreRoomSyncScheduler.ts` + `useMeshcoreRuntime.ts` — periodic re-login (Auto-sync, RF-only); single-flight ticks; background route resolve uses `skipTrace` / `MESHCORE_ROOM_SYNC_ROUTE_RESOLVE_FAST_MS`. Auth failure disables auto-sync and auto-login via `disableMeshcoreRoomLoginAfterAuthFailure`. Connect auto-login skips rooms with `getMeshcoreRoomAutoLoginFailure`. Timeouts in `timeConstants.ts` (shorter for TCP / 0-hop).
- **Wire text:** `meshcoreChannelText.ts` — channel/DM/room payloads, SignedPlain inbound strip, tapback/reply lines; `meshcoreGifWire.ts` — Open `g:GIFID`; `meshcoreOpenReaction.ts` — Open `r:HASH:INDEX`. Default companion keyless outbound; opt-in Open wire via App `meshcoreOpenWireCompatEnabled`.
