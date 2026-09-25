import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '@/renderer/stores/messageStore';
import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import {
  type EmergencySendDeps,
  sendEmergencyText,
  sendTextWithOutboxFallback,
} from './emergencySend';
import { resetMeshtasticTextSendPacingForTests } from './meshtasticTextSendPacing';
import { OFFLINE_RETICULUM_IDENTITY_ID } from './offlineProtocolIdentities';
import { mockConsoleWarn } from './vitestConsoleMock';

function makeDeps(overrides: Partial<EmergencySendDeps> = {}): EmergencySendDeps {
  return {
    isSendAvailable: true,
    sendFn: vi.fn().mockResolvedValue(undefined),
    queueOutbox: vi.fn((entry: OutboxEntryInput) =>
      Promise.resolve({
        ...entry,
        id: 1,
        attemptCount: 0,
        createdAt: 0,
        updatedAt: 0,
        priority: entry.priority ?? 'normal',
      } satisfies OutboxEntry),
    ),
    protocol: 'meshcore',
    viewKey: 'ch:0',
    channel: 0,
    toNode: null,
    ...overrides,
  };
}

describe('sendEmergencyText', () => {
  beforeEach(() => {
    resetMeshtasticTextSendPacingForTests();
  });

  it('queues an emergency outbox row without sending when send is unavailable', async () => {
    const deps = makeDeps({ isSendAvailable: false, toNode: 42, viewKey: 'dm:42' });
    await expect(sendEmergencyText('MECP report', deps)).resolves.toBe('queued');
    expect(deps.sendFn).not.toHaveBeenCalled();
    expect(deps.queueOutbox).toHaveBeenCalledWith({
      protocol: 'meshcore',
      viewKey: 'dm:42',
      channel: 0,
      toNode: 42,
      payload: 'MECP report',
      replyId: null,
      status: 'queued',
      error: null,
      nextRetryAt: null,
      groupId: null,
      groupIndex: null,
      groupTotal: null,
      priority: 'emergency',
    });
  });

  it('sends live when available and does not queue on success', async () => {
    const deps = makeDeps({ channel: 2, replyId: 7 });
    await expect(sendEmergencyText('MECP report', deps)).resolves.toBe('sent');
    expect(deps.sendFn).toHaveBeenCalledWith('MECP report', 2, undefined, 7);
    expect(deps.queueOutbox).not.toHaveBeenCalled();
  });

  it('falls back to an emergency outbox row when the live send throws', async () => {
    const { spy, restore } = mockConsoleWarn();
    try {
      const deps = makeDeps({ sendFn: vi.fn().mockRejectedValue(new Error('radio busy')) });
      await expect(sendEmergencyText('MECP report', deps)).resolves.toBe('queued');
      expect(deps.queueOutbox).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'emergency', payload: 'MECP report' }),
      );
      expect(spy).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('propagates queueOutbox failures so callers can surface them', async () => {
    const deps = makeDeps({
      isSendAvailable: false,
      queueOutbox: vi.fn().mockRejectedValue(new Error('db closed')),
    });
    await expect(sendEmergencyText('MECP report', deps)).rejects.toThrow('db closed');
  });
});

describe('sendEmergencyText (Reticulum receipt)', () => {
  const identityId = OFFLINE_RETICULUM_IDENTITY_ID;

  function pendingMessage(id: string, status: 'sending' | 'acked' | 'failed') {
    return {
      [identityId]: {
        [id]: {
          id,
          from: 1,
          to: 123,
          payload: 'MECP/0/M01',
          channelIndex: 0,
          timestamp: Date.now(),
          status,
        },
      },
    };
  }

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('reports sent only after the remote receipt acks the attempt', async () => {
    const sendFn = vi.fn(() => {
      useMessageStore.setState({ messages: pendingMessage('rt-1', 'sending') });
      return 'rt-1';
    });
    const deps = makeDeps({ protocol: 'reticulum', toNode: 123, sendFn });
    const outcome = sendEmergencyText('MECP/0/M01', deps);
    await Promise.resolve();
    useMessageStore.setState({ messages: pendingMessage('rt-1', 'acked') });
    await expect(outcome).resolves.toBe('sent');
    expect(deps.queueOutbox).not.toHaveBeenCalled();
  });

  it('queues an emergency row when the receipt times out', async () => {
    const { restore } = mockConsoleWarn();
    try {
      const sendFn = vi.fn(() => {
        useMessageStore.setState({ messages: pendingMessage('rt-2', 'sending') });
        return 'rt-2';
      });
      const deps = makeDeps({
        protocol: 'reticulum',
        toNode: 123,
        sendFn,
        reticulumReceiptTimeoutMs: 10,
      });
      await expect(sendEmergencyText('MECP/0/M01', deps)).resolves.toBe('queued');
      expect(deps.queueOutbox).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'emergency', protocol: 'reticulum' }),
      );
    } finally {
      restore();
    }
  });

  it('queues when the receipt fails or the send returns no attempt id', async () => {
    const { restore } = mockConsoleWarn();
    try {
      const failing = makeDeps({
        protocol: 'reticulum',
        sendFn: vi.fn(() => {
          useMessageStore.setState({ messages: pendingMessage('rt-3', 'failed') });
          return 'rt-3';
        }),
      });
      await expect(sendEmergencyText('MECP/0/M01', failing)).resolves.toBe('queued');
      const noId = makeDeps({
        protocol: 'reticulum',
        sendFn: vi.fn().mockResolvedValue(undefined),
      });
      await expect(sendEmergencyText('MECP/0/M01', noId)).resolves.toBe('queued');
    } finally {
      restore();
    }
  });
});

describe('sendTextWithOutboxFallback', () => {
  beforeEach(() => {
    resetMeshtasticTextSendPacingForTests();
  });

  it('queues a normal-priority row when send is unavailable', async () => {
    const deps = makeDeps({ isSendAvailable: false });
    await expect(sendTextWithOutboxFallback('OK', deps, 'normal')).resolves.toBe('queued');
    expect(deps.queueOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'normal', payload: 'OK' }),
    );
  });

  it('queues a normal-priority row when the live send throws', async () => {
    const { restore } = mockConsoleWarn();
    try {
      const deps = makeDeps({ sendFn: vi.fn().mockRejectedValue(new Error('radio busy')) });
      await expect(sendTextWithOutboxFallback('OK', deps, 'normal')).resolves.toBe('queued');
      expect(deps.queueOutbox).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'normal' }),
      );
    } finally {
      restore();
    }
  });
});
