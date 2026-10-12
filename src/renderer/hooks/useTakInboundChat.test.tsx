import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type IdentityRecord, useIdentityStore } from '../stores/identityStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';
import { TAK_SEND_ROOMS_RETRY_MS, useTakInboundChat } from './useTakInboundChat';

/** The mocked IPC call the hook reports the room list through. */
const setChatSendRooms = () => vi.mocked(window.electronAPI.tak.setChatSendRooms);

/** A minimal identity record of the given protocol. */
function identity(id: string, type: string): IdentityRecord {
  return { id, protocol: { type }, signature: id, transports: [] } as unknown as IdentityRecord;
}

describe('useTakInboundChat send-room list', () => {
  let unmount: (() => void) | undefined;

  /** Render the hook; it is unmounted after the test, before the stores are reset. */
  function mount(): void {
    ({ unmount } = renderHook(() => {
      useTakInboundChat();
    }));
  }
  beforeEach(() => {
    setChatSendRooms().mockClear();
    useTakSinkStore.setState({ active: false });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useIdentityStore.setState({
      identities: { mc: identity('mc', 'meshcore') },
      activeIdentityId: null,
    });
    const { setChatBridge, setChatSend } = useTakRelayPrefsStore.getState();
    setChatBridge('mc', 2, 'Mesh Ops');
    setChatSend('mc', 2, true);
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    useTakSinkStore.setState({ active: false });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('sends the list when a sink starts and again only when the list changes', () => {
    mount();
    expect(setChatSendRooms()).not.toHaveBeenCalled();

    act(() => {
      useTakSinkStore.setState({ active: true });
    });
    expect(setChatSendRooms()).toHaveBeenLastCalledWith(['Mesh Ops']);
    expect(setChatSendRooms()).toHaveBeenCalledTimes(1);

    // Store updates that leave the room list as it was send nothing.
    act(() => {
      useTakRelayPrefsStore.getState().setTrackerChannel('mc', 1, true);
      useIdentityStore.setState({
        identities: { mc: identity('mc', 'meshcore'), x: identity('x', 'reticulum') },
      });
    });
    expect(setChatSendRooms()).toHaveBeenCalledTimes(1);

    act(() => {
      useTakRelayPrefsStore.getState().setChatSend('mc', 2, false);
    });
    expect(setChatSendRooms()).toHaveBeenLastCalledWith([]);
    expect(setChatSendRooms()).toHaveBeenCalledTimes(2);
  });

  it('retries a refused update until it lands', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setChatSendRooms()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValue(undefined);
      useTakSinkStore.setState({ active: true });
      mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(setChatSendRooms()).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatSendRooms()).toHaveBeenCalledTimes(2);

      // The wait doubles after each refusal.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatSendRooms()).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatSendRooms()).toHaveBeenCalledTimes(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * TAK_SEND_ROOMS_RETRY_MS);
      });
      expect(setChatSendRooms()).toHaveBeenCalledTimes(3);
      expect(setChatSendRooms()).toHaveBeenLastCalledWith(['Mesh Ops']);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops retrying an old list once a newer one replaces it', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setChatSendRooms()
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
      expect(setChatSendRooms().mock.calls.map((c) => c[0])).toEqual([['Mesh Ops'], []]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
