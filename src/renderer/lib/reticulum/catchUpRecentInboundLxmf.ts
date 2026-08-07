import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { fetchRecentInboundLxmfDetailed } from '@/renderer/lib/reticulum/fetchRecentInboundLxmf';
import { useMessageStore } from '@/renderer/stores/messageStore';

export interface CatchUpRecentInboundLxmfOpts {
  identityId: string;
  ingest: (payload: ReticulumLxmfPayload) => void;
  sinceTs?: number;
  /** Opaque sidecar `ring_seq` paired with `sinceTs` for same-ms recovery. */
  sinceSeq?: number;
  reason?: string;
}

export interface CatchUpRecentInboundLxmfOutcome {
  count: number;
  /** Max payload timestamp among fetched rows; null when none usable for watermark. */
  watermarkTs: number | null;
  /** `ring_seq` for {@link watermarkTs} (max seq at that timestamp among fetched rows). */
  watermarkSeq: number | null;
}

interface CatchUpFlight {
  promise: Promise<CatchUpRecentInboundLxmfOutcome | null>;
  opts: CatchUpRecentInboundLxmfOpts;
  pending: CatchUpRecentInboundLxmfOpts | null;
}

/** Per-identity single-flight + trailing coalesce (never share across identityIds). */
const catchUpByIdentity = new Map<string, CatchUpFlight>();

/** Prefer latest cursor; merge reason labels; last ingest wins (same identity). */
function mergeCatchUpOpts(
  base: CatchUpRecentInboundLxmfOpts,
  next: CatchUpRecentInboundLxmfOpts,
): CatchUpRecentInboundLxmfOpts {
  const reasons = [base.reason, next.reason].filter(
    (r): r is string => typeof r === 'string' && r.length > 0,
  );
  const uniqueReasons = [...new Set(reasons)];
  const sinceTs =
    next.sinceTs != null && Number.isFinite(next.sinceTs)
      ? next.sinceTs
      : base.sinceTs != null && Number.isFinite(base.sinceTs)
        ? base.sinceTs
        : undefined;
  const sinceSeq =
    next.sinceSeq != null && Number.isFinite(next.sinceSeq)
      ? next.sinceSeq
      : base.sinceSeq != null && Number.isFinite(base.sinceSeq)
        ? base.sinceSeq
        : undefined;
  // When both cursors present, prefer the later (ts, seq) pair from `next` if it advances.
  let chosenSinceTs = sinceTs;
  let chosenSinceSeq = sinceSeq;
  if (
    base.sinceTs != null &&
    Number.isFinite(base.sinceTs) &&
    next.sinceTs != null &&
    Number.isFinite(next.sinceTs)
  ) {
    if (next.sinceTs > base.sinceTs) {
      chosenSinceTs = next.sinceTs;
      chosenSinceSeq = next.sinceSeq;
    } else if (next.sinceTs < base.sinceTs) {
      chosenSinceTs = base.sinceTs;
      chosenSinceSeq = base.sinceSeq;
    } else {
      const baseSeq = base.sinceSeq ?? -1;
      const nextSeq = next.sinceSeq ?? -1;
      if (nextSeq >= baseSeq) {
        chosenSinceTs = next.sinceTs;
        chosenSinceSeq = next.sinceSeq;
      } else {
        chosenSinceTs = base.sinceTs;
        chosenSinceSeq = base.sinceSeq;
      }
    }
  }
  return {
    identityId: base.identityId,
    ingest: next.ingest,
    ...(chosenSinceTs != null ? { sinceTs: chosenSinceTs } : {}),
    ...(chosenSinceSeq != null ? { sinceSeq: chosenSinceSeq } : {}),
    ...(uniqueReasons.length > 0 ? { reason: uniqueReasons.join('+') } : {}),
  };
}

function rowAlreadyInMessageStore(identityId: string, p: ReticulumLxmfPayload): boolean {
  const hash = typeof p.message_hash === 'string' ? p.message_hash.trim() : '';
  if (!hash) return false;
  // Identity buckets are sparse at runtime despite Record typing.
  const bucket = useMessageStore.getState().messages[identityId] as
    Record<string, unknown> | undefined;
  return Boolean(bucket && Object.hasOwn(bucket, hash));
}

