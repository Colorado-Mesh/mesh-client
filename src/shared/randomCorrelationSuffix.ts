/**
 * Short unpredictable suffix for correlation ids (identity slots, driver refs).
 * Not for secrets or Meshtastic packet ids — use full-width crypto randomness for those.
 */
export function randomCorrelationSuffix(length = 6): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length);
}
