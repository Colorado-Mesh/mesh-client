import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

vi.mock('@/renderer/stores/messageStore', () => ({
  updateMessageStatus: vi.fn(),
}));

import {
  applyMeshtasticOutboundRoutingErrorFromLog,
  chatRoutingErrorKeyForSdkErrorName,
  parseMeshtasticSdkRoutingErrorLog,
} from './meshtasticSdkRoutingErrorLog';

describe('meshtasticSdkRoutingErrorLog', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        db: { updateMessageStatus: vi.fn().mockResolvedValue(undefined) },
      },
    });
  });
  it('parses SDK routing error log lines', () => {
    expect(
      parseMeshtasticSdkRoutingErrorLog(
        'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      ),
    ).toEqual({
      packetId: 669520633,
      errorName: 'PKI_SEND_FAIL_PUBLIC_KEY',
    });
  });

  it('maps PKI send failures to chat i18n keys', () => {
    expect(chatRoutingErrorKeyForSdkErrorName('PKI_SEND_FAIL_PUBLIC_KEY')).toBe(
      'chatPanel.routingErrors.pkiMissingRecipientKey',
    );
  });

  it('marks matching outbound message failed', () => {
    const messagesRef = {
      current: [
        {
          id: 1,
          sender_id: 42,
          sender_name: 'Me',
          packetId: 669520633,
          payload: 'hello',
          status: 'acked' as const,
          channel: 0,
          timestamp: 1,
        },
      ],
    };
    const setMessages = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      {
        myNodeNum: 42,
        identityId: 'id-1',
        messagesRef,
        setMessages,
      },
    );
    expect(applied).toBe(true);
    expect(setMessages).toHaveBeenCalledTimes(1);
  });
});
