import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { noteReticulumInboundRingLen } from '@/renderer/lib/reticulum/reticulumInboundLxmfDiagnostics';
import {
  clearReticulumProxyRateLimitBackoff,
  isReticulumProxyRateLimitBackoffActive,
  noteReticulumProxyErrorIfRateLimited,
  reticulumProxyRateLimitBackoffRemainingMs,
} from '@/renderer/lib/reticulum/reticulumProxyRateLimitBackoff';
import { RETICULUM_LXMF_RECENT_API_PATH } from '@/shared/reticulumApiPaths';

export interface FetchRecentInboundLxmfOpts {
  /**
   * Exclusive lower-bound cursor on payload timestamp (ms).
   * Alone: sidecar returns `timestamp > since_ts`.
   * With {@link sinceSeq}: rows after the complete `(since_ts, since_seq)` cursor.
   */
  sinceTs?: number;
  /** Opaque sidecar `ring_seq` paired with {@link sinceTs} for same-ms recovery. */
  sinceSeq?: number;
  limit?: number;
}

export interface FetchRecentInboundLxmfResult {
  messages: ReticulumLxmfPayload[];
  ringLen: number | null;
  /** Set when the call was skipped or failed due to proxy rate limiting. */
  rateLimited?: boolean;
}

/**
 * Fetch recent inbound LXMF payloads from the sidecar ring buffer
 * (`GET /api/v1/lxmf/recent`) for WS lag / reconnect catch-up.
 */
export async function fetchRecentInboundLxmf(
  opts: FetchRecentInboundLxmfOpts = {},
): Promise<ReticulumLxmfPayload[]> {
  const result = await fetchRecentInboundLxmfDetailed(opts);
  return result.messages;
}

/** Same as {@link fetchRecentInboundLxmf} but also returns ring size when present. */
export async function fetchRecentInboundLxmfDetailed(
  opts: FetchRecentInboundLxmfOpts = {},
): Promise<FetchRecentInboundLxmfResult> {
  if (isReticulumProxyRateLimitBackoffActive('lxmfRecent')) {
    const remaining = reticulumProxyRateLimitBackoffRemainingMs('lxmfRecent');
    console.warn(
      `[fetchRecentInboundLxmf] skipped — proxy rate-limit backoff remaining=${remaining}ms`,
    );
    return { messages: [], ringLen: null, rateLimited: true };
  }
  const params = new URLSearchParams();
  if (opts.sinceTs != null && Number.isFinite(opts.sinceTs)) {
    params.set('since_ts', String(Math.floor(opts.sinceTs)));
  }
  if (
    opts.sinceTs != null &&
    Number.isFinite(opts.sinceTs) &&
    opts.sinceSeq != null &&
    Number.isFinite(opts.sinceSeq)
  ) {
    params.set('since_seq', String(Math.floor(opts.sinceSeq)));
  }
  if (opts.limit != null && Number.isFinite(opts.limit)) {
    params.set('limit', String(Math.max(1, Math.min(500, Math.floor(opts.limit)))));
  }
  const qs = params.toString();
  const path = qs ? `${RETICULUM_LXMF_RECENT_API_PATH}?${qs}` : RETICULUM_LXMF_RECENT_API_PATH;
  try {
    const body = (await window.electronAPI.reticulum.proxyGet(path)) as {
      messages?: unknown;
      ring_len?: unknown;
    };
    clearReticulumProxyRateLimitBackoff('lxmfRecent');
    const ringLen =
      typeof body.ring_len === 'number' && Number.isFinite(body.ring_len)
        ? Math.trunc(body.ring_len)
        : null;
    noteReticulumInboundRingLen(ringLen);
    if (!Array.isArray(body.messages)) {
      return { messages: [], ringLen };
    }
    return {
      messages: body.messages.filter(isInboundLxmfPayload),
      ringLen,
    };
  } catch (e) {
    const rateLimited = noteReticulumProxyErrorIfRateLimited(e, 'lxmfRecent');
    console.warn('[fetchRecentInboundLxmf] ' + errLikeToLogString(e));
    return { messages: [], ringLen: null, rateLimited };
  }
}

function isInboundLxmfPayload(row: unknown): row is ReticulumLxmfPayload {
  if (!row || typeof row !== 'object') return false;
  const p = row as ReticulumLxmfPayload;
  if (typeof p.sender_hash !== 'string' || !p.sender_hash) return false;
  if (typeof p.text !== 'string' || !p.text) return false;
  if (p.direction != null && p.direction !== 'inbound') return false;
  return true;
}
