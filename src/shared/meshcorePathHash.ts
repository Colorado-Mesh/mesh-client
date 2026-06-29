import { type NodeHashCandidate, resolveNodeId } from './meshcoreNodeHash';

/** Companion / CLI path.hash.mode: 0 → 1-byte, 1 → 2-byte, 2 → 3-byte per hop. */
export type MeshcorePathHashMode = 0 | 1 | 2;

export const MESHCORE_PATH_HASH_MODE_MIN = 0 as const;
export const MESHCORE_PATH_HASH_MODE_MAX = 2 as const;

/** Max flood hop count per hash size (MeshCore firmware v1.14+). */
export const MESHCORE_PATH_HASH_MAX_HOPS: Readonly<Record<1 | 2 | 3, number>> = {
  1: 64,
  2: 32,
  3: 21,
};

export function meshcorePathHashSizeFromMode(mode: MeshcorePathHashMode): 1 | 2 | 3 {
  if (mode === 1) return 2;
  if (mode === 2) return 3;
  return 1;
}

export function meshcorePathHashModeFromSize(hashSizeBytes: number): MeshcorePathHashMode | null {
  if (hashSizeBytes === 1) return 0;
  if (hashSizeBytes === 2) return 1;
  if (hashSizeBytes === 3) return 2;
  return null;
}

export function meshcorePathHashSizeFromTraceFlags(flags: number): 1 | 2 | 3 {
  const code = flags & 0x03;
  if (code === 1) return 2;
  if (code === 2) return 3;
  return 1;
}

export interface MeshcoreUnpackedPathLen {
  hopCount: number;
  hashSizeBytes: 1 | 2 | 3;
  packed: number;
}

/** Decode packed path_length byte (hop count in low 6 bits, hash size code in high 2 bits). */
export function meshcoreUnpackPathLenByte(packed: number): MeshcoreUnpackedPathLen {
  const safe = packed & 0xff;
  const hopCount = safe & 0x3f;
  const hashSizeCode = (safe >> 6) & 0x03;
  const hashSizeBytes = (hashSizeCode + 1) as 1 | 2 | 3;
  return { hopCount, hashSizeBytes, packed: safe };
}

/** Encode hop count + hash size into path_length byte. Throws when hop count exceeds mode limit. */
export function meshcorePackPathLenByte(hopCount: number, hashSizeBytes: 1 | 2 | 3): number {
  const hops = Math.max(0, Math.min(63, Math.trunc(hopCount)));
  const maxHops = MESHCORE_PATH_HASH_MAX_HOPS[hashSizeBytes];
  if (hops > maxHops) {
    throw new Error(
      `Path hop count ${hops} exceeds max ${maxHops} for ${hashSizeBytes}-byte hashes`,
    );
  }
  const hashSizeCode = hashSizeBytes - 1;
  return hops | ((hashSizeCode & 0x03) << 6);
}

/** First N bytes of a 32-byte MeshCore pubkey used as on-air path hash. */
export function meshcorePubkeyPathPrefix(pubKey: Uint8Array, hashSizeBytes: 1 | 2 | 3): Uint8Array {
  if (pubKey.length < hashSizeBytes) {
    throw new Error(`Public key too short for ${hashSizeBytes}-byte path prefix`);
  }
  return pubKey.subarray(0, hashSizeBytes);
}

