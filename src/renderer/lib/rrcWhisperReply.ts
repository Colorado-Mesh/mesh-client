/**
 * Resolve the peer for plain-text replies in the synthetic `[whispers]` room.
 */

import type { RrcWhisperPeer } from '@/renderer/stores/rrcSessionStore';
import type { RrcChatMessage } from '@/shared/rrc-types';

const FULL_HASH_RE = /^[0-9a-f]{32}$/i;

export function isRrcWhisperPeerHash(hash: string | null | undefined): hash is string {
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
 * (outbound `dst_hash` on msg/system, then inbound `sender_hash`).
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

    // Outbound whisper echo (new msg rows or legacy system) carries peer in dst_hash.
    const dst = msg.dst_hash;
    if ((msg.kind === 'system' || msg.kind === 'msg') && isRrcWhisperPeerHash(dst)) {
      return {
        identity_hash: dst.trim().toLowerCase(),
        nickname: null,
      };
    }

    const senderHash = msg.sender_hash;
    if ((msg.kind === 'notice' || msg.kind === 'msg') && isRrcWhisperPeerHash(senderHash)) {
      const sender = senderHash.trim().toLowerCase();
      if (local && sender === local) continue;
      return {
        identity_hash: sender,
        nickname: msg.nickname ?? null,
      };
    }
  }

  return null;
}

/** Sidebar/header label for the synthetic whispers room. */
export function rrcWhisperDisplayLabel(
  peer: { identity_hash: string; nickname?: string | null } | null,
  fallback = '[whispers]',
): string {
  if (!peer) return fallback;
  const nick = peer.nickname?.trim();
  if (nick) return nick;
  if (isRrcWhisperPeerHash(peer.identity_hash)) {
    return peer.identity_hash.trim().toLowerCase().slice(0, 8);
  }
  return fallback;
}
