/**
 * Fallback nick resolution for the RRC nicklist.
 *
 * rrcd JOINED rosters carry identity hashes only, and `/who` is a single
 * best-effort NOTICE (dropped when the roster exceeds the Link MDU). The hub's
 * transcripts — including SQLite history rehydrated after a restart — already
 * pair `sender_hash` with the nick the hub advertised, so use them to label
 * members that would otherwise render as bare hex.
 */

import { rrcIdentityHashesMatch } from '@/renderer/lib/rrcRoomMembers';
import type { RrcChatMessage, RrcRoomMember } from '@/shared/rrc-types';

export interface RrcHistoryNick {
  hash: string;
  nickname: string;
}

function collectInto(map: Map<string, RrcHistoryNick>, messages: readonly RrcChatMessage[]): void {
  for (const msg of messages) {
    const hash = msg.sender_hash?.trim().toLowerCase();
    const nickname = msg.nickname?.trim();
    if (!hash || hash.length < 8 || !nickname) continue;
    if (/^anonymous$/i.test(nickname)) continue;
    map.set(hash, { hash, nickname });
  }
}

/** Latest nick per sender hash, newest transcript entry winning. */
export function collectRrcNicksFromMessages(messages: readonly RrcChatMessage[]): RrcHistoryNick[] {
  const byHash = new Map<string, RrcHistoryNick>();
  collectInto(byHash, messages);
  return [...byHash.values()];
}

/**
 * Nicks learned anywhere on one hub. A peer who only ever spoke in another room
 * (or a whisper) still gets a name in this room's nicklist.
 *
 * `messagesByKey` is `rrcSessionStore.messages`, keyed `${hubHash}::${room}`.
 */
export function collectRrcNicksForHub(
  messagesByKey: ReadonlyMap<string, RrcChatMessage[]>,
  hubHash: string | null | undefined,
): RrcHistoryNick[] {
  const hub = hubHash?.trim().toLowerCase();
  if (!hub) return [];
  const byHash = new Map<string, RrcHistoryNick>();
  const prefix = `${hub}::`;
  for (const [key, messages] of messagesByKey) {
    if (!key.startsWith(prefix)) continue;
    collectInto(byHash, messages);
  }
  return [...byHash.values()];
}

/**
 * Fill in `nickname` for members the hub only gave us a hash for. Never
 * overwrites a nick the hub supplied (`/who`, chat, or advisory JOINED nick).
 */
export function applyRrcHistoryNicksToMembers(
  members: readonly RrcRoomMember[],
  known: readonly RrcHistoryNick[],
): RrcRoomMember[] {
  if (known.length === 0) return [...members];
  return members.map((member) => {
    if (member.nickname?.trim()) return member;
    const hash = member.identity_hash.trim().toLowerCase();
    if (hash.startsWith('nick:')) return member;
    const match = known.find((k) => rrcIdentityHashesMatch(k.hash, hash));
    if (!match) return member;
    return {
      // Chat carries the full identity; `/who` only a 12-hex prefix.
      identity_hash: match.hash.length >= hash.length ? match.hash : hash,
      nickname: match.nickname,
    };
  });
}
