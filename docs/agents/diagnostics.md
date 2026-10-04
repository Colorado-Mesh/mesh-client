# Agent reference: Diagnostics

Deep subsystem reference for AI assistants. Open this when a task touches diagnostic engines, rows, or tab scoping. Hard rules live in [`AGENTS.md`](../../AGENTS.md).

- **Engines:** `src/renderer/lib/diagnostics/`; `RoutingDiagnosticEngine.ts`, `RFDiagnosticEngine.ts` (includes MeshCore **High Companion TX Queue** when `queueLen > 200`), `RemediationEngine.ts`, `ReticulumDiagnosticEngine.ts`.
- **Store:** `src/renderer/stores/diagnosticsStore.ts`; routing/RF rows, foreign LoRa, MQTT ignore, redundancy.
- **Tab scoping:** `filterDiagnosticRowsForProtocol()` — Meshtastic/MeshCore tabs show LoRa rows only; Reticulum tab shows `reticulum/*` only. Foreign-LoRa tables UI is on Meshtastic and MeshCore tabs (keyed by that protocol’s self node id).
- **Location trust (#1110):** distance detectors use `homeNodeForDistanceChecks` (`lib/locationTrust.ts`), which clears home coordinates unless the reference from `publishOurPositionReference` (`lib/ourPositionReference.ts`) is `trusted` (radio GPS this session, or the active saved location confirmed this launch / `fixed`). `approximate` (IP / browser), `needsConfirm`, and `unknown` skip Impossible hop / Hop goblin / suboptimal route. Saved locations: `lib/savedLocations.ts` (`crypto.randomUUID` ids), parser `lib/coordinateInput.ts` (decimal, DMS, MGRS, map links), UI `SetLocationCard.tsx` / `StartupLocationPrompt.tsx` / `SavedLocationsSection.tsx`, state `stores/locationPromptStore.ts`. `useRefreshPositionOnProtocolSwitch` re-resolves the position when the active protocol changes.
- **Extend:** adjust `DiagnosticRow` in `src/renderer/lib/types.ts`, add detector, wire `replaceRoutingRowsFromMap` / `replaceRfRowsForNode`; TTL defaults in `diagnosticRows.ts` (routing 24h, RF 1h).
- **Full reference:** [../diagnostics.md](../diagnostics.md).
