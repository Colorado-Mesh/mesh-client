# Agent reference: MECP (Mesh Emergency Communication Protocol)

Deep subsystem reference for AI assistants. Open when a task touches MECP compose, alerts, audit log, ALERT_APP ingest, or cross-protocol RF rebroadcast. Hard rules live in [`AGENTS.md`](../../AGENTS.md).

## Wire format

```
MECP/<severity>/<codes> [freetext]
```

- Severity: `0` MAYDAY, `1` URGENT, `2` SAFETY, `3` ROUTINE
- Codes: letter + two digits (`M01`, …); drill `D01`/`D02` set `isDrill` (suppresses alerts)
- Max **200** UTF-8 bytes (`MAX_MESSAGE_BYTES`)
- Vendored engine: [`src/renderer/lib/mecp/engine/`](../../src/renderer/lib/mecp/engine/) from [xiang-dev-1/MECP](https://github.com/xiang-dev-1/MECP) (GPLv3)
- Language packs: [`src/renderer/lib/mecp/languages/`](../../src/renderer/lib/mecp/languages/) (CC BY 4.0)
- Overview / video: [mecp.radio](https://mecp.radio/)
- App wrappers: `mecpMessages.ts` (`MECP_REGEX`, `tryParseMecp`), `mecpAlert.ts`, `mecpRebroadcast.ts`

## Receive path

1. Messages land in `messageStore` as normal chat text (Meshtastic RF/MQTT, MeshCore, Reticulum).
2. Meshtastic **`ALERT_APP`** (port 11) is decoded like `TEXT_MESSAGE_APP` in `MeshtasticProtocol` / MQTT.
3. `useMecpAlertWatcher` (mounted once from `App.tsx`):
   - Seeds a dedup set at mount (no alert/audit on hydration)
   - New inbound MECP → durable audit append (`mecp:appendReceived`)
   - Alerts: sev **0** `'mecpSiren'` (~5s six-cycle siren) + emergency toast; sev **1** US EAS-style 853+960 Hz `'mecpEas'` (~5s) + toast (**ignore** mutes; **always** including focused chat); sev **2** `'mecpSafety'` (dit–dah × 3) / **3** `'mecp'` repeated burst when unmuted; drills never alert
   - Focused Chat still alerts via `ChatPanel` → `triggerMecpAlert` (deduped with the watcher)
   - Optional RF rebroadcast (§ below)

## Durable audit log

- File: `mecp-received.log` (+ `.1` size rotate) under Electron `userData` — **not** session `mesh-client.log`
- IPC: `mecp:appendReceived`, `mecp:exportReceivedLog` (Save dialog)
- Included in support bundles
- App → MECP section: **Export MECP log** (Save dialog) alongside RF bridge settings and a link to upstream docs

## Send path

- App → MECP → **Show MECP button in Chat** (default **off**) gates the Chat compose control
- When enabled: Chat **MECP** button → `MecpComposeModal` (defaults: ROUTINE + Drill category, no codes selected) → encode → existing `handleSendChunk` / `useSendMessage` (follows open DM/channel)
- Attach GPS uses the app share-location waterfall (`resolveShareLocation`), not raw `navigator.geolocation` alone
- Meshtastic outbound uses normal text (`TEXT_MESSAGE_APP`), not ALERT_APP

## RF rebroadcast (default off)

- App → MECP section: rules `{ enabled, bidirectional, endpointA, endpointB }` (Meshtastic/MeshCore channel indices 0–7)
- One-way **A→B** by default; **Bidirectional** toggle enables B→A
- Trigger: new inbound MECP with `receivedVia` `rf`/`both` (not mqtt-only); skip own/history/drill
- Loop guard: payload+dest fingerprint TTL
- After each successful bridge send: short follow-up notice `MECP from <sender> via <Meshtastic|MeshCore> (<channel name>)` (not a wire MECP; channel **name**, not index)
- Implementation: `mecpRebroadcast.ts` + `sendMecpRebroadcast.ts`

## Out of scope (follow-ups)

- RetAlert (`!RETALERT!…`)
- SQLite `mecpParsed` column / in-memory emergency panel
- MeshCore Rooms bubble styling
- Send via `ALERT_APP` portnum
- Reticulum DM bridge endpoints

Sound choices and volume are configurable per severity in App → Notifications. Original sounds remain defaults; MAYDAY/URGENT retain mute bypass and a 10% volume floor. See [notification-sounds.md](../notification-sounds.md).
