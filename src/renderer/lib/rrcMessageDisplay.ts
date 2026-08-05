import type { RrcChatMessage } from '@/shared/rrc-types';

/**
 * Empty notice/system/error rows render as a lone IRC `*` — hide them.
 * MSG/ACTION with empty body are still shown (rare).
 */
export function shouldDisplayRrcChatMessage(msg: Pick<RrcChatMessage, 'body' | 'kind'>): boolean {
  if (msg.kind === 'notice' || msg.kind === 'system' || msg.kind === 'error') {
    return msg.body.trim().length > 0;
  }
  return true;
}

/** True when an inbound RRC chat row should be dropped at ingest. */
export function shouldDropEmptyRrcInbound(kind: string, body: string): boolean {
  if (kind === 'notice' || kind === 'system' || kind === 'error') {
    return body.trim().length === 0;
  }
  return false;
}

/**
 * Parse legacy local whisper-sent echo body (`→ name: text`).
 * New outbound whispers are stored as room-style `msg` rows.
 */
export function parseRrcWhisperEcho(body: string): { name: string; text: string } | null {
  const m = /^→\s+(.+?):\s([\s\S]*)$/.exec(body);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  return { name, text: m[2] };
}
