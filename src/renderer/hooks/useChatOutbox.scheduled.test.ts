import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetChatOutboxDrainLocksForTests } from '@/renderer/lib/chatOutboxDrain';
import { resetMeshcoreSendRateForTests } from '@/renderer/lib/meshcoreSendRateNotice';
import { resetMeshtasticTextSendPacingForTests } from '@/renderer/lib/meshtasticTextSendPacing';
import type { MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry } from '@/shared/electron-api.types';

import {
  drainChatOutboxOnce,
  earliestEmergencyRetryAt,
  isAppDrainedOutboxRow,
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

const HOUR = 60 * 60 * 1000;

describe('scheduled send via durable outbox', () => {
  const outbox = window.electronAPI.chat.outbox;

  beforeEach(() => {
    resetMeshtasticTextSendPacingForTests();
    resetMeshcoreSendRateForTests();
    resetChatOutboxDrainLocksForTests();
    vi.mocked(outbox.list).mockReset().mockResolvedValue([]);
    vi.mocked(outbox.add).mockReset();
    vi.mocked(outbox.updateStatus).mockReset().mockResolvedValue(undefined);
    vi.mocked(outbox.remove).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<MeshProtocol>(['meshtastic', 'meshcore', 'reticulum'])(
    'does not send a future scheduled row but sends it once due (%s)',
    async (protocol) => {
      const future = makeEntry({ id: 10, protocol, nextRetryAt: Date.now() + HOUR });
      const sendFn = vi.fn().mockResolvedValue('ok');
      vi.mocked(outbox.list).mockResolvedValue([future]);
      await drainChatOutboxOnce({ protocol, sendFn, isSendAvailable: () => true });
      expect(sendFn).not.toHaveBeenCalled();
      expect(outbox.updateStatus).not.toHaveBeenCalled();

      // Simulates a restart after the schedule elapsed: the same persisted row now drains.
      vi.mocked(outbox.list).mockResolvedValue([{ ...future, nextRetryAt: Date.now() - 1000 }]);
      if (protocol === 'reticulum') {
        // Reticulum drain requires a receipt; this test only covers the eligibility gate.
        sendFn.mockResolvedValue(undefined);
      }
      await drainChatOutboxOnce({
        protocol,
        sendFn,
        isSendAvailable: () => true,
        reticulumReceiptTimeoutMs: 1,
      });
      expect(sendFn).toHaveBeenCalledTimes(1);
      expect(sendFn.mock.calls[0][0]).toBe('hello');
    },
  );

  it('treats a scheduled row as App-drained and arms the retry timer for it', () => {
    const at = Date.now() + HOUR;
    const scheduled = makeEntry({ id: 2, nextRetryAt: at });
    const plain = makeEntry({ id: 3, nextRetryAt: null });
    expect(isAppDrainedOutboxRow(scheduled)).toBe(true);
    expect(isAppDrainedOutboxRow(plain)).toBe(false);
    expect(earliestEmergencyRetryAt([plain, scheduled])).toBe(at);
    // A retried (attempted) normal row is not App-drained.
    expect(
      isAppDrainedOutboxRow(makeEntry({ attemptCount: 1, nextRetryAt: Date.now() + HOUR })),
    ).toBe(false);
  });

  it('ages a scheduled row from its send time, not its creation time', async () => {
    const protocol: MeshProtocol = 'meshtastic';
    const sendFn = vi.fn().mockResolvedValue(undefined);
    // Created long ago (beyond the 24h cap) but scheduled to fire just now.
    vi.mocked(outbox.list).mockResolvedValue([
      makeEntry({
        id: 4,
        createdAt: Date.now() - OUTBOX_MAX_AGE_MS - HOUR,
        nextRetryAt: Date.now() - 1000,
      }),
    ]);
    await drainChatOutboxOnce({ protocol, sendFn, isSendAvailable: () => true });
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('App rowFilter sends scheduled rows without touching other normal rows', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    vi.mocked(outbox.list).mockResolvedValue([
      makeEntry({ id: 5, payload: 'scheduled', nextRetryAt: Date.now() - 1000 }),
      makeEntry({ id: 6, payload: 'plain', nextRetryAt: null }),
    ]);
    await drainChatOutboxOnce({
      protocol: 'meshtastic',
      sendFn,
      isSendAvailable: () => true,
      rowFilter: isAppDrainedOutboxRow,
    });
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0]).toBe('scheduled');
  });

  it('keeps a failed scheduled send as a normal retry row (not forever)', async () => {
    const sendFn = vi.fn().mockRejectedValue(new Error('radio busy'));
    vi.mocked(outbox.list).mockResolvedValue([
      makeEntry({ id: 7, nextRetryAt: Date.now() - 1000 }),
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await drainChatOutboxOnce({
      protocol: 'meshtastic',
      sendFn,
      isSendAvailable: () => true,
    });
    warn.mockRestore();
    const updated = result.rows.find((r) => r.id === 7);
    expect(updated?.status).toBe('failed');
    expect(updated?.attemptCount).toBe(1);
    expect(updated?.nextRetryAt).not.toBeNull();
  });

  describe('editScheduled', () => {
    async function setup(rows: OutboxEntry[]) {
      vi.mocked(outbox.list).mockResolvedValue(rows);
      const sendFn = vi.fn().mockResolvedValue(undefined);
      const hook = renderHook(() =>
        useChatOutbox({ protocol: 'meshtastic', isSendAvailable: false, sendFn }),
      );
      await waitFor(() => {
        expect(hook.result.current.rows).toHaveLength(rows.length);
      });
      return hook;
    }

    it('reschedules without changing text', async () => {
      const at = Date.now() + HOUR;
      const { result } = await setup([makeEntry({ id: 20, nextRetryAt: at })]);
      const next = Date.now() + 2 * HOUR;
      let ok = false;
      await act(async () => {
        ok = await result.current.editScheduled(20, { scheduledAt: next });
      });
      expect(ok).toBe(true);
      expect(outbox.updateStatus).toHaveBeenCalledWith(20, 'queued', undefined, next);
      expect(outbox.add).not.toHaveBeenCalled();
      expect(result.current.rows[0].nextRetryAt).toBe(next);
    });

    it('replaces the row when the text changes (add before remove)', async () => {
      const at = Date.now() + HOUR;
      const { result } = await setup([makeEntry({ id: 21, nextRetryAt: at, payload: 'old' })]);
      vi.mocked(outbox.add).mockImplementation((entry) =>
        Promise.resolve(makeEntry({ ...(entry as Partial<OutboxEntry>), id: 22 })),
      );
      const next = Date.now() + 3 * HOUR;
      let ok = false;
      await act(async () => {
        ok = await result.current.editScheduled(21, { payload: ' new ', scheduledAt: next });
      });
      expect(ok).toBe(true);
      expect(outbox.add).toHaveBeenCalledWith(
        expect.objectContaining({ payload: 'new', nextRetryAt: next, viewKey: 'ch:0' }),
      );
      expect(outbox.remove).toHaveBeenCalledWith(21);
      expect(vi.mocked(outbox.add).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(outbox.remove).mock.invocationCallOrder[0],
      );
      expect(result.current.rows.map((r) => r.id)).toEqual([22]);
      expect(result.current.rows[0].payload).toBe('new');
    });

    it('rolls back the new row and keeps the original when remove fails', async () => {
      const { result } = await setup([
        makeEntry({ id: 23, nextRetryAt: Date.now() + HOUR, payload: 'old' }),
      ]);
      vi.mocked(outbox.add).mockResolvedValue(makeEntry({ id: 24, payload: 'new' }));
      vi.mocked(outbox.remove).mockImplementation((id: number) =>
        id === 23 ? Promise.reject(new Error('db locked')) : Promise.resolve(undefined),
      );
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let ok = true;
      await act(async () => {
        ok = await result.current.editScheduled(23, {
          payload: 'new',
          scheduledAt: Date.now() + 2 * HOUR,
        });
      });
      warn.mockRestore();
      expect(ok).toBe(false);
      expect(outbox.remove).toHaveBeenCalledWith(24);
      expect(result.current.rows.map((r) => r.id)).toEqual([23]);
      expect(result.current.rows[0].payload).toBe('old');
    });

    it('reschedules every part of a multi-part message together', async () => {
      const at = Date.now() + HOUR;
      const { result } = await setup([
        makeEntry({ id: 30, groupId: 'g', groupIndex: 0, groupTotal: 2, nextRetryAt: at }),
        makeEntry({ id: 31, groupId: 'g', groupIndex: 1, groupTotal: 2, nextRetryAt: at }),
      ]);
      const next = Date.now() + 2 * HOUR;
      let ok = false;
      await act(async () => {
        ok = await result.current.editScheduled(30, { scheduledAt: next });
      });
      expect(ok).toBe(true);
      expect(outbox.updateStatus).toHaveBeenCalledWith(30, 'queued', undefined, next);
      expect(outbox.updateStatus).toHaveBeenCalledWith(31, 'queued', undefined, next);
      expect(result.current.rows.every((r) => r.nextRetryAt === next)).toBe(true);
    });

    it('refuses to re-word multi-part rows, past times, and non-scheduled rows', async () => {
      const { result } = await setup([
        makeEntry({
          id: 40,
          groupId: 'g',
          groupIndex: 0,
          groupTotal: 2,
          nextRetryAt: Date.now() + HOUR,
        }),
        makeEntry({ id: 41, attemptCount: 1, status: 'failed', nextRetryAt: Date.now() + HOUR }),
      ]);
      let multipart = true;
      let past = true;
      let attempted = true;
      await act(async () => {
        multipart = await result.current.editScheduled(40, {
          payload: 'changed',
          scheduledAt: Date.now() + 2 * HOUR,
        });
        past = await result.current.editScheduled(40, { scheduledAt: Date.now() - 1 });
        attempted = await result.current.editScheduled(41, { scheduledAt: Date.now() + 2 * HOUR });
      });
      expect([multipart, past, attempted]).toEqual([false, false, false]);
      expect(outbox.updateStatus).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('cancel removes a scheduled row', async () => {
      const { result } = await setup([makeEntry({ id: 50, nextRetryAt: Date.now() + HOUR })]);
      act(() => {
        result.current.cancel(50);
      });
      await waitFor(() => {
        expect(result.current.rows).toHaveLength(0);
      });
      expect(outbox.remove).toHaveBeenCalledWith(50);
    });

    it('send now (retry) clears the schedule and drains', async () => {
      const row = makeEntry({ id: 60, nextRetryAt: Date.now() + HOUR });
      vi.mocked(outbox.list).mockResolvedValue([row]);
      const sendFn = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useChatOutbox({ protocol: 'meshtastic', isSendAvailable: true, sendFn }),
      );
      await waitFor(() => {
        expect(result.current.rows).toHaveLength(1);
      });
      expect(sendFn).not.toHaveBeenCalled();
      vi.mocked(outbox.list).mockResolvedValue([{ ...row, nextRetryAt: null }]);
      act(() => {
        result.current.retry(60);
      });
      await waitFor(() => {
        expect(sendFn).toHaveBeenCalledTimes(1);
      });
      expect(outbox.updateStatus).toHaveBeenCalledWith(60, 'queued', undefined, undefined);
    });
  });
});
