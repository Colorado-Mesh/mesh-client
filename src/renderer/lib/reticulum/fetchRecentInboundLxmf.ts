import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { noteReticulumInboundRingLen } from '@/renderer/lib/reticulum/reticulumInboundLxmfDiagnostics';

export interface FetchRecentInboundLxmfOpts {
  /** Exclusive lower bound on payload timestamp (ms); sidecar returns `timestamp > since_ts`. */
  sinceTs?: number;
  limit?: number;
}

export interface FetchRecentInboundLxmfResult {
  messages: ReticulumLxmfPayload[];
  ringLen: number | null;
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
  const params = new URLSearchParams();
  if (opts.sinceTs != null && Number.isFinite(opts.sinceTs)) {
    params.set('since_ts', String(Math.floor(opts.sinceTs)));
  }
  if (opts.limit != null && Number.isFinite(opts.limit)) {
    params.set('limit', String(Math.max(1, Math.min(500, Math.floor(opts.limit)))));
  }
  const qs = params.toString();
  const path = qs ? `/api/v1/lxmf/recent?${qs}` : '/api/v1/lxmf/recent';
  try {
    const body = (await window.electronAPI.reticulum.proxyGet(path)) as {
      messages?: unknown;
      ring_len?: unknown;
    };
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
    console.warn('[fetchRecentInboundLxmf] ' + errLikeToLogString(e));
    return { messages: [], ringLen: null };
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
