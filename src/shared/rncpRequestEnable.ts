/**
 * LXMF control sentinels for mesh-client rncp receive enable / dest sharing.
 * Human-readable LXMF bodies must stay app-agnostic (Sideband, Nomad, etc.).
 * mesh-client still recognizes these sentinels when present for UI automation;
 * request-enable outbound text is human-only so non-mesh-client peers are not
 * shown opaque mesh-client tokens.
 */

export const RNCP_REQUEST_ENABLE_SENTINEL = 'mesh-client:request-rncp-receive:v1';

/** Prefix for replies that share the sender's rncp.receive destination hash. */
export const RNCP_RECEIVE_DEST_SHARE_PREFIX = 'mesh-client:rncp-receive-dest:v1:';

/** Rate-limit: one request per peer per this many ms. */
export const RNCP_REQUEST_ENABLE_COOLDOWN_MS = 10 * 60 * 1000;

const DEST_HASH_RE = /^[0-9a-f]{32}$/;

/** Human-only enable request body (no mesh-client sentinel). */
export function buildRncpRequestEnableMessageBody(instructions: string): string {
  return instructions.trim();
}

export function lxmfBodyContainsRncpRequestEnable(body: string | null | undefined): boolean {
  if (!body) return false;
  // Legacy outbound bodies from older mesh-client builds still include the sentinel.
  return body.includes(RNCP_REQUEST_ENABLE_SENTINEL);
}

/**
 * Build an LXMF body that shares this client's rncp.receive destination with a peer
 * who requested enable (plain hash for any LXMF client + mesh-client sentinel).
 */
export function buildRncpReceiveDestShareBody(instructions: string, receiveHash: string): string {
  const hash = receiveHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (!DEST_HASH_RE.test(hash)) {
    throw new Error('invalid_rncp_receive_hash');
  }
  const trimmed = instructions.trim();
  return `${trimmed}\n${hash}\n\n${RNCP_RECEIVE_DEST_SHARE_PREFIX}${hash}`;
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
  const hexPrefix = /^[0-9a-fA-F]+/.exec(after)?.[0] ?? '';
  const candidate = hexPrefix.toLowerCase();
  return DEST_HASH_RE.test(candidate) ? candidate : null;
}
