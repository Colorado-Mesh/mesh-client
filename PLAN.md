# PLAN.md: Top Chat Feature Plans

## Summary

Implement three desktop-first chat upgrades that work for both Meshtastic and MeshCore on macOS,
Linux, and Windows:

1. Protocol-aware long message composer with chunked sending.
2. Durable SQLite-backed outbox with retry/cancel.
3. Protocol-neutral conversation inbox for channels and DMs.

All features must stay protocol-neutral at the UI layer, use existing `protocol` /
`ProtocolCapabilities` patterns, and avoid OS-specific APIs except existing Electron bridge
surfaces.

## 1. Protocol-Aware Long Message Composer

Add a shared renderer helper, `src/renderer/lib/chatComposerLimits.ts`, with:

- `getChatPayloadLimit(protocol)`:
  - Meshtastic: `228`, preserving the current composer limit.
  - MeshCore: `133`, matching MeshCore companion protocol guidance.
- `countMessageChars(text)`: count Unicode code points with `Array.from(text).length`.
- `splitChatMessage(text, protocol)`: split text into chunks that fit the protocol limit.
- Chunk prefix format: `[1/3] message`, `[2/3] message`, etc.
- Maximum chunks: `9`; if the text cannot fit in 9 chunks, block send and show a clear composer
  error.
- Splitting behavior: prefer word boundaries; hard-split only tokens longer than the available
  chunk body size.
- Replies: only the first chunk carries `replyId`; all chunks keep the same channel / DM
  destination.

Update `ChatPanel` composer behavior:

- Replace hardcoded `maxLength={228}` with protocol-aware display and validation.
- Allow text longer than the single-message limit only when it can be chunked.
- Show character count always when over 80% of the single-message limit.
- When over limit, show `Will send as N parts` and change button text to `Send N Parts`.
- Send chunks sequentially using existing `onSend(text, channel, destination, replyId)`.
- If any chunk fails, stop sending remaining chunks and hand unsent chunks to the outbox once
  feature 2 is available.

Tests:

- Unit test exact-boundary Meshtastic and MeshCore limits.
- Unit test word-boundary chunking, long-token hard splitting, emoji/code-point counting, and
  9-chunk cap.
- `ChatPanel` tests for single send, chunked send, reply chunk behavior, and blocked over-9-chunk
  input.
- Run `pnpm run test:run -- ChatPanel chatComposerLimits`.

Reference:

- MeshCore companion protocol message limit and chunking guidance:
  https://docs.meshcore.io/companion_protocol/

## 2. Durable Outbox With Retry

Add SQLite-backed outbox storage.

Schema:

- Add table `chat_outbox` through `db-schema-sync` migration:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `protocol TEXT NOT NULL CHECK(protocol IN ('meshtastic','meshcore'))`
  - `view_key TEXT NOT NULL`
  - `channel INTEGER NOT NULL`
  - `to_node INTEGER NULL`
  - `payload TEXT NOT NULL`
  - `reply_id INTEGER NULL`
  - `status TEXT NOT NULL CHECK(status IN ('queued','sending','blocked','failed'))`
  - `error TEXT NULL`
  - `attempt_count INTEGER NOT NULL DEFAULT 0`
  - `next_retry_at INTEGER NULL`
  - `created_at INTEGER NOT NULL`
  - `updated_at INTEGER NOT NULL`
  - `group_id TEXT NULL`
  - `group_index INTEGER NULL`
  - `group_total INTEGER NULL`
- Indexes:
  - `(protocol, status, next_retry_at)`
  - `(protocol, view_key, created_at)`

IPC/API additions:

- Add types in `src/shared/electron-api.types.ts`.
- Add preload methods under `electronAPI.chat.outbox`.
- Main handlers:
  - `chat:outbox:list(protocol)`
  - `chat:outbox:add(entry)`
  - `chat:outbox:updateStatus(id, status, error?, nextRetryAt?)`
  - `chat:outbox:delete(id)`
  - `chat:outbox:clearSentOrDeleted` is not needed because sent rows are deleted immediately.
- Validate payload length, protocol, channel, destination, and status in main.

Renderer behavior:

- Add `useChatOutbox(protocol, sendFn, isSendAvailable)` hook.
- `ChatPanel` send button remains enabled while disconnected and becomes `Queue` when no send path
  is available.
