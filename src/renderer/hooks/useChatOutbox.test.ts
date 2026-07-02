import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const entry = makeEntry({ id: 4, status: 'failed' });
    vi.mocked(mockOutbox.list).mockResolvedValue([entry]);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
    );
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(0);
    }); // initially drains the failed row and fails again
    // Now manually call retry
    vi.mocked(mockOutbox.updateStatus).mockResolvedValue(undefined);
    vi.mocked(mockOutbox.list).mockResolvedValue([{ ...entry, status: 'queued' }]);
    result.current.retry(4);
    await waitFor(() => {
      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(4, 'queued', undefined, undefined);
    });
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
});
