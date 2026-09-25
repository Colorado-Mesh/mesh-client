# Agent reference: EMCOMM (emergency communications)

Deep subsystem reference for AI assistants. Open when a task touches Incident Command, the emergency outbox, MECP send reliability, ACK/beacon, ops alerts, quick status / roll call, EMCOMM exports, SAR map tools, or track retention. MECP wire format, siren alerts, audit log, and RF rebroadcast live in [mecp.md](mecp.md). Hard rules live in [`AGENTS.md`](../../AGENTS.md).

## Safety invariants (S1–S14)

Keep this list in sync with the header comment in [`emcommSafety.contract.test.ts`](../../src/renderer/lib/mecp/emcommSafety.contract.test.ts). Every invariant has a source contract and/or behavioral test today; do not weaken one without updating both the test and this table.

| ID  | Invariant                                                                                                        | Status / coverage                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| S1  | MECP compose send path uses the emergency outbox (not bare `handleSendChunk` only)                               | **Enforced** — contract + `emergencySend.test.ts`                                                                         |
| S2  | Emergency rows ignore the 24h age / 5-attempt stop; the soft row cap blocks (never deletes) active distress rows | **Enforced** — contract + `useChatOutbox.test.ts`                                                                         |
| S3  | Offline / send-fail MAYDAY still enqueues and drains on reconnect                                                | **Enforced** — `emergencySend.test.ts` (enqueue paths) + `useChatOutbox.test.ts` (emergency drain)                        |
| S4  | Watcher hydration seeds without alert/audit                                                                      | **Enforced** — `useMecpAlertWatcher.test.tsx` (hydrate seed + incident upsert without alert/audit)                        |
| S5  | Sev 0/1 bypass mute; drills never alert                                                                          | **Enforced** — `mecpAlert.test.ts`                                                                                        |
| S6  | Cross-protocol rebroadcast does not duplicate incidents                                                          | **Enforced** — contract (fingerprint omits protocol) + `incidentStore.test.ts`                                            |
| S7  | B02/B03 do not open new incidents; B02 is not the general ACK compose                                            | **Enforced** — contract + `incidentStore.test.ts`, `mecpAck.test.ts`, `useMecpAlertWatcher.test.tsx`                      |
| S8  | Incident tab lazy export is mounted in App                                                                       | **Enforced** — contract                                                                                                   |
| S9  | Tab badge counts open sev 0/1 only                                                                               | **Enforced** — contract + `incidentStore.test.ts` (drills excluded) + `Sidebar.test.tsx`                                  |
| S10 | Manual disconnect does not fire link-down / does not cancel emergency outbox retries                             | **Enforced** — `useOperationalAlerts.test.ts`, `operationalAlerts.test.ts`                                                |
| S11 | Link-down suppressed while RF reconnect is in progress                                                           | **Enforced** — `useOperationalAlerts.test.ts`, `operationalAlerts.test.ts`                                                |
| S12 | Incident-open nodes exempt from `position_history` prune                                                         | **Enforced** — `position-history-prune.test.ts` + `useAppStartupDbPrune.test.ts`                                          |
| S13 | USGS/topo tiles only via allowlisted hosts; no user URL template                                                 | **Enforced** — contract + `basemapRegistry.test.ts`                                                                       |
| S14 | `mecpComposeEnabled` and `mecpMaydayButtonEnabled` default remain `false`                                        | **Enforced** — contract + source-policy rules `emcomm-mecp-compose-default-off` / `emcomm-mecp-mayday-button-default-off` |

## WS1 — Incident tab, store, watcher hydrate upsert

