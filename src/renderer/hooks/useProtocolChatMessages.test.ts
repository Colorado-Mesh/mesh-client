import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { OFFLINE_MESHTASTIC_IDENTITY_ID } from '../lib/offlineProtocolIdentities';
import { addMessage, useMessageStore } from '../stores/messageStore';
import { useProtocolChatMessages } from './useProtocolChatMessages';

describe('useProtocolChatMessages', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('maps store records to ChatMessage for Meshtastic', () => {
    addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: '11',
      from: 2,
      senderName: 'A',
      to: 0,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 100,
      status: 'acked',
    });
    const { result } = renderHook(() =>
      useProtocolChatMessages('meshtastic', OFFLINE_MESHTASTIC_IDENTITY_ID),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.payload).toBe('hello');
    expect(result.current[0]?.packetId).toBe(11);
  });
});
