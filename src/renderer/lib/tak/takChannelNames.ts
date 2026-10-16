import { sha256 } from '@noble/hashes/sha2.js';

import type { ChannelIdentityProtocol } from '@/shared/channelIdentityKey';
import { isMeshtasticDefaultPublicPsk } from '@/shared/meshtasticDefaultPublicPsk';
import { TAK_GEOCHAT_ROOM_MAX_LEN } from '@/shared/tak-types';

/** What a channel is, for its ATAK name: open to all, a hashtag channel, or private. */
export type TakChannelKind = 'public' | 'hashtag' | 'private';

/** MeshCore's Public channel key, the firmware default every radio ships with. */
const MESHCORE_PUBLIC_SECRET_HEX = '8b3387e9c5cdea6ac9e5edbaa115cd72';
const SECRET_BYTES = 16;

/** Protocol tag every ATAK channel name carries, so two radios' channels never clash. */
const PROTOCOL_TAG: Record<ChannelIdentityProtocol, string> = {
  meshcore: 'MC',
  meshtastic: 'MT',
};

/** Marks a private channel in ATAK's contact list. */
const PRIVATE_MARK = '\u{1F512}';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A hashtag channel's name without its leading `#`, as MeshCore apps show it. */
function bareHashtag(name: string): string {
  return name.trim().replace(/^#+/, '');
}

/**
 * MeshCore channel kind, from its key: the Public key, the key a hashtag name gives (the first
 * 16 bytes of SHA-256 of `#name`), or anything else, which is private. The key is only compared.
 */
export function meshcoreChannelKind(name: string, secret: Uint8Array): TakChannelKind {
  if (secret.length !== SECRET_BYTES) return 'private';
  const secretHex = hex(secret);
  if (secretHex === MESHCORE_PUBLIC_SECRET_HEX) return 'public';
  const tag = bareHashtag(name);
  if (tag) {
    const derived = sha256(new TextEncoder().encode(`#${tag}`)).slice(0, SECRET_BYTES);
    if (hex(derived) === secretHex) return 'hashtag';
  }
  return 'private';
}

/** Meshtastic channel kind: the default key, or no encryption, is public; any other is private. */
export function meshtasticChannelKind(psk: Uint8Array): TakChannelKind {
  if (psk.length === 0 || isMeshtasticDefaultPublicPsk(psk)) return 'public';
  return 'private';
}

/**
 * Longest start of `text` within `max` UTF-16 units (how main measures names), never splitting
 * an emoji or other surrogate pair.
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trimEnd();
}

/**
 * The name a channel's contact gets in ATAK: `#`, the protocol tag, then the channel name, with
 * a lock on private channels: `#MC Public`, `#MC ops` (a hashtag channel, its own `#` dropped),
 * `#MT 🔒 Ops`. The leading `#` groups channels at the top of ATAK's contact list.
 */
export function takChannelContactName(
  protocol: ChannelIdentityProtocol,
  kind: TakChannelKind,
  name: string,
): string {
  const shown = kind === 'hashtag' ? bareHashtag(name) : name.trim();
  const mark = kind === 'private' ? `${PRIVATE_MARK} ` : '';
  return clip(`#${PROTOCOL_TAG[protocol]} ${mark}${shown}`, TAK_GEOCHAT_ROOM_MAX_LEN);
}
