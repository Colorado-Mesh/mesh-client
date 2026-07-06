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

import {
  installMeshtasticSdkRoutingErrorConsoleHook,
  installMeshtasticSdkRoutingErrorUnhandledRejectionHandler,
} from './meshtasticSdkRoutingErrorConsoleHook';
import {
  applyMeshtasticOutboundRoutingErrorFromLog,
  applyMeshtasticOutboundRoutingErrorFromRejection,
  chatRoutingErrorKeyForSdkErrorName,
  parseMeshtasticSdkQueueRejection,
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

  it('parses SDK queue rejections with id or packetId', () => {
    expect(parseMeshtasticSdkQueueRejection({ id: 397127051, error: 3 })).toEqual({
      packetId: 397127051,
      errorName: 'TIMEOUT',
    });
    expect(parseMeshtasticSdkQueueRejection({ packetId: 42, error: 8 })).toEqual({
      packetId: 42,
      errorName: 'NO_RESPONSE',
    });
    expect(parseMeshtasticSdkQueueRejection({ id: 1, error: 'TIMEOUT' })).toBeNull();
    expect(parseMeshtasticSdkQueueRejection('timeout')).toBeNull();
  });

  it('marks matching outbound message failed from queue rejection', () => {
    const messagesRef = {
      current: [
        {
          id: 1,
          sender_id: 42,
          sender_name: 'Me',
          packetId: 397127051,
          payload: 'hello',
          status: 'sending' as const,
          channel: 0,
          timestamp: Date.now(),
        },
      ],
    };
    const setMessages = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromRejection(
      { id: 397127051, error: 3 },
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
  let priorErrorSpy: ReturnType<typeof vi.spyOn>;
  let priorWarnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    priorErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    priorWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards SDK routing errors from console.error at debug level', () => {
    const onRoutingErrorLog = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.error('Error received for packet 645488536: PKI_SEND_FAIL_PUBLIC_KEY');
    restore();
    expect(onRoutingErrorLog).toHaveBeenCalledWith(
      'Error received for packet 645488536: PKI_SEND_FAIL_PUBLIC_KEY',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      '[Meshtastic] SDK routing failure:',
      'Error received for packet 645488536: PKI_SEND_FAIL_PUBLIC_KEY',
    );
    expect(priorErrorSpy).not.toHaveBeenCalled();
  });

  it('forwards SDK packet timeout lines from console.warn at debug level', () => {
    const onRoutingErrorLog = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.warn('Packet 711859058 of type packet timed out');
    restore();
    expect(onRoutingErrorLog).toHaveBeenCalledWith('Packet 711859058 of type packet timed out');
    expect(debugSpy).toHaveBeenCalledWith(
      '[Meshtastic] SDK routing failure:',
      'Packet 711859058 of type packet timed out',
    );
    expect(priorWarnSpy).not.toHaveBeenCalled();
  });

  it('does not intercept unrelated console.error messages', () => {
    const onRoutingErrorLog = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.error('Something else failed');
    restore();
    expect(onRoutingErrorLog).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(priorErrorSpy).toHaveBeenCalledWith('Something else failed');
  });

  it('does not intercept unrelated console.warn messages', () => {
    const onRoutingErrorLog = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.warn('[meshcoreRepeaterSession] repeater login failed (continuing) timeout');
    restore();
    expect(onRoutingErrorLog).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(priorWarnSpy).toHaveBeenCalledWith(
      '[meshcoreRepeaterSession] repeater login failed (continuing) timeout',
    );
  });
});

describe('installMeshtasticSdkRoutingErrorUnhandledRejectionHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      electronAPI: {
        db: { updateMessageStatus: vi.fn().mockResolvedValue(undefined) },
      },
    });
  });

  it('calls onQueueRejection and preventDefault for SDK queue rejections', () => {
    const onQueueRejection = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(onQueueRejection);
    const handler = vi.mocked(window.addEventListener).mock.calls[0]?.[1] as (event: {
      reason: unknown;
      preventDefault: () => void;
    }) => void;
    const reason = { id: 397127051, error: 3 };
    const preventDefault = vi.fn();
    handler({ reason, preventDefault });
    expect(onQueueRejection).toHaveBeenCalledWith(reason);
    expect(preventDefault).toHaveBeenCalled();
    restore();
    expect(window.removeEventListener).toHaveBeenCalledWith('unhandledrejection', handler);
  });

  it('ignores unrelated unhandled rejections', () => {
    const onQueueRejection = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(onQueueRejection);
    const handler = vi.mocked(window.addEventListener).mock.calls[0]?.[1] as (event: {
      reason: unknown;
      preventDefault: () => void;
    }) => void;
    const reason = new Error('network down');
    const preventDefault = vi.fn();
    handler({ reason, preventDefault });
    expect(onQueueRejection).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    restore();
  });
});
