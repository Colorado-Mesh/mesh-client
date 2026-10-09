import { afterEach, describe, expect, it } from 'vitest';

import { getTakRelayPrefs, useTakRelayPrefsStore } from './takRelayPrefsStore';

afterEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  localStorage.removeItem('mesh-client:takRelayPrefs');
});

describe('takRelayPrefsStore', () => {
  it('keeps tracker channels per identity, sorted and unique', () => {
    const { setTrackerChannel } = useTakRelayPrefsStore.getState();
    setTrackerChannel('a', 3, true);
    setTrackerChannel('a', 1, true);
    setTrackerChannel('a', 3, true);
    setTrackerChannel('b', 2, true);
    expect(getTakRelayPrefs('a').trackerChannels).toEqual([1, 3]);
    expect(getTakRelayPrefs('b').trackerChannels).toEqual([2]);
    setTrackerChannel('a', 1, false);
    expect(getTakRelayPrefs('a').trackerChannels).toEqual([3]);
  });

  it('sets, trims, and removes chat bridges', () => {
    const { setChatBridge } = useTakRelayPrefsStore.getState();
    setChatBridge('a', 0, '  Mesh Ops  ');
    expect(getTakRelayPrefs('a').chatBridges).toEqual({ 0: 'Mesh Ops' });
    setChatBridge('a', 0, ' ');
    expect(getTakRelayPrefs('a').chatBridges).toEqual({});
  });

  it('ignores invalid channel indices', () => {
    useTakRelayPrefsStore.getState().setTrackerChannel('a', -1, true);
    useTakRelayPrefsStore.getState().setChatBridge('a', 300, 'x');
    expect(getTakRelayPrefs('a')).toEqual({ trackerChannels: [], chatBridges: {} });
  });

  it('sanitizes malformed persisted state on rehydrate', async () => {
    localStorage.setItem(
      'mesh-client:takRelayPrefs',
      JSON.stringify({
        state: {
          byIdentity: {
            a: { trackerChannels: [1, 'x', 1, 999], chatBridges: { 2: ' Room ', bad: 'x', 3: 7 } },
            b: 'nope',
          },
        },
        version: 1,
      }),
    );
    await useTakRelayPrefsStore.persist.rehydrate();
    expect(useTakRelayPrefsStore.getState().byIdentity).toEqual({
      a: { trackerChannels: [1], chatBridges: { 2: 'Room' } },
    });
  });
});
