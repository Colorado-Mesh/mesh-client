/** Network error codes that should trigger reconnect rather than terminal error state. */
export const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  // macOS local-interface address loss (os error 49) / host-down flaps — must not
  // terminal-error Meshtastic MQTT or close will skipReconnect.
  'EADDRNOTAVAIL',
  'EHOSTDOWN',
]);

export function isTransientNetworkErrorCode(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return TRANSIENT_NETWORK_ERROR_CODES.has(code);
}

export function isTransientNetworkError(err: Error & { code?: unknown }): boolean {
  if (isTransientNetworkErrorCode(err.code)) return true;
  const msg = err.message;
  return msg === 'Keepalive timeout' || msg === 'connack timeout';
}
