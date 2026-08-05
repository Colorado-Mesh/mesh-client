/**
 * Apply an inbound RRC direct NOTICE to the session (open per-peer DM, resolve room).
 * Extracted from useReticulumRuntime for behavioral tests.
 */

import {
  resolveRrcDmPeerFromDirectMessage,
  type RrcDmPeer,
  rrcDmRoomKey,
} from '@/renderer/lib/rrcDmRoom';

export interface ApplyRrcDirectMessageOpts {
  dst_hash: string | null | undefined;
  sender_hash: string | null | undefined;
  nickname: string | null | undefined;
  localIdentityHash: string | null | undefined;
  hubDestHash: string | undefined;
  fallbackRoom: string;
  openDm: (peer: RrcDmPeer, hubHash: string | undefined, opts: { focus: boolean }) => void;
}

/**
 * Resolve peer + open DM when possible. Returns the room key for the message.
 * When local identity is unavailable, returns `fallbackRoom` and does not openDm
 * (caller should not mis-route outbound echo as a self-DM).
 */
export function applyRrcDirectMessageRoom(opts: ApplyRrcDirectMessageOpts): string {
  const peer = resolveRrcDmPeerFromDirectMessage(
    {
      dst_hash: typeof opts.dst_hash === 'string' ? opts.dst_hash : null,
      sender_hash: typeof opts.sender_hash === 'string' ? opts.sender_hash : null,
      nickname: typeof opts.nickname === 'string' ? opts.nickname : null,
    },
    opts.localIdentityHash,
  );
  if (peer) {
    // Do not steal focus from an active room — unread badge surfaces new DMs.
    opts.openDm(peer, opts.hubDestHash, { focus: false });
    return rrcDmRoomKey(peer.identity_hash);
  }
  return opts.fallbackRoom;
}
