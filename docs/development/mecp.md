# MECP (Mesh Emergency Communication Protocol)

Developer reference for MECP compose, alerts, audit log, ALERT_APP ingest, or cross-protocol RF rebroadcast. Repo-wide rules live in [`AGENTS.md`](../../AGENTS.md). The operator-facing guide (send, receive, audit log, RF bridge) is [`../emcomm.md`](../emcomm.md); keep it in sync when user-visible behavior changes.

## Wire format

```
MECP/<severity>/<codes> [freetext]
```

- Severity: `0` MAYDAY, `1` URGENT, `2` SAFETY, `3` ROUTINE
- Codes: letter + two digits (`M01`, `M16` medical supply drop, …); drill `D01`/`D02` set `isDrill` (suppresses alerts). Labels come from vendored language packs under `languages/`
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
   - Alerts: sev **0** `'mecpSiren'` (~5s six-cycle siren, length-matched to URGENT) + emergency toast; sev **1** US EAS-style 853+960 Hz `'mecpEas'` (~5s) + toast (**ignore** mutes; **always** including focused chat); sev **2** `'mecpSafety'` (short–long dit–dah × 6, 1175 Hz square, ~4.4s) / **3** `'mecp'` repeated rising triple when unmuted; drills never alert
   - Focused Chat still alerts via `ChatPanel` → `triggerMecpAlert` (deduped with the watcher)
   - Optional RF rebroadcast (§ below)
   - Upserts eligible MECP into the Incident Command store — see [Incident Command](#incident-command). Live: peer reports plus B03/R01/B02 control updates, excluding history, store-and-forward, tapback and invalid severity. Seed (mount snapshot or DB rows): records older than `INCIDENT_SEED_MAX_AGE_MS` (24h) are dropped before any handling, and new reports honor resolved tombstones. Own traffic is skipped except own B01/B03 beacon control (not via S&F/tapback), so Resolve can send B03. Records stored by the bulk message-store writers (`wasMessageBulkLoaded`, tracked per stored record object) always take the silent seed path even when hydration lands after mount; a DB row never demotes a live record already in the store
4. Chat channel/DM chips and the overflow `ChatChannelSwitcher` (rows + trigger) show a static severity-colored `ShieldAlert` (`MecpUnreadIcon`) for the most severe **unread** MECP in that view (`computeUnreadMecpSeverityByView`, same watermark as unread counts). The Incident tab badge counts open MAYDAY/URGENT only, drills included (`incidentTabBadgeCount`, S9); quit confirmation still uses non-drill `openMaydayUrgentCount`

Default tone shapes and timings: [notification-sounds.md — Default MECP tone shapes](../notification-sounds.md#default-mecp-tone-shapes).

## Durable audit log

- File: `mecp-received.log` (+ `.1` size rotate) under Electron `userData` — **not** session `mesh-client.log`
- IPC: `mecp:appendReceived`, `mecp:exportReceivedLog` (Save dialog)
- Included in support bundles
- App → MECP section: **Export MECP log** (Save dialog) alongside RF bridge settings and a link to upstream docs

## Send path

- App → MECP → **Show MECP button in Chat** (default **off**) gates the Chat MECP compose control
- When enabled: red **Siren** icon button in the composer action row (`ChatComposer` `actionSlot`, next to share-location, left of Send; hidden in Starred) → `MecpComposeModal` (defaults: ROUTINE + Drill category, no codes selected) → encode → `sendEmergencyText` ([`emergencySend.ts`](../../src/renderer/lib/emergencySend.ts)) → live `handleSendChunk` / `useSendMessage` (follows open DM/channel)
- **Emergency outbox:** when offline / MQTT-only MeshCore, or when the live send throws, the report is queued in the chat outbox with `priority: 'emergency'` — no 24h drain cutoff, no 5-attempt stop, soft cap of 20 rows (overflow blocks the oldest, never deletes). See [emcomm.md — WS2](emcomm.md#ws2--emergency-priority-outbox)
- Attach GPS uses the app share-location waterfall (`resolveShareLocation`), not raw `navigator.geolocation` alone
- Meshtastic outbound uses normal text (`TEXT_MESSAGE_APP`), not ALERT_APP. This is deliberate — see [Why not ALERT_APP outbound](#why-not-alert_app-outbound)

### Why not ALERT_APP outbound

Evaluated and not planned. Blockers:

- **Firmware rate limit:** `PhoneAPI.cpp` allows one locally-originated `ALERT_APP` packet per **10s** (same rule as POSITION / WAYPOINT / TELEMETRY), versus 2s for text (`MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS`). An over-limit packet is dropped with only a queue-status reply — no `RATE_LIMIT_EXCEEDED` routing error — so `@meshtastic/core` waits for its 60s queue timeout before rejecting.
- **No re-queue on that failure:** the Meshtastic emergency `sendFn` is fire-and-forget (session `sendChatMessage` does not surface the device result), so a silently dropped report would never fall back to the emergency outbox.
- **Bursts:** `tryParseMecp` also matches R01 / B02 / B03 ACK and beacon control traffic, and RF rebroadcast (`sendMecpRebroadcast.ts`) is unpaced, so a MAYDAY followed by an ACK, update, or bridge send within 10s would lose packets.
- **No Store & Forward replay:** the S&F server stores only `TEXT_MESSAGE_APP`.

If ever revisited, it needs at least: a dedicated ≥10s `ALERT_APP` pacer covering compose, outbox drain, ACK/beacon, and rebroadcast; a send result that re-queues to the emergency outbox on timeout; and a classifier limited to severity 0/1 that excludes R/B control codes and drills.

## RF rebroadcast (default off)

- App → MECP section: rules `{ enabled, bidirectional, endpointA, endpointB }` (Meshtastic/MeshCore channel indices 0–7)
- One-way **A→B** by default; **Bidirectional** toggle enables B→A
- Trigger: new inbound MECP with `receivedVia` `rf`/`both` (not mqtt-only); skip own/history/drill
- Loop guard: payload+dest fingerprint TTL
- After each successful bridge send: short follow-up notice `MECP from <sender> via <Meshtastic|MeshCore> (<channel name>)` (not a wire MECP; channel **name**, not index)
- Implementation: `mecpRebroadcast.ts` + `sendMecpRebroadcast.ts`

## Incident Command

Inbound MECP feeds the always-visible **Incident** tab (persistent `incidentStore`, cross-protocol merge, R01 ACK / B02 beacon Confirm, Resolve, map markers). Ops alerts, exports, SAR map tools, and incident track retention are also EMCOMM workstreams. See [emcomm.md](emcomm.md).

Sound choices and volume are configurable per severity in App → Notifications. Original sounds remain defaults; MAYDAY/URGENT retain mute bypass and a 10% volume floor. See [notification-sounds.md](../notification-sounds.md).
