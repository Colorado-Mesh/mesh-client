import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '../../stores/liveChannelKeyStore';
import { resolveChannelTargetIndex } from './resolveChannelTarget';

beforeEach(() => {
  resetLiveChannelKeyStoreForTests();
});

describe('resolveChannelTargetIndex', () => {
  it('resolves by channelKey when slots reorder', () => {
    setLiveChannelKeys('meshtastic', {
      radioNodeId: 1,
      keyByIndex: { 3: 'aabb', 0: 'ccdd' },
    });
    expect(
      resolveChannelTargetIndex({
        kind: 'meshtastic-channel',
        channelIndex: 0,
        channelKey: 'aabb',
      }),
    ).toEqual({ ok: true, channelIndex: 3 });
  });

  it('returns channel-missing when key is absent on the live radio', () => {
    setLiveChannelKeys('meshcore', {
      radioNodeId: 2,
      keyByIndex: { 0: 'only' },
    });
    expect(
      resolveChannelTargetIndex({
        kind: 'meshcore-channel',
        channelIndex: 1,
        channelKey: 'gone',
      }),
    ).toEqual({ ok: false, reason: 'channel-missing' });
  });

  it('falls back to channelIndex for legacy targets when the slot still exists', () => {
    setLiveChannelKeys('meshtastic', {
      radioNodeId: 1,
      keyByIndex: { 2: 'xx' },
    });
    expect(
      resolveChannelTargetIndex({
        kind: 'meshtastic-channel',
        channelIndex: 2,
      }),
    ).toEqual({ ok: true, channelIndex: 2 });
  });

  it('marks legacy index-only targets missing when the slot left the live map', () => {
    setLiveChannelKeys('meshtastic', {
      radioNodeId: 1,
      keyByIndex: { 0: 'primary' },
    });
    expect(
      resolveChannelTargetIndex({
        kind: 'meshtastic-channel',
        channelIndex: 5,
      }),
    ).toEqual({ ok: false, reason: 'channel-missing' });
  });
});
