import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { fetchRecentInboundLxmfDetailed } from '@/renderer/lib/reticulum/fetchRecentInboundLxmf';

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

/**
 * Fetch recent inbound LXMF, ingest rows, and compute the catch-up watermark.
 * Caller applies diagnostics (`noteReticulumInboundCatchUp` / watermark advance).
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
  console.warn(
    `[catchUpRecentInboundLxmf] inbound LXMF catch-up count=${rows.length} reason=${reason}`,
  );

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
