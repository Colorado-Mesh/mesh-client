import { useCallback, useEffect, useRef, useState } from 'react';

import type { MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry, OutboxEntryInput, OutboxStatus } from '@/shared/electron-api.types';
import { isMeshProtocol } from '@/shared/meshProtocol';

import {
  registerChatOutboxDrainListener,
  subscribeChatOutboxRowsChanged,
  withChatOutboxDrainLock,
} from '../lib/chatOutboxDrain';
import {
  CHAT_OUTBOX_REMOVE_FAILED_KEY,
  isEncryptionBlockedSendError,
  persistableChatSendError,
} from '../lib/chatSendErrorI18n';
import { incidentNeedsBeaconAck, parseIncidentAckViewKey } from '../lib/mecp/incidentAck';
import { recordMeshcoreSend } from '../lib/meshcoreSendRateNotice';
import { withMeshtasticTextSendPacing } from '../lib/meshtasticTextSendPacing';
import { getRadioCapabilities } from '../lib/radio/providerFactory';
import {
  assertReticulumSendAcked,
  resolveReticulumIdentityId,
  RETICULUM_RECEIPT_TIMEOUT_MS,
} from '../lib/reticulumOutboundReceipt';
import { useIncidentStore } from '../stores/incidentStore';

export type { OutboxEntry };

// Retry backoff delays in ms: 30s, 2m, 10m, 10m (max 5 attempts then permanently failed)
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 600_000];
const MAX_ATTEMPTS = 5;
/** Drop outbox rows older than this from automatic drain (manual retry still allowed). */
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Max live (non-blocked) emergency rows per protocol outbox. Enqueueing past the cap blocks the
 * least-urgent, oldest other emergency row so a stuck backlog cannot grow unbounded. MAYDAY
 * (sev 0) rows are never blocked by the cap — the outbox may temporarily exceed it instead.
 */
export const EMERGENCY_OUTBOX_SOFT_CAP = 20;
const EMERGENCY_CAP_BLOCKED_KEY = 'chatPanel.outboxEmergencyCapBlocked';
/** Per-row send watchdog so a hung TX cannot hold {@link withChatOutboxDrainLock} forever. */
export const OUTBOX_DRAIN_ROW_TIMEOUT_MS = RETICULUM_RECEIPT_TIMEOUT_MS + 15_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MECP_MAYDAY_PAYLOAD_RE = /^MECP\/0\b/i;
const MECP_SEVERITY_PAYLOAD_RE = /^MECP\/(\d)\b/i;

export function isEmergencyOutboxPriority(row: Pick<OutboxEntry, 'priority'>): boolean {
  return row.priority === 'emergency';
}

/** Incident ACK rows tagged via {@link incidentAckViewKey} (normal priority, App-drained). */
export function isIncidentAckOutboxRow(row: Pick<OutboxEntry, 'viewKey'>): boolean {
  return parseIncidentAckViewKey(row.viewKey) != null;
}

/** Rows the App-level drain may send without ChatPanel mounted. */
export function isAppManagedOutboxRow(row: Pick<OutboxEntry, 'priority' | 'viewKey'>): boolean {
  return isEmergencyOutboxPriority(row) || isIncidentAckOutboxRow(row);
}

/** True when an outbox payload is an MECP severity-0 (MAYDAY) report. */
export function isMaydayEmergencyOutboxPayload(payload: string): boolean {
  return MECP_MAYDAY_PAYLOAD_RE.test(payload);
}

