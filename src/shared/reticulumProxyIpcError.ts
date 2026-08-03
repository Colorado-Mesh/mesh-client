/**
 * Expected Reticulum proxy failures (sidecar restart / not running / transient
 * fetch) are returned as this envelope instead of rejecting the IPC promise.
 * Electron logs every rejected `ipcMain.handle` as `[error] Error occurred in
 * handler…` — returning a value keeps stack-restart races at debug noise while
 * preload rethrows so renderer try/catch stays unchanged.
 */
export const RETICULUM_PROXY_IPC_ERROR_TAG = '__reticulumProxyError' as const;

export interface ReticulumProxyIpcErrorEnvelope {
  readonly [RETICULUM_PROXY_IPC_ERROR_TAG]: true;
  readonly message: string;
}

/** HTTP status from sidecar manager errors shaped like `sidecar GET … failed: 404`. */
function httpStatusFromProxyMessage(message: string): number | null {
  const m = /failed:\s*(\d{3})\b/i.exec(message);
  if (!m?.[1]) return null;
  const status = Number(m[1]);
  return Number.isFinite(status) ? status : null;
}

function readNumericStatusField(err: object): number | null {
  const rec = err as Record<string, unknown>;
  for (const key of ['status', 'statusCode'] as const) {
    const raw = rec[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^\d{3}$/.test(raw)) return Number(raw);
  }
  return null;
}

/**
 * True when message matches genuine transient sidecar/proxy failures
 * (restart races, AbortSignal timeout, IPC rate limit). Avoids bare `404` /
 * `timeout` substrings that can appear in unrelated backend text.
 */
export function isExpectedReticulumProxyErrorMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (lower.includes('not running')) return true;
  if (lower.includes('fetch failed')) return true;
  if (lower.includes('rate limit exceeded')) return true;
  // AbortSignal.timeout / fetch abort wording (word-bounded timeout; not bare digit runs)
  if (
    lower.includes('aborted') ||
    lower.includes('timed out') ||
    lower.includes('due to timeout') ||
    /\btimeouts?\b/.test(lower)
  ) {
    return true;
  }
  // Sidecar manager: `sidecar GET|POST|PUT|DELETE <path> failed: <status>`
  if (httpStatusFromProxyMessage(lower) === 404) return true;
  return false;
}

/**
 * Prefer structured fields (`status` / `statusCode`, AbortError / TimeoutError)
 * when present; fall back to anchored message checks.
 */
export function isExpectedReticulumProxyError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'object') {
    const status = readNumericStatusField(err);
    if (status === 404) return true;
    const name =
      'name' in err && typeof (err as { name?: unknown }).name === 'string'
        ? (err as { name: string }).name
        : '';
    if (name === 'AbortError' || name === 'TimeoutError') return true;
  }
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : errLikeMessage(err);
  return isExpectedReticulumProxyErrorMessage(message);
}

function errLikeMessage(err: unknown): string {
  if (err != null && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return 'unknown error';
}

export function isReticulumProxyIpcErrorEnvelope(
  value: unknown,
): value is ReticulumProxyIpcErrorEnvelope {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return rec[RETICULUM_PROXY_IPC_ERROR_TAG] === true && typeof rec.message === 'string';
}

export function reticulumProxyIpcErrorEnvelope(message: string): ReticulumProxyIpcErrorEnvelope {
  return { [RETICULUM_PROXY_IPC_ERROR_TAG]: true, message };
}

/** Preload: turn envelope into a thrown Error so renderer catch paths stay the same. */
export function throwIfReticulumProxyIpcError(value: unknown): unknown {
  if (isReticulumProxyIpcErrorEnvelope(value)) {
    throw new Error(value.message);
  }
  return value;
}