- Queued rows render as synthetic own `ChatMessage` bubbles with status `queued`.
- Extend `ChatMessage.status` to include `queued` and `blocked`; update `StatusBadge`.
- Drain policy:
  - Drain on app startup after messages load.
  - Drain when protocol transport becomes operational.
  - Drain when MQTT connects for protocols that support MQTT send.
  - Retry queued rows in `created_at` order.
- Retry policy:
  - On transient send failure: `30s`, `2m`, `10m`, then every `10m`, max `5` attempts.
  - After 5 attempts: status `failed`.
  - MeshCore "no encryption key" errors become `blocked` with no automatic retry.
- User actions:
  - Queued/sending/failed/blocked bubbles expose `Retry now` and `Cancel`.
  - Failed bubbles keep existing resend affordance but route through outbox retry.
  - Cancel deletes only the outbox row, not persisted delivered messages.

Integration with existing send paths:

- Meshtastic `sendMessage` remains the transport submission path.
- MeshCore `sendMessage` remains the transport submission path.
- Outbox success means "submitted to transport"; delivery ACK/failure remains existing message status
  behavior.
- Do not duplicate delivered message rows: delete outbox row immediately after `sendFn` resolves or
  completes without throwing.

Tests:

- DB migration and `check:db-migrations`.
- IPC contract tests for every new outbox channel.
- Hook tests for queue, drain, retry backoff, blocked key error, cancel, and restart persistence.
- `ChatPanel` tests for Queue button, queued bubble, retry/cancel actions.
- Run `pnpm run typecheck`, relevant tests, and `pnpm run check:ipc-contract`.

## 3. Conversation Inbox

Add a protocol-neutral conversation inbox inside `ChatPanel`.

Data model:

- Add `ConversationSummary` in a renderer helper:
  - `protocol`
  - `viewKey`
  - `kind: 'channel' | 'dm'`
  - `label`
  - `lastMessageText`
  - `lastActivity`
  - `unreadCount`
  - `muted`
  - `pinned`
  - `queuedCount`
  - `failedCount`
- Add `buildConversationSummaries(...)` helper using:
  - existing channels
  - regular chat messages
  - inferred/open DM tabs
  - outbox rows
  - existing muted views
  - existing unread maps
  - new pinned views

Persistence:

- Extend `chatPanelProtocolStorage.ts`:
  - `pinnedViewsStorageKey(protocol)`
  - `loadPinnedViews(protocol): Set<string>`
  - `savePinnedViews(protocol, Set<string>)`
- Store as localStorage per protocol, same pattern as muted/starred views.

UI:

- Add `ConversationInbox.tsx`.
- Desktop layout: left rail, 260px wide, inside `ChatPanel`; messages remain on the right.
- Narrow windows: collapse inbox into a top conversation selector button/dropdown.
- Keep the existing top toolbar actions: search, jump date, export, mute, starred.
- Remove duplicated channel/DM chip rows once inbox is present.
- Sort order:
  - pinned conversations first
  - then unread conversations
  - then newest `lastActivity`
  - stable fallback by label
- Inbox row shows label, last preview, unread badge, queued/failed indicators, mute icon, and pin
  toggle.
- Channels always appear; DMs appear if open, inferred from messages, or represented by outbox rows.
- Selecting a row updates existing `viewMode`, `channel`, and `activeDmNode`.
- Closing a DM remains supported from the row action menu and uses existing dismissed-DM behavior.

Tests:

- Unit test `buildConversationSummaries` for channels, DMs, unread counts, pinned/muted state,
  outbox rows, and sort order.
- `ChatPanel` tests for selecting channel/DM from inbox, pin persistence, mute state, failed outbox
  indicator, and narrow layout dropdown.
- Accessibility test: inbox rows are keyboard reachable and expose `aria-current` for active
  conversation.

## Assumptions

- Meshtastic keeps the existing 228-character effective limit for v1 to avoid changing current
  behavior.
- MeshCore uses a 133-character effective limit.
- Outbox rows represent local send intent, not guaranteed delivery.
- No QR, quick replies, attachments, typing indicators, or read receipts are in scope.
- All new UI strings go into English locale first and then through existing i18n flow.