/** MECP severity digit, or +Infinity for non-MECP payloads (least urgent for cap eviction). */
function emergencyPayloadSeverity(payload: string): number {
  const match = MECP_SEVERITY_PAYLOAD_RE.exec(payload);
  return match?.[1] != null ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Earliest future `nextRetryAt` among App-managed (`emergency` or incident-ACK) `queued` /
 * `failed` rows, or null when none are waiting on backoff.
 */
export function earliestEmergencyRetryAt(
  rows: readonly OutboxEntry[],
  now: number = Date.now(),
): number | null {
  let earliest: number | null = null;
  for (const r of rows) {
    if (!isAppManagedOutboxRow(r)) continue;
    if (r.status !== 'queued' && r.status !== 'failed') continue;
    if (r.nextRetryAt == null || r.nextRetryAt <= now) continue;
    if (earliest == null || r.nextRetryAt < earliest) earliest = r.nextRetryAt;
  }
  return earliest;
}

/** Clamp a wall-clock target to a safe `setTimeout` delay. */
export function outboxRetryTimerDelayMs(at: number, now: number = Date.now()): number {
  return Math.min(Math.max(0, at - now), MAX_TIMER_DELAY_MS);
}

/** Legacy mesh-client `[i/N] ` chunk prefix on outbox payloads queued before single-packet. */
const LEGACY_MULTIPART_PREFIX_RE = /^\[\d+\/\d+\]\s/;

/**
 * True for durable outbox rows from before MeshCore single-packet: grouped multi-chunk sends
 * (`groupTotal > 1`) and/or payloads already prefixed with `[i/N] `. Single-packet protocols
 * must not TX these on upgrade — quarantine for user cancel/edit instead.
 */
export function isLegacySinglePacketMultipartOutboxRow(row: OutboxEntry): boolean {
  if (!isMeshProtocol(row.protocol)) return false;
  if (getRadioCapabilities(row.protocol).composerMaxChunks > 1) return false;
  if (row.groupTotal != null && row.groupTotal > 1) return true;
  return LEGACY_MULTIPART_PREFIX_RE.test(row.payload);
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
    (isEmergencyOutboxPriority(row) || now - row.createdAt <= OUTBOX_MAX_AGE_MS)
  );
}

/** Drain order: emergency rows first, then oldest first. */
function compareDrainOrder(a: OutboxEntry, b: OutboxEntry): number {
  const pa = isEmergencyOutboxPriority(a) ? 0 : 1;
  const pb = isEmergencyOutboxPriority(b) ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return a.createdAt - b.createdAt;
}

function retryDelayMs(attemptCount: number): number {
  return RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
}

/** Mark the incident ACK'd once a tagged ACK outbox row actually leaves the radio. */
export function applyIncidentAckAfterOutboxSend(
  row: Pick<OutboxEntry, 'viewKey' | 'payload'>,
): void {
  const incidentId = parseIncidentAckViewKey(row.viewKey);
  if (incidentId == null) return;
  const store = useIncidentStore.getState();
  const inc = store.incidents[incidentId];
  if (inc == null || inc.status === 'resolved') return;
  if (incidentNeedsBeaconAck(inc)) {
    store.confirmBeacon(incidentId);
  } else {
    store.recordAck(incidentId, 'local');
  }
}

async function withOutboxDrainRowTimeout<T>(fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('chatPanel.outboxDrainTimeout'));
        }, OUTBOX_DRAIN_ROW_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

