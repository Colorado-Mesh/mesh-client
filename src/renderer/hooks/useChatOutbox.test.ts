import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isMeshcoreSendTooFast,
  resetMeshcoreSendRateForTests,
} from '@/renderer/lib/meshcoreSendRateNotice';
import { resetMeshtasticTextSendPacingForTests } from '@/renderer/lib/meshtasticTextSendPacing';
import { OFFLINE_RETICULUM_IDENTITY_ID } from '@/renderer/lib/offlineProtocolIdentities';
import { MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS } from '@/renderer/lib/timeConstants';
import { useMessageStore } from '@/renderer/stores/messageStore';
import type { OutboxEntry } from '@/shared/electron-api.types';

import { useChatOutbox } from './useChatOutbox';

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
    ...overrides,
  };
}

describe('useChatOutbox', () => {
  const mockOutbox = window.electronAPI.chat.outbox;

  beforeEach(() => {
    resetMeshtasticTextSendPacingForTests();
    resetMeshcoreSendRateForTests();
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
        'radio busy',
        expect.any(Number),
        1,
      );
    });
    await waitFor(() => {
      const row = result.current.rows.find((r) => r.id === 7);
      expect(row?.status).toBe('failed');
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
        'no encryption key',
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
        expect.stringMatching(/multi-part|shorter/i),
        undefined,
      );
    });
    expect(sendFn).not.toHaveBeenCalled();
    await waitFor(() => {
      const row = result.current.rows.find((r) => r.id === 60);
      expect(row?.status).toBe('blocked');
      expect(row?.error).toMatch(/multi-part|shorter/i);
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
      expect.stringMatching(/multi-part|shorter/i),
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
        'sync boom',
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
        'radio busy',
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
        'timeout',
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
        expect.stringContaining('outbox remove failed'),
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
    const sendFn = vi.fn().mockResolvedValue(undefined);
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
          m1: {
            id: 'm1',
            from: 1,
            to: 123,
            payload: 'rf only dm',
            channelIndex: 0,
            timestamp: createdAt + 1,
            status: 'sending',
          },
        },
      },
    });
    expect(mockOutbox.remove).not.toHaveBeenCalled();

    useMessageStore.setState({
      messages: {
        [OFFLINE_RETICULUM_IDENTITY_ID]: {
          m1: {
            id: 'm1',
            from: 1,
            to: 123,
            payload: 'rf only dm',
            channelIndex: 0,
            timestamp: createdAt + 1,
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
        'Send timed out. The Reticulum stack may be starting or busy — try again.',
        expect.any(Number),
        1,
      );
    });
    await waitFor(() => {
      expect(result.current.rows.find((r) => r.id === 71)?.status).toBe('failed');
    });
  });
});
