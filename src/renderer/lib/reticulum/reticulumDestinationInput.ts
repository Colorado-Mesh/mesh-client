import {
  parseRncpReceiveDestShare,
  RNCP_RECEIVE_DEST_SHARE_PREFIX,
} from '@/shared/rncpRequestEnable';

import { registerReticulumDestinationHash, reticulumHashToNodeId } from './destHash';
import { resolveReticulumChatLxmfDestination } from './resolveReticulumChatLxmfDest';

const RETICULUM_HASH_RE = /^[a-f0-9]{32}$/;

/** Thrown when Chat cannot resolve an LXMF delivery destination for the peer. */
export class ReticulumChatMissingLxmfError extends Error {
  constructor() {
    super('RETICULUM_CHAT_MISSING_LXMF');
    this.name = 'ReticulumChatMissingLxmfError';
  }
}

/** Strip optional angle brackets or quotes around pasted addresses. */
function stripWrappers(raw: string): string {
  let s = raw.trim();
  if (
    (s.startsWith('<') && s.endsWith('>')) ||
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Parse user-entered Reticulum destination input into a normalized 32-char hex hash.
 * Accepts lxmf://, lxmf@, lxmf.delivery@, bare 32-char hex, and pasted
 * `mesh-client:rncp-receive-dest:v1:<hash>` share lines (older peers paste these into chat).
 */
export function parseReticulumDestinationInput(raw: string): string | null {
  const trimmed = stripWrappers(raw);
  if (!trimmed) return null;

  // Prefer explicit receive-dest share sentinels before stripping non-hex (the
  // human/prefix text otherwise contaminates bare hex extraction).
  const fromShare = parseRncpReceiveDestShare(trimmed);
  if (fromShare) return fromShare;
  if (trimmed.toLowerCase().includes(RNCP_RECEIVE_DEST_SHARE_PREFIX)) {
    return null;
  }

  const lower = trimmed.toLowerCase();

  if (lower.startsWith('lxmf://')) {
    const hash = lower.slice('lxmf://'.length).replace(/[^a-f0-9]/g, '');
    return RETICULUM_HASH_RE.test(hash) ? hash : null;
  }

  if (lower.startsWith('lxmf.delivery@')) {
    const hash = lower.slice('lxmf.delivery@'.length).replace(/[^a-f0-9]/g, '');
    return RETICULUM_HASH_RE.test(hash) ? hash : null;
  }

  if (lower.startsWith('lxmf@')) {
    const hash = lower.slice('lxmf@'.length).replace(/[^a-f0-9]/g, '');
    return RETICULUM_HASH_RE.test(hash) ? hash : null;
  }

  const bare = lower.replace(/[^a-f0-9]/g, '');
  return RETICULUM_HASH_RE.test(bare) ? bare : null;
}

/**
 * Returns true when a Micron link URL explicitly targets an LXMF destination
 * (not a bare nomad page hash).
 */
export function isReticulumLxmfLink(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('lxmf://') ||
    trimmed.startsWith('lxmf@') ||
    trimmed.startsWith('lxmf.delivery@')
  );
}

/** Parse an lxmf-schemed Micron link into a destination hash, or null. */
export function parseReticulumLxmfLinkUrl(url: string): string | null {
  if (!isReticulumLxmfLink(url)) return null;
  return parseReticulumDestinationInput(url);
}

/**
 * Register the peer's LXMF delivery hash and return its uint32 node id for chat stores.
 * Remaps RNS identity hashes and `lxst.telephony` (and other non-lxmf aspects) to that
 * identity's `lxmf.delivery` when known.
 */
export function openReticulumDmFromHash(hash: string): number {
  const normalized = parseReticulumDestinationInput(hash);
  if (!normalized) {
    throw new Error('Invalid Reticulum destination hash');
  }
  const resolved = resolveReticulumChatLxmfDestination(normalized);
  if (resolved.status === 'missing_lxmf') {
    throw new ReticulumChatMissingLxmfError();
  }
  if (resolved.status !== 'ok') {
    throw new Error('Invalid Reticulum destination hash');
  }
  const nodeId = reticulumHashToNodeId(resolved.hash);
  registerReticulumDestinationHash(nodeId, resolved.hash);
  return nodeId;
}
