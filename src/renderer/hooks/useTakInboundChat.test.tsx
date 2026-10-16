import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeChannelIdentityKey } from '@/shared/channelIdentityKey';
import type { TakChatChannel } from '@/shared/tak-types';

import { getTakChannels, useTakChannelStore } from '../stores/takChannelStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';
import {
  TAK_SEND_ROOMS_RETRY_MS,
  type TakChannelSources,
  useTakInboundChat,
} from './useTakInboundChat';

/** The mocked IPC call the hook reports the served channels through. */
const setChatChannels = () => vi.mocked(window.electronAPI.tak.setChatChannels);

const PUBLIC = Uint8Array.from('8b3387e9c5cdea6ac9e5edbaa115cd72'.match(/../g) ?? [], (b) =>
  parseInt(b, 16),
);
const PRIVATE = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const MESHCORE_CHANNELS = [
  { index: 0, name: 'Public', secret: PUBLIC },
  { index: 2, name: 'Ops', secret: PRIVATE },
];
const OPS: TakChatChannel = {
  key: computeChannelIdentityKey('meshcore', 'Ops', PRIVATE),
  name: '#MC \u{1F512} Ops',
  send: true,
  remote: false,
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
    useTakSinkStore.setState({ active: false });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakChannelStore.setState({ channelsByIdentity: {} });
    const { setChannelMode, setChatChannel, setChatSend } = useTakRelayPrefsStore.getState();
    setChannelMode('mc', 'selected');
    setChatChannel('mc', 2, true);
    setChatSend('mc', 2, true);
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
      useTakRelayPrefsStore.getState().setChatSend('mc', 0, true);
      rerender?.(sources([...MESHCORE_CHANNELS]));
    });
    expect(setChatChannels()).toHaveBeenCalledTimes(1);

    act(() => {
      useTakRelayPrefsStore.getState().setChatSend('mc', 2, false);
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
        useTakRelayPrefsStore.getState().setChatSend('mc', 2, false);
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
});
