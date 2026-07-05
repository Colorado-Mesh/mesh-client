import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

vi.mock('@/renderer/stores/messageStore', () => ({
  updateMessageStatus: vi.fn(),
  useMessageStore: {
    getState: () => ({ messages: {} }),
  },
}));

import { updateMessageStatus } from '@/renderer/stores/messageStore';

import { installMeshtasticSdkRoutingErrorConsoleHook } from './meshtasticSdkRoutingErrorConsoleHook';
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

  it('parses SDK packet timeout log lines', () => {
    expect(parseMeshtasticSdkRoutingErrorLog('Packet 711859058 of type packet timed out')).toEqual({
      packetId: 711859058,
      errorName: 'TIMEOUT',
    });
    expect(parseMeshtasticSdkRoutingErrorLog('Packet 42 of type decoded timed out')).toEqual({
      packetId: 42,
      errorName: 'TIMEOUT',
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
          status: 'sending' as const,
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
    expect(updateMessageStatus).toHaveBeenCalledWith(
      'id-1',
      '669520633',
      'failed',
      'chatPanel.routingErrors.pkiMissingRecipientKey',
    );
  });

  it('matches optimistic temp packet id via tempIdToWirePacketId map', () => {
    const messagesRef = {
      current: [
        {
          id: 1,
          sender_id: 42,
          sender_name: 'Me',
          packetId: 100,
          payload: 'hello',
          status: 'sending' as const,
          channel: 0,
          timestamp: Date.now(),
        },
      ],
    };
    const setMessages = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      {
        myNodeNum: 42,
        identityId: null,
        messagesRef,
        setMessages,
        tempIdToWirePacketId: new Map([[100, 669520633]]),
      },
    );
    expect(applied).toBe(true);
    expect(setMessages).toHaveBeenCalledTimes(1);
  });

  it('marks packet timeout log lines as failed outbound chat', () => {
    const messagesRef = {
      current: [
        {
          id: 1,
          sender_id: 42,
          sender_name: 'Me',
          packetId: 711859058,
          payload: 'hello',
          status: 'sending' as const,
          channel: 0,
          timestamp: Date.now(),
        },
      ],
    };
    const setMessages = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Packet 711859058 of type packet timed out',
      {
        myNodeNum: 42,
        identityId: null,
        messagesRef,
        setMessages,
      },
    );
    expect(applied).toBe(true);
    expect(setMessages).toHaveBeenCalledTimes(1);
  });

  it('falls back to a single recent sending outbound when packet id differs', () => {
    const messagesRef = {
      current: [
        {
          id: 1,
          sender_id: 42,
          sender_name: 'Me',
          packetId: 999,
          payload: 'hello',
          status: 'sending' as const,
          channel: 0,
          timestamp: Date.now(),
        },
      ],
    };
    const setMessages = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      {
        myNodeNum: 42,
        identityId: null,
        messagesRef,
        setMessages,
      },
    );
    expect(applied).toBe(true);
    expect(setMessages).toHaveBeenCalledTimes(1);
  });
});

describe('installMeshtasticSdkRoutingErrorConsoleHook', () => {
  it('forwards SDK routing errors from console.error', () => {
    const onRoutingErrorLog = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.error('Error received for packet 645488536: PKI_SEND_FAIL_PUBLIC_KEY');
    restore();
    expect(onRoutingErrorLog).toHaveBeenCalledWith(
      'Error received for packet 645488536: PKI_SEND_FAIL_PUBLIC_KEY',
    );
  });

  it('forwards SDK packet timeout lines from console.warn', () => {
    const onRoutingErrorLog = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.warn('Packet 711859058 of type packet timed out');
    restore();
    expect(onRoutingErrorLog).toHaveBeenCalledWith('Packet 711859058 of type packet timed out');
  });

  it('does not intercept unrelated console.warn messages', () => {
    const onRoutingErrorLog = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.warn('[meshcoreRepeaterSession] repeater login failed (continuing) timeout');
    restore();
    expect(onRoutingErrorLog).not.toHaveBeenCalled();
  });
});
