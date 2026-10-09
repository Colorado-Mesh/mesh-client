import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  useMessageStore,
} from '@/renderer/stores/messageStore';

import type { MeshProtocol } from '../types';
import {
  autoResendKey,
  autoResendMessageId,
  type AutoResendSendFn,
  cancelAutoResend,
  isAutoResendEligible,
  resetAutoResendForTests,
  startAutoResend,
  useAutoResendStore,
} from './autoResendController';
import { AUTO_RESEND_DELAYS_MS, REGULAR_MESSAGE_MAX_AUTO_RESENDS } from './autoResendPolicy';

const PROTOCOLS = ['meshtastic', 'meshcore', 'reticulum'] as const;

function identityFor(protocol: MeshProtocol): string {
  return `id-${protocol}`;
}

function protocolOf(identityId: string): MeshProtocol | null {
  return PROTOCOLS.find((p) => identityFor(p) === identityId) ?? null;
}

function dm(id: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id,
    from: 1,
    to: 42,
    payload: 'hello',
    channelIndex: -1,
    timestamp: Date.now(),
    status: 'sending',
    ...overrides,
  };
}

function setStatus(identityId: string, id: string, status: MessageRecord['status']): void {
  useMessageStore.setState((s) => {
    const bucket = s.messages[identityId] ?? {};
    return {
      messages: { ...s.messages, [identityId]: { ...bucket, [id]: { ...bucket[id], status } } },
    };
  });
}

function hasMessage(identityId: string, id: string): boolean {
  return Object.hasOwn(useMessageStore.getState().messages[identityId] ?? {}, id);
}

describe('isAutoResendEligible', () => {
  it('excludes tapbacks, room posts and MECP payloads', () => {
    expect(isAutoResendEligible('meshtastic', dm('1'))).toBe(true);
    expect(isAutoResendEligible('meshtastic', dm('1', { tapback: true }))).toBe(false);
    expect(isAutoResendEligible('meshcore', dm('1', { roomServerId: 'abc' } as never))).toBe(false);
    expect(isAutoResendEligible('meshtastic', dm('1', { payload: 'MECP/0/M01' }))).toBe(false);
  });

  it('skips channel sends only where the protocol has no channel delivery ACK', () => {
    const channel = dm('1', { to: 0, channelIndex: 0 });
    expect(isAutoResendEligible('meshtastic', channel)).toBe(true);
    expect(isAutoResendEligible('meshcore', channel)).toBe(false);
  });
});

describe('autoResendMessageId', () => {
  it('prefers storeId, then reticulum hash, then packetId', () => {
    expect(autoResendMessageId({ storeId: 's', reticulum_message_hash: 'h', packetId: 3 })).toBe(
      's',
    );
    expect(autoResendMessageId({ reticulum_message_hash: 'h', packetId: 3 })).toBe('h');
    expect(autoResendMessageId({ packetId: 3 })).toBe('3');
    expect(autoResendMessageId({})).toBeNull();
  });
});

describe('startAutoResend', () => {
  let stop: () => void = () => {};
  let nextId = 1000;
  let send: ReturnType<typeof vi.fn<AutoResendSendFn>>;
  const deleteFailedOutboundMessage = vi.fn().mockResolvedValue({ changes: 1 });

  beforeEach(() => {
    vi.useFakeTimers();
    resetAutoResendForTests();
    useMessageStore.setState({ messages: {} });
    deleteFailedOutboundMessage.mockClear();
    vi.stubGlobal('window', { electronAPI: { db: { deleteFailedOutboundMessage } } });
    send = vi.fn<AutoResendSendFn>((protocol, args) => {
      nextId += 1;
      const id = String(nextId);
      addMessage(identityFor(protocol), dm(id, { payload: args.text }));
      return id;
    });
    stop = startAutoResend(send, protocolOf);
  });

  afterEach(() => {
    stop();
    resetAutoResendForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(PROTOCOLS)(
    '%s: resends a failed message up to 3 times with backoff, then stops',
    (protocol) => {
      const identityId = identityFor(protocol);
      addMessage(identityId, dm('1'));
      let currentId = '1';
      for (let attempt = 1; attempt <= REGULAR_MESSAGE_MAX_AUTO_RESENDS; attempt += 1) {
        setStatus(identityId, currentId, 'failed');
        const entry = useAutoResendStore.getState().entries[autoResendKey(protocol, currentId)];
        expect(entry).toMatchObject({ attempt, messageId: currentId });
        vi.advanceTimersByTime(AUTO_RESEND_DELAYS_MS[attempt - 1] - 1);
        expect(send).toHaveBeenCalledTimes(attempt - 1);
        vi.advanceTimersByTime(1);
        expect(send).toHaveBeenCalledTimes(attempt);
        expect(send).toHaveBeenLastCalledWith(
          protocol,
          expect.objectContaining({ text: 'hello', destination: 42, retryOfStoreId: currentId }),
        );
        const superseded = currentId;
        currentId = String(nextId);
        expect(hasMessage(identityId, superseded)).toBe(protocol === 'reticulum');
      }
      setStatus(identityId, currentId, 'failed');
      expect(useAutoResendStore.getState().entries).toEqual({});
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(send).toHaveBeenCalledTimes(REGULAR_MESSAGE_MAX_AUTO_RESENDS);
      if (protocol !== 'reticulum') {
        expect(deleteFailedOutboundMessage).toHaveBeenCalledWith(protocol, 1);
      }
    },
  );

  it.each(PROTOCOLS)('%s: Cancel retry stops the pending resend', (protocol) => {
    const identityId = identityFor(protocol);
    addMessage(identityId, dm('1'));
    setStatus(identityId, '1', 'failed');
    expect(useAutoResendStore.getState().entries[autoResendKey(protocol, '1')]).toBeDefined();
    cancelAutoResend(protocol, '1');
    expect(useAutoResendStore.getState().entries).toEqual({});
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(send).not.toHaveBeenCalled();
    expect(hasMessage(identityId, '1')).toBe(true);
  });

  it('does not resend when the message is acked before the timer fires', () => {
    const identityId = identityFor('meshtastic');
    addMessage(identityId, dm('1'));
    setStatus(identityId, '1', 'failed');
    setStatus(identityId, '1', 'acked');
    expect(useAutoResendStore.getState().entries).toEqual({});
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores MECP payloads and incoming messages', () => {
    const identityId = identityFor('meshtastic');
    addMessage(identityId, dm('1', { payload: 'MECP/0/M01' }));
    addMessage(identityId, dm('2', { status: undefined, from: 99 }));
    setStatus(identityId, '1', 'failed');
    setStatus(identityId, '2', 'failed');
    expect(useAutoResendStore.getState().entries).toEqual({});
  });

  it('follows a renamed message id', () => {
    const identityId = identityFor('meshtastic');
    addMessage(identityId, dm('1'));
    renameMessageId(identityId, '1', '555');
    setStatus(identityId, '555', 'failed');
    expect(useAutoResendStore.getState().entries[autoResendKey('meshtastic', '555')]).toBeDefined();
  });
});
