import { LAST_HEARD_MS_THRESHOLD } from '../../shared/lastHeardUnits';
import type { ChatMessage } from './types';

const MESHCORE_REPLY_KEY_MS_THRESHOLD = LAST_HEARD_MS_THRESHOLD;

/** Match a MeshCore reply key against a message's packet id or timestamp (s or ms). */
export function meshcoreMessageMatchesReplyKey(msg: ChatMessage, replyKey: number): boolean {
  if (!Number.isFinite(replyKey) || replyKey <= 0) return false;
  if (msg.packetId === replyKey || msg.timestamp === replyKey) return true;

  const keyLooksSec = replyKey < MESHCORE_REPLY_KEY_MS_THRESHOLD;
  if (keyLooksSec && msg.timestamp >= MESHCORE_REPLY_KEY_MS_THRESHOLD) {
    if (Math.floor(msg.timestamp / 1000) === replyKey) return true;
    if (msg.timestamp === replyKey * 1000) return true;
  }

  if (msg.packetId != null && msg.packetId !== replyKey) {
    if (keyLooksSec && msg.packetId >= MESHCORE_REPLY_KEY_MS_THRESHOLD) {
      if (Math.floor(msg.packetId / 1000) === replyKey) return true;
    }
  }

  return false;
}
