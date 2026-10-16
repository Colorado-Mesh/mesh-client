import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';

import { MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES } from '@/shared/meshtasticDefaultPublicPsk';

import {
  meshcoreChannelKind,
  meshtasticChannelKind,
  takChannelContactName,
} from './takChannelNames';

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const PUBLIC = fromHex('8b3387e9c5cdea6ac9e5edbaa115cd72');
const hashtagKey = (name: string) => sha256(new TextEncoder().encode(name)).slice(0, 16);
const PRIVATE = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

describe('meshcoreChannelKind', () => {
  it('knows the Public channel by its key, whatever its name', () => {
    expect(meshcoreChannelKind('Public', PUBLIC)).toBe('public');
    expect(meshcoreChannelKind('Renamed', PUBLIC)).toBe('public');
  });

  it('knows a hashtag channel by the key its name gives, with or without the #', () => {
    expect(meshcoreChannelKind('#ops', hashtagKey('#ops'))).toBe('hashtag');
    expect(meshcoreChannelKind('ops', hashtagKey('#ops'))).toBe('hashtag');
    expect(meshcoreChannelKind('#ops', hashtagKey('#other'))).toBe('private');
  });

  it('treats any other key as private', () => {
    expect(meshcoreChannelKind('Ops', PRIVATE)).toBe('private');
    expect(meshcoreChannelKind('Ops', new Uint8Array(8))).toBe('private');
  });
});

describe('meshtasticChannelKind', () => {
  it('treats the default key, its one-byte alias, and no encryption as public', () => {
    expect(meshtasticChannelKind(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES)).toBe('public');
    expect(meshtasticChannelKind(Uint8Array.of(1))).toBe('public');
    expect(meshtasticChannelKind(new Uint8Array(0))).toBe('public');
  });

  it('treats any other key as private', () => {
    expect(meshtasticChannelKind(PRIVATE)).toBe('private');
    expect(meshtasticChannelKind(Uint8Array.of(2))).toBe('private');
  });
});

describe('takChannelContactName', () => {
  it('tags the protocol, drops a hashtag channel its own #, and locks private channels', () => {
    expect(takChannelContactName('meshcore', 'public', 'Public')).toBe('#MC Public');
    expect(takChannelContactName('meshcore', 'hashtag', '#ops')).toBe('#MC ops');
    expect(takChannelContactName('meshcore', 'private', ' Ops ')).toBe('#MC \u{1F512} Ops');
    expect(takChannelContactName('meshtastic', 'public', 'LongFast')).toBe('#MT LongFast');
    expect(takChannelContactName('meshtastic', 'private', 'Ops')).toBe('#MT \u{1F512} Ops');
  });

  it('fits ATAK names to the 64 UTF-16 units main accepts, without splitting an emoji', () => {
    const name = takChannelContactName('meshcore', 'private', 'x'.repeat(80));
    expect(name).toHaveLength(64);
    expect(name.startsWith('#MC \u{1F512} x')).toBe(true);
    // '#MC ' + 58 x = 62 units; the first emoji fits (64), the second would not.
    const emoji = takChannelContactName(
      'meshcore',
      'public',
      `${'x'.repeat(58)}\u{1F600}\u{1F600}`,
    );
    expect(emoji).toHaveLength(64);
    expect(emoji.endsWith('x\u{1F600}')).toBe(true);
  });
});
