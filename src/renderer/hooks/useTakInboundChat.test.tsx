import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type IdentityRecord, useIdentityStore } from '../stores/identityStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';
import { useTakInboundChat } from './useTakInboundChat';

const setChatSendRooms = () => vi.mocked(window.electronAPI.tak.setChatSendRooms);

function identity(id: string, type: string): IdentityRecord {
  return { id, protocol: { type }, signature: id, transports: [] } as unknown as IdentityRecord;
}

describe('useTakInboundChat send-room list', () => {
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
    useTakSinkStore.setState({ active: false });
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('sends the list when a sink starts and again only when the list changes', () => {
    renderHook(() => {
      useTakInboundChat();
    });
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
});
