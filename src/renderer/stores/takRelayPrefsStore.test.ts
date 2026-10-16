import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bindTakPendingSlots,
  getTakRelayPrefs,
  getTakRetiredRooms,
  useTakRelayPrefsStore,
} from './takRelayPrefsStore';

afterEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {}, retiredRooms: null });
  localStorage.removeItem('mesh-client:takRelayPrefs');
  vi.useRealTimers();
});

const EMPTY = {
  trackerChannels: [],
  channelMode: 'off',
  chatChannels: [],
  sendChannels: [],
  remoteChannels: [],
  atakNames: {},
};

const PUBLIC = '0123456789abcdef';
const OPS = 'fedcba9876543210';
const SAR = 'aaaaaaaaaaaaaaaa';

async function rehydrate(state: Record<string, unknown>, version: number): Promise<void> {
  localStorage.setItem('mesh-client:takRelayPrefs', JSON.stringify({ state, version }));
  await useTakRelayPrefsStore.persist.rehydrate();
}

describe('takRelayPrefsStore', () => {
  it('starts every radio with channels off', () => {
    expect(getTakRelayPrefs('a')).toEqual(EMPTY);
  });

  it('keeps tracker slots per identity, sorted and unique', () => {
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
    expect(getTakRelayPrefs('a').channelMode).toBe('selected');
    setChannelMode('a', 'sometimes' as never);
    expect(getTakRelayPrefs('a').channelMode).toBe('selected');
  });

  it('keeps selected, send and remote channels apart, by channel key', () => {
    const { setChatChannel, setChatSend, setChatRemote } = useTakRelayPrefsStore.getState();
    setChatChannel('a', OPS, true);
    setChatChannel('a', PUBLIC, true);
    setChatSend('a', OPS, true);
    setChatSend('a', OPS, true);
    setChatRemote('a', PUBLIC, true);
    expect(getTakRelayPrefs('a')).toMatchObject({
      chatChannels: [OPS, PUBLIC],
      sendChannels: [OPS],
      remoteChannels: [PUBLIC],
    });
    setChatChannel('a', PUBLIC, false);
    setChatSend('a', OPS, false);
    expect(getTakRelayPrefs('a')).toMatchObject({
      chatChannels: [OPS],
      sendChannels: [],
      remoteChannels: [PUBLIC],
    });
  });

  it('ignores invalid tracker slots and channel keys', () => {
    const state = useTakRelayPrefsStore.getState();
    state.setTrackerChannel('a', -1, true);
    state.setChatChannel('a', 'Ops', true);
    state.setChatSend('a', '2', true);
    state.setChatRemote('a', PUBLIC.toUpperCase(), true);
    state.setAtakName('a', 'nope', 'Ops');
    expect(getTakRelayPrefs('a')).toEqual(EMPTY);
  });

  it('names a channel for ATAK, back to automatic when blanked, ignoring names main refuses', () => {
    const { setAtakName } = useTakRelayPrefsStore.getState();
    setAtakName('a', OPS, '  Ops Net ');
    expect(getTakRelayPrefs('a').atakNames).toEqual({ [OPS]: 'Ops Net' });
    const before = useTakRelayPrefsStore.getState().byIdentity;
    setAtakName('a', OPS, 'Ops Net');
    expect(useTakRelayPrefsStore.getState().byIdentity).toBe(before);
    setAtakName('a', OPS, 'x'.repeat(65));
    setAtakName('a', OPS, 'two\nlines');
    expect(getTakRelayPrefs('a').atakNames).toEqual({ [OPS]: 'Ops Net' });
    setAtakName('a', OPS, '   ');
    expect(getTakRelayPrefs('a').atakNames).toEqual({});
  });

  it('round-trips version 3 settings', async () => {
    const saved = {
      trackerChannels: [1],
      channelMode: 'selected',
      chatChannels: [PUBLIC, OPS],
      sendChannels: [OPS],
      remoteChannels: [PUBLIC],
      atakNames: { [OPS]: 'Ops Net' },
    };
    await rehydrate({ byIdentity: { a: saved } }, 3);
    expect(getTakRelayPrefs('a')).toEqual(saved);
  });

  it('sanitizes malformed settings', async () => {
    await rehydrate(
      {
        byIdentity: {
          a: {
            trackerChannels: [1, 'x', 1, 999],
            channelMode: 'sometimes',
            chatChannels: [OPS, OPS, 'Ops'],
            sendChannels: 'all',
            remoteChannels: [PUBLIC],
            atakNames: { [OPS]: ' Ops ', [PUBLIC]: '', [SAR]: 'two\nlines', x: 'X' },
          },
          b: 'nope',
        },
      },
      3,
    );
    expect(useTakRelayPrefsStore.getState().byIdentity).toEqual({
      a: {
        trackerChannels: [1],
        channelMode: 'off',
        chatChannels: [OPS],
        sendChannels: [],
        remoteChannels: [PUBLIC],
        atakNames: { [OPS]: 'Ops' },
      },
    });
  });

  it('holds settings an earlier build saved by slot until the channels are known', async () => {
    await rehydrate(
      {
        byIdentity: {
          a: {
            trackerChannels: [],
            channelMode: 'selected',
            chatChannels: [0, 2],
            sendChannels: [2],
            remoteChannels: [0],
            atakNames: { 2: 'Ops Net' },
          },
        },
      },
      2,
    );
    expect(getTakRelayPrefs('a')).toEqual({
      ...EMPTY,
      channelMode: 'selected',
      pendingSlots: {
        chatChannels: [0, 2],
        sendChannels: [2],
        remoteChannels: [0],
        atakNames: { 2: 'Ops Net' },
      },
    });
  });

  describe('binding settings saved by slot', () => {
    function pending(): void {
      useTakRelayPrefsStore.setState({
        byIdentity: {
          a: {
            ...EMPTY,
            channelMode: 'selected',
            atakNames: { [SAR]: 'Chosen since' },
            pendingSlots: {
              chatChannels: [0, 2, 5],
              sendChannels: [2],
              remoteChannels: [0, 5],
              atakNames: { 2: 'Ops room', 5: 'Later' },
            },
          },
        },
      });
    }

    it('gives each slot its settings to the channel in it, keeping slots not yet reported', () => {
      pending();
      bindTakPendingSlots('a', [
        { index: 0, key: PUBLIC },
        { index: 2, key: OPS },
      ]);
      expect(getTakRelayPrefs('a')).toEqual({
        ...EMPTY,
        channelMode: 'selected',
        chatChannels: [PUBLIC, OPS],
        sendChannels: [OPS],
        remoteChannels: [PUBLIC],
        atakNames: { [OPS]: 'Ops room', [SAR]: 'Chosen since' },
        pendingSlots: {
          chatChannels: [5],
          sendChannels: [],
          remoteChannels: [5],
          atakNames: { 5: 'Later' },
        },
      });
      // The rest binds when its channel is reported; a name the user chose wins.
      bindTakPendingSlots('a', [{ index: 5, key: SAR }]);
      expect(getTakRelayPrefs('a')).toMatchObject({
        chatChannels: [PUBLIC, OPS, SAR],
        remoteChannels: [PUBLIC, SAR],
        atakNames: { [OPS]: 'Ops room', [SAR]: 'Chosen since' },
      });
      expect(getTakRelayPrefs('a').pendingSlots).toBeUndefined();
    });

    it('does nothing for an empty list, which a radio reports before its channels load', () => {
      pending();
      const before = useTakRelayPrefsStore.getState().byIdentity;
      bindTakPendingSlots('a', []);
      bindTakPendingSlots('a', [{ index: 7, key: PUBLIC }]);
      expect(useTakRelayPrefsStore.getState().byIdentity).toBe(before);
    });

    it('never moves a bound setting to the next channel in that slot', () => {
      pending();
      bindTakPendingSlots('a', [{ index: 2, key: OPS }]);
      bindTakPendingSlots('a', [{ index: 2, key: SAR }]);
      expect(getTakRelayPrefs('a').sendChannels).toEqual([OPS]);
    });
  });

  describe('from version 1', () => {
    it('serves each bridged channel, keeping its send setting, remote stream and room name', async () => {
      await rehydrate(
        {
          byIdentity: {
            a: {
              trackerChannels: [5],
              chatBridges: { 0: 'Public', 2: ' Ops ', 3: ' ' },
              chatSendChannels: [2, 2, 4, 'x'],
            },
          },
        },
        1,
      );
      expect(getTakRelayPrefs('a')).toEqual({
        ...EMPTY,
        trackerChannels: [5],
        channelMode: 'selected',
        pendingSlots: {
          chatChannels: [0, 2],
          sendChannels: [2],
          remoteChannels: [0, 2],
          atakNames: { 0: 'Public', 2: 'Ops' },
        },
      });
      // Bound to the channels, the room names become their ATAK names, so the remote
      // server's rooms keep their names.
      bindTakPendingSlots('a', [
        { index: 0, key: PUBLIC },
        { index: 2, key: OPS },
      ]);
      expect(getTakRelayPrefs('a').atakNames).toEqual({ [PUBLIC]: 'Public', [OPS]: 'Ops' });
    });

    it('retires the room contacts it announced, those open for sending, for a day', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse('2026-10-16T12:00:00Z'));
      await rehydrate(
        { byIdentity: { a: { chatBridges: { 0: 'Public', 2: 'Ops' }, chatSendChannels: [2] } } },
        1,
      );
      expect(getTakRetiredRooms()).toEqual(['Ops']);
      expect(getTakRetiredRooms(Date.now() + 24 * 60 * 60 * 1000)).toEqual([]);

      // Stored once, they are not renewed by reading the settings again.
      const stored = useTakRelayPrefsStore.getState().retiredRooms;
      await rehydrate({ byIdentity: {}, retiredRooms: stored }, 3);
      expect(useTakRelayPrefsStore.getState().retiredRooms).toEqual(stored);
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
      await rehydrate({ byIdentity: {}, retiredRooms: stored }, 3);
      expect(useTakRelayPrefsStore.getState().retiredRooms).toBeNull();
    });

    it('leaves a radio with no bridged channel off, keeping its tracker channels', async () => {
      await rehydrate(
        { byIdentity: { a: { trackerChannels: [1], chatBridges: {}, chatSendChannels: [] } } },
        1,
      );
      expect(getTakRelayPrefs('a')).toEqual({ ...EMPTY, trackerChannels: [1] });
      expect(getTakRetiredRooms()).toEqual([]);
    });

    it('drops malformed bridges', async () => {
      await rehydrate({ byIdentity: { a: { chatBridges: { bad: 'x', 3: 7, 300: 'Big' } } } }, 1);
      expect(getTakRelayPrefs('a')).toEqual(EMPTY);
    });
  });
});
