import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetChatOutboxDrainLocksForTests } from '@/renderer/lib/chatOutboxDrain';
import {
  isMeshcoreSendTooFast,
  resetMeshcoreSendRateForTests,
} from '@/renderer/lib/meshcoreSendRateNotice';
import { resetMeshtasticTextSendPacingForTests } from '@/renderer/lib/meshtasticTextSendPacing';
import { OFFLINE_RETICULUM_IDENTITY_ID } from '@/renderer/lib/offlineProtocolIdentities';
import { MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS } from '@/renderer/lib/timeConstants';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';
import { useMessageStore } from '@/renderer/stores/messageStore';
import type { OutboxEntry } from '@/shared/electron-api.types';

import {
  earliestEmergencyRetryAt,
  EMERGENCY_OUTBOX_SOFT_CAP,
  isEmergencyOutboxPriority,
  isMaydayEmergencyOutboxPayload,
  OUTBOX_MAX_AGE_MS,
  useChatOutbox,
} from './useChatOutbox';

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 1,
    protocol: 'meshtastic',
    viewKey: 'ch:0',
    channel: 0,
    toNode: null,
    payload: 'hello',
    replyId: null,
    status: 'queued',
    error: null,
    attemptCount: 0,
    nextRetryAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    groupId: null,
    groupIndex: null,
    groupTotal: null,
    priority: 'normal',
    ...overrides,
  };
}

