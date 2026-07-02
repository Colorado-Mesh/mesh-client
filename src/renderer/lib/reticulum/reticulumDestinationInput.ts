import { registerReticulumDestinationHash, reticulumHashToNodeId } from './destHash';

const RETICULUM_HASH_RE = /^[a-f0-9]{32}$/;

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
 * Accepts lxmf://, lxmf@, lxmf.delivery@, and bare 32-char hex.
 */
export function parseReticulumDestinationInput(raw: string): string | null {
  const trimmed = stripWrappers(raw);
  if (!trimmed) return null;

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

/** Register hash in the runtime registry and return the uint32 node id for chat stores. */
export function openReticulumDmFromHash(hash: string): number {
  const normalized = parseReticulumDestinationInput(hash);
  if (!normalized) {
    throw new Error('Invalid Reticulum destination hash');
  }
  const nodeId = reticulumHashToNodeId(normalized);
  registerReticulumDestinationHash(nodeId, normalized);
  return nodeId;
}
