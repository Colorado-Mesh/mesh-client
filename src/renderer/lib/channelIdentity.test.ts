import { afterEach, describe, expect, it } from 'vitest';

import { computeChannelIdentityKey } from '../../shared/channelIdentityKey';
import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '../stores/liveChannelKeyStore';
import {
  buildMeshcoreChannelKeyByIndex,
  buildMeshtasticChannelKeyByIndex,
  resolveChannelKeyForPersist,
  withMeshtasticChannelIdentity,
} from './channelIdentity';
import type { ChatMessage } from './types';

const SECRET = new Uint8Array(16).fill(0x11);
const ZERO_SECRET = new Uint8Array(16);
const KEY_A = 'aaaaaaaaaaaaaaaa';
const RADIO = 222;

function msg(extra: Partial<ChatMessage>): ChatMessage {
  return { sender_id: 1, sender_name: 'n', payload: 'p', channel: 1, timestamp: 1, ...extra };
}

afterEach(() => {
  resetLiveChannelKeyStoreForTests();
});

describe('buildMeshcoreChannelKeyByIndex', () => {
  it('keys configured slots and skips unset (all-zero) or malformed slots', () => {
    const map = buildMeshcoreChannelKeyByIndex([
      { index: 0, name: 'Public', secret: SECRET },
      { index: 1, name: '', secret: ZERO_SECRET },
      { index: 2, name: '#emergency', secret: new Uint8Array(4) },
      { index: 3, name: '#emergency', secret: SECRET },
      null,
      { index: 'x', name: 'bad', secret: SECRET },
    ]);
    expect(map).toEqual({
      0: computeChannelIdentityKey('meshcore', 'Public', SECRET),
      3: computeChannelIdentityKey('meshcore', '#emergency', SECRET),
    });
  });

  it('gives the same channel the same key on two radios regardless of slot', () => {
    const a = buildMeshcoreChannelKeyByIndex([{ index: 1, name: '#emergency', secret: SECRET }]);
    const b = buildMeshcoreChannelKeyByIndex([{ index: 4, name: '#emergency', secret: SECRET }]);
    expect(a[1]).toBe(b[4]);
  });
});

describe('buildMeshtasticChannelKeyByIndex', () => {
  it('keys enabled channels by raw config name + PSK and skips disabled slots', () => {
    const psk = new Uint8Array([1]);
    const map = buildMeshtasticChannelKeyByIndex([
      { index: 0, name: '', role: 1, psk },
      { index: 1, name: 'Ops', role: 2, psk: SECRET },
      { index: 2, name: '', role: 0, psk: new Uint8Array() },
    ]);
    expect(map).toEqual({
      0: computeChannelIdentityKey('meshtastic', '', psk),
      1: computeChannelIdentityKey('meshtastic', 'Ops', SECRET),
    });
  });
});

describe('resolveChannelKeyForPersist', () => {
  it('returns null for DMs/rooms and when no live map exists', () => {
    expect(resolveChannelKeyForPersist('meshcore', {}, -1, RADIO)).toBeNull();
    expect(resolveChannelKeyForPersist('meshcore', {}, 1, RADIO)).toBeNull();
  });

  it('keeps an existing key and otherwise uses the live slot for this radio', () => {
    setLiveChannelKeys('meshcore', { radioNodeId: RADIO, keyByIndex: { 1: KEY_A } });
    expect(
      resolveChannelKeyForPersist('meshcore', { channelKey: 'bbbbbbbbbbbbbbbb' }, 1, RADIO),
    ).toBe('bbbbbbbbbbbbbbbb');
    expect(resolveChannelKeyForPersist('meshcore', {}, 1, RADIO)).toBe(KEY_A);
    expect(resolveChannelKeyForPersist('meshcore', {}, 2, RADIO)).toBeNull();
  });

  it('never stamps another radio’s rows with this radio’s layout', () => {
    setLiveChannelKeys('meshcore', { radioNodeId: RADIO, keyByIndex: { 1: KEY_A } });
    expect(resolveChannelKeyForPersist('meshcore', { radioNodeId: 111 }, 1, RADIO)).toBeNull();
    expect(resolveChannelKeyForPersist('meshcore', {}, 1, 111)).toBeNull();
  });
});

describe('withMeshtasticChannelIdentity', () => {
  it('adds radio + key to broadcast rows and only the radio to DMs', () => {
    setLiveChannelKeys('meshtastic', { radioNodeId: RADIO, keyByIndex: { 1: KEY_A } });
    expect(withMeshtasticChannelIdentity(msg({}))).toMatchObject({
      radioNodeId: RADIO,
      channelKey: KEY_A,
    });
    const dm = withMeshtasticChannelIdentity(msg({ to: 5 }));
    expect(dm.radioNodeId).toBe(RADIO);
    expect(dm.channelKey).toBeUndefined();
  });

  it('returns the same object when nothing is known', () => {
    const m = msg({});
    expect(withMeshtasticChannelIdentity(m)).toBe(m);
  });
});
