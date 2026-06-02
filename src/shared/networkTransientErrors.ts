/** Network error codes that should trigger reconnect rather than terminal error state. */
export const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

export function isTransientNetworkErrorCode(code: unknown): boolean {
  if (typeof code !== 'string' && typeof code !== 'number') return false;
  return TRANSIENT_NETWORK_ERROR_CODES.has(String(code));
}

export function isTransientNetworkError(err: Error & { code?: string | number }): boolean {
  if (isTransientNetworkErrorCode(err.code)) return true;
  const msg = err.message ?? '';
  return msg === 'Keepalive timeout' || msg === 'connack timeout';
}
