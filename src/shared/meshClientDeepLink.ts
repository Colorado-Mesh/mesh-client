/**
 * Classify and parse mesh-client deep-link URIs (lxm:// contact/identity cards,
 * Meshtastic channel URLs). Full encrypted LXMF paper blobs are not supported yet.
 */

import { canonicalizeReticulumDestinationHash } from './reticulumDestinationHash';

export type MeshClientDeepLink =
  | { kind: 'meshtasticChannel'; url: string }
  | { kind: 'lxmContact'; destinationHash: string; name?: string }
  | { kind: 'lxmIdentity'; identityHash: string; lxmfHash?: string; name?: string }
  | { kind: 'lxmPaperUnsupported'; uri: string }
  | { kind: 'unknown'; raw: string };

const MESHTASTIC_URL_RE = /^(?:meshtastic:\/\/|https?:\/\/meshtastic\.org\/e\/)/i;

export function buildLxmContactUri(destinationHash: string, name?: string): string {
  const hash = canonicalizeReticulumDestinationHash(destinationHash);
  if (!hash) throw new Error('invalid destination hash');
  const base = `lxm://contact/${hash}`;
  if (!name?.trim()) return base;
  return `${base}?name=${encodeURIComponent(name.trim())}`;
}

export function buildLxmIdentityUri(opts: {
  identityHash: string;
  lxmfHash?: string | null;
  name?: string | null;
}): string {
  const id = opts.identityHash.trim().toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(id)) throw new Error('invalid identity hash');
  const params = new URLSearchParams();
  if (opts.lxmfHash?.trim()) params.set('lxmf', opts.lxmfHash.trim().toLowerCase());
  if (opts.name?.trim()) params.set('name', opts.name.trim());
  const q = params.toString();
  return q ? `lxm://identity/${id}?${q}` : `lxm://identity/${id}`;
}

export function classifyMeshClientDeepLink(raw: string): MeshClientDeepLink {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown', raw };

  if (MESHTASTIC_URL_RE.test(trimmed) || /^[A-Za-z0-9_-]{20,}={0,2}$/.test(trimmed)) {
    // Bare base64url channel payloads are handled by meshtasticUrlEncoder consumers.
    return { kind: 'meshtasticChannel', url: trimmed };
  }

  if (/^lxm:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.replace(/^\//, '');

      if (host === 'contact') {
        const hash = canonicalizeReticulumDestinationHash(path);
        if (!hash) return { kind: 'lxmPaperUnsupported', uri: trimmed };
        const name = url.searchParams.get('name') ?? undefined;
        return {
          kind: 'lxmContact',
          destinationHash: hash,
          ...(name ? { name } : {}),
        };
      }

      if (host === 'identity') {
        const identityHash = path.toLowerCase();
        if (!/^[0-9a-f]{16,64}$/.test(identityHash)) {
          return { kind: 'lxmPaperUnsupported', uri: trimmed };
        }
        const lxmfHash = url.searchParams.get('lxmf')?.toLowerCase() || undefined;
        const name = url.searchParams.get('name') || undefined;
        return {
          kind: 'lxmIdentity',
          identityHash,
          ...(lxmfHash ? { lxmfHash } : {}),
          ...(name ? { name } : {}),
        };
      }

      // Encrypted paper messages and other lxm:// forms — soft-fail.
      return { kind: 'lxmPaperUnsupported', uri: trimmed };
    } catch {
      return { kind: 'lxmPaperUnsupported', uri: trimmed };
    }
  }

  return { kind: 'unknown', raw: trimmed };
}

/** Scan process.argv (Windows/Linux second-instance / cold start) for an lxm:// URL. */
export function findLxmUrlInArgv(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (typeof arg === 'string' && /^lxm:\/\//i.test(arg.trim())) {
      return arg.trim();
    }
  }
  return undefined;
}

/**
 * True when main should forward an OS open-url / argv string to the renderer.
 * Allows `lxm://` (including paper-unsupported forms) and Meshtastic channel URLs;
 * drops unrelated schemes.
 */
export function isForwardableMeshClientOpenUrl(raw: string): boolean {
  const kind = classifyMeshClientDeepLink(raw).kind;
  return kind !== 'unknown';
}
