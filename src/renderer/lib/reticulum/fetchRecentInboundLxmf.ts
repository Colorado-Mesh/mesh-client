import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';

export interface FetchRecentInboundLxmfOpts {
  /** Inclusive lower bound on payload timestamp (ms). */
  sinceTs?: number;
  limit?: number;
}

/**
 * Fetch recent inbound LXMF payloads from the sidecar ring buffer
 * (`GET /api/v1/lxmf/recent`) for WS lag / reconnect catch-up.
 */
export async function fetchRecentInboundLxmf(
  opts: FetchRecentInboundLxmfOpts = {},
): Promise<ReticulumLxmfPayload[]> {
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
    };
    if (!Array.isArray(body.messages)) return [];
    return body.messages.filter(isInboundLxmfPayload);
  } catch (e) {
    console.debug('[fetchRecentInboundLxmf] ' + errLikeToLogString(e));
    return [];
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
