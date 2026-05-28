/**
 * Short unpredictable suffix for correlation ids (identity slots, driver refs).
 * Not for secrets or Meshtastic packet ids — use full-width crypto randomness for those.
 */
export function randomCorrelationSuffix(length = 6): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const byte of bytes) {
    s += byte.toString(36);
  }
  return s.slice(0, length);
}