function rowRingSeq(p: ReticulumLxmfPayload): number | null {
  return typeof p.ring_seq === 'number' && Number.isFinite(p.ring_seq)
    ? Math.floor(p.ring_seq)
    : null;
}

function isCursorAfter(
  ts: number,
  seq: number | null,
  maxTs: number,
  maxSeq: number | null,
): boolean {
  if (ts > maxTs) return true;
  if (ts < maxTs) return false;
  if (seq == null) return false;
  return maxSeq == null || seq > maxSeq;
}

async function catchUpRecentInboundLxmfOnce(
  opts: CatchUpRecentInboundLxmfOpts,
): Promise<CatchUpRecentInboundLxmfOutcome | null> {
  if (!opts.identityId) return null;

  const { messages: rows, rateLimited } = await fetchRecentInboundLxmfDetailed({
    limit: 200,
    ...(opts.sinceTs != null ? { sinceTs: opts.sinceTs } : {}),
    ...(opts.sinceSeq != null ? { sinceSeq: opts.sinceSeq } : {}),
  });
  if (rateLimited) {
    console.warn(
      `[catchUpRecentInboundLxmf] rateLimited reason=${opts.reason ?? 'catch-up'} — skipped (not empty inbox)`,
    );
    return null;
  }
  if (rows.length === 0) return null;

  const knownFlags = rows.map((p) => rowAlreadyInMessageStore(opts.identityId, p));
  const allKnown = knownFlags.every(Boolean);
  const reason = opts.reason ?? 'catch-up';
  const logLine = `[catchUpRecentInboundLxmf] inbound LXMF catch-up count=${rows.length} reason=${reason}`;
  if (allKnown) {
    console.debug(logLine);
  } else {
    console.warn(logLine);
  }

  let maxTs = opts.sinceTs ?? 0;
  let maxSeq: number | null = opts.sinceSeq ?? null;
  for (const [i, p] of rows.entries()) {
    if (!knownFlags[i]) {
      opts.ingest(p);
    }
    if (typeof p.timestamp === 'number' && Number.isFinite(p.timestamp)) {
      const seq = rowRingSeq(p);
      if (isCursorAfter(p.timestamp, seq, maxTs, maxSeq)) {
        maxTs = p.timestamp;
        maxSeq = seq;
      }
    }
  }

  return {
    count: rows.length,
    watermarkTs: maxTs > 0 ? maxTs : null,
    watermarkSeq: maxTs > 0 ? maxSeq : null,
  };
}

/**
 * Fetch recent inbound LXMF, ingest unknown rows, and compute the catch-up watermark.
 * Caller applies diagnostics (`noteReticulumInboundCatchUp` / watermark advance).
 *
 * Sidecar cursor is exclusive `(since_ts, since_seq)`; returned watermarks are the max
 * `(timestamp, ring_seq)` among fetched rows and are safe for the next periodic fetch.
 *
 * Concurrent callers for the **same** identity share one in-flight promise; later opts
 * coalesce (latest cursor, merged reasons) into a trailing rerun. Different identities
 * never share flight state.
 */
export async function catchUpRecentInboundLxmf(
  opts: CatchUpRecentInboundLxmfOpts,
): Promise<CatchUpRecentInboundLxmfOutcome | null> {
  if (!opts.identityId) return null;
  const identityId = opts.identityId;

  const existing = catchUpByIdentity.get(identityId);
  if (existing) {
    const base = existing.pending ?? existing.opts;
    existing.pending = mergeCatchUpOpts(base, opts);
    return existing.promise;
  }

  const flight: CatchUpFlight = { opts, pending: null, promise: Promise.resolve(null) };
  const promise = (async () => {
    try {
      let current = opts;
      let result = await catchUpRecentInboundLxmfOnce(current);
      while (flight.pending) {
        current = flight.pending;
        flight.pending = null;
        flight.opts = current;
        result = await catchUpRecentInboundLxmfOnce(current);
      }
      return result;
    } finally {
      catchUpByIdentity.delete(identityId);
    }
  })();
  flight.promise = promise;
  catchUpByIdentity.set(identityId, flight);

  return promise;
}

/** Test-only reset of single-flight coalesce state. */
export function resetCatchUpRecentInboundLxmfSingleFlightForTests(): void {
  catchUpByIdentity.clear();
}
