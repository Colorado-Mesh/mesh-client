import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { fetchRecentInboundLxmfDetailed } from '@/renderer/lib/reticulum/fetchRecentInboundLxmf';
import { useMessageStore } from '@/renderer/stores/messageStore';

export interface CatchUpRecentInboundLxmfOpts {
  identityId: string;
  ingest: (payload: ReticulumLxmfPayload) => void;
  sinceTs?: number;
  reason?: string;
}

export interface CatchUpRecentInboundLxmfOutcome {
  count: number;
  /** Max payload timestamp among ingested rows; null when none usable for watermark. */
  watermarkTs: number | null;
}

function rowAlreadyInMessageStore(identityId: string, p: ReticulumLxmfPayload): boolean {
  const hash = typeof p.message_hash === 'string' ? p.message_hash.trim() : '';
  if (!hash) return false;
  // Identity buckets are sparse at runtime despite Record typing.
  const bucket = useMessageStore.getState().messages[identityId] as
    Record<string, unknown> | undefined;
  return Boolean(bucket && Object.hasOwn(bucket, hash));
}

/**
 * Fetch recent inbound LXMF, ingest rows, and compute the catch-up watermark.
 * Caller applies diagnostics (`noteReticulumInboundCatchUp` / watermark advance).
 *
 * Sidecar `since_ts` is exclusive; returned `watermarkTs` is the max seen timestamp and is
 * safe to pass as the next periodic `sinceTs`.
 */
export async function catchUpRecentInboundLxmf(
  opts: CatchUpRecentInboundLxmfOpts,
): Promise<CatchUpRecentInboundLxmfOutcome | null> {
  if (!opts.identityId) return null;

  const { messages: rows } = await fetchRecentInboundLxmfDetailed({
    limit: 200,
    ...(opts.sinceTs != null ? { sinceTs: opts.sinceTs } : {}),
  });
  if (rows.length === 0) return null;

  const reason = opts.reason ?? 'catch-up';
  const allKnown = rows.every((p) => rowAlreadyInMessageStore(opts.identityId, p));
  const logLine = `[catchUpRecentInboundLxmf] inbound LXMF catch-up count=${rows.length} reason=${reason}`;
  if (allKnown) {
    console.debug(logLine);
  } else {
    console.warn(logLine);
  }

  let maxTs = opts.sinceTs ?? 0;
  for (const p of rows) {
    opts.ingest(p);
    if (typeof p.timestamp === 'number' && Number.isFinite(p.timestamp) && p.timestamp > maxTs) {
      maxTs = p.timestamp;
    }
  }

  return {
    count: rows.length,
    watermarkTs: maxTs > 0 ? maxTs : null,
  };
}
