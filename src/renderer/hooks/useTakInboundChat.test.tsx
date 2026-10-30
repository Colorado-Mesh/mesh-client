import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeChannelIdentityKey } from '@/shared/channelIdentityKey';
import type { TakChatChannel } from '@/shared/tak-types';

import type { EmergencyIncident } from '../lib/mecp/incidentTypes';
import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
} from '../lib/reticulum/destHash';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { useIncidentStore } from '../stores/incidentStore';
import { addMessage, useMessageStore } from '../stores/messageStore';
import { getTakChannels, getTakRadio, useTakChannelStore } from '../stores/takChannelStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';
import {
  TAK_SEND_ROOMS_RETRY_MS,
  type TakChannelSources,
  useTakInboundChat,
} from './useTakInboundChat';

/** The mocked IPC call the hook reports the served channels through. */
const setChatChannels = () => vi.mocked(window.electronAPI.tak.setChatChannels);
const setIncidentMarkers = () => vi.mocked(window.electronAPI.tak.setIncidentMarkers);
const setDirectMessaging = () => vi.mocked(window.electronAPI.tak.setDirectMessaging);
const setDirectPeers = () => vi.mocked(window.electronAPI.tak.setDirectPeers);

const PUBLIC = Uint8Array.from('8b3387e9c5cdea6ac9e5edbaa115cd72'.match(/../g) ?? [], (b) =>
  parseInt(b, 16),
);
const PRIVATE = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const MESHCORE_CHANNELS = [
  { index: 0, name: 'Public', secret: PUBLIC },
  { index: 2, name: 'Ops', secret: PRIVATE },
];
const PUBLIC_KEY = computeChannelIdentityKey('meshcore', 'Public', PUBLIC);
const OPS: TakChatChannel = {
  key: computeChannelIdentityKey('meshcore', 'Ops', PRIVATE),
  name: '#MC \u{1F512} Ops',
  send: true,
  remote: false,
  protocol: 'meshcore',
};

