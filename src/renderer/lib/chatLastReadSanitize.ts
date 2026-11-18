import { chatViewKeyForMessage } from '@/renderer/lib/chatUnreadCounts';

import { chatReadClockMs, chatReadOrderMs } from './chatReceiveOrder';
import { clampReadWatermarkMs } from './nodeStatus';
import type { ChatMessage } from './types';

export type ChatLastReadSanitizeMessage = Pick<
  ChatMessage,
  'channel' | 'timestamp' | 'receivedAt'
> & {
  to?: number | null;
  sender_id?: number;
  reticulum_sender_hash?: string;
};

/** Newest read key (arrival time, or the stamp for older rows) per chat view key. */
export function maxMessageTimestampByViewKey(
  messages: readonly ChatLastReadSanitizeMessage[],
  protocol: 'meshcore' | 'meshtastic' | 'reticulum' = 'meshtastic',
  ownNodeIds: ReadonlySet<number> = new Set(),
): Record<string, number> {
  const maxByKey: Record<string, number> = {};
  for (const msg of messages) {
    const key =
      msg.sender_id != null
        ? chatViewKeyForMessage(
            {
              channel: msg.channel,
              to: msg.to ?? undefined,
              sender_id: msg.sender_id,
              reticulum_sender_hash: msg.reticulum_sender_hash,
            },
            protocol,
            ownNodeIds,
          )
        : msg.to != null
          ? `dm:${msg.to >>> 0}`
          : `ch:${msg.channel}`;
    const ts = chatReadOrderMs(msg);
    const prev = maxByKey[key] ?? 0;
    if (ts > prev) maxByKey[key] = ts;
  }
  return maxByKey;
}

/** Newest read key (arrival time, or the clamped stamp for older posts) per room server id. */
export function maxRoomPostTimestampByServerId(
  messages: readonly { roomServerId?: number; timestamp: number; receivedAt?: number }[],
): Record<number, number> {
  const maxById: Record<number, number> = {};
  for (const msg of messages) {
    if (msg.roomServerId == null) continue;
    const ts = chatReadOrderMs(msg);
    const id = msg.roomServerId >>> 0;
    if (ts > (maxById[id] ?? 0)) maxById[id] = ts;
  }
  return maxById;
}

/**
 * Shared clamp loop for `ch:`/`dm:` string-keyed last-read watermarks: drop any watermark
 * past the read clock (`chatReadClockMs`: this clock, or a newer receipt after a set-back) or
 * past the newest known message for that view key (legacy pre-#490 `Date.now()` bumps
 * suppressed sidebar badges across all three protocols).
 */
export function sanitizeViewKeyLastRead(
  persisted: Readonly<Record<string, number>>,
  maxByKey: Readonly<Record<string, number>>,
  now: number = Date.now(),
): Record<string, number> {
  const readNow = chatReadClockMs(now);
  let changed = false;
  const next: Record<string, number> = { ...persisted };
  for (const [key, watermark] of Object.entries(persisted)) {
    if (!key.startsWith('ch:') && !key.startsWith('dm:')) continue;
    const maxMsg = maxByKey[key] ?? 0;
    let clamped = clampReadWatermarkMs(watermark, readNow);
    if (watermark > readNow || (maxMsg > 0 && clamped > maxMsg)) clamped = maxMsg;
    if (clamped !== watermark) {
      next[key] = clamped;
      changed = true;
    }
  }
  return changed ? next : persisted;
}

/** Same clamp rule as {@link sanitizeViewKeyLastRead} but for numeric-keyed watermarks (rooms). */
export function sanitizeNumericKeyLastRead(
  persisted: Readonly<Record<number, number>>,
  maxById: Readonly<Record<number, number>>,
  now: number = Date.now(),
): Record<number, number> {
  const readNow = chatReadClockMs(now);
  let changed = false;
  const next: Record<number, number> = { ...persisted };
  for (const [k, watermark] of Object.entries(persisted)) {
    const nodeId = Number(k) >>> 0;
    if (!Number.isFinite(nodeId)) continue;
    const maxMsg = maxById[nodeId] ?? 0;
    let clamped = clampReadWatermarkMs(watermark, readNow);
    if (watermark > readNow || (maxMsg > 0 && clamped > maxMsg)) clamped = maxMsg;
    if (clamped !== watermark) {
      next[nodeId] = clamped;
      changed = true;
    }
  }
  return changed ? next : persisted;
}
