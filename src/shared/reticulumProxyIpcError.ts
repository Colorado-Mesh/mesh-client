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

/** True when message matches transient sidecar/proxy failures (restart races). */
export function isExpectedReticulumProxyErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('not running') ||
    message.includes('404') ||
    lower.includes('fetch failed') ||
    lower.includes('aborted') ||
    lower.includes('timeout') ||
    lower.includes('rate limit exceeded')
  );
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
