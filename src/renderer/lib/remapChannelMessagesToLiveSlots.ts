import { isMeshtasticChannelMessage } from './channelIdentity';
import type { ChatMessage } from './types';

export interface ChannelRemapContext {
  /** Connected radio's slot → channel identity key. */
  keyByIndex: Readonly<Record<number, string>>;
  /** Connected radio node number, or null when unknown. */
  radioNodeId: number | null;
}

function isGroupChannelMessage(m: ChatMessage): boolean {
  return m.channel >= 0 && m.roomServerId == null && isMeshtasticChannelMessage(m);
}

/**
 * Show persisted group-channel history under whichever slot holds the same channel on the
 * connected radio (slot indices differ between radios). DMs and room posts pass through.
 *
 * - Keyed row whose channel is on this radio: moved to that slot.
 * - Keyed row whose channel is not on this radio: hidden (kept in SQLite).
 * - Unkeyed row from this radio, or with no radio (legacy): stays in its stored slot.
 * - Unkeyed row from a different radio: hidden, since its slot layout is unknown.
 * - No live channel list (offline / still loading): rows pass through unchanged.
 */
export function remapChannelMessagesToLiveSlots(
  messages: ChatMessage[],
  ctx: ChannelRemapContext | null,
): ChatMessage[] {
  if (!ctx) return messages;
  const indexByKey = new Map<string, number>();
  for (const [index, key] of Object.entries(ctx.keyByIndex)) {
    const slot = Number(index);
    const prev = indexByKey.get(key);
    if (prev == null || slot < prev) indexByKey.set(key, slot);
  }
  if (indexByKey.size === 0) return messages;

  let changed = false;
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (!isGroupChannelMessage(m)) {
      out.push(m);
      continue;
    }
    if (m.channelKey) {
      const slot = indexByKey.get(m.channelKey);
      if (slot == null) {
        changed = true;
        continue;
      }
      if (slot !== m.channel) {
        changed = true;
        out.push({ ...m, channel: slot });
        continue;
      }
      out.push(m);
      continue;
    }
    if (m.radioNodeId != null && ctx.radioNodeId != null && m.radioNodeId !== ctx.radioNodeId) {
      changed = true;
      continue;
    }
    out.push(m);
  }
  return changed ? out : messages;
}
