/**
 * LXMF control sentinel for mesh-client "request rncp.receive enable".
 * Ordinary LXMF DM body always includes human-readable instructions; mesh-client
 * peers additionally parse this sentinel to open an enable modal.
 */

export const RNCP_REQUEST_ENABLE_SENTINEL = 'mesh-client:request-rncp-receive:v1';

/** Rate-limit: one request per peer per this many ms. */
export const RNCP_REQUEST_ENABLE_COOLDOWN_MS = 10 * 60 * 1000;

export function buildRncpRequestEnableMessageBody(instructions: string): string {
  const trimmed = instructions.trim();
  return `${trimmed}\n\n${RNCP_REQUEST_ENABLE_SENTINEL}`;
}

export function lxmfBodyContainsRncpRequestEnable(body: string | null | undefined): boolean {
  if (!body) return false;
  return body.includes(RNCP_REQUEST_ENABLE_SENTINEL);
}
