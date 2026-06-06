import { useCallback, useEffect, useRef, useState } from 'react';

import type { MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry, OutboxEntryInput, OutboxStatus } from '@/shared/electron-api.types';

export type { OutboxEntry };

// Retry backoff delays in ms: 30s, 2m, 10m, 10m (max 5 attempts then permanently failed)
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 600_000];
const MAX_ATTEMPTS = 5;

export interface UseChatOutboxOptions {
  protocol: MeshProtocol;
  isSendAvailable: boolean;
  sendFn: (
    text: string,
    channel: number,
    destination?: number,
    replyId?: number,
  ) => Promise<void> | void;
}

export interface UseChatOutbox {
  rows: OutboxEntry[];
  queue: (entry: OutboxEntryInput) => Promise<OutboxEntry>;
  retry: (id: number) => void;
  cancel: (id: number) => void;
}

export function useChatOutbox({
  protocol,
  isSendAvailable,
  sendFn,
}: UseChatOutboxOptions): UseChatOutbox {
  const [rows, setRows] = useState<OutboxEntry[]>([]);
  const drainingRef = useRef(false);
  const isSendAvailableRef = useRef(isSendAvailable);
  const sendFnRef = useRef(sendFn);
  useEffect(() => {
    isSendAvailableRef.current = isSendAvailable;
    sendFnRef.current = sendFn;
  }, [isSendAvailable, sendFn]);

  // Load outbox rows on mount; reset any 'sending' rows left from a prior crash to 'queued'
  useEffect(() => {
    window.electronAPI.chat.outbox
      .list(protocol)
      .then(async (loaded) => {
        const stale = loaded.filter((r) => r.status === 'sending');
        if (stale.length > 0) {
          await Promise.all(
            stale.map((r) => window.electronAPI.chat.outbox.updateStatus(r.id, 'queued')),
          );
        }
        setRows(
          loaded.map((r) =>
            r.status === 'sending' ? { ...r, status: 'queued' satisfies OutboxStatus } : r,
          ),
        );
      })
      .catch((err: unknown) => {
        console.warn('[useChatOutbox] load failed', err);
      });
  }, [protocol]);

  const updateRow = useCallback((id: number, patch: Partial<OutboxEntry>) => {
    setRows((prev) => prev.map((r: OutboxEntry) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback((id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const drainOnce = useCallback(async () => {
    if (drainingRef.current || !isSendAvailable) return;
    drainingRef.current = true;
    try {
      // Re-fetch fresh rows so we always drain the canonical state
      const freshRows = await window.electronAPI.chat.outbox.list(protocol);
      setRows(freshRows);
      const now = Date.now();
      const eligible = freshRows.filter(
        (r) =>
          (r.status === 'queued' || r.status === 'failed') &&
          (r.nextRetryAt == null || r.nextRetryAt <= now),
      );
      for (const row of eligible) {
        if (!isSendAvailableRef.current) break;
        // Mark as sending optimistically
        await window.electronAPI.chat.outbox.updateStatus(row.id, 'sending');
        updateRow(row.id, { status: 'sending' });
        try {
          await sendFnRef.current(
            row.payload,
            row.channel,
            row.toNode ?? undefined,
            row.replyId ?? undefined,
          );
          // Success — remove from outbox
          await window.electronAPI.chat.outbox.remove(row.id);
          removeRow(row.id);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isBlocked = /no.?encr|no.?key|encryption/i.test(errMsg);
          const nextAttemptCount = row.attemptCount + 1;
          if (isBlocked) {
            const newStatus: OutboxStatus = 'blocked';
            await window.electronAPI.chat.outbox.updateStatus(row.id, newStatus, errMsg);
            updateRow(row.id, { status: newStatus, error: errMsg, attemptCount: nextAttemptCount });
          } else if (nextAttemptCount >= MAX_ATTEMPTS) {
            const newStatus: OutboxStatus = 'failed';
            await window.electronAPI.chat.outbox.updateStatus(row.id, newStatus, errMsg);
            updateRow(row.id, { status: newStatus, error: errMsg, attemptCount: nextAttemptCount });
          } else {
            const delayMs =
              RETRY_DELAYS_MS[Math.min(nextAttemptCount - 1, RETRY_DELAYS_MS.length - 1)];
            const nextRetryAt = Date.now() + delayMs;
            const newStatus: OutboxStatus = 'failed';
            await window.electronAPI.chat.outbox.updateStatus(
              row.id,
              newStatus,
              errMsg,
              nextRetryAt,
            );
            updateRow(row.id, {
              status: newStatus,
              error: errMsg,
              attemptCount: nextAttemptCount,
              nextRetryAt,
            });
          }
          console.warn('[useChatOutbox] send failed for outbox row', row.id, errMsg);
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [protocol, isSendAvailable, updateRow, removeRow]);

  // Drain when send becomes available, or when protocol changes while already connected
  useEffect(() => {
    if (isSendAvailable) {
      void drainOnce();
    }
    // drainOnce intentionally omitted: only trigger on availability/protocol change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSendAvailable, protocol]);

  const queue = useCallback(
    async (entry: OutboxEntryInput): Promise<OutboxEntry> => {
      const newRow = await window.electronAPI.chat.outbox.add(entry);
      setRows((prev) => [...prev, newRow]);
      if (isSendAvailable) {
        // Attempt immediate drain on next tick
        setTimeout(() => void drainOnce(), 0);
      }
      return newRow;
    },
    [drainOnce, isSendAvailable],
  );

  const retry = useCallback(
    (id: number) => {
      // Reset status to queued with no retry delay, then drain
      void window.electronAPI.chat.outbox
        .updateStatus(id, 'queued', undefined, undefined)
        .then(() => {
          updateRow(id, { status: 'queued', error: null, nextRetryAt: null });
          return drainOnce();
        })
        .catch((err: unknown) => {
          console.warn('[useChatOutbox] retry failed', err);
        });
    },
    [drainOnce, updateRow],
  );

  const cancel = useCallback(
    (id: number) => {
      void window.electronAPI.chat.outbox
        .remove(id)
        .then(() => {
          removeRow(id);
        })
        .catch((err: unknown) => {
          console.warn('[useChatOutbox] cancel failed', err);
        });
    },
    [removeRow],
  );

  return { rows, queue, retry, cancel };
}
