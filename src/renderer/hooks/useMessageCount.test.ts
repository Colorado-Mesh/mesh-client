import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { OFFLINE_MESHTASTIC_IDENTITY_ID } from '../lib/offlineProtocolIdentities';
import { addMessage, useMessageStore } from '../stores/messageStore';
import { useMessageCount } from './useMessageCount';

describe('useMessageCount', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('returns the per-identity message count', () => {
    const { result } = renderHook(() => useMessageCount(OFFLINE_MESHTASTIC_IDENTITY_ID));
    expect(result.current).toBe(0);
    act(() => {
      addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
        id: '1',
        from: 1,
        to: 0,
        payload: 'a',
        channelIndex: 0,
        timestamp: 1,
        status: 'acked',
      });
    });
    expect(result.current).toBe(1);
  });
});
