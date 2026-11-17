import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { OFFLINE_MESHTASTIC_IDENTITY_ID } from '../lib/offlineProtocolIdentities';
import { addMessage, updateMessageStatus, useMessageStore } from '../stores/messageStore';
import { useHasLocalSendingMessage, useHasSendingMessage } from './useHasSendingMessage';

describe('useHasSendingMessage', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('tracks sending boolean without exposing the message list', () => {
    const { result } = renderHook(() =>
      useHasSendingMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, 1, true),
    );
    expect(result.current).toBe(false);
    act(() => {
      addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
        id: 's1',
        from: 1,
        to: 0,
        payload: 'x',
        channelIndex: 0,
        timestamp: Date.now(),
        status: 'sending',
      });
    });
    expect(result.current).toBe(true);
    act(() => {
      updateMessageStatus(OFFLINE_MESHTASTIC_IDENTITY_ID, 's1', 'acked');
    });
    expect(result.current).toBe(false);
  });

  it('respects the sending time window', () => {
    const now = 1_700_000_060_000;
    addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: 's2',
      from: 1,
      to: 0,
      payload: 'x',
      channelIndex: 0,
      timestamp: now - 60_000,
      status: 'sending',
    });
    const { result } = renderHook(() =>
      useHasLocalSendingMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, 1, now, 30_000, true),
    );
    expect(result.current).toBe(false);
  });
});
