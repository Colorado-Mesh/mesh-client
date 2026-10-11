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
    expect(getTakRelayPrefs('a')).toEqual({
      trackerChannels: [],
      chatBridges: {},
      chatSendChannels: [],
    });
  });

  it('lets TAK send only to a bridged channel and drops the opt-in with the room', () => {
    const { setChatBridge, setChatSend } = useTakRelayPrefsStore.getState();
    setChatSend('a', 2, true);
    expect(getTakRelayPrefs('a').chatSendChannels).toEqual([]);

    setChatBridge('a', 2, 'Mesh Ops');
    setChatBridge('a', 0, 'Public');
    setChatSend('a', 2, true);
    setChatSend('a', 0, true);
    setChatSend('a', 2, true);
    setChatSend('a', 999, true);
    expect(getTakRelayPrefs('a').chatSendChannels).toEqual([0, 2]);

    setChatSend('a', 0, false);
    expect(getTakRelayPrefs('a').chatSendChannels).toEqual([2]);
    setChatBridge('a', 2, 'Renamed');
    expect(getTakRelayPrefs('a').chatSendChannels).toEqual([2]);
    setChatBridge('a', 2, '');
    expect(getTakRelayPrefs('a').chatSendChannels).toEqual([]);
  });

  it('drops a persisted send opt-in for a channel with no room', async () => {
    localStorage.setItem(
      'mesh-client:takRelayPrefs',
      JSON.stringify({
        state: {
          byIdentity: {
            a: {
              trackerChannels: [],
              chatBridges: { 2: 'Room' },
              chatSendChannels: [2, 2, 5, 'x'],
            },
          },
        },
        version: 1,
      }),
    );
    await useTakRelayPrefsStore.persist.rehydrate();
    expect(getTakRelayPrefs('a').chatSendChannels).toEqual([2]);
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
      a: { trackerChannels: [1], chatBridges: { 2: 'Room' }, chatSendChannels: [] },
    });
  });
});
