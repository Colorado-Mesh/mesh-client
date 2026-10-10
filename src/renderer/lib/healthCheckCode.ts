/**
 * MeshCore Health Check test codes (yellowcooln/meshcore-health-check), e.g. `MHC-AB12CD`.
 * Communities run their own instances and results are keyed by server session, not by code,
 * so the chat only labels the code.
 */

const HEALTH_CHECK_CODE_RE = /^MHC-[0-9A-F]{6}$/i;

/** The upper-cased code when the whole message is a Health Check code; otherwise null. */
export function parseHealthCheckCode(text: string): string | null {
  const trimmed = text.trim();
  return HEALTH_CHECK_CODE_RE.test(trimmed) ? trimmed.toUpperCase() : null;
}
