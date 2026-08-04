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

/**
 * Fetch recent inbound LXMF, ingest unknown rows, and compute the catch-up watermark.
 * Caller applies diagnostics (`noteReticulumInboundCatchUp` / watermark advance).
 *
 * Sidecar cursor is exclusive `(since_ts, since_seq)`; returned watermarks are the max
 * `(timestamp, ring_seq)` among fetched rows and are safe for the next periodic fetch.
 */
export async function catchUpRecentInboundLxmf(
  opts: CatchUpRecentInboundLxmfOpts,
): Promise<CatchUpRecentInboundLxmfOutcome | null> {
  if (!opts.identityId) return null;

  const { messages: rows } = await fetchRecentInboundLxmfDetailed({
    limit: 200,
    ...(opts.sinceTs != null ? { sinceTs: opts.sinceTs } : {}),
    ...(opts.sinceSeq != null ? { sinceSeq: opts.sinceSeq } : {}),
  });
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
