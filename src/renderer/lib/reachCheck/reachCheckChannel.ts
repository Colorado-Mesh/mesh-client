import { sha256 } from '@noble/hashes/sha2.js';

import { bytesToHex, hexToBytesExact } from '@/shared/hexBytes';

import { findFirstFreeMeshcoreChannelIndex } from '../meshcoreChatChannelAdd';
import {
  MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX,
  type MeshcoreChatChannelSource,
  meshcoreConfiguredChannelIndexSet,
} from '../meshcoreConfiguredChatChannels';
import { meshcoreDeriveChannelKeyHexFromName } from '../meshcoreUtils';

/**
 * How the radio relates to a reach check server's test channel. A radio channel is the test
 * channel only when its name and its key both match: the server's hash is one byte, so a hash
 * match alone could be an unrelated private channel, and the code must never be sent there.
 */
export type ReachCheckChannelPlan =
  | { kind: 'ready'; index: number }
  | { kind: 'add-hashtag'; index: number; name: string; secret: Uint8Array }
  | { kind: 'needs-key'; index: number; name: string }
  | { kind: 'key-mismatch'; index: number; name: string }
  | { kind: 'slots-full' };

export interface ReachCheckChannelTarget {
  channelName: string;
  channelHash: string;
}

/** First byte of SHA-256 of a channel key, as two lower-case hex digits (MeshCore channel hash). */
export function meshcoreChannelHashHex(secret: Uint8Array): string {
  return bytesToHex(sha256(secret).subarray(0, 1));
}

function plainChannelName(name: string): string {
  return name.trim().replace(/^#/, '').toLowerCase();
}

export async function planReachCheckChannel(
  channels: readonly MeshcoreChatChannelSource[],
  server: ReachCheckChannelTarget,
): Promise<ReachCheckChannelPlan> {
  const configured = meshcoreConfiguredChannelIndexSet(channels);
  const named = channels.filter(
    (ch): ch is MeshcoreChatChannelSource & { secret: Uint8Array } =>
      configured.has(ch.index) &&
      ch.secret instanceof Uint8Array &&
      plainChannelName(ch.name) === server.channelName,
  );
  const matching = named
    .filter((ch) => meshcoreChannelHashHex(ch.secret) === server.channelHash)
    .sort((a, b) => {
      const aHash = a.name.trim().startsWith('#') ? 0 : 1;
      const bHash = b.name.trim().startsWith('#') ? 0 : 1;
      return aHash - bHash || a.index - b.index;
    });
  if (matching.length > 0) return { kind: 'ready', index: matching[0].index };
  if (named.length > 0) {
    const mismatched = [...named].sort((a, b) => a.index - b.index)[0];
    return { kind: 'key-mismatch', index: mismatched.index, name: mismatched.name };
  }

  const index = findFirstFreeMeshcoreChannelIndex(channels);
  if (index == null) return { kind: 'slots-full' };
  const hashtagName = `#${server.channelName}`;
  const derived = hexToBytesExact(await meshcoreDeriveChannelKeyHexFromName(hashtagName), 16);
  if (derived && meshcoreChannelHashHex(derived) === server.channelHash) {
    return { kind: 'add-hashtag', index, name: hashtagName, secret: derived };
  }
  return { kind: 'needs-key', index, name: server.channelName };
}

/** Checks a pasted 32-hex-digit channel key against the server's one-byte channel hash. */
export function checkPastedReachCheckKey(
  raw: string,
  channelHash: string,
): { ok: true; secret: Uint8Array } | { ok: false; reason: 'format' | 'hash' } {
  const hex = raw.replace(/\s+/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex) || hex === MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX) {
    return { ok: false, reason: 'format' };
  }
  const secret = hexToBytesExact(hex, 16);
  if (!secret) return { ok: false, reason: 'format' };
  if (meshcoreChannelHashHex(secret) !== channelHash) return { ok: false, reason: 'hash' };
  return { ok: true, secret };
}
