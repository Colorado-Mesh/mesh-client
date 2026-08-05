/**
 * IRC-style per-peer RRC DMs.
 *
 * Wire: direct NOTICE with K_DST (no K_ROOM). Client storage key: `@<32-hex>`.
 */

import type { RrcChatMessage } from '@/shared/rrc-types';

const FULL_HASH_RE = /^[0-9a-f]{32}$/i;

/** Legacy single-inbox room — no longer written for new traffic. */
export const RRC_LEGACY_WHISPERS_ROOM = '[whispers]';

export function isRrcWhisperPeerHash(hash: string | null | undefined): hash is string {
  return Boolean(hash && FULL_HASH_RE.test(hash.trim()));
}

/** Stable synthetic room key for one peer DM. */
export function rrcDmRoomKey(identityHash: string): string {
  return `@${identityHash.trim().toLowerCase()}`;
}

/** Parse `@<32-hex>` → identity hash, or null. */
export function parseRrcDmRoomKey(room: string | null | undefined): string | null {
  const t = (room ?? '').trim().toLowerCase();
  if (!t.startsWith('@')) return null;
  const hash = t.slice(1);
  return isRrcWhisperPeerHash(hash) ? hash : null;
}

export function isRrcDmRoom(room: string | null | undefined): boolean {
  return parseRrcDmRoomKey(room) != null;
}

export function isRrcLegacyWhispersRoom(room: string | null | undefined): boolean {
  return (room ?? '').trim().toLowerCase() === RRC_LEGACY_WHISPERS_ROOM;
}

export interface RrcDmPeer {
  identity_hash: string;
  nickname: string | null;
}

/** Sidebar/header label: nick, else 8-hex, else fallback. */
export function rrcDmDisplayLabel(
  peer: { identity_hash: string; nickname?: string | null } | null,
  fallback = 'DM',
): string {
  if (!peer) return fallback;
  const nick = peer.nickname?.trim();
  if (nick) return nick;
  if (isRrcWhisperPeerHash(peer.identity_hash)) {
    return peer.identity_hash.trim().toLowerCase().slice(0, 8);
  }
  return fallback;
}

/**
 * Resolve the peer identity for a direct NOTICE (has dst_hash).
 * Inbound: sender is the peer. Outbound echo: dst is the peer.
 */
export function resolveRrcDmPeerFromDirectMessage(
  msg: Pick<RrcChatMessage, 'dst_hash' | 'sender_hash' | 'nickname'>,
  localIdentityHash?: string | null,
): RrcDmPeer | null {
  const dst = msg.dst_hash?.trim().toLowerCase() ?? null;
  if (!isRrcWhisperPeerHash(dst)) return null;

  const local = localIdentityHash?.trim().toLowerCase() || null;
  const sender = msg.sender_hash?.trim().toLowerCase() || null;

  if (sender && isRrcWhisperPeerHash(sender) && (!local || sender !== local)) {
    return {
      identity_hash: sender,
      nickname: msg.nickname?.trim() ? msg.nickname.trim() : null,
    };
  }

  // Outbound (sender is self or missing): peer is dst; nick usually unknown on echo.
  return {
    identity_hash: dst,
    nickname: null,
  };
}

/**
 * Best-effort split of legacy `[whispers]` rows into per-peer `@hash` buckets.
 * Outbound rows without recoverable peer hash are skipped.
 */
export function splitLegacyWhispersMessages(
  messages: readonly RrcChatMessage[],
  localIdentityHash?: string | null,
): Map<string, RrcChatMessage[]> {
  const local = localIdentityHash?.trim().toLowerCase() || null;
  const byRoom = new Map<string, RrcChatMessage[]>();

  for (const msg of messages) {
    let peerHash: string | null = null;
    let peerNick: string | null = null;

    if (isRrcWhisperPeerHash(msg.dst_hash)) {
      const dst = msg.dst_hash.trim().toLowerCase();
      const sender = msg.sender_hash?.trim().toLowerCase() || null;
      if (sender && local && sender === local) {
        peerHash = dst;
      } else if (sender && isRrcWhisperPeerHash(sender) && sender !== local) {
        peerHash = sender;
        peerNick = msg.nickname?.trim() || null;
      } else {
        peerHash = dst;
      }
    } else if (isRrcWhisperPeerHash(msg.sender_hash)) {
      const sender = msg.sender_hash.trim().toLowerCase();
      if (!local || sender !== local) {
        peerHash = sender;
        peerNick = msg.nickname?.trim() || null;
      }
    }

    if (!peerHash) continue;
    const room = rrcDmRoomKey(peerHash);
    const mapped: RrcChatMessage = { ...msg, room, dst_hash: msg.dst_hash ?? peerHash };
    void peerNick;
    const list = byRoom.get(room) ?? [];
    list.push(mapped);
    byRoom.set(room, list);
  }

  return byRoom;
}