export function meshcorePubkeyPathPrefixHex(pubKey: Uint8Array, hashSizeBytes: 1 | 2 | 3): string {
  return Array.from(meshcorePubkeyPathPrefix(pubKey, hashSizeBytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** Split flat path hash bytes into per-hop segments. */
export function meshcoreSplitPathHashSegments(
  pathBytes: readonly number[] | Uint8Array,
  hashSizeBytes: 1 | 2 | 3,
): Uint8Array[] {
  const bytes =
    pathBytes instanceof Uint8Array ? pathBytes : Uint8Array.from(pathBytes.map((b) => b & 0xff));
  if (bytes.length === 0 || hashSizeBytes <= 0) return [];
  const segments: Uint8Array[] = [];
  for (let i = 0; i + hashSizeBytes <= bytes.length; i += hashSizeBytes) {
    segments.push(bytes.subarray(i, i + hashSizeBytes));
  }
  return segments;
}

function prefixMatches(pubKey: Uint8Array, segment: Uint8Array): boolean {
  if (segment.length === 0 || pubKey.length < segment.length) return false;
  for (let i = 0; i < segment.length; i++) {
    if ((pubKey[i] & 0xff) !== (segment[i] & 0xff)) return false;
  }
  return true;
}

/**
 * Resolve a path hash segment back to node_id using pubkey prefixes when available.
 * Falls back to 1-byte XOR-fold matching for single-byte segments.
 */
export function meshcoreResolveNodeFromPathPrefix(
  prefixBytes: Uint8Array,
  candidates: NodeHashCandidate[],
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>,
): number | null {
  if (prefixBytes.length === 0 || candidates.length === 0) return null;

  if (prefixBytes.length === 1) {
    return resolveNodeId(prefixBytes[0] & 0xff, candidates);
  }

  let best: NodeHashCandidate | null = null;
  for (const node of candidates) {
    const pubKey = pubKeyByNodeId?.get(node.node_id);
    if (pubKey && pubKey.length >= prefixBytes.length) {
      if (!prefixMatches(pubKey, prefixBytes)) continue;
    } else {
      continue;
    }
    if (best === null || node.last_heard > best.last_heard) {
      best = node;
    }
  }
  return best?.node_id ?? null;
}

/** Resolve flood-path originator from multibyte path segments (prefers freshest contact). */
export function meshcoreResolvePathSenderFromBytes(
  pathBytes: readonly number[] | Uint8Array,
  hashSizeBytes: 1 | 2 | 3,
  candidates: NodeHashCandidate[],
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>,
): number | null {
  const segments = meshcoreSplitPathHashSegments(pathBytes, hashSizeBytes);
  if (segments.length === 0 || candidates.length === 0) return null;

  const byId = new Map(candidates.map((c) => [c.node_id, c]));
  let bestId: number | null = null;
  let bestHeard = 0;

  for (const segment of segments) {
    const id = meshcoreResolveNodeFromPathPrefix(segment, candidates, pubKeyByNodeId);
    if (id == null) continue;
    const heard = byId.get(id)?.last_heard ?? 0;
    if (bestId == null || heard >= bestHeard) {
      bestId = id;
      bestHeard = heard;
    }
  }
  return bestId;
}

/** TraceData: pathLen byte is total hash bytes; flags low 2 bits encode hash size code. */
export function meshcoreTraceDataHashLayout(
  pathLenByte: number,
  flags: number,
): { hopCount: number; hashSizeBytes: 1 | 2 | 3; hashByteLength: number; snrByteLength: number } {
  const path_sz = flags & 0x03;
  const hashSizeBytes = (path_sz + 1) as 1 | 2 | 3;
  const hashByteLength = pathLenByte & 0xff;
  const snrCount = hashByteLength >> path_sz;
  const hopCount = hashSizeBytes > 0 ? Math.floor(hashByteLength / hashSizeBytes) : hashByteLength;
  return {
    hopCount,
    hashSizeBytes,
    hashByteLength,
    snrByteLength: snrCount + 1,
  };
}

export function isMeshcorePathHashMode(value: unknown): value is MeshcorePathHashMode {
  return value === 0 || value === 1 || value === 2;
}

/** Firmware v1.14+ required for multibyte path hashes on the mesh. */
export function meshcoreFirmwareSupportsMultibytePathHash(
  firmwareVersion: string | undefined,
): boolean {
  if (!firmwareVersion?.trim()) return false;
  const v = firmwareVersion.trim().replace(/^v/i, '');
  const parts = v.split('.').map((n) => parseInt(n, 10) || 0);
  const [maj = 0, min = 0] = parts;
  if (maj > 1) return true;
  if (maj < 1) return false;
  return min >= 14;
}
