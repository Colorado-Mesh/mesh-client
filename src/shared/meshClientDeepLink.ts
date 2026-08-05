/**
 * Classify and parse mesh-client deep-link URIs (lxm:// contact/identity cards,
 * Columba lxma://, encrypted LXMF paper blobs, MeshCore meshcore://, Meshtastic channel URLs).
 */

import { canonicalizeReticulumDestinationHash } from './reticulumDestinationHash';

export type MeshcoreContactType = 1 | 2 | 3 | 4;

export type MeshClientDeepLink =
  | { kind: 'meshtasticChannel'; url: string }
  | { kind: 'lxmContact'; destinationHash: string; name?: string }
  | { kind: 'lxmIdentity'; identityHash: string; lxmfHash?: string; name?: string }
  | { kind: 'lxmaContact'; destinationHash: string; publicKeyHex: string }
  | {
      kind: 'meshcoreContactAdd';
      name: string;
      publicKeyHex: string;
      type: MeshcoreContactType;
    }
  | {
      kind: 'meshcoreChannelAdd';
      name: string;
      secretHex: string;
      regionScope?: string;
    }
  | { kind: 'lxmPaperMessage'; uri: string }
  | { kind: 'unknown'; raw: string };

const MESHTASTIC_URL_RE = /^(?:meshtastic:\/\/|https?:\/\/meshtastic\.org\/e\/)/i;
const MESHCORE_PUBKEY_RE = /^[0-9a-f]{64}$/;
const MESHCORE_CHANNEL_SECRET_RE = /^[0-9a-f]{32}$/;
const LXMA_PUBKEY_RE = /^[0-9a-f]{128}$/;
/** Paper `lxm://` host is URL-safe base64 of dest‖ciphertext; require a minimum blob length. */
const LXM_PAPER_BLOB_RE = /^[A-Za-z0-9_-]{32,}$/;