describe('useChatOutbox', () => {
  const mockOutbox = window.electronAPI.chat.outbox;

  beforeEach(() => {
    resetMeshtasticTextSendPacingForTests();
    resetMeshcoreSendRateForTests();
    resetChatOutboxDrainLocksForTests();
    vi.mocked(mockOutbox.list).mockClear();
    vi.mocked(mockOutbox.add).mockClear();
    vi.mocked(mockOutbox.updateStatus).mockClear();
    vi.mocked(mockOutbox.remove).mockClear();
    vi.mocked(mockOutbox.list).mockResolvedValue([]);
    vi.mocked(mockOutbox.add).mockImplementation((entry) =>
      Promise.resolve({
        ...makeEntry(),
        ...(entry as Partial<OutboxEntry>),
        id: 99,
        updatedAt: Date.now(),
      }),
    );
    vi.mocked(mockOutbox.updateStatus).mockResolvedValue(undefined);
    vi.mocked(mockOutbox.remove).mockResolvedValue(undefined);
    useMessageStore.setState({ messages: {} });
  });

  it('loads outbox on mount', async () => {
    const stored = [makeEntry({ id: 1 })];
    vi.mocked(mockOutbox.list).mockResolvedValue(stored);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn }),
    );
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(1);
    });
    expect(result.current.rows[0].id).toBe(1);
  });

  it('queue adds a row and triggers drain when connected', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const entry = makeEntry({ id: 99, status: 'queued' });
    vi.mocked(mockOutbox.add).mockResolvedValue(entry);
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
    );
    await result.current.queue({
      protocol: 'meshtastic',
      viewKey: 'ch:0',
      channel: 0,
      toNode: null,
      payload: 'hello',
      replyId: null,
      status: 'queued',
      error: null,
      nextRetryAt: null,
      groupId: null,
      groupIndex: null,
      groupTotal: null,
    });
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalled();
    });
  });

  it('drain removes row from state on success', async () => {
    const entry = makeEntry({ id: 5 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(mockOutbox.remove).toHaveBeenCalledWith(5);
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(0);
    });
  });

  it('marks row as failed after send error', async () => {
    const entry = makeEntry({ id: 7 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockRejectedValue(new Error('radio busy'));
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        7,
        'failed',
        'chatPanel.sendFailed',
        expect.any(Number),
        1,
      );
    });
    await waitFor(() => {
      const row = result.current.rows.find((r) => r.id === 7);
      expect(row?.status).toBe('failed');
    });
  });

  it('keeps retryable encryption-init timeouts in failed (not blocked)', async () => {
    const entry = makeEntry({ id: 81 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockRejectedValue(new Error('timeout while initializing encryption'));
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        81,
        'failed',
        'chatPanel.sendErrors.timeout',
        expect.any(Number),
        1,
      );
    });
  });

  it('marks row as blocked on encryption error without retry', async () => {
    const entry = makeEntry({ id: 8 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockRejectedValue(new Error('no encryption key'));
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        8,
        'blocked',
        'chatPanel.sendErrors.encryptionBlocked',
        undefined,
        1,
      );
    });
  });

  it('cancel removes the row', async () => {
    const entry = makeEntry({ id: 3 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn();
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn }),
    );
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(1);
    });
    result.current.cancel(3);
    await waitFor(() => {
      expect(mockOutbox.remove).toHaveBeenCalledWith(3);
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(0);
    });
  });

  it('retry resets status to queued and triggers drain', async () => {
    vi.useFakeTimers();
    try {
      const entry = makeEntry({ id: 4, status: 'failed' });
      vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
      const sendFn = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(result.current.rows).toHaveLength(0);
      expect(sendFn).toHaveBeenCalledTimes(1);

      vi.mocked(mockOutbox.updateStatus).mockResolvedValue(undefined);
      vi.mocked(mockOutbox.list).mockResolvedValue([{ ...entry, status: 'queued' }]);
      result.current.retry(4);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(4, 'queued', undefined, undefined);
      // Second send is paced behind the first — advance past the interval so no timer dangles.
      expect(sendFn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS);
      expect(sendFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('paces successive meshtastic sends within one drain to avoid RATE_LIMIT_EXCEEDED', async () => {
    // Regression: firmware rejects a second TEXT_MESSAGE_APP within 2s of the first
    // (Routing_Error.RATE_LIMIT_EXCEEDED). Rows draining back-to-back must be paced.
    vi.useFakeTimers();
    try {
      const rowA = makeEntry({ id: 30, payload: 'first' });
      const rowB = makeEntry({ id: 31, payload: 'second' });
      vi.mocked(mockOutbox.list).mockResolvedValue([rowA, rowB]);
      const sendFn = vi.fn().mockResolvedValue(undefined);
      renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendFn).toHaveBeenCalledTimes(1);
      expect(sendFn).toHaveBeenNthCalledWith(1, 'first', 0, undefined, undefined);

      await vi.advanceTimersByTimeAsync(MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS - 100);
      expect(sendFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(sendFn).toHaveBeenCalledTimes(2);
      expect(sendFn).toHaveBeenNthCalledWith(2, 'second', 0, undefined, undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains successive meshcore sends within one drain without client pacing', async () => {
    // MeshCore chunk pacing was removed (it did not gate on airtime); a drain should send
    // all eligible MeshCore rows without waiting on a client-side interval.
    const rowA = makeEntry({ id: 40, protocol: 'meshcore', payload: 'first' });
    const rowB = makeEntry({ id: 41, protocol: 'meshcore', payload: 'second' });
    vi.mocked(mockOutbox.list).mockResolvedValue([rowA, rowB]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));

    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(2);
    });
    expect(sendFn).toHaveBeenNthCalledWith(1, 'first', 0, undefined, undefined);
    expect(sendFn).toHaveBeenNthCalledWith(2, 'second', 0, undefined, undefined);
  });

  it('advances the shared meshcore fast-send clock when a row drains successfully', async () => {
    // A drained MeshCore row is airtime too, so a composer send right after should still warn.
    const entry = makeEntry({ id: 50, protocol: 'meshcore', payload: 'hi' });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    expect(isMeshcoreSendTooFast()).toBe(false);
    renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    expect(isMeshcoreSendTooFast()).toBe(true);
  });

  it('quarantines legacy meshcore multipart outbox rows without calling sendFn', async () => {
    // Upgrade path: rows queued before single-packet (groupTotal > 1 / [i/N] payload) must not TX.
    const legacy = makeEntry({
      id: 60,
      protocol: 'meshcore',
      payload: '[1/3] first chunk of a long message',
      groupId: 'legacy-group',
      groupIndex: 0,
      groupTotal: 3,
    });
    vi.mocked(mockOutbox.list).mockResolvedValue([legacy]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        60,
        'blocked',
        'chatPanel.outboxLegacyMultipartBlocked',
        undefined,
      );
    });
    expect(sendFn).not.toHaveBeenCalled();
    await waitFor(() => {
      const row = result.current.rows.find((r) => r.id === 60);
      expect(row?.status).toBe('blocked');
      expect(row?.error).toBe('chatPanel.outboxLegacyMultipartBlocked');
    });
  });

  it('still drains non-legacy meshcore rows when a legacy multipart row is also present', async () => {
    const legacy = makeEntry({
      id: 61,
      protocol: 'meshcore',
      payload: '[2/2] leftover',
      groupTotal: 2,
    });
    const ok = makeEntry({ id: 62, protocol: 'meshcore', payload: 'short ok' });
    vi.mocked(mockOutbox.list).mockResolvedValue([legacy, ok]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    expect(sendFn).toHaveBeenCalledWith('short ok', 0, undefined, undefined);
    expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
      61,
      'blocked',
      'chatPanel.outboxLegacyMultipartBlocked',
      undefined,
    );
  });

  it('does not touch the meshcore fast-send clock for meshtastic drains', async () => {
    const entry = makeEntry({ id: 51, protocol: 'meshtastic', payload: 'hi' });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    expect(isMeshcoreSendTooFast()).toBe(false);
  });

  it('does not advance the meshcore fast-send clock when a drain send fails', async () => {
    const entry = makeEntry({ id: 52, protocol: 'meshcore', payload: 'hi' });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockRejectedValue(new Error('radio busy'));
    renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    expect(isMeshcoreSendTooFast()).toBe(false);
  });

  it('does not drain when isSendAvailable is false', async () => {
    const entry = makeEntry({ id: 9 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn();
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn }));
    await waitFor(() => {
      expect(mockOutbox.list).toHaveBeenCalled();
    });
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('resets sending rows to queued on mount', async () => {
    const staleRow = makeEntry({ id: 10, status: 'sending' });
    vi.mocked(mockOutbox.list).mockResolvedValue([staleRow]);
    const sendFn = vi.fn();
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn }),
    );
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(10, 'queued');
    });
    await waitFor(() => {
      expect(result.current.rows[0]?.status).toBe('queued');
    });
  });

  it('drains on protocol change when already connected', async () => {
    const entry = makeEntry({ id: 11, protocol: 'meshcore' });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ protocol }: { protocol: 'meshtastic' | 'meshcore' }) =>
        useChatOutbox({ protocol, isSendAvailable: true, sendFn }),
      { initialProps: { protocol: 'meshtastic' as 'meshtastic' | 'meshcore' } },
    );
    // Switch protocol while connected — should trigger a new drain
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    rerender({ protocol: 'meshcore' });
    await waitFor(() => {
      expect(mockOutbox.list).toHaveBeenCalledWith('meshcore');
    });
  });

  it('catches synchronous throw from sendFn and marks row failed', async () => {
    const entry = makeEntry({ id: 12 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockImplementation(() => {
      throw new Error('sync boom');
    });
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        12,
        'failed',
        'chatPanel.sendFailed',
        expect.any(Number),
        1,
      );
    });
  });

  it('permanently fails row after MAX_ATTEMPTS without nextRetryAt', async () => {
    const entry = makeEntry({ id: 13, attemptCount: 4 }); // next attempt = 5 = MAX_ATTEMPTS
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockRejectedValue(new Error('radio busy'));
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        13,
        'failed',
        'chatPanel.sendFailed',
        undefined,
        5,
      );
    });
  });

  it('persists attemptCount to IPC on send failure', async () => {
    const entry = makeEntry({ id: 14, attemptCount: 2 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockRejectedValue(new Error('timeout'));
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        14,
        'failed',
        'chatPanel.sendErrors.timeout',
        expect.any(Number),
        3,
      );
    });
  });

  it('blocks the row when remove fails after a successful send', async () => {
    const entry = makeEntry({ id: 21 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    vi.mocked(mockOutbox.remove).mockRejectedValueOnce(new Error('db locked'));
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        21,
        'blocked',
        'chatPanel.outboxRemoveFailed',
        undefined,
        1,
      );
    });
    await waitFor(() => {
      expect(result.current.rows.find((r) => r.id === 21)?.status).toBe('blocked');
    });
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('keeps UI failed when persisting failure status rejects', async () => {
    const entry = makeEntry({ id: 22 });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    vi.mocked(mockOutbox.updateStatus).mockImplementation((_id, status) => {
      if (status === 'sending') return Promise.resolve();
      return Promise.reject(new Error('persist failed'));
    });
    const sendFn = vi.fn().mockRejectedValue(new Error('radio busy'));
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(result.current.rows.find((r) => r.id === 22)?.status).toBe('failed');
    });
  });

  it('resets stuck sending rows to queued at the start of drain', async () => {
    const stuck = makeEntry({ id: 23, status: 'sending' });
    const sendFn = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockOutbox.list).mockResolvedValue([stuck]);
    renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(23, 'queued');
    });
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalled();
    });
  });

  it('keeps reticulum outbox row until remote receipt marks terminal success', async () => {
    const createdAt = Date.now();
    const attemptTimestamp = createdAt + 1;
    const row = makeEntry({
      id: 70,
      protocol: 'reticulum',
      payload: 'rf only dm',
      toNode: 123,
      viewKey: 'dm:123',
      createdAt,
      updatedAt: createdAt,
    });
    vi.mocked(mockOutbox.list).mockResolvedValue([row]);
    const sendFn = vi.fn().mockImplementation(() => {
      useMessageStore.setState({
        messages: {
          [OFFLINE_RETICULUM_IDENTITY_ID]: {
            'reticulum-pending-70': {
              id: 'reticulum-pending-70',
              from: 1,
              to: 123,
              payload: 'rf only dm',
              channelIndex: 0,
              timestamp: attemptTimestamp,
              status: 'sending',
            },
          },
        },
      });
      return 'reticulum-pending-70';
    });
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'reticulum', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();

    useMessageStore.setState({
      messages: {
        [OFFLINE_RETICULUM_IDENTITY_ID]: {
          'reticulum-pending-70': {
            id: 'reticulum-pending-70',
            from: 1,
            to: 123,
            payload: 'rf only dm',
            channelIndex: 0,
            timestamp: attemptTimestamp,
            status: 'sending',
          },
        },
      },
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();

    useMessageStore.setState({
      messages: {
        [OFFLINE_RETICULUM_IDENTITY_ID]: {
          ['aa'.repeat(32)]: {
            id: 'aa'.repeat(32),
            from: 1,
            to: 123,
            payload: 'rf only dm',
            channelIndex: 0,
            timestamp: attemptTimestamp,
            status: 'acked',
          },
        },
      },
    });

    await waitFor(() => {
      expect(mockOutbox.remove).toHaveBeenCalledWith(70);
    });
    await waitFor(() => {
      expect(result.current.rows.find((r) => r.id === 70)).toBeUndefined();
    });
  });

  it('marks reticulum outbox row failed when matched attempt receipt fails', async () => {
    const now = Date.now();
    const attemptTimestamp = now + 1;
    const row = makeEntry({
      id: 72,
      protocol: 'reticulum',
      payload: 'failed dm',
      toNode: 789,
      viewKey: 'dm:789',
      createdAt: now,
      updatedAt: now,
    });
    vi.mocked(mockOutbox.list).mockResolvedValue([row]);
    const sendFn = vi.fn().mockImplementation(() => {
      useMessageStore.setState({
        messages: {
          [OFFLINE_RETICULUM_IDENTITY_ID]: {
            'reticulum-pending-72': {
              id: 'reticulum-pending-72',
              from: 1,
              to: 789,
              payload: 'failed dm',
              channelIndex: 0,
              timestamp: attemptTimestamp,
              status: 'sending',
            },
          },
        },
      });
      return 'reticulum-pending-72';
    });
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'reticulum', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();

    useMessageStore.setState({
      messages: {
        [OFFLINE_RETICULUM_IDENTITY_ID]: {
          'reticulum-pending-72': {
            id: 'reticulum-pending-72',
            from: 1,
            to: 789,
            payload: 'failed dm',
            channelIndex: 0,
            timestamp: attemptTimestamp,
            status: 'failed',
            error: 'link timeout',
          },
        },
      },
    });

    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        72,
        'failed',
        'chatPanel.reticulumSendFailed',
        expect.any(Number),
        1,
      );
    });
    await waitFor(() => {
      expect(result.current.rows.find((r) => r.id === 72)?.status).toBe('failed');
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();
  });

  it('does not treat a later resend with same payload as this attempt receipt', async () => {
    const now = Date.now();
    const attemptTimestamp = now + 1;
    const row = makeEntry({
      id: 73,
      protocol: 'reticulum',
      payload: 'repeat dm',
      toNode: 321,
      viewKey: 'dm:321',
      createdAt: now,
      updatedAt: now,
    });
    vi.mocked(mockOutbox.list).mockResolvedValue([row]);
    const sendFn = vi.fn().mockImplementation(() => {
      useMessageStore.setState({
        messages: {
          [OFFLINE_RETICULUM_IDENTITY_ID]: {
            'reticulum-pending-73': {
              id: 'reticulum-pending-73',
              from: 1,
              to: 321,
              payload: 'repeat dm',
              channelIndex: 0,
              timestamp: attemptTimestamp,
              status: 'sending',
            },
            'older-acked': {
              id: 'older-acked',
              from: 1,
              to: 321,
              payload: 'repeat dm',
              channelIndex: 0,
              timestamp: now - 60_000,
              status: 'acked',
            },
          },
        },
      });
      return 'reticulum-pending-73';
    });
    renderHook(() =>
      useChatOutbox({
        protocol: 'reticulum',
        isSendAvailable: true,
        reticulumReceiptTimeoutMs: 1,
        sendFn,
      }),
    );
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });

    useMessageStore.setState({
      messages: {
        [OFFLINE_RETICULUM_IDENTITY_ID]: {
          'reticulum-pending-73': {
            id: 'reticulum-pending-73',
            from: 1,
            to: 321,
            payload: 'repeat dm',
            channelIndex: 0,
            timestamp: attemptTimestamp,
            status: 'sending',
          },
          'later-acked': {
            id: 'later-acked',
            from: 1,
            to: 321,
            payload: 'repeat dm',
            channelIndex: 0,
            timestamp: now + 60_000,
            status: 'acked',
          },
        },
      },
    });

    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        73,
        'failed',
        'chatPanel.reticulumSendTimeout',
        expect.any(Number),
        1,
      );
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();
  });

  it('does not complete an outbox row from a same-content concurrent send', async () => {
    const now = Date.now();
    const row = makeEntry({
      id: 74,
      protocol: 'reticulum',
      payload: 'same text',
      toNode: 111,
      viewKey: 'dm:111',
      createdAt: now,
      updatedAt: now,
    });
    vi.mocked(mockOutbox.list).mockResolvedValue([row]);
    const sendFn = vi.fn().mockImplementation(() => {
      useMessageStore.setState({
        messages: {
          [OFFLINE_RETICULUM_IDENTITY_ID]: {
            'reticulum-pending-74': {
              id: 'reticulum-pending-74',
              from: 1,
              to: 111,
              payload: 'same text',
              channelIndex: 0,
              timestamp: now + 1,
              status: 'sending',
            },
            'reticulum-pending-concurrent': {
              id: 'reticulum-pending-concurrent',
              from: 1,
              to: 111,
              payload: 'same text',
              channelIndex: 0,
              timestamp: now + 2,
              status: 'sending',
            },
          },
        },
      });
      return 'reticulum-pending-74';
    });
    const { result } = renderHook(() =>
      useChatOutbox({
        protocol: 'reticulum',
        isSendAvailable: true,
        reticulumReceiptTimeoutMs: 1,
        sendFn,
      }),
    );
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });

    useMessageStore.setState({
      messages: {
        [OFFLINE_RETICULUM_IDENTITY_ID]: {
          'reticulum-pending-74': {
            id: 'reticulum-pending-74',
            from: 1,
            to: 111,
            payload: 'same text',
            channelIndex: 0,
            timestamp: now + 1,
            status: 'sending',
          },
          'reticulum-pending-concurrent': {
            id: 'reticulum-pending-concurrent',
            from: 1,
            to: 111,
            payload: 'same text',
            channelIndex: 0,
            timestamp: now + 2,
            status: 'acked',
          },
        },
      },
    });

    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        74,
        'failed',
        'chatPanel.reticulumSendTimeout',
        expect.any(Number),
        1,
      );
    });
    await waitFor(() => {
      expect(result.current.rows.find((r) => r.id === 74)?.status).toBe('failed');
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();
  });

  it('marks reticulum outbox row failed on receipt timeout', async () => {
    const now = Date.now();
    const row = makeEntry({
      id: 71,
      protocol: 'reticulum',
      payload: 'timeout dm',
      toNode: 456,
      viewKey: 'dm:456',
      createdAt: now,
      updatedAt: now,
    });
    vi.mocked(mockOutbox.list).mockResolvedValue([row]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatOutbox({
        protocol: 'reticulum',
        isSendAvailable: true,
        reticulumReceiptTimeoutMs: 1,
        sendFn,
      }),
    );
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        71,
        'failed',
        'chatPanel.reticulumSendTimeout',
        expect.any(Number),
        1,
      );
    });
    await waitFor(() => {
      expect(result.current.rows.find((r) => r.id === 71)?.status).toBe('failed');
    });
  });

  describe('emergency priority', () => {
    it('isEmergencyOutboxPriority only matches emergency rows', () => {
      expect(isEmergencyOutboxPriority(makeEntry({ priority: 'emergency' }))).toBe(true);
      expect(isEmergencyOutboxPriority(makeEntry())).toBe(false);
    });

    it('skips normal rows older than 24h but still drains emergency rows past 24h', async () => {
      const old = Date.now() - OUTBOX_MAX_AGE_MS - 60_000;
      const normal = makeEntry({ id: 100, protocol: 'meshcore', payload: 'stale', createdAt: old });
      const emergency = makeEntry({
        id: 101,
        protocol: 'meshcore',
        payload: 'mayday',
        createdAt: old,
        priority: 'emergency',
      });
      vi.mocked(mockOutbox.list).mockResolvedValue([normal, emergency]);
      const sendFn = vi.fn().mockResolvedValue(undefined);
      renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));
      await waitFor(() => {
        expect(mockOutbox.remove).toHaveBeenCalledWith(101);
      });
      expect(sendFn).toHaveBeenCalledTimes(1);
      expect(sendFn).toHaveBeenCalledWith('mayday', 0, undefined, undefined);
    });

    it('keeps scheduling nextRetryAt for emergency rows beyond MAX_ATTEMPTS', async () => {
      const entry = makeEntry({ id: 102, attemptCount: 7, priority: 'emergency' });
      vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
      const sendFn = vi.fn().mockRejectedValue(new Error('radio busy'));
      const { result } = renderHook(() =>
        useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
      );
      await waitFor(() => {
        expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
          102,
          'failed',
          'chatPanel.sendFailed',
          expect.any(Number),
          8,
        );
      });
      await waitFor(() => {
        expect(result.current.rows.find((r) => r.id === 102)?.nextRetryAt).toEqual(
          expect.any(Number),
        );
      });
    });

    it('still blocks emergency rows on encryption errors without retry', async () => {
      const entry = makeEntry({ id: 103, priority: 'emergency' });
      vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
      const sendFn = vi.fn().mockRejectedValue(new Error('no encryption key'));
      renderHook(() => useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }));
      await waitFor(() => {
        expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
          103,
          'blocked',
          'chatPanel.sendErrors.encryptionBlocked',
          undefined,
          1,
        );
      });
    });

    it('queue preserves emergency priority on the stored row', async () => {
      const sendFn = vi.fn();
      const { result } = renderHook(() =>
        useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn }),
      );
      const row = await result.current.queue({
        protocol: 'meshtastic',
        viewKey: 'ch:0',
        channel: 0,
        toNode: null,
        payload: 'mayday',
        replyId: null,
        status: 'queued',
        error: null,
        nextRetryAt: null,
        groupId: null,
        groupIndex: null,
        groupTotal: null,
        priority: 'emergency',
      });
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'emergency' }),
      );
      expect(row.priority).toBe('emergency');
      await waitFor(() => {
        expect(result.current.rows.find((r) => r.id === 99)?.priority).toBe('emergency');
      });
      expect(sendFn).not.toHaveBeenCalled();
    });

    const emergencyInput = (payload: string) => ({
      protocol: 'meshtastic',
      viewKey: 'ch:0',
      channel: 0,
      toNode: null,
      payload,
      replyId: null,
      status: 'queued' as const,
      error: null,
      nextRetryAt: null,
      groupId: null,
      groupIndex: null,
      groupTotal: null,
      priority: 'emergency' as const,
    });

    async function queueOverCap(existing: OutboxEntry[], newPayload = 'MECP/0/M01') {
      const newRow = makeEntry({
        id: 99,
        priority: 'emergency',
        payload: newPayload,
        createdAt: Date.now(),
      });
      vi.mocked(mockOutbox.add).mockResolvedValue(newRow);
      const { result } = renderHook(() =>
        useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn: vi.fn() }),
      );
      await waitFor(() => {
        expect(mockOutbox.list).toHaveBeenCalled();
      });
      vi.mocked(mockOutbox.list).mockResolvedValue([...existing, newRow]);
      await result.current.queue(emergencyInput(newPayload));
    }

    it('isMaydayEmergencyOutboxPayload only matches MECP severity 0', () => {
      expect(isMaydayEmergencyOutboxPayload('MECP/0/M01 2pax')).toBe(true);
      expect(isMaydayEmergencyOutboxPayload('mecp/0/M01')).toBe(true);
      expect(isMaydayEmergencyOutboxPayload('MECP/1/T04')).toBe(false);
      expect(isMaydayEmergencyOutboxPayload('MECP/01/M01')).toBe(false);
      expect(isMaydayEmergencyOutboxPayload('hello MECP/0/M01')).toBe(false);
    });

    it('blocks the oldest active non-MAYDAY emergency row when the soft cap is exceeded', async () => {
      const base = Date.now() - 10_000;
      // One already-blocked row plus CAP active rows: blocked rows do not count toward the cap.
      const existing = Array.from({ length: EMERGENCY_OUTBOX_SOFT_CAP + 1 }, (_, i) =>
        makeEntry({
          id: 200 + i,
          priority: 'emergency',
          payload: 'MECP/2/M01',
          status: i === 0 ? 'blocked' : 'failed',
          createdAt: base + i,
        }),
      );
      await queueOverCap(existing);
      expect(mockOutbox.updateStatus).toHaveBeenCalledTimes(1);
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        201,
        'blocked',
        'chatPanel.outboxEmergencyCapBlocked',
        undefined,
      );
    });

    it('ignores blocked rows when counting toward the soft cap', async () => {
      const blocked = Array.from({ length: EMERGENCY_OUTBOX_SOFT_CAP }, (_, i) =>
        makeEntry({ id: 400 + i, priority: 'emergency', status: 'blocked', payload: 'MECP/2/M01' }),
      );
      const active = makeEntry({ id: 450, priority: 'emergency', payload: 'MECP/2/M01' });
      await queueOverCap([...blocked, active]);
      expect(mockOutbox.updateStatus).not.toHaveBeenCalled();
    });

    it('prefers the least urgent severity over older more urgent rows', async () => {
      const base = Date.now() - 10_000;
      const existing = Array.from({ length: EMERGENCY_OUTBOX_SOFT_CAP }, (_, i) =>
        makeEntry({
          id: 500 + i,
          priority: 'emergency',
          payload: i === 5 ? 'MECP/3/L01' : 'MECP/1/T04',
          status: 'failed',
          createdAt: base + i,
        }),
      );
      await queueOverCap(existing);
      expect(mockOutbox.updateStatus).toHaveBeenCalledTimes(1);
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        505,
        'blocked',
        'chatPanel.outboxEmergencyCapBlocked',
        undefined,
      );
    });

    it('never blocks a MAYDAY row; allows temporary over-cap when only MAYDAYs remain', async () => {
      const { restore } = mockConsoleWarn();
      try {
        const existing = Array.from({ length: EMERGENCY_OUTBOX_SOFT_CAP }, (_, i) =>
          makeEntry({
            id: 600 + i,
            priority: 'emergency',
            payload: 'MECP/0/M01',
            status: 'failed',
            createdAt: Date.now() - 10_000 + i,
          }),
        );
        await queueOverCap(existing, 'MECP/2/M01');
        expect(mockOutbox.updateStatus).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('drains emergency rows before older normal rows', async () => {
      const base = Date.now() - 10_000;
      const normalOld = makeEntry({
        id: 700,
        protocol: 'meshcore',
        payload: 'n1',
        createdAt: base,
      });
      const emergencyNew = makeEntry({
        id: 701,
        protocol: 'meshcore',
        payload: 'e2',
        createdAt: base + 2,
        priority: 'emergency',
      });
      const emergencyOld = makeEntry({
        id: 702,
        protocol: 'meshcore',
        payload: 'e1',
        createdAt: base + 1,
        priority: 'emergency',
      });
      vi.mocked(mockOutbox.list).mockResolvedValue([normalOld, emergencyNew, emergencyOld]);
      const sendFn = vi.fn().mockResolvedValue(undefined);
      renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));
      await waitFor(() => {
        expect(sendFn).toHaveBeenCalledTimes(3);
      });
      expect(sendFn.mock.calls.map((c: unknown[]) => c[0])).toEqual(['e1', 'e2', 'n1']);
    });

    it('earliestEmergencyRetryAt only considers future emergency queued/failed rows', () => {
      const now = 1_000_000;
      const rows = [
        makeEntry({ id: 1, priority: 'emergency', status: 'failed', nextRetryAt: now + 5_000 }),
        makeEntry({ id: 2, priority: 'emergency', status: 'queued', nextRetryAt: now + 1_000 }),
        makeEntry({ id: 3, priority: 'normal', status: 'failed', nextRetryAt: now + 10 }),
        makeEntry({ id: 4, priority: 'emergency', status: 'blocked', nextRetryAt: now + 20 }),
        makeEntry({ id: 5, priority: 'emergency', status: 'failed', nextRetryAt: now - 1 }),
      ];
      expect(earliestEmergencyRetryAt(rows, now)).toBe(now + 1_000);
      expect(earliestEmergencyRetryAt([], now)).toBeNull();
    });

    it('wakes a drain at the earliest emergency nextRetryAt after a failed send', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { restore } = mockConsoleWarn();
      try {
        const entry = makeEntry({ id: 800, protocol: 'meshcore', priority: 'emergency' });
        vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
        const sendFn = vi
          .fn()
          .mockRejectedValueOnce(new Error('radio busy'))
          .mockResolvedValue(undefined);
        renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));
        await waitFor(() => {
          expect(sendFn).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
          expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
            800,
            'failed',
            expect.any(String),
            expect.any(Number),
            1,
          );
        });
        vi.mocked(mockOutbox.list).mockResolvedValue([
          { ...entry, status: 'failed', attemptCount: 1, nextRetryAt: Date.now() - 1 },
        ]);
        await vi.advanceTimersByTimeAsync(31_000);
        await waitFor(() => {
          expect(sendFn).toHaveBeenCalledTimes(2);
        });
      } finally {
        restore();
        vi.useRealTimers();
      }
    });

    it('does not enforce the soft cap at or below the limit', async () => {
      const existing = Array.from({ length: EMERGENCY_OUTBOX_SOFT_CAP - 1 }, (_, i) =>
        makeEntry({ id: 300 + i, priority: 'emergency', status: 'failed' }),
      );
      const newRow = makeEntry({ id: 99, priority: 'emergency' });
      vi.mocked(mockOutbox.add).mockResolvedValue(newRow);
      vi.mocked(mockOutbox.list).mockResolvedValue([...existing, newRow]);
      const sendFn = vi.fn();
      const { result } = renderHook(() =>
        useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn }),
      );
      await result.current.queue({
        protocol: 'meshtastic',
        viewKey: 'ch:0',
        channel: 0,
        toNode: null,
        payload: 'mayday',
        replyId: null,
        status: 'queued',
        error: null,
        nextRetryAt: null,
        groupId: null,
        groupIndex: null,
        groupTotal: null,
        priority: 'emergency',
      });
      expect(mockOutbox.updateStatus).not.toHaveBeenCalledWith(
        expect.any(Number),
        'blocked',
        'chatPanel.outboxEmergencyCapBlocked',
        undefined,
      );
    });
  });
});