- **Types:** [`incidentTypes.ts`](../../src/renderer/lib/mecp/incidentTypes.ts) — `EmergencyIncident` (`status: 'open' | 'acked' | 'resolved'`, `protocolsSeen`, `ackPeerIds`/`ackCount`, `beaconActive`/`beaconAcked`, `lat`/`lon` + `coordsSource: 'message' | 'lastKnown' | null`, `isDrill`).
- **Store:** [`incidentStore.ts`](../../src/renderer/stores/incidentStore.ts) (Zustand `persist`, localStorage key `mesh-client:incidents`, cap `MAX_INCIDENTS = 200` — prunes oldest resolved first).
  - `upsertFromMecp(input)` is the single ingest entry. Id = `incidentFingerprint({ severity, codes, freetext, senderId })` from `mecpMessages.ts` — **no protocol**, so an RF copy and its cross-protocol rebroadcast merge into one row (S6) and append to `protocolsSeen`. Severity only escalates (`Math.min`). Message coordinates always win over `lastKnown` and are never downgraded.
  - B03 clears the sender's active beacon; B02/R01 record an ACK on the matched incident; none of them open rows (S7).
  - `resolveIncident` sets `resolved`; copies within `INCIDENT_REOPEN_GRACE_MS` (5 min) do not reopen (rebroadcast echoes).
  - Selectors: `openIncidentCount`, `openMaydayUrgentCount` (non-drill sev 0/1 → Sidebar badge, S9), `selectOpenIncidentsSorted` (severity, then recency; memoize callers). Use selectors — never bare `useIncidentStore()`.
- **Watcher:** [`useMecpAlertWatcher.ts`](../../src/renderer/hooks/useMecpAlertWatcher.ts) upserts every MECP message into the store for **both** the hydration seed pass and live messages across all protocols; only live messages alert/audit (S4). The sender's last known node position is passed as `lastKnown`.
- **UI:** [`components/incident/`](../../src/renderer/components/incident/) — `IncidentPanel.tsx` (lazy via `lazyTabPanels.ts`, mounted in `App.tsx`, S8), `EmergencyIncidentRow.tsx`, `AckIncidentButton.tsx`, `ResolveIncidentButton.tsx`. Tab slot `Incident` in `tabSlotIds.ts` / `appTabMappings.ts` (`INCIDENT_PANEL_INDEX`) sits **just before App** (always visible on all three protocols; rarely used day-to-day — badge still surfaces open MAYDAY/URGENT); icon in `tabIcons.tsx`. Panel intro + empty hint copy live under `incidentPanel.*` in `en/translation.json`. User-facing “what’s here” also in README **EMCOMM / Incident Command** and troubleshooting **What is the Incident tab?**.
- **Map:** open incidents with coordinates render via `IncidentMarkersLayer` in [`components/map/emcommMapLayers.tsx`](../../src/renderer/components/map/emcommMapLayers.tsx) on **both** the LoRa Map tab and the **Reticulum** Map tab (Layers → Emergency incidents, `mapLayerStore.showIncidents`, default on; drills dashed). Reticulum hears MECP over LXMF chat the same way as LoRa; markers are protocol-agnostic from `incidentStore`.

## WS2 — Emergency-priority outbox

- **Type / storage:** `OutboxEntry.priority: 'normal' | 'emergency'` ([`electron-api.types.ts`](../../src/shared/electron-api.types.ts)); `OutboxEntryInput.priority` is optional and defaults to `'normal'`. SQLite `chat_outbox.priority TEXT NOT NULL DEFAULT 'normal'` (canonical DDL + `DESIRED_COLUMNS` additive upgrade in `db-schema-sync.ts`). `chat:outbox:add` coerces anything other than `'emergency'` to `'normal'`; `rowToOutboxEntry` maps the same way.
- **Drain policy** ([`useChatOutbox.ts`](../../src/renderer/hooks/useChatOutbox.ts)):
  - Emergency rows skip the 24h `OUTBOX_MAX_AGE_MS` drain cutoff (still require `queued`/`failed` + due `nextRetryAt`).
  - Emergency send failures always schedule `nextRetryAt` with the normal backoff (30s → 2m → 10m, then 10m forever) — no `MAX_ATTEMPTS` stop. Encryption-blocked errors still go to `blocked` without retry.
  - **Soft cap:** `EMERGENCY_OUTBOX_SOFT_CAP = 20`. After enqueueing an emergency row, if emergency rows (any status) exceed the cap, the oldest non-blocked emergency row other than the new one is set to `blocked` with `chatPanel.outboxEmergencyCapBlocked`. Rows are never deleted; the user can Retry or Cancel.