function isMeshcoreContactType(n: number): n is MeshcoreContactType {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

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

/** Columba / LXMF contact card: lxma://<32-hex-dest>:<128-hex-pubkey> */
export function buildLxmaContactUri(destinationHash: string, publicKeyHex: string): string {
  const hash = canonicalizeReticulumDestinationHash(destinationHash);
  if (!hash) throw new Error('invalid destination hash');
  const key = publicKeyHex.trim().toLowerCase();
  if (!LXMA_PUBKEY_RE.test(key)) throw new Error('invalid public key');
  return `lxma://${hash}:${key}`;
}

export function buildMeshcoreContactAddUri(opts: {
  name: string;
  publicKeyHex: string;
  type: MeshcoreContactType;
}): string {
  const name = opts.name.trim();
  if (!name) throw new Error('invalid name');
  const key = opts.publicKeyHex.trim().toLowerCase();
  if (!MESHCORE_PUBKEY_RE.test(key)) throw new Error('invalid public key');
  if (!isMeshcoreContactType(opts.type)) throw new Error('invalid contact type');
  const params = new URLSearchParams();
  params.set('name', name);
  params.set('public_key', key);
  params.set('type', String(opts.type));
  return `meshcore://contact/add?${params.toString()}`;
}

export function buildMeshcoreChannelAddUri(opts: {
  name: string;
  secretHex: string;
  regionScope?: string | null;
}): string {
  const name = opts.name.trim();
  if (!name) throw new Error('invalid name');
  const secret = opts.secretHex.trim().toLowerCase();
  if (!MESHCORE_CHANNEL_SECRET_RE.test(secret)) throw new Error('invalid channel secret');
  const params = new URLSearchParams();
  params.set('name', name);
  params.set('secret', secret);
  if (opts.regionScope?.trim()) params.set('region_scope', opts.regionScope.trim());
  return `meshcore://channel/add?${params.toString()}`;
}

function classifyLxmaUri(trimmed: string): MeshClientDeepLink {
  // lxma://<dest>:<pubkey> — not a hierarchical URL; parse manually.
  const withoutScheme = trimmed.replace(/^lxma:\/\//i, '');
  const parts = withoutScheme.split(':');
  if (parts.length !== 2) return { kind: 'unknown', raw: trimmed };
  const dest = canonicalizeReticulumDestinationHash(parts[0] ?? '');
  const key = (parts[1] ?? '').trim().toLowerCase();
  if (!dest || !LXMA_PUBKEY_RE.test(key)) return { kind: 'unknown', raw: trimmed };
  return { kind: 'lxmaContact', destinationHash: dest, publicKeyHex: key };
}

function classifyMeshcoreUri(trimmed: string): MeshClientDeepLink {
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/^\//, '').toLowerCase();

    if (host === 'contact' && path === 'add') {
      const name = url.searchParams.get('name') ?? '';
      const publicKeyHex = (url.searchParams.get('public_key') ?? '').trim().toLowerCase();
      const typeRaw = url.searchParams.get('type');
      const typeNum = typeRaw != null ? Number(typeRaw) : NaN;
      if (
        !name.trim() ||
        !MESHCORE_PUBKEY_RE.test(publicKeyHex) ||
        !isMeshcoreContactType(typeNum)
      ) {
        return { kind: 'unknown', raw: trimmed };
      }
      return {
        kind: 'meshcoreContactAdd',
        name: name.trim(),
        publicKeyHex,
        type: typeNum,
      };
    }

    if (host === 'channel' && path === 'add') {
      const name = url.searchParams.get('name') ?? '';
      const secretHex = (url.searchParams.get('secret') ?? '').trim().toLowerCase();
      const regionScope = url.searchParams.get('region_scope')?.trim() || undefined;
      if (!name.trim() || !MESHCORE_CHANNEL_SECRET_RE.test(secretHex)) {
        return { kind: 'unknown', raw: trimmed };
      }
      return {
        kind: 'meshcoreChannelAdd',
        name: name.trim(),
        secretHex,
        ...(regionScope ? { regionScope } : {}),
      };
    }

    return { kind: 'unknown', raw: trimmed };
  } catch {
    return { kind: 'unknown', raw: trimmed };
  }
}

/** True when an `lxm://` host+path looks like an encrypted paper blob (not contact/identity). */
export function looksLikeLxmPaperBlob(hostAndPath: string): boolean {
  const blob = hostAndPath.replace(/^\/*/, '').replace(/\/*$/, '');
  return LXM_PAPER_BLOB_RE.test(blob);
}

export function classifyMeshClientDeepLink(raw: string): MeshClientDeepLink {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown', raw };

  if (MESHTASTIC_URL_RE.test(trimmed) || /^[A-Za-z0-9_-]{20,}={0,2}$/.test(trimmed)) {
    // Bare base64url channel payloads are handled by meshtasticUrlEncoder consumers.
    return { kind: 'meshtasticChannel', url: trimmed };
  }

  if (/^lxma:\/\//i.test(trimmed)) {
    return classifyLxmaUri(trimmed);
  }

  if (/^meshcore:\/\//i.test(trimmed)) {
    return classifyMeshcoreUri(trimmed);
  }

  if (/^lxm:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.replace(/^\//, '');

      if (host === 'contact') {
        const hash = canonicalizeReticulumDestinationHash(path);
        if (!hash) return { kind: 'unknown', raw: trimmed };
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
          return { kind: 'unknown', raw: trimmed };
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

      // Encrypted paper: lxm://<base64url(dest‖ciphertext)> — host is the blob.
      const blob = path ? `${host}/${path}` : host;
      if (looksLikeLxmPaperBlob(blob)) {
        return { kind: 'lxmPaperMessage', uri: trimmed };
      }
      return { kind: 'unknown', raw: trimmed };
    } catch {
      // catch-no-log-ok malformed / overlong paper hosts: fall back to raw blob check without logging
      // Some engines reject very long hosts; still try paper when scheme + blob remain.
      const withoutScheme = trimmed.replace(/^lxm:\/\//i, '');
      if (looksLikeLxmPaperBlob(withoutScheme.split(/[?#]/)[0] ?? '')) {
        return { kind: 'lxmPaperMessage', uri: trimmed };
      }
      return { kind: 'unknown', raw: trimmed };
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
 * Allows `lxm://` / `lxma://` / `meshcore://` and Meshtastic channel URLs;
 * drops unrelated schemes.
 */
export function isForwardableMeshClientOpenUrl(raw: string): boolean {
  const kind = classifyMeshClientDeepLink(raw).kind;
  return kind !== 'unknown';
}
