import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

const storeMessages: Record<string, Record<string, unknown>> = {};

vi.mock('@/renderer/stores/messageStore', () => ({
  updateMessageStatus: vi.fn(),
  useMessageStore: {
    getState: () => ({ messages: storeMessages }),
  },
}));

import { updateMessageStatus } from '@/renderer/stores/messageStore';

import {
  resetMeshtasticLateConfigureRetryableSwallowForTests,
  shouldSwallowLateMeshtasticConfigureRetryableRejection,
} from './meshtasticConfigureRetry';
import {
  beginMeshtasticNonChatOutbound,
  endMeshtasticNonChatOutbound,
  registerMeshtasticNonChatWirePacketId,
  resetMeshtasticOutboundCoordinationForTests,
} from './meshtasticOutboundCoordination';
import {
  installMeshtasticSdkRoutingErrorConsoleHook,
  installMeshtasticSdkRoutingErrorUnhandledRejectionHandler,
} from './meshtasticSdkRoutingErrorConsoleHook';
import {
  applyMeshtasticOutboundRoutingErrorFromLog,
  applyMeshtasticOutboundRoutingErrorFromRejection,
  chatRoutingErrorKeyForSdkErrorName,
  humanizeMeshtasticSdkQueueRejectionError,
  isMeshtasticMissingRecipientKeyError,
  parseMeshtasticSdkQueueRejection,
  parseMeshtasticSdkRoutingErrorLog,
} from './meshtasticSdkRoutingErrorLog';

const IDENTITY = 'id-1';
/** Mesh.Routing_Error.TIMEOUT — mapped to chatPanel.routingErrors.timeout */
const ROUTING_TIMEOUT = 3;

interface SeedRow {
  packetId: number;
  payload?: string;
  channelIndex?: number;
  timestamp?: number;
  from?: number;
  to?: number;
}

function clearStoreMessages(): void {
  for (const key of Object.keys(storeMessages)) {
    Reflect.deleteProperty(storeMessages, key);
  }
}

/** Seed identity-scoped outbound rows — the only source routing errors read. */
function seedOutbound(rows: SeedRow[]): void {
  clearStoreMessages();
  storeMessages[IDENTITY] = Object.fromEntries(
    rows.map((row) => [
      String(row.packetId),
      {
        id: String(row.packetId),
        from: row.from ?? 42,
        senderName: 'Me',
        to: row.to ?? 0xffffffff,
        payload: row.payload ?? 'hello',
        channelIndex: row.channelIndex ?? 0,
        timestamp: row.timestamp ?? Date.now(),
        status: 'sending',
      },
    ]),
  );
}

