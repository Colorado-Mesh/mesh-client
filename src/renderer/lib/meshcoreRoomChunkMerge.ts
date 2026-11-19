import type { ChatMessage } from './types';

const ROOM_CHUNK_PREFIX_RE = /^\[(\d+)\/(\d+)\]\s/;

function parseRoomChunkPrefix(
  payload: string,
): { index: number; total: number; body: string } | null {
  const match = ROOM_CHUNK_PREFIX_RE.exec(payload);
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isFinite(index) ||
    !Number.isFinite(total) ||
    index < 1 ||
    total < 1 ||
    index > total
  ) {
    return null;
  }
  return { index, total, body: payload.slice(match[0].length) };
}

/**
 * Merge consecutive room posts that use `[i/N] ` chunk prefixes (mesh-client long posts).
 * Failure point: out-of-order chunks — only merges strictly increasing index on same sender.
 */
export function mergeDisplayedRoomPostChunks(posts: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let pending: ChatMessage | null = null;
  let pendingTotal = 0;
  let pendingReceived = 0;

  const flushPending = (): void => {
    if (pending != null) out.push(pending);
    pending = null;
    pendingTotal = 0;
    pendingReceived = 0;
  };

  for (const msg of posts) {
    const chunk = parseRoomChunkPrefix(msg.payload);
    if (chunk == null) {
      flushPending();
      out.push(msg);
      continue;
    }
    if (
      pending != null &&
      (pending.sender_id !== msg.sender_id ||
        pending.roomServerId !== msg.roomServerId ||
        chunk.total !== pendingTotal ||
        chunk.index !== pendingReceived + 1)
    ) {
      flushPending();
    }
    if (pending == null) {
      pending = { ...msg, payload: chunk.body };
      pendingTotal = chunk.total;
      pendingReceived = 1;
      if (chunk.index === chunk.total) flushPending();
      continue;
    }
    // Newest receipt across chunks: RoomsPanel may re-order out-of-order arrivals by
    // chunk index, so the last index is not always the last observation.
    const previousReceivedAt: number | undefined = pending.receivedAt;
    const incomingReceivedAt: number | undefined = msg.receivedAt;
    const nextReceivedAt: number | undefined =
      previousReceivedAt == null
        ? incomingReceivedAt
        : incomingReceivedAt == null
          ? previousReceivedAt
          : Math.max(previousReceivedAt, incomingReceivedAt);
    pending = {
      ...pending,
      payload: pending.payload + chunk.body,
      timestamp: msg.timestamp,
      ...(nextReceivedAt != null ? { receivedAt: nextReceivedAt } : {}),
    };
    pendingReceived = chunk.index;
    if (chunk.index === chunk.total) flushPending();
  }
  flushPending();
  return out;
}
