import { afterEach, describe, expect, it } from 'vitest';

import { getTakRelayPrefs, useTakRelayPrefsStore } from './takRelayPrefsStore';

afterEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  localStorage.removeItem('mesh-client:takRelayPrefs');
});

const EMPTY = {
  trackerChannels: [],
  channelMode: 'off',
  chatChannels: [],
  sendChannels: [],
  remoteChannels: [],
};

async function rehydrate(byIdentity: unknown, version: number): Promise<void> {
  localStorage.setItem(
    'mesh-client:takRelayPrefs',
    JSON.stringify({ state: { byIdentity }, version }),
  );
  await useTakRelayPrefsStore.persist.rehydrate();
}

describe('takRelayPrefsStore', () => {
  it('starts every radio with channels off', () => {
    expect(getTakRelayPrefs('a')).toEqual(EMPTY);
  });

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

  it('sets the channel mode per radio and ignores an unknown one', () => {
    const { setChannelMode } = useTakRelayPrefsStore.getState();
    setChannelMode('a', 'selected');
    setChannelMode('b', 'all');
    expect(getTakRelayPrefs('a').channelMode).toBe('selected');
    expect(getTakRelayPrefs('b').channelMode).toBe('all');
    setChannelMode('a', 'everything' as never);
    expect(getTakRelayPrefs('a').channelMode).toBe('selected');
  });

  it('keeps selected, send and remote channels apart, sorted and unique', () => {
    const { setChatChannel, setChatSend, setChatRemote } = useTakRelayPrefsStore.getState();
    setChatChannel('a', 4, true);
    setChatChannel('a', 0, true);
    setChatSend('a', 4, true);
    setChatSend('a', 4, true);
    setChatRemote('a', 0, true);
    expect(getTakRelayPrefs('a')).toMatchObject({
      chatChannels: [0, 4],
      sendChannels: [4],
      remoteChannels: [0],
    });
    setChatChannel('a', 0, false);
    setChatSend('a', 4, false);
    expect(getTakRelayPrefs('a')).toMatchObject({
      chatChannels: [4],
      sendChannels: [],
      remoteChannels: [0],
    });
  });

  it('ignores invalid channel indices', () => {
    const state = useTakRelayPrefsStore.getState();
    state.setTrackerChannel('a', -1, true);
    state.setChatChannel('a', 300, true);
    state.setChatSend('a', 1.5, true);
    state.setChatRemote('a', Number.NaN, true);
    expect(getTakRelayPrefs('a')).toEqual(EMPTY);
  });

  it('round-trips version 2 settings', async () => {
    const saved = {
      trackerChannels: [1],
      channelMode: 'selected',
      chatChannels: [0, 2],
      sendChannels: [2],
      remoteChannels: [0],
    };
    await rehydrate({ a: saved }, 2);
    expect(getTakRelayPrefs('a')).toEqual(saved);
  });

  it('sanitizes malformed version 2 settings', async () => {
    await rehydrate(
      {
        a: {
          trackerChannels: [1, 'x', 1, 999],
          channelMode: 'sometimes',
          chatChannels: [3, 3, -1],
          sendChannels: 'all',
          remoteChannels: [2],
        },
        b: 'nope',
      },
      2,
    );
    expect(useTakRelayPrefsStore.getState().byIdentity).toEqual({
      a: {
        trackerChannels: [1],
        channelMode: 'off',
        chatChannels: [3],
        sendChannels: [],
        remoteChannels: [2],
      },
    });
  });

  describe('from version 1', () => {
    it('serves each bridged channel, keeps its send setting and streams it to the remote server', async () => {
      await rehydrate(
        {
          a: {
            trackerChannels: [5],
            chatBridges: { 0: 'Public', 2: ' Ops ', 3: ' ' },
            chatSendChannels: [2, 2, 4, 'x'],
          },
        },
        1,
      );
      expect(getTakRelayPrefs('a')).toEqual({
        trackerChannels: [5],
        channelMode: 'selected',
        chatChannels: [0, 2],
        sendChannels: [2],
        remoteChannels: [0, 2],
      });
    });

    it('leaves a radio with no bridged channel off, keeping its tracker channels', async () => {
      await rehydrate({ a: { trackerChannels: [1], chatBridges: {}, chatSendChannels: [] } }, 1);
      expect(getTakRelayPrefs('a')).toEqual({ ...EMPTY, trackerChannels: [1] });
    });

    it('drops malformed bridges', async () => {
      await rehydrate({ a: { chatBridges: { bad: 'x', 3: 7, 300: 'Big' } } }, 1);
      expect(getTakRelayPrefs('a')).toEqual(EMPTY);
    });
  });
});