describe('meshtasticSdkRoutingErrorLog', () => {
  beforeEach(() => {
    resetMeshtasticOutboundCoordinationForTests();
    vi.mocked(updateMessageStatus).mockClear();
    clearStoreMessages();
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      electronAPI: {
        db: { updateMessageStatus: vi.fn().mockResolvedValue(undefined) },
      },
    });
  });

  afterEach(() => {
    resetMeshtasticOutboundCoordinationForTests();
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

  it.each([
    ['RATE_LIMIT_EXCEEDED', 'chatPanel.routingErrors.rateLimited'],
    ['NO_INTERFACE', 'chatPanel.routingErrors.noInterface'],
    ['NO_INTERFACE_AVAILABLE', 'chatPanel.routingErrors.noInterface'],
  ])('maps %s to a chat routing i18n key', (errorName, key) => {
    expect(chatRoutingErrorKeyForSdkErrorName(errorName)).toBe(key);
  });

  it('marks matching outbound message failed', () => {
    seedOutbound([{ packetId: 669520633 }]);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY },
    );
    expect(applied).toBe(true);
    expect(updateMessageStatus).toHaveBeenCalledWith(
      IDENTITY,
      '669520633',
      'failed',
      'chatPanel.routingErrors.pkiMissingRecipientKey',
    );
  });

  it('marks matching outbound message failed from timeout log', () => {
    seedOutbound([{ packetId: 711859058 }]);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Packet 711859058 of type packet timed out',
      { myNodeNum: 42, identityId: IDENTITY },
    );
    expect(applied).toBe(true);
    expect(updateMessageStatus).toHaveBeenCalledWith(
      IDENTITY,
      '711859058',
      'failed',
      'chatPanel.routingErrors.timeout',
    );
  });

  it('matches optimistic temp packet id via tempIdToWirePacketId map', () => {
    seedOutbound([{ packetId: 1001 }]);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      {
        myNodeNum: 42,
        identityId: IDENTITY,
        tempIdToWirePacketId: new Map([[1001, 669520633]]),
      },
    );
    expect(applied).toBe(true);
    expect(updateMessageStatus).toHaveBeenCalled();
  });

  it('falls back to a single recent sending outbound when packet id is unmatched', () => {
    seedOutbound([{ packetId: 55, timestamp: Date.now() }]);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY },
    );
    expect(applied).toBe(true);
    expect(updateMessageStatus).toHaveBeenCalled();
  });

  it('does not apply when no outbound rows exist', () => {
    seedOutbound([]);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY },
    );
    expect(applied).toBe(false);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it('does not apply when identity is null', () => {
    seedOutbound([{ packetId: 669520633 }]);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: null },
    );
    expect(applied).toBe(false);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it('does not apply when two recent sending outbounds are ambiguous', () => {
    const now = Date.now();
    seedOutbound([
      { packetId: 1, timestamp: now },
      { packetId: 2, timestamp: now },
    ]);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY },
    );
    expect(applied).toBe(false);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it('does not apply to a known non-chat wire packet id', () => {
    seedOutbound([{ packetId: 669520633 }]);
    registerMeshtasticNonChatWirePacketId(669520633);
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY },
    );
    expect(applied).toBe(false);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it('skips fallback while non-chat outbound is in flight', () => {
    seedOutbound([{ packetId: 55, timestamp: Date.now() }]);
    beginMeshtasticNonChatOutbound();
    try {
      const applied = applyMeshtasticOutboundRoutingErrorFromLog(
        'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
        { myNodeNum: 42, identityId: IDENTITY },
      );
      expect(applied).toBe(false);
    } finally {
      endMeshtasticNonChatOutbound();
    }
  });

  it('marks matching outbound message failed from queue rejection', () => {
    seedOutbound([{ packetId: 669520633 }]);
    const applied = applyMeshtasticOutboundRoutingErrorFromRejection(
      { id: 669520633, error: ROUTING_TIMEOUT },
      { myNodeNum: 42, identityId: IDENTITY },
    );
    expect(applied).toBe(true);
    expect(updateMessageStatus).toHaveBeenCalled();
  });

  it('parses queue rejection shapes', () => {
    expect(parseMeshtasticSdkQueueRejection({ id: 1, error: 5 })).toEqual({
      packetId: 1,
      errorName: expect.any(String),
    });
    expect(parseMeshtasticSdkQueueRejection({ packetId: 2, error: 5 })).toEqual({
      packetId: 2,
      errorName: expect.any(String),
    });
    expect(parseMeshtasticSdkQueueRejection('nope')).toBeNull();
  });

  it('humanizes queue rejection errors', () => {
    expect(
      humanizeMeshtasticSdkQueueRejectionError({ id: 1, error: ROUTING_TIMEOUT }),
    ).toBeTruthy();
    expect(humanizeMeshtasticSdkQueueRejectionError('x')).toBeNull();
  });

  it('requests recipient NODEINFO on PKI_SEND_FAIL_PUBLIC_KEY for a DM row', () => {
    seedOutbound([{ packetId: 669520633, to: 0x1234 }]);
    const onMissingRecipientKey = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY, onMissingRecipientKey },
    );
    expect(applied).toBe(true);
    expect(onMissingRecipientKey).toHaveBeenCalledWith(0x1234);
  });

  it('requests recipient NODEINFO on PKI_UNKNOWN_PUBKEY for a DM row', () => {
    seedOutbound([{ packetId: 669520633, to: 0xabcd }]);
    const onMissingRecipientKey = vi.fn();
    applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_UNKNOWN_PUBKEY',
      { myNodeNum: 42, identityId: IDENTITY, onMissingRecipientKey },
    );
    expect(onMissingRecipientKey).toHaveBeenCalledWith(0xabcd);
  });

  it('does not request NODEINFO for non-key routing errors', () => {
    seedOutbound([{ packetId: 711859058, to: 0x1234 }]);
    const onMissingRecipientKey = vi.fn();
    applyMeshtasticOutboundRoutingErrorFromLog('Packet 711859058 of type packet timed out', {
      myNodeNum: 42,
      identityId: IDENTITY,
      onMissingRecipientKey,
    });
    expect(onMissingRecipientKey).not.toHaveBeenCalled();
  });

  it('does not request NODEINFO for a broadcast row (no recipient)', () => {
    seedOutbound([{ packetId: 669520633 }]);
    const onMissingRecipientKey = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY, onMissingRecipientKey },
    );
    expect(applied).toBe(true);
    expect(onMissingRecipientKey).not.toHaveBeenCalled();
  });

  it('does not request NODEINFO when no outbound row matches', () => {
    seedOutbound([]);
    const onMissingRecipientKey = vi.fn();
    const applied = applyMeshtasticOutboundRoutingErrorFromLog(
      'Error received for packet 669520633: PKI_SEND_FAIL_PUBLIC_KEY',
      { myNodeNum: 42, identityId: IDENTITY, onMissingRecipientKey },
    );
    expect(applied).toBe(false);
    expect(onMissingRecipientKey).not.toHaveBeenCalled();
  });

  it('classifies missing recipient key errors', () => {
    expect(isMeshtasticMissingRecipientKeyError('PKI_SEND_FAIL_PUBLIC_KEY')).toBe(true);
    expect(isMeshtasticMissingRecipientKeyError('PKI_UNKNOWN_PUBKEY')).toBe(true);
    expect(isMeshtasticMissingRecipientKeyError('MAX_RETRANSMIT')).toBe(false);
    expect(isMeshtasticMissingRecipientKeyError('TIMEOUT')).toBe(false);
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
    const onRoutingErrorLog = vi.fn().mockReturnValue(true);
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
    const onRoutingErrorLog = vi.fn().mockReturnValue(true);
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

  it('falls through to original console when routing handler does not apply UI update', () => {
    const onRoutingErrorLog = vi.fn().mockReturnValue(false);
    const restore = installMeshtasticSdkRoutingErrorConsoleHook(onRoutingErrorLog);
    console.error('Error received for packet 645488536: PKI_SEND_FAIL_PUBLIC_KEY');
    restore();
    expect(onRoutingErrorLog).toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(priorErrorSpy).toHaveBeenCalledWith(
      'Error received for packet 645488536: PKI_SEND_FAIL_PUBLIC_KEY',
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

  it('calls onQueueRejection and preventDefault when handler returns true', () => {
    const onQueueRejection = vi.fn().mockReturnValue(true);
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
    expect(window.removeEventListener).toHaveBeenCalledWith('unhandledrejection', handler, {
      capture: true,
    });
  });

  it('does not preventDefault when handler returns false', () => {
    const onQueueRejection = vi.fn().mockReturnValue(false);
    const restore = installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(onQueueRejection);
    const handler = vi.mocked(window.addEventListener).mock.calls[0]?.[1] as (event: {
      reason: unknown;
      preventDefault: () => void;
    }) => void;
    const reason = { id: 397127051, error: 3 };
    const preventDefault = vi.fn();
    handler({ reason, preventDefault });
    expect(onQueueRejection).toHaveBeenCalledWith(reason);
    expect(preventDefault).not.toHaveBeenCalled();
    restore();
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

  it('does not swallow mid-session Packet does not exist (only the late window does)', () => {
    const onQueueRejection = vi.fn();
    const restore = installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(onQueueRejection);
    const handler = vi.mocked(window.addEventListener).mock.calls[0]?.[1] as (event: {
      reason: unknown;
      preventDefault: () => void;
    }) => void;
    const reason = new Error('Packet does not exist');
    const preventDefault = vi.fn();
    handler({ reason, preventDefault });
    expect(onQueueRejection).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    restore();
  });

  it('registers unhandledrejection listener in capture phase', () => {
    const restore = installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(vi.fn());
    expect(window.addEventListener).toHaveBeenCalledWith(
      'unhandledrejection',
      expect.any(Function),
      { capture: true },
    );
    restore();
    expect(window.removeEventListener).toHaveBeenCalledWith(
      'unhandledrejection',
      expect.any(Function),
      { capture: true },
    );
  });

  it('arms late-swallow window when the capture handler is removed', () => {
    resetMeshtasticLateConfigureRetryableSwallowForTests();
    const restore = installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(vi.fn());
    expect(
      shouldSwallowLateMeshtasticConfigureRetryableRejection(new Error('Packet does not exist')),
    ).toBe(false);
    restore();
    expect(
      shouldSwallowLateMeshtasticConfigureRetryableRejection(new Error('Packet does not exist')),
    ).toBe(true);
    resetMeshtasticLateConfigureRetryableSwallowForTests();
  });
});
