/** Inclusive TCP/UDP port range (IANA). */
export const TCP_PORT_MIN = 1;
export const TCP_PORT_MAX = 65_535;

/** Clamp a user-entered port string to a valid 1–65535 integer, or return fallback. */
export function clampTcpPort(value: string | number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(TCP_PORT_MIN, Math.min(TCP_PORT_MAX, n));
}

/** Parse a port string; return fallback when missing or out of range (no clamping). */
export function parseTcpPortFromString(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < TCP_PORT_MIN || n > TCP_PORT_MAX) return fallback;
  return n;
}