describe('useTakInboundChat', () => {
  let unmount: (() => void) | undefined;
  let rerender: ((sources: TakChannelSources) => void) | undefined;

  const sources = (meshcore: readonly unknown[] = MESHCORE_CHANNELS): TakChannelSources => ({
    meshcore: { identityId: 'mc', channels: meshcore },
    meshtastic: { identityId: null, channelConfigs: [] },
  });

  /** Render the hook; it is unmounted after the test, before the stores are reset. */
  function mount(initial: TakChannelSources = sources()): void {
    ({ unmount, rerender } = renderHook(
      (props: TakChannelSources) => {
        useTakInboundChat(props);
      },
      { initialProps: initial },
    ));
  }

  beforeEach(() => {
    setChatChannels().mockClear();
    setDirectMessaging().mockClear();
    setDirectPeers().mockClear();
    useTakSinkStore.setState({ active: false });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakChannelStore.setState({ channelsByIdentity: {} });
    const { setChannelMode, setChatChannel, setChatSend } = useTakRelayPrefsStore.getState();
    setChannelMode('mc', 'selected');
    setChatChannel('mc', OPS.key, true);
    setChatSend('mc', OPS.key, true);
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    useTakSinkStore.setState({ active: false });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakChannelStore.setState({ channelsByIdentity: {} });
  });

  it("publishes each radio's channels with their ATAK names", () => {
    mount();
    expect(getTakChannels('mc').map((c) => [c.index, c.atakName])).toEqual([
      [0, '#MC Public'],
      [2, '#MC \u{1F512} Ops'],
    ]);
    act(() => {
      rerender?.(sources([MESHCORE_CHANNELS[0]]));
    });
    expect(getTakChannels('mc').map((c) => c.index)).toEqual([0]);
  });

  it('records the radio TAK uses for each protocol', () => {
    mount();
    expect(getTakRadio('meshcore')).toBe('mc');
    expect(getTakRadio('meshtastic')).toBeUndefined();
    act(() => {
      rerender?.({ ...sources(), meshtastic: { identityId: 'mt', channelConfigs: [] } });
    });
    expect(getTakRadio('meshtastic')).toBe('mt');
  });

  it('tells main which LXMF peers have a conversation, once Reticulum takes direct messages', () => {
    clearReticulumHashRegistry();
    registerReticulumDestinationHash(789, 'ab'.repeat(16));
    useMessageStore.setState({ messages: {} });
    useConnectionStore.setState({ connections: {} });
    setConnection('rn', { myNodeNum: 3 });
    addMessage('rn', { id: 'a', from: 789, to: 3, payload: 'hi', channelIndex: 0, timestamp: 1 });
    mount({ ...sources(), reticulum: { identityId: 'rn' } });
    expect(getTakRadio('reticulum')).toBe('rn');
    act(() => {
      useTakSinkStore.setState({ active: true });
    });
    // Off by default: no peers go to ATAK.
    expect(setDirectPeers()).toHaveBeenLastCalledWith([]);
    act(() => {
      useTakRelayPrefsStore.getState().setDirectMessages('rn', true);
    });
    expect(setDirectMessaging()).toHaveBeenLastCalledWith(['reticulum']);
    expect(setDirectPeers()).toHaveBeenLastCalledWith([
      { protocol: 'reticulum', nodeId: 789, callsign: '789' },
    ]);
    // A conversation with another peer adds it.
    registerReticulumDestinationHash(790, 'cd'.repeat(16));
    act(() => {
      addMessage('rn', { id: 'b', from: 3, to: 790, payload: 'yo', channelIndex: 0, timestamp: 2 });
    });
    expect(setDirectPeers().mock.lastCall?.[0].map((p) => p.nodeId)).toEqual([790, 789]);
    useMessageStore.setState({ messages: {} });
    useConnectionStore.setState({ connections: {} });
    clearReticulumHashRegistry();
  });

  it('tells main which radios take direct messages, when a sink starts and when it changes', () => {
    mount();
    expect(setDirectMessaging()).not.toHaveBeenCalled();
    act(() => {
      useTakSinkStore.setState({ active: true });
    });
    expect(setDirectMessaging()).toHaveBeenLastCalledWith([]);
    act(() => {
      useTakRelayPrefsStore.getState().setDirectMessages('mc', true);
    });
    expect(setDirectMessaging()).toHaveBeenLastCalledWith(['meshcore']);
    // A change elsewhere in the settings sends nothing new.
    act(() => {
      useTakRelayPrefsStore.getState().setChatRemote('mc', OPS.key, true);
    });
    expect(setDirectMessaging()).toHaveBeenCalledTimes(2);
  });

  it("binds settings saved by slot to the radio's channels as it reports them", () => {
    useTakRelayPrefsStore.setState({
      byIdentity: {
        mc: {
          trackerChannels: [],
          channelMode: 'selected',
          chatChannels: [],
          sendChannels: [],
          remoteChannels: [],
          noCallsignChannels: [],
          atakNames: {},
          directMessages: false,
          pendingSlots: {
            chatChannels: [2],
            sendChannels: [2],
            remoteChannels: [],
            atakNames: { 2: 'Ops' },
          },
        },
      },
    });
    // The radio has not loaded its channels yet: nothing binds.
    mount(sources([]));
    expect(useTakRelayPrefsStore.getState().byIdentity.mc?.pendingSlots).toBeDefined();
    act(() => {
      rerender?.(sources());
    });
    expect(useTakRelayPrefsStore.getState().byIdentity.mc).toMatchObject({
      chatChannels: [OPS.key],
      sendChannels: [OPS.key],
      atakNames: { [OPS.key]: 'Ops' },
    });
    expect(useTakRelayPrefsStore.getState().byIdentity.mc?.pendingSlots).toBeUndefined();
  });

  it("tells main to drop the previous version's room contacts while a sink is up", () => {
    const retire = vi.mocked(window.electronAPI.tak.retireChatRooms);
    retire.mockClear();
    useTakRelayPrefsStore.setState({
      retiredRooms: { rooms: ['Ops'], untilMs: Date.now() + 60_000 },
    });
    mount();
    expect(retire).not.toHaveBeenCalled();
    act(() => {
      useTakSinkStore.setState({ active: true });
    });
    expect(retire).toHaveBeenCalledExactlyOnceWith(['Ops']);
    useTakRelayPrefsStore.setState({ retiredRooms: null });
  });

  it('sends the served list when a sink starts and again only when it changes', () => {
    mount();
    expect(setChatChannels()).not.toHaveBeenCalled();

    act(() => {
      useTakSinkStore.setState({ active: true });
    });
    expect(setChatChannels()).toHaveBeenLastCalledWith([OPS]);
    expect(setChatChannels()).toHaveBeenCalledTimes(1);

    // Store updates that leave the served list as it was send nothing.
    act(() => {
      useTakRelayPrefsStore.getState().setTrackerChannel('mc', 1, true);
      useTakRelayPrefsStore.getState().setChatSend('mc', PUBLIC_KEY, true);
      rerender?.(sources([...MESHCORE_CHANNELS]));
    });
    expect(setChatChannels()).toHaveBeenCalledTimes(1);

    act(() => {
      useTakRelayPrefsStore.getState().setChatSend('mc', OPS.key, false);
    });
    expect(setChatChannels()).toHaveBeenLastCalledWith([{ ...OPS, send: false }]);
    act(() => {
      useTakRelayPrefsStore.getState().setChannelMode('mc', 'off');
    });
    expect(setChatChannels()).toHaveBeenLastCalledWith([]);
    expect(setChatChannels()).toHaveBeenCalledTimes(3);
  });

  it('retries a refused update until it lands', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setChatChannels()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValue(undefined);
      useTakSinkStore.setState({ active: true });
      mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(setChatChannels()).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatChannels()).toHaveBeenCalledTimes(2);

      // The wait doubles after each refusal.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatChannels()).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatChannels()).toHaveBeenCalledTimes(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatChannels()).toHaveBeenCalledTimes(3);
      expect(setChatChannels()).toHaveBeenLastCalledWith([OPS]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops retrying an old list once a newer one replaces it', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setChatChannels()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValue(undefined);
      useTakSinkStore.setState({ active: true });
      mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        useTakRelayPrefsStore.getState().setChatSend('mc', OPS.key, false);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatChannels().mock.calls.map((c) => c[0])).toEqual([
        [OPS],
        [{ ...OPS, send: false }],
      ]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
  it('keeps main told the open MECP incidents with a position, while a sink is up', async () => {
    const incident: EmergencyIncident = {
      id: 'mecp-abc',
      protocol: 'meshcore',
      protocolsSeen: ['meshcore'],
      severity: 0,
      codes: ['M01'],
      freetext: '',
      senderId: '1',
      senderName: 'Alice',
      channel: '0',
      receivedAt: 1_800_000_000_000,
      lastSeenAt: 1_800_000_000_000,
      lat: 39.7,
      lon: -105.1,
      coordsSource: 'message',
      messageIds: [],
      ackCount: 0,
      ackPeerIds: [],
      beaconActive: false,
      beaconAcked: false,
      isDrill: false,
      status: 'open',
    };
    setIncidentMarkers().mockClear();
    useIncidentStore.setState({ incidents: { [incident.id]: incident } });
    try {
      mount();
      expect(setIncidentMarkers()).not.toHaveBeenCalled();
      await act(async () => {
        useTakSinkStore.setState({ active: true });
        await Promise.resolve();
      });
      expect(setIncidentMarkers().mock.lastCall?.[0].map((m) => m.callsign)).toEqual([
        '🆘 MAYDAY Alice',
      ]);
      act(() => {
        useIncidentStore.setState({
          incidents: { [incident.id]: { ...incident, status: 'resolved' } },
        });
      });
      expect(setIncidentMarkers().mock.lastCall?.[0]).toEqual([]);
    } finally {
      useIncidentStore.setState({ incidents: {} });
    }
  });
});