- **Send helper:** [`emergencySend.ts`](../../src/renderer/lib/emergencySend.ts) `sendEmergencyText(text, deps)` — offline / MQTT-only MeshCore → enqueue `priority: 'emergency'`; otherwise live send (Meshtastic paced via `withMeshtasticTextSendPacing`), and on throw enqueue as emergency. Returns `'sent' | 'queued'`; rejects only if the enqueue itself fails.
- **Wiring:** `ChatPanel` `MecpComposeModal.onSend` → `sendEmergencyText` with `queueOutbox` from `useChatOutbox` and the same `isSendAvailable` the outbox hook uses. Incident ACKs (WS3) use the same helper from `App.tsx`.
- **UI:** `OutboxBubble` shows a red border, **Emergency** badge, “will keep retrying” note, and an attempt counter for emergency rows; **Cancel** asks `window.confirm(chatPanel.outboxEmergencyCancelConfirm)` first.

## WS3 — ACK (R01) vs beacon (B01 / B02 / B03)

- **Codes** ([`mecpAck.ts`](../../src/renderer/lib/mecp/mecpAck.ts)): `R01` general ACK (`MECP/<sev>/R01 <echoed codes> [freetext] ~CALLSIGN`), `B01` beacon, `B02` beacon ACK (reduce beacon rate), `B03` beacon cancel (sender OK). `composeGeneralAck` never emits B02 (S7); `composeBeaconAck` / `composeBeaconCancel` emit only their marker. All composers stay within `MAX_MESSAGE_BYTES` (freetext truncated first, then trailing echoed codes dropped; callsign suffix preserved).
- **Correlation:** `findOpenIncidentForAck` scores unresolved incidents by exact echoed-code set, overlap, active beacon (for B02), matching severity, then recency. Incidents raised by the ACK sender are never candidates; the store's `recordAck` also ignores the incident sender acking themselves.
- **Incident ACK button** ([`incidentAck.ts`](../../src/renderer/lib/mecp/incidentAck.ts)): `incidentNeedsBeaconAck` (active, unconfirmed beacon) → B02 **Confirm**, else R01 **ACK**. `resolveIncidentAckRoute` prefers the active protocol if the incident was heard there (live send on the incident channel), otherwise targets the protocol of the latest copy (queued for that protocol's outbox drain). DM-only protocols (Reticulum) route the ACK straight back to the sender. `App.tsx` `handleIncidentAck` sends via `sendEmergencyText`, then `confirmBeacon` (B02) or `recordAck(id, 'local')` (R01).
- **ACK honesty:** broadcast ACKs are **heard-by-network, best effort** — an ACK count means R01/B02 copies were overheard, not that the distressed operator read anything. UI copy must not imply read receipts.

## WS4 — Operational alerts

- **Pure predicates** ([`operationalAlerts.ts`](../../src/renderer/lib/operationalAlerts.ts)): `shouldFireSilenceAlert`, `shouldFireSilenceEscalation` (`SILENCE_ESCALATION_MULTIPLIER = 2`; never-heard nodes are not "silent"), `shouldFireBatteryLow` (ignores `0` "unknown" and `>100` charging; requires `hasBatteryTelemetry`), `shouldFireLinkDown` (requires was-connected, not manual disconnect, not reconnecting — S10/S11).
- **Hook** ([`useOperationalAlerts.ts`](../../src/renderer/hooks/useOperationalAlerts.ts)), mounted once in `App.tsx` with `nodesForUi`, active capabilities, Meshtastic + MeshCore link states, and `useOperationalAlertSettings()`:
  - **Watched nodes only** (`watchedNodesStore`). Battery low fires once per cycle; re-arms after recovering `BATTERY_ALERT_RESET_HYSTERESIS` (5 pts) above the threshold.
  - Silence **escalation** at 2× `nodeSilenceAlertMinutes`; the first-level offline alert stays in `useNodeStatusNotifier` (which receives the same setting as `silenceThresholdMinutes`).
  - Link-down: `connecting`/`reconnecting` keep the "was up" latch so reconnect exhaustion still alerts; manual disconnect (`connectionLoss !== true`) never alerts; `LINK_DOWN_GRACE_MS` (5s) debounce absorbs power-suspend blips. Reticulum is not a link entry (sidecar, not RF driver).
- **Settings UI:** App → Notifications → ops alerts subsection in `AppPanel.tsx`.
- **Settings** ([`appSettingsStorage.ts`](../../src/renderer/lib/appSettingsStorage.ts) `getOperationalAlertSettings`, defaults in `defaultAppSettings.ts`): `nodeSilenceAlertMinutes` (`null` = off / capability default), `nodeBatteryLowThreshold` (10), `notifyOnLinkDown` (true). Changes broadcast via the `mesh-client:appSettings` window event. Sounds: `batteryLow`, `connectionLost` (`notificationSounds.ts`).

## WS5 — Quick status, roll call, one-tap MAYDAY

- **Presets** ([`quickStatusMessages.ts`](../../src/renderer/lib/quickStatusMessages.ts)): OK (`L15`), Need help (`C01`), In position (`P05`), Lost comms (plain), Returning (`L14`). Labels are i18n (`quickStatus.*`); wire text stays English for interop. `formatQuickStatusPayload` returns plain text (optionally `lat,lon`) or, with `asMecp`, an encoded MECP line when the preset has codes.
- **Roll call** ([`rollCall.ts`](../../src/renderer/lib/rollCall.ts)): `ROLL_CALL_COMMAND_TEXT = 'Roll call: reply OK'`; `createRollCall`, `noteRollCallReply` / `tallyRollCallReplies` (own node ignored, seconds or ms timestamps, MECP-prefixed `OK` counts), `rollCallMissing`, `isRollCallExpired` (`rollCallWindowMinutes` default). Tally is best-effort heard replies.
- **UI:** [`QuickStatusBar.tsx`](../../src/renderer/components/chat/QuickStatusBar.tsx) above the Chat composer (always shown; disabled with the composer for DM-only chat with no peer / Reticulum peer without LXMF). `ChatPanel` sends presets and the roll-call command through `sendTextWithOutboxFallback(text, deps, 'normal')` in `emergencySend.ts` (live send, or a normal-priority outbox row when offline / on send failure). Roll call keeps `RollCallState` in ChatPanel: expected peers are watched nodes, else currently-online nodes (own node excluded); the tally is derived from the current view's messages via `tallyRollCallReplies` and shown as `rollCallSummary` until the window expires.
- **One-tap MAYDAY:** when App → MECP → **Show MAYDAY button in Chat** is on (default off, S14), Chat shows **MAYDAY**. It opens `MecpComposeModal` with `initialSeverity={0}` and `autoAttachGps` (prefill applied once per open; remount via `key={mecpComposeSession}`), then sends through `sendEmergencyText` (WS2). The MECP compose button is a separate opt-in (`mecpComposeEnabled`).

## WS6 — Exports and after-action report

- **UI:** NodeListPanel **Export JSON** (topology envelope over `nodesToExportRows`) / **Export CSV**; DiagnosticsPanel **Export JSON** (visible rows for the active protocol); MECP audit log via App → MECP.
- **Serializers** ([`exportFormats.ts`](../../src/renderer/lib/exportFormats.ts), pure): `nodesToCsv` (RFC 4180, CSV-injection guarded, canonical `TOPOLOGY_NODE_FIELDS` first then extra keys), `nodesToTopologyJson` (`format: 'mesh-client-topology'`, `version`), `diagnosticsRowsToJson` (`format: 'mesh-client-diagnostics'`), `toJsonSafe` (Maps/Sets/bigint/Dates/cycles).
- **Report assembler** ([`src/main/emcommReport.ts`](../../src/main/emcommReport.ts), pure, English export artifact): `assembleEmcommReportJson` / `assembleEmcommReportMarkdown` merge `mecp-received.log` JSONL lines (malformed lines counted, not fatal), `node_status_events`, and incident snapshots into a sorted timeline + summary. `escapeMarkdownCell` neutralizes mesh-sourced text.
- **Schema:** `node_status_events (node_id, protocol, event_type CHECK IN ('went_stale','offline','online'), ts_ms)` + `idx_node_status_events_ts` in `db-schema-sync.ts`.
- **Not yet wired:** no IPC/UI calls the report assembler, and nothing writes `node_status_events` rows yet — add a `db:*` insert from the node status notifier and a Save-dialog IPC before advertising "EMCOMM report export" in UI.

## WS7 — SAR map tools (MGRS grid, measure, bearing)

- [`lib/map/mgrsGrid.ts`](../../src/renderer/lib/map/mgrsGrid.ts): `pickMgrsPrecisionForBbox` (finest precision under `MGRS_GRID_MAX_SQUARES = 400`), `mgrsSquaresInBbox`, `mgrsSquareSizeMeters`, `estimateMgrsSquareCount`.
- [`lib/map/measureMath.ts`](../../src/renderer/lib/map/measureMath.ts): `polylineSegmentsKm`, `polylineLengthKm` (haversine; invalid segments count 0).
- Bearing: `bearingBetween` / `formatBearing` in [`nodeStatus.ts`](../../src/renderer/lib/nodeStatus.ts) (tested helpers; not yet surfaced in any UI).
- Map wiring: `MgrsGridLayer` (Layers → MGRS grid, `mapLayerStore.showMgrsGrid`, default off; labels only when ≤60 squares) and `MeasureControl` in `components/map/emcommMapLayers.tsx`.

## WS8 — USGS topo, incident track exemption, prune

- **USGS topo basemap:** `usgs-topo` in the offline-maps allowlist ([`basemapRegistry.ts`](../../src/shared/offlineMaps/basemapRegistry.ts)) — fixed `basemap.nationalmap.gov` ArcGIS host (z/y/x order), `USGS_TOPO_MAX_NATIVE_ZOOM = 16` (Leaflet overzooms), served through `mesh-tiles://usgs-topo/…` and the shared tile cache. No user-supplied URL templates (S13). Renderer basemap entry in `mapBasemapUtils.ts`; selectable in the Map Layers control and `leafletMapControls.tsx`. See [offline-maps.md](offline-maps.md).
- **Track exemption:** [`incidentTrackExemption.ts`](../../src/renderer/lib/incidentTrackExemption.ts) `nodesExemptFromPositionPrune` returns sender ids of `open`/`acked` incidents (`resolved` releases the hold). `useAppStartupDbPrune.ts` (`incidentPruneOptions()`) reads the incident store at each startup/session prune and passes them as `exemptNodeIds` to `startupDbPrune.ts`. Sender ids that do not normalize to a uint32 node id (e.g. a MeshCore pubkey prefix longer than 8 hex chars, Reticulum hashes) are dropped by main, so those senders are not yet exempt.
- **Prune IPC:** `db:prunePositionHistory` / `db:prunePositionHistoryPerNode` accept optional `exemptNodeIds`; main validates with `sanitizeExemptNodeIdsArg` and `normalizePositionPruneExemptNodeIds` (numbers, decimal, `!hex`, `0x` hex; capped at `MAX_POSITION_PRUNE_EXEMPT_IDS`) and excludes them via `json_each` in `database.ts` (S12).

## File map

| Area                      | Path                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Incident store / types    | `src/renderer/stores/incidentStore.ts`, `src/renderer/lib/mecp/incidentTypes.ts`                                             |
| Incident UI               | `src/renderer/components/incident/`                                                                                          |
| Watcher (hydrate + live)  | `src/renderer/hooks/useMecpAlertWatcher.ts`                                                                                  |
| ACK / beacon              | `src/renderer/lib/mecp/mecpAck.ts`, `src/renderer/lib/mecp/incidentAck.ts`                                                   |
| Outbox hook / policy      | `src/renderer/hooks/useChatOutbox.ts`                                                                                        |
| Emergency send helper     | `src/renderer/lib/emergencySend.ts`                                                                                          |
| Outbox IPC / schema       | `src/main/index.ts` (`chat:outbox:*`), `src/main/db-schema-sync.ts` (`chat_outbox`)                                          |
| Ops alerts                | `src/renderer/lib/operationalAlerts.ts`, `src/renderer/hooks/useOperationalAlerts.ts`                                        |
| Quick status / roll call  | `src/renderer/lib/quickStatusMessages.ts`, `src/renderer/lib/rollCall.ts`                                                    |
| Quick status bar / MAYDAY | `src/renderer/components/chat/QuickStatusBar.tsx`, `src/renderer/components/ChatPanel.tsx`                                   |
| Exports / report          | `src/renderer/lib/exportFormats.ts`, `src/main/emcommReport.ts`                                                              |
| SAR map                   | `src/renderer/lib/map/mgrsGrid.ts`, `src/renderer/lib/map/measureMath.ts`, `src/renderer/components/map/emcommMapLayers.tsx` |
| Topo / track retention    | `src/shared/offlineMaps/basemapRegistry.ts`, `src/renderer/lib/incidentTrackExemption.ts`, `src/main/database.ts`            |
| Safety contract           | `src/renderer/lib/mecp/emcommSafety.contract.test.ts`                                                                        |
