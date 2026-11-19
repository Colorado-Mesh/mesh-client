# Renderer performance

Incoming chat traffic can re-render the App shell and parked panels. Use this recipe when measuring or validating `perf:` work (reply-preview index, chat pipeline extraction, NodeList DM-peer IPC, panel memoization).

## React DevTools Profiler

1. Open the app with React DevTools → **Profiler**.
2. Start recording, then trigger a ~50-message burst (busy MQTT channel or a test inject).
3. Stop and inspect commits for `AppContent`, `MapPanel`, `NodeListPanel`, and `ChatPanel`.
4. Use “Why did this render?” on each. After the pipeline is owned by chat surfaces (not App), message inserts should **not** commit `AppContent` / parked maps / nodes.

## Opt-in span tracing

```js
localStorage.setItem('mesh-client:perf', '1');
location.reload();
```

After a burst, in the renderer DevTools console:

```js
__meshPerf();
```

Spans of interest:

- `store->chat:meshtastic` / `store->chat:meshcore` / `store->chat:reticulum` — store→`ChatMessage[]` pipeline (repair + remap where applicable)
- `repairMeshtasticReplyPreviews` — Meshtastic reply-parent repair only
- `protocol-switch` — opt-in span around the protocol transition commit body

Disable with `localStorage.removeItem('mesh-client:perf')` and reload.

## Always-on Support timings (`rendererTimings`)

`startLongTaskProbe()` runs from `main.tsx` (no perf flag). Samples export in Support / debug snapshots as `rendererTimings`:

| Name                           | Meaning                            |
| ------------------------------ | ---------------------------------- |
| `longTask`                     | Browser Long Task ≥ 200 ms         |
| `protocolSwitch:urgent`        | Click → sync rail / handler return |
| `protocolSwitch:commit`        | Click → transition body ran        |
| `protocolSwitch:paint`         | Click → double-rAF after paint     |
| `reticulumRefresh:peers`       | Full peer/contact sidecar refresh  |
| `reticulumApplyContacts`       | Contact/history → node-store merge |
| `reticulumPoll:interfaces`     | Local interface health poll tick   |
| `reticulumRefresh:diagnostics` | Diagnostics sync from sidecar      |

Long tasks over 1 s also emit a rate-limited `console.debug` so they appear in normal logs.

## Vitest micro-benchmark (not CI)

```bash
MESH_PERF=1 pnpm exec vitest run --project renderer-logic \
  src/renderer/lib/replyPreview.bench.test.ts --coverage.enabled=false
```

Records average repair cost at 1k / 2k / 5k / 10k synthetic rows. Live in-memory chat is hard-capped at `MAX_IN_MEMORY_CHAT_MESSAGES` (2000); larger sizes are for scaling curves only.

## Related code

- `src/renderer/lib/perfTrace.ts` — opt-in spans
- `src/renderer/lib/rendererTimings.ts` — Support timing ring
- `src/renderer/lib/longTaskProbe.ts` — always-on Long Task → `rendererTimings`
- `src/renderer/lib/protocolSwitchTiming.ts` — protocol-switch urgent/commit/paint breadcrumbs
- `src/renderer/lib/mainThreadLagProbe.ts` — opt-in 100 ms event-loop lag probe
- `src/renderer/lib/replyPreview.ts` — Meshtastic reply parent index / repair
- `src/renderer/hooks/useProtocolChatMessages.ts` — per-protocol store→UI pipeline
- `src/renderer/components/ChatSurface.tsx` — Chat panel owns its message list via the hook
- `src/renderer/hooks/useHasSendingMessage.ts` / `useMessageCount.ts` — scalar store selectors
- `src/renderer/lib/dbHydrationRevision.ts` — NodeList DM-peer IPC refresh token
- `src/renderer/lib/chatInMemoryBuffer.ts` — in-memory cap (2000)
