/**
 * Resolve the peer for plain-text replies in the synthetic `[whispers]` room.
 */

import type { RrcWhisperPeer } from '@/renderer/stores/rrcSessionStore';
import type { RrcChatMessage } from '@/shared/rrc-types';

const FULL_HASH_RE = /^[0-9a-f]{32}$/i;

export function isRrcWhisperPeerHash(hash: string | null | undefined): boolean {
  return Boolean(hash && FULL_HASH_RE.test(hash.trim()));
}

export interface ResolveRrcWhisperReplyTargetOpts {
  lastWhisperPeer: RrcWhisperPeer | null;
  messages: readonly RrcChatMessage[];
  /** Local identity — excluded when scanning inbound sender_hash. */
  localIdentityHash?: string | null;
}

/**
 * Prefer the stored last-whisper peer; else scan recent whisper messages newest-first
 * (outbound system `dst_hash`, then inbound `sender_hash`).
 */
export function resolveRrcWhisperReplyTarget(
  opts: ResolveRrcWhisperReplyTargetOpts,
): RrcWhisperPeer | null {
  const stored = opts.lastWhisperPeer;
  if (stored && isRrcWhisperPeerHash(stored.identity_hash)) {
    return {
      identity_hash: stored.identity_hash.trim().toLowerCase(),
      nickname: stored.nickname,
    };
  }

  const local = opts.localIdentityHash?.trim().toLowerCase() || null;
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const msg = opts.messages[i];

    if (msg.kind === 'system' && isRrcWhisperPeerHash(msg.dst_hash)) {
      return {
        identity_hash: msg.dst_hash!.trim().toLowerCase(),
        nickname: msg.nickname ?? null,
      };
    }

    if ((msg.kind === 'notice' || msg.kind === 'msg') && isRrcWhisperPeerHash(msg.sender_hash)) {
      const sender = msg.sender_hash!.trim().toLowerCase();
      if (local && sender === local) continue;
      return {
        identity_hash: sender,
        nickname: msg.nickname ?? null,
      };
    }
  }

  return null;
}
