import { describe, expect, it } from 'vitest';

import { bytesToHex, hexToBytesExactOrThrow } from '@/shared/hexBytes';

import type { MeshcoreChatChannelSource } from '../meshcoreConfiguredChatChannels';
import { meshcoreDeriveChannelKeyHexFromName } from '../meshcoreUtils';
import {
  checkPastedReachCheckKey,
  meshcoreChannelHashHex,
  planReachCheckChannel,
} from './reachCheckChannel';

async function hashtagSecret(name: string): Promise<Uint8Array> {
  return hexToBytesExactOrThrow(await meshcoreDeriveChannelKeyHexFromName(name), 16);
}

function filledSecret(byte: number): Uint8Array {
  return new Uint8Array(16).fill(byte);
}

const PUBLIC: MeshcoreChatChannelSource = { index: 0, name: 'Public', secret: filledSecret(0x8b) };
const CM_REACH = { channelName: 'cm-reach', channelHash: 'd6' };

describe('meshcoreChannelHashHex', () => {
  it('is the first byte of SHA-256 of the key, as two hex digits', async () => {
    expect(meshcoreChannelHashHex(await hashtagSecret('#cm-reach'))).toBe('d6');
    expect(meshcoreChannelHashHex(await hashtagSecret('#ma-hc'))).toBe('13');
  });
});

describe('planReachCheckChannel', () => {
  it('offers to add the hashtag channel in the first free slot when the radio lacks it', async () => {
    const plan = await planReachCheckChannel(
      [PUBLIC, { index: 1, name: '#denver', secret: filledSecret(0x11) }],
      CM_REACH,
    );
    expect(plan.kind).toBe('add-hashtag');
    if (plan.kind !== 'add-hashtag') return;
    expect(plan.index).toBe(2);
    expect(plan.name).toBe('#cm-reach');
    expect(bytesToHex(plan.secret)).toBe(await meshcoreDeriveChannelKeyHexFromName('#cm-reach'));
  });

  it('skips unconfigured slots when looking for a free one', async () => {
    const plan = await planReachCheckChannel(
      [PUBLIC, { index: 1, name: '', secret: new Uint8Array(16) }],
      CM_REACH,
    );
    expect(plan).toMatchObject({ kind: 'add-hashtag', index: 1 });
  });

  it('is ready when a channel with the same name, in any case, holds the matching key', async () => {
    const plan = await planReachCheckChannel(
      [PUBLIC, { index: 4, name: '#CM-Reach', secret: await hashtagSecret('#cm-reach') }],
      CM_REACH,
    );
    expect(plan).toEqual({ kind: 'ready', index: 4 });
  });

  it('accepts the name without a leading #', async () => {
    const plan = await planReachCheckChannel(
      [PUBLIC, { index: 3, name: 'cm-reach', secret: await hashtagSecret('#cm-reach') }],
      CM_REACH,
    );
    expect(plan).toEqual({ kind: 'ready', index: 3 });
  });

  it('prefers the #name channel when several match', async () => {
    const secret = await hashtagSecret('#cm-reach');
    const plan = await planReachCheckChannel(
      [PUBLIC, { index: 2, name: 'cm-reach', secret }, { index: 5, name: '#cm-reach', secret }],
      CM_REACH,
    );
    expect(plan).toEqual({ kind: 'ready', index: 5 });
  });

  it('reports a key mismatch for a same-named channel with another key', async () => {
    const plan = await planReachCheckChannel(
      [PUBLIC, { index: 6, name: '#cm-reach', secret: filledSecret(0x42) }],
      CM_REACH,
    );
    expect(plan).toEqual({ kind: 'key-mismatch', index: 6, name: '#cm-reach' });
  });

  it('ignores a channel with another name even when its key hash matches', async () => {
    const plan = await planReachCheckChannel(
      [PUBLIC, { index: 1, name: 'Family', secret: await hashtagSecret('#cm-reach') }],
      CM_REACH,
    );
    expect(plan).toMatchObject({ kind: 'add-hashtag', index: 2, name: '#cm-reach' });
  });

  it('asks for the key when the name does not derive the server hash', async () => {
    const plan = await planReachCheckChannel([PUBLIC], {
      channelName: 'ukmeshtest',
      channelHash: '24',
    });
    expect(plan).toEqual({ kind: 'needs-key', index: 1, name: 'ukmeshtest' });
  });

  it('reports slots-full when every slot holds a channel', async () => {
    const channels: MeshcoreChatChannelSource[] = Array.from({ length: 40 }, (_, i) => ({
      index: i,
      name: `ch${i}`,
      secret: filledSecret(i + 1),
    }));
    await expect(planReachCheckChannel(channels, CM_REACH)).resolves.toEqual({
      kind: 'slots-full',
    });
    await expect(
      planReachCheckChannel(channels, { channelName: 'ukmeshtest', channelHash: '24' }),
    ).resolves.toEqual({ kind: 'slots-full' });
  });
});

describe('checkPastedReachCheckKey', () => {
  it('accepts a key whose hash matches, ignoring spaces and case', async () => {
    const secret = await hashtagSecret('#cm-reach');
    const hex = bytesToHex(secret).toUpperCase();
    const spaced = `${hex.slice(0, 16)} ${hex.slice(16)}`;
    const result = checkPastedReachCheckKey(spaced, 'd6');
    expect(result.ok).toBe(true);
    if (result.ok) expect(bytesToHex(result.secret)).toBe(bytesToHex(secret));
  });

  it.each([
    ['31 hex digits', 'a'.repeat(31)],
    ['33 hex digits', 'a'.repeat(33)],
    ['non-hex characters', 'z'.repeat(32)],
    ['the all-zero key', '0'.repeat(32)],
    ['an empty value', ''],
  ])('refuses %s as format', (_label, hex) => {
    expect(checkPastedReachCheckKey(hex, 'd6')).toEqual({ ok: false, reason: 'format' });
  });

  it('refuses a well-formed key whose hash differs', () => {
    expect(checkPastedReachCheckKey('11'.repeat(16), 'd6')).toEqual({ ok: false, reason: 'hash' });
  });
});
