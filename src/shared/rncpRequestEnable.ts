/**
 * LXMF control sentinels for mesh-client rncp receive enable / dest sharing.
 * Ordinary LXMF DM bodies always include human-readable instructions; mesh-client
 * peers additionally parse these sentinels for UI automation.
 */

export const RNCP_REQUEST_ENABLE_SENTINEL = 'mesh-client:request-rncp-receive:v1';

/** Prefix for replies that share the sender's rncp.receive destination hash. */
export const RNCP_RECEIVE_DEST_SHARE_PREFIX = 'mesh-client:rncp-receive-dest:v1:';

/** Rate-limit: one request per peer per this many ms. */
export const RNCP_REQUEST_ENABLE_COOLDOWN_MS = 10 * 60 * 1000;

const DEST_HASH_RE = /^[0-9a-f]{32}$/;

export function buildRncpRequestEnableMessageBody(instructions: string): string {
  const trimmed = instructions.trim();
  return `${trimmed}\n\n${RNCP_REQUEST_ENABLE_SENTINEL}`;
}

export function lxmfBodyContainsRncpRequestEnable(body: string | null | undefined): boolean {
  if (!body) return false;
  return body.includes(RNCP_REQUEST_ENABLE_SENTINEL);
}

/**
 * Build an LXMF body that shares this client's rncp.receive destination with a peer
 * who requested enable (human line + machine-readable sentinel).
 */
export function buildRncpReceiveDestShareBody(instructions: string, receiveHash: string): string {
  const hash = receiveHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (!DEST_HASH_RE.test(hash)) {
    throw new Error('invalid_rncp_receive_hash');
  }
  const trimmed = instructions.trim();
  return `${trimmed}\n\n${RNCP_RECEIVE_DEST_SHARE_PREFIX}${hash}`;
}

/**
 * Parse a peer's shared rncp.receive destination from an LXMF body, if present.
 * Returns lowercase 32-hex or null.
 */
export function parseRncpReceiveDestShare(body: string | null | undefined): string | null {
  if (!body) return null;
  const idx = body.indexOf(RNCP_RECEIVE_DEST_SHARE_PREFIX);
  if (idx < 0) return null;
  const after = body.slice(idx + RNCP_RECEIVE_DEST_SHARE_PREFIX.length);
  const candidate = after.replace(/[^0-9a-fA-F].*$/, '').toLowerCase();
  return DEST_HASH_RE.test(candidate) ? candidate : null;
}