async function finalizeSuccessfulOutboxSend(
  row: OutboxEntry,
  removeRow: (id: number) => void,
  updateRow: (id: number, patch: Partial<OutboxEntry>) => void,
): Promise<void> {
  applyIncidentAckAfterOutboxSend(row);
  try {
    await window.electronAPI.chat.outbox.remove(row.id);
    removeRow(row.id);
  } catch (removeErr: unknown) {
    console.warn('[useChatOutbox] remove after send failed', row.id, removeErr);
    const error = CHAT_OUTBOX_REMOVE_FAILED_KEY;
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
  const errMsg = persistableChatSendError(err);
  const rawMsg = err instanceof Error ? err.message : errMsg;
  const isBlocked = isEncryptionBlockedSendError(rawMsg) || isEncryptionBlockedSendError(errMsg);
  const nextAttemptCount = row.attemptCount + 1;
  const newStatus: OutboxStatus = isBlocked ? 'blocked' : 'failed';
  // Emergency rows never stop retrying on attempt count; encryption blocks still halt them.
  const keepRetrying =
    !isBlocked && (isEmergencyOutboxPriority(row) || nextAttemptCount < MAX_ATTEMPTS);
  const nextRetryAt = keepRetrying ? Date.now() + retryDelayMs(nextAttemptCount) : undefined;
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

/**
 * Preserve a legacy multi-part MeshCore outbox row without calling sendFn.
 * Failure point: upgrade-path drain would otherwise TX incomplete `[i/N]` parts;
 * fallback: block with an explanatory error so the user can cancel or rewrite.
 */
async function quarantineLegacyMultipartOutboxRow(
  row: OutboxEntry,
  updateRow: (id: number, patch: Partial<OutboxEntry>) => void,
): Promise<void> {
  const error = 'chatPanel.outboxLegacyMultipartBlocked';
  try {
    await window.electronAPI.chat.outbox.updateStatus(row.id, 'blocked', error, undefined);
  } catch (persistErr: unknown) {
    console.warn('[useChatOutbox] quarantine legacy multipart failed', row.id, persistErr);
  }
  updateRow(row.id, { status: 'blocked', error, nextRetryAt: null });
  console.warn('[useChatOutbox] quarantined legacy multipart outbox row', row.id);
}

/**
 * When non-blocked emergency rows (including `newRow`) exceed {@link EMERGENCY_OUTBOX_SOFT_CAP},
 * block one other queued/failed emergency row: least urgent MECP severity first, then oldest.
 * MAYDAY (sev 0) rows are never chosen — if only MAYDAYs remain the outbox stays over cap.
 * Failure point: list / updateStatus IPC — logged; the new row stays queued so enqueue never
 * fails on cap bookkeeping.
 */
async function enforceEmergencyOutboxSoftCap(
  newRow: OutboxEntry,
  updateRow: (id: number, patch: Partial<OutboxEntry>) => void,
): Promise<void> {
  try {
    const listed = await window.electronAPI.chat.outbox.list(newRow.protocol);
    const activeOthers = listed.filter(
      (r) => isEmergencyOutboxPriority(r) && r.id !== newRow.id && r.status !== 'blocked',
    );
    if (activeOthers.length + 1 <= EMERGENCY_OUTBOX_SOFT_CAP) return;
    let victim: OutboxEntry | undefined;
    let victimSeverity = Number.NEGATIVE_INFINITY;
    for (const r of activeOthers) {
      if (r.status === 'sending') continue;
      if (isMaydayEmergencyOutboxPayload(r.payload)) continue;
      const severity = emergencyPayloadSeverity(r.payload);
      if (
        victim == null ||
        severity > victimSeverity ||
        (severity === victimSeverity && r.createdAt < victim.createdAt)
      ) {
        victim = r;
        victimSeverity = severity;
      }
    }
    if (victim == null) {
      console.warn('[useChatOutbox] emergency soft cap exceeded; only MAYDAY rows remain');
      return;
    }
    await window.electronAPI.chat.outbox.updateStatus(
      victim.id,
      'blocked',
      EMERGENCY_CAP_BLOCKED_KEY,
      undefined,
    );
    updateRow(victim.id, {
      status: 'blocked',
      error: EMERGENCY_CAP_BLOCKED_KEY,
      nextRetryAt: null,
    });
    console.warn('[useChatOutbox] emergency soft cap blocked row', victim.id);
  } catch (err: unknown) {
    console.warn('[useChatOutbox] emergency soft cap enforcement failed', newRow.id, err);
  }
}

async function sendOneOutboxRow(
  row: OutboxEntry,
  protocol: MeshProtocol,
  sendFn: ChatOutboxSendFn,
  reticulumReceiptTimeoutMs: number,
  updateRow: (id: number, patch: Partial<OutboxEntry>) => void,
  removeRow: (id: number) => void,
): Promise<void> {
  await window.electronAPI.chat.outbox.updateStatus(row.id, 'sending');
  updateRow(row.id, { status: 'sending' });
  try {
    await withOutboxDrainRowTimeout(async () => {
      const reticulumIdentityId = protocol === 'reticulum' ? resolveReticulumIdentityId() : null;
      const sendResult = await sendFn(
        row.payload,
        row.channel,
        row.toNode ?? undefined,
        row.replyId ?? undefined,
      );
      if (protocol === 'reticulum') {
        await assertReticulumSendAcked(reticulumIdentityId, sendResult, reticulumReceiptTimeoutMs);
      }
      // Keep the app-wide single-packet fast-send clock honest: a drained row is airtime too.
      if (
        isMeshProtocol(row.protocol) &&
        getRadioCapabilities(row.protocol).composerMaxChunks <= 1
      ) {
        recordMeshcoreSend();
      }
    });
    await finalizeSuccessfulOutboxSend(row, removeRow, updateRow);
  } catch (err: unknown) {
    // catch-no-log-ok recordOutboxSendFailure logs the send failure
    await recordOutboxSendFailure(row, err, updateRow);
  }
}

export type ChatOutboxSendFn = (
  text: string,
  channel: number,
  destination?: number,
  replyId?: number,
) => Promise<string | undefined> | string | undefined;

type OutboxRowPatchFn = (id: number, patch: Partial<OutboxEntry>) => void;

export interface DrainChatOutboxOnceOptions {
  protocol: MeshProtocol;
  sendFn: ChatOutboxSendFn;
  /** Re-checked before every row so a mid-drain disconnect stops further sends. */
  isSendAvailable: () => boolean;
  reticulumReceiptTimeoutMs?: number;
  /** Restrict which eligible rows are sent (App-level drain passes emergency + ACK rows). */
  rowFilter?: (row: OutboxEntry) => boolean;
  onRowsListed?: (rows: OutboxEntry[]) => void;
  updateRow?: OutboxRowPatchFn;
  removeRow?: (id: number) => void;
}

export interface DrainChatOutboxOnceResult {
  /** Rows after this drain (listed at start, then patched by each send outcome). */
  rows: OutboxEntry[];
  /** Rows sent or quarantined during this drain. */
  attempted: number;
}

/**
 * One outbox drain pass for `protocol`, serialized by {@link withChatOutboxDrainLock} so
 * ChatPanel and the App-level emergency drain never send the same row twice. Rows are re-listed
 * from SQLite after acquiring the lock and sent emergency-first, then oldest-first.
 * Failure point: list / recover IPC — rejects to the caller (row statuses are left untouched).
 */
export function drainChatOutboxOnce({
  protocol,
  sendFn,
  isSendAvailable,
  reticulumReceiptTimeoutMs = RETICULUM_RECEIPT_TIMEOUT_MS,
  rowFilter,
  onRowsListed,
  updateRow,
  removeRow,
}: DrainChatOutboxOnceOptions): Promise<DrainChatOutboxOnceResult> {
  return withChatOutboxDrainLock(protocol, async () => {
    if (!isSendAvailable()) return { rows: [], attempted: 0 };
    const listed = await window.electronAPI.chat.outbox.list(protocol);
    let current = await recoverStuckSendingRows(listed);
    onRowsListed?.(current);
    const trackUpdate: OutboxRowPatchFn = (id, patch) => {
      current = current.map((r) => (r.id === id ? { ...r, ...patch } : r));
      updateRow?.(id, patch);
    };
    const trackRemove = (id: number) => {
      current = current.filter((r) => r.id !== id);
      removeRow?.(id);
    };
    const now = Date.now();
    const eligible = current
      .filter((r) => isEligibleForDrain(r, now) && (rowFilter == null || rowFilter(r)))
      .sort(compareDrainOrder);
    let attempted = 0;
    for (const row of eligible) {
      if (!isSendAvailable()) break;
      attempted += 1;
      // Upgrade path: do not TX legacy MeshCore multi-split rows queued before single-packet.
      if (isLegacySinglePacketMultipartOutboxRow(row)) {
        await quarantineLegacyMultipartOutboxRow(row, trackUpdate);
        continue;
      }
      const sendRow = () =>
        sendOneOutboxRow(
          row,
          protocol,
          sendFn,
          reticulumReceiptTimeoutMs,
          trackUpdate,
          trackRemove,
        );
      // Meshtastic-only pacing, shared with ChatComposer so live sends and outbox drain cannot
      // race firmware's TEXT_MESSAGE_APP RATE_LIMIT_EXCEEDED window. Single-packet protocols
      // drain without a client interval — they only advance the fast-send clock after success.
      if (protocol === 'meshtastic') {
        await withMeshtasticTextSendPacing(sendRow);
      } else {
        await sendRow();
      }
    }
    return { rows: current, attempted };
  });
}

export interface UseChatOutboxOptions {
  protocol: MeshProtocol;
  isSendAvailable: boolean;
  /** Test override for deterministic timeout coverage. */
  reticulumReceiptTimeoutMs?: number;
  sendFn: ChatOutboxSendFn;
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
  reticulumReceiptTimeoutMs = RETICULUM_RECEIPT_TIMEOUT_MS,
  sendFn,
}: UseChatOutboxOptions): UseChatOutbox {
  const [rows, setRows] = useState<OutboxEntry[]>([]);
  const rowsRef = useRef<OutboxEntry[]>(rows);
  const drainingRef = useRef(false);
  const isSendAvailableRef = useRef(isSendAvailable);
  const sendFnRef = useRef(sendFn);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainOnceRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    isSendAvailableRef.current = isSendAvailable;
    sendFnRef.current = sendFn;
  }, [isSendAvailable, sendFn]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const scheduleRetryTimer = useCallback((snapshot: readonly OutboxEntry[]) => {
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const at = earliestEmergencyRetryAt(snapshot);
    if (at == null) return;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void drainOnceRef.current();
    }, outboxRetryTimerDelayMs(at));
  }, []);

  useEffect(
    () => () => {
      if (retryTimerRef.current != null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    },
    [],
  );

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

  // App-level emergency drain changed rows out of band — reload so the UI is not stale.
  useEffect(() => {
    return subscribeChatOutboxRowsChanged(protocol, () => {
      window.electronAPI.chat.outbox
        .list(protocol)
        .then((loaded) => {
          setRows(loaded);
          scheduleRetryTimer(loaded);
        })
        .catch((err: unknown) => {
          console.warn('[useChatOutbox] reload after external drain failed', err);
        });
    });
  }, [protocol, scheduleRetryTimer]);

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
      const result = await drainChatOutboxOnce({
        protocol,
        sendFn: (text, channel, destination, replyId) =>
          sendFnRef.current(text, channel, destination, replyId),
        isSendAvailable: () => isSendAvailableRef.current,
        reticulumReceiptTimeoutMs,
        onRowsListed: setRows,
        updateRow,
        removeRow,
      });
      scheduleRetryTimer(result.rows);
    } catch (err: unknown) {
      console.warn('[useChatOutbox] drainOnce failed', err);
    } finally {
      drainingRef.current = false;
    }
  }, [
    protocol,
    isSendAvailable,
    reticulumReceiptTimeoutMs,
    updateRow,
    removeRow,
    scheduleRetryTimer,
  ]);

  useEffect(() => {
    drainOnceRef.current = drainOnce;
  }, [drainOnce]);

  // Drain when send becomes available, or when protocol changes while already connected
  useEffect(() => {
    if (isSendAvailable) {
      // Fire-and-forget drain; setState happens asynchronously inside drainOnce.
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
      if (isEmergencyOutboxPriority(newRow)) {
        await enforceEmergencyOutboxSoftCap(newRow, updateRow);
      }
      if (isSendAvailable) {
        // Attempt immediate drain on next tick
        setTimeout(() => void drainOnce(), 0);
      } else {
        scheduleRetryTimer([...rowsRef.current, newRow]);
      }
      return newRow;
    },
    [drainOnce, isSendAvailable, updateRow, scheduleRetryTimer],
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
