/**
 * Classify and parse deep-link URIs (MeshCore meshcore://, Meshtastic channel URLs).
 */

export type MeshcoreContactType = 1 | 2 | 3 | 4;

export type MeshClientDeepLink =
  | { kind: 'meshtasticChannel'; url: string }
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
  | { kind: 'unknown'; raw: string };

const MESHTASTIC_URL_RE = /^(?:meshtastic:\/\/|https?:\/\/meshtastic\.org\/e\/)/i;
const MESHCORE_PUBKEY_RE = /^[0-9a-f]{64}$/;
const MESHCORE_CHANNEL_SECRET_RE = /^[0-9a-f]{32}$/;

function isMeshcoreContactType(n: number): n is MeshcoreContactType {
  return n === 1 || n === 2 || n === 3 || n === 4;
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
  unscoped?: boolean;
}): string {
  const name = opts.name.trim();
  if (!name) throw new Error('invalid name');
  const secret = opts.secretHex.trim().toLowerCase();
  if (!MESHCORE_CHANNEL_SECRET_RE.test(secret)) throw new Error('invalid channel secret');
  const params = new URLSearchParams();
  params.set('name', name);
  params.set('secret', secret);
  if (!opts.unscoped && opts.regionScope?.trim())
    params.set('region_scope', opts.regionScope.trim());
  if (opts.unscoped) params.set('mesh_client_scope', 'unscoped');
  return `meshcore://channel/add?${params.toString()}`;
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
      const regionScope =
        url.searchParams.get('mesh_client_scope') === 'unscoped'
          ? ''
          : url.searchParams.get('region_scope')?.trim() || undefined;
      if (!name.trim() || !MESHCORE_CHANNEL_SECRET_RE.test(secretHex)) {
        return { kind: 'unknown', raw: trimmed };
      }
      return {
        kind: 'meshcoreChannelAdd',
        name: name.trim(),
        secretHex,
        ...(regionScope !== undefined ? { regionScope } : {}),
      };
    }

    return { kind: 'unknown', raw: trimmed };
  } catch {
    return { kind: 'unknown', raw: trimmed };
  }
}

export function classifyMeshClientDeepLink(raw: string): MeshClientDeepLink {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown', raw };

  if (MESHTASTIC_URL_RE.test(trimmed) || /^[A-Za-z0-9_-]{20,}={0,2}$/.test(trimmed)) {
    // Bare base64url channel payloads are handled by meshtasticUrlEncoder consumers.
    return { kind: 'meshtasticChannel', url: trimmed };
  }

  if (/^meshcore:\/\//i.test(trimmed)) {
    return classifyMeshcoreUri(trimmed);
  }

  return { kind: 'unknown', raw: trimmed };
}

/** Scan process.argv (Windows/Linux second-instance / cold start) for a forwardable deep link. */
export function findMeshDeepLinkInArgv(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    const trimmed = arg.trim();
    if (!trimmed) continue;
    if (/^(?:meshcore|meshtastic):\/\//i.test(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * True when main should forward an OS open-url / argv string to the renderer.
 * Allows `meshcore://` and Meshtastic channel URLs;
 * drops unrelated schemes.
 */
export function isForwardableMeshClientOpenUrl(raw: string): boolean {
  const kind = classifyMeshClientDeepLink(raw).kind;
  return kind !== 'unknown';
}
