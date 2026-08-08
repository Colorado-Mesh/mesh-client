import { useCallback, useEffect, useRef, useState } from 'react';

import type { MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry, OutboxEntryInput, OutboxStatus } from '@/shared/electron-api.types';

import { registerChatOutboxDrainListener } from '../lib/chatOutboxDrain';
import { recordMeshcoreSend } from '../lib/meshcoreSendRateNotice';
import { withMeshtasticTextSendPacing } from '../lib/meshtasticTextSendPacing';

export type { OutboxEntry };

// Retry backoff delays in ms: 30s, 2m, 10m, 10m (max 5 attempts then permanently failed)
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 600_000];
const MAX_ATTEMPTS = 5;
/** Drop outbox rows older than this from automatic drain (manual retry still allowed). */
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isEncryptionBlockedError(errMsg: string): boolean {
  return /no.?encr|no.?key|encryption/i.test(errMsg);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reset interrupted `sending` rows to `queued` (crash / failed status persist). */
async function recoverStuckSendingRows(listed: OutboxEntry[]): Promise<OutboxEntry[]> {
  const stuckSending = listed.filter((r) => r.status === 'sending');
  if (stuckSending.length === 0) return listed;
  await Promise.all(
    stuckSending.map((r) => window.electronAPI.chat.outbox.updateStatus(r.id, 'queued')),
  );
  return listed.map((r) => (r.status === 'sending' ? { ...r, status: 'queued' as const } : r));
}

function isEligibleForDrain(row: OutboxEntry, now: number): boolean {
  return (
    (row.status === 'queued' || row.status === 'failed') &&
    (row.nextRetryAt == null || row.nextRetryAt <= now) &&
    now - row.createdAt <= OUTBOX_MAX_AGE_MS
  );
}

async function finalizeSuccessfulOutboxSend(
  row: OutboxEntry,
  removeRow: (id: number) => void,
  updateRow: (id: number, patch: Partial<OutboxEntry>) => void,
): Promise<void> {
  try {
    await window.electronAPI.chat.outbox.remove(row.id);
    removeRow(row.id);
  } catch (removeErr: unknown) {
    console.warn('[useChatOutbox] remove after send failed', row.id, removeErr);
    const removeMsg = errMessage(removeErr);
    const error = `delivered; outbox remove failed: ${removeMsg}`;
    const attemptCount = row.attemptCount + 1;
    try {
      await window.electronAPI.chat.outbox.updateStatus(
        row.id,
        'blocked',
        error,
        undefined,
        attemptCount,
      );
    } catch (persistErr: unknown) {
      console.warn('[useChatOutbox] block after remove failure failed', row.id, persistErr);
    }
    updateRow(row.id, { status: 'blocked', error, attemptCount });
  }
}

async function recordOutboxSendFailure(
  row: OutboxEntry,
  err: unknown,
  updateRow: (id: number, patch: Partial<OutboxEntry>) => void,
): Promise<void> {
  const errMsg = errMessage(err);
  const isBlocked = isEncryptionBlockedError(errMsg);
  const nextAttemptCount = row.attemptCount + 1;
  const newStatus: OutboxStatus = isBlocked ? 'blocked' : 'failed';
  const nextRetryAt =
    !isBlocked && nextAttemptCount < MAX_ATTEMPTS
      ? Date.now() + RETRY_DELAYS_MS[Math.min(nextAttemptCount - 1, RETRY_DELAYS_MS.length - 1)]
      : undefined;
  try {
    await window.electronAPI.chat.outbox.updateStatus(
      row.id,
      newStatus,
      errMsg,
      nextRetryAt,
      nextAttemptCount,
    );
  } catch (persistErr: unknown) {
    // Failure point: status may remain 'sending' in SQLite; mount + drain reset
    // sending→queued so the row is not stuck forever.
    console.warn('[useChatOutbox] persist failure status failed', row.id, persistErr);
  }
  updateRow(row.id, {
    status: newStatus,
    error: errMsg,
    attemptCount: nextAttemptCount,
    ...(nextRetryAt != null ? { nextRetryAt } : { nextRetryAt: null }),
  });
  console.warn('[useChatOutbox] send failed for outbox row', row.id, errMsg);
}

async function sendOneOutboxRow(
  row: OutboxEntry,
  sendFn: UseChatOutboxOptions['sendFn'],
  updateRow: (id: number, patch: Partial<OutboxEntry>) => void,
  removeRow: (id: number) => void,
): Promise<void> {
  await window.electronAPI.chat.outbox.updateStatus(row.id, 'sending');
  updateRow(row.id, { status: 'sending' });
  try {
    await sendFn(row.payload, row.channel, row.toNode ?? undefined, row.replyId ?? undefined);
    // Keep the app-wide MeshCore fast-send clock honest: a drained row is airtime too, so a
    // composer send right after a backlog drain should still surface the advisory.
    if (row.protocol === 'meshcore') {
      recordMeshcoreSend();
    }
    await finalizeSuccessfulOutboxSend(row, removeRow, updateRow);
  } catch (err: unknown) {
    // catch-no-log-ok recordOutboxSendFailure logs the send failure
    await recordOutboxSendFailure(row, err, updateRow);
  }
}

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
  drainNow: () => Promise<void>;
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
      const listed = await window.electronAPI.chat.outbox.list(protocol);
      const freshRows = await recoverStuckSendingRows(listed);
      setRows(freshRows);
      const now = Date.now();
      for (const row of freshRows.filter((r) => isEligibleForDrain(r, now))) {
        if (!isSendAvailableRef.current) break;
        const sendRow = () => sendOneOutboxRow(row, sendFnRef.current, updateRow, removeRow);
        // Meshtastic-only pacing, shared with ChatComposer so live sends and outbox drain cannot
        // race firmware's TEXT_MESSAGE_APP RATE_LIMIT_EXCEEDED window. MeshCore drains without a
        // client interval (see the meshcore branch below) — it only advances the fast-send clock.
        if (protocol === 'meshtastic') {
          await withMeshtasticTextSendPacing(sendRow);
        } else {
          await sendRow();
        }
      }
    } catch (err: unknown) {
      console.warn('[useChatOutbox] drainOnce failed', err);
    } finally {
      drainingRef.current = false;
    }
  }, [protocol, isSendAvailable, updateRow, removeRow]);

  // Drain when send becomes available, or when protocol changes while already connected
  useEffect(() => {
    if (isSendAvailable) {
      // Fire-and-forget drain; setState happens asynchronously inside drainOnce.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- availability-driven outbox drain
      void drainOnce();
    }
    // drainOnce intentionally omitted: only trigger on availability/protocol change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSendAvailable, protocol]);

  // Allow runtimes to trigger drain on peer announce / path update
  useEffect(() => {
    return registerChatOutboxDrainListener(protocol, () => {
      void drainOnce();
    });
  }, [protocol, drainOnce]);

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

  return { rows, queue, retry, cancel, drainNow: drainOnce };
}
