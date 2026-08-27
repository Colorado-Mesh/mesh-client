import type { HeardRepeater } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import type { IdentityId } from '@/renderer/lib/types';
import { meshcoreNodeHash, type NodeHashCandidate } from '@/shared/meshcoreNodeHash';
import { meshcoreSplitPathHashSegments } from '@/shared/meshcorePathHash';

/** Window after a channel TX during which we credit rebroadcasts to that message.
 * Large meshes often need ≥60s for multi-hop floods to return; keep headroom. */
export const MESHCORE_HEARD_REPEAT_WINDOW_MS = 120_000;

export type MeshcoreHashSizeBytes = 1 | 2 | 3;

export type MeshcoreHeardRepeater = HeardRepeater;

interface PendingWindow {
  messageId: string;
  identityId: IdentityId;
  openedAt: number;
  windowMs: number;
  /**
   * Path-invariant flood id (type||payload). Bound from empty-path / own TX when seen;
   * once set, only matching rebroadcasts credit (blocks concurrent foreign GRP_TXT).
   */
  payloadIdentityHex?: string;
}

/** Latest open listen window per identity. */
const pendingByIdentity = new Map<IdentityId, PendingWindow>();

export function resetHeardRepeatWindowsForTests(): void {
  pendingByIdentity.clear();
}

/** Drop the listen window for an identity (disconnect / session teardown). */
export function clearHeardRepeatWindow(identityId: IdentityId): void {
  pendingByIdentity.delete(identityId);
}

/** Drop the listen window only when it still tracks `messageId`. */
export function clearHeardRepeatWindowIfMessage(identityId: IdentityId, messageId: string): void {
  const w = pendingByIdentity.get(identityId);
  if (w?.messageId === messageId) pendingByIdentity.delete(identityId);
}

/** Keep the listen window message id in sync when the bubble id is renamed. */
export function renameHeardRepeatWindowMessageId(
  identityId: IdentityId,
  fromMessageId: string,
  toMessageId: string,
): void {
  if (fromMessageId === toMessageId) return;
  const w = pendingByIdentity.get(identityId);
  if (w?.messageId !== fromMessageId) return;
  pendingByIdentity.set(identityId, { ...w, messageId: toMessageId });
}

export function openHeardRepeatWindow(
  identityId: IdentityId,
  messageId: string,
  windowMs: number = MESHCORE_HEARD_REPEAT_WINDOW_MS,
  openedAt: number = Date.now(),
): void {
  const prev = pendingByIdentity.get(identityId);
  if (prev) {
    const expired = openedAt - prev.openedAt > prev.windowMs;
    if (expired) {
      pendingByIdentity.delete(identityId);
    } else if (prev.messageId !== messageId) {
      // One active window per identity: drop the prior bubble's empty confirmed seed so
      // back-to-back channel sends do not leave orphan empty coverage for superseded ids.
      const prior = useRelayCoverageStore.getState().coverageFor(identityId, prev.messageId);
      if (
        prior?.protocol === 'meshcore' &&
        prior.mode === 'confirmed' &&
        (prior.heardRepeaters?.length ?? 0) === 0
      ) {
        useRelayCoverageStore.getState().remove(identityId, prev.messageId);
      }
    }
  }
  pendingByIdentity.set(identityId, {
    identityId,
    messageId,
    openedAt,
    windowMs,
  });
  useRelayCoverageStore.getState().set(identityId, messageId, {
    protocol: 'meshcore',
    mode: 'confirmed',
    heardRepeaters: [],
  });
}

function activeWindow(identityId: IdentityId, now: number): PendingWindow | null {
  const w = pendingByIdentity.get(identityId);
  if (!w) return null;
  if (now - w.openedAt > w.windowMs) {
    pendingByIdentity.delete(identityId);
    return null;
  }
  return w;
}

/** True when a non-expired listen window is open for this identity (same rule as credit path). */
export function hasOpenHeardRepeatWindow(
  identityId: IdentityId,
  now: number = Date.now(),
): boolean {
  return activeWindow(identityId, now) != null;
}

function prefixMatches(pubKey: Uint8Array, segment: Uint8Array): boolean {
  if (segment.length === 0 || pubKey.length < segment.length) return false;
  for (let i = 0; i < segment.length; i++) {
    if ((pubKey[i] & 0xff) !== (segment[i] & 0xff)) return false;
  }
  return true;
}

/**
 * All known nodes matching a path-hash segment, freshest first.
 * Unlike {@link meshcoreResolveNodeFromPathPrefix}, does not collapse collisions to one id —
 * callers can prefer Repeater/Room among matches.
 */
export function listMeshcorePathPrefixMatches(
  prefixBytes: Uint8Array,
  candidates: readonly NodeHashCandidate[],
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>,
): number[] {
  if (prefixBytes.length === 0 || candidates.length === 0) return [];

  const matches: NodeHashCandidate[] = [];
  if (prefixBytes.length === 1) {
    // Air format: 1-byte path hash = first pubkey byte. XOR-fold of node_id is fallback only.
    const prefix = prefixBytes[0] & 0xff;
    for (const node of candidates) {
      const pubKey = pubKeyByNodeId?.get(node.node_id);
      if (pubKey && pubKey.length > 0) {
        if ((pubKey[0] & 0xff) === prefix) matches.push(node);
      } else if (meshcoreNodeHash(node.node_id) === prefix) {
        matches.push(node);
      }
    }
  } else {
    for (const node of candidates) {
      const pubKey = pubKeyByNodeId?.get(node.node_id);
      if (!pubKey || !prefixMatches(pubKey, prefixBytes)) continue;
      matches.push(node);
    }
  }

  matches.sort((a, b) => b.last_heard - a.last_heard);
  return matches.map((m) => m.node_id);
}

/** Stable negative id for an unresolved on-air path segment (avoids real node_id space). */
export function syntheticHeardNodeIdFromPathSegment(segment: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const byte of segment) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return h | 0x80000000 | 0;
}

/** True when `nodeId` was minted by {@link syntheticHeardNodeIdFromPathSegment} (signed high bit). */
export function isSyntheticHeardNodeId(nodeId: number): boolean {
  return nodeId >>> 0 >= 0x80000000;
}

function pathSegmentHex(segment: Uint8Array): string {
  return Array.from(segment, (b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

/**
 * True when a path segment matches this node's routing hash.
 * MeshCore flood paths do **not** include the originator — only forwarders append
 * hashes — so this is used to skip self if it ever appears, not as an origin gate.
 */
export function meshcorePathOriginIsSelf(
  firstSegment: Uint8Array,
  myNodeNum: number,
  pathHashSizeBytes: MeshcoreHashSizeBytes,
  myPubKey?: Uint8Array | null,
): boolean {
  if (firstSegment.length === 0) return false;
  if (pathHashSizeBytes === 1) {
    if (myPubKey && myPubKey.length > 0) {
      return (firstSegment[0] & 0xff) === (myPubKey[0] & 0xff);
    }
    return (firstSegment[0] & 0xff) === meshcoreNodeHash(myNodeNum);
  }
  if (!myPubKey || myPubKey.length < pathHashSizeBytes) return false;
  return prefixMatches(myPubKey, firstSegment);
}

export interface RecordMeshcoreRfRxArgs {
  identityId: IdentityId;
  isOwnMeshcoreTx: boolean;
  /**
   * GRP_TXT channel floods do not carry a cleartext originator pubkey, so
   * `isOwnMeshcoreTx` is usually false on repeater overhears. When true and a
   * listen window is open, credit Repeater/Room hashes in the flood path
   * (forwarders only — MeshCore never puts the originator in `path`).
   */
  treatAsOwnChannelFlood?: boolean;
  pathBytes: readonly number[];
  pathHashSizeBytes: MeshcoreHashSizeBytes;
  myNodeNum: number;
  /** Used to skip self on path segments; prefer pubkey prefix over XOR-fold. */
  myPubKey?: Uint8Array | null;
  /**
   * Path-invariant flood id ({@link meshCorePathInvariantPayloadIdHex}). When the
   * window already bound an id, mismatched packets are ignored (foreign floods).
   * Empty-path / own TX binds the id for later rebroadcasts.
   */
  payloadIdentityHex?: string | null;
  snr?: number;
  rssi?: number;
  now?: number;
  candidates: readonly NodeHashCandidate[];
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
  /** Repeater/Room only; return null for other roles (Chat / users are never credited). */
  resolveRepeater: (nodeId: number) => MeshcoreHeardRepeater | null;
}

/**
 * Credit flood-path forwarder hashes on a channel-flood / own-TX RF overhear to the open TX window.
 *
 * Correlation:
 * - Bind path-invariant payload id only from own-TX echo or empty-path channel flood (never from
 *   the first credited hop — that races with foreign GRP_TXT).
 * - Once bound, mismatched ids are ignored; unbound windows credit all window GRP_TXT forwarders
 *   (pre-#888 best-effort; Chat hops still excluded).
 */
export function recordMeshcoreRfRx(args: RecordMeshcoreRfRxArgs): void {
  const {
    identityId,
    isOwnMeshcoreTx,
    treatAsOwnChannelFlood,
    pathBytes,
    pathHashSizeBytes,
    myNodeNum,
    myPubKey,
    payloadIdentityHex,
    snr,
    rssi,
    candidates,
    pubKeyByNodeId,
    resolveRepeater,
  } = args;
  const now = args.now ?? Date.now();
  if (!isOwnMeshcoreTx && !treatAsOwnChannelFlood) return;
  const window = activeWindow(identityId, now);
  if (!window) return;

  const incomingId =
    typeof payloadIdentityHex === 'string' && payloadIdentityHex.length > 0
      ? payloadIdentityHex.toUpperCase()
      : null;
  // Bind only from own-TX or empty-path channel echo — never from first credited hop.
  const canBindIdentity =
    Boolean(incomingId) &&
    !window.payloadIdentityHex &&
    (isOwnMeshcoreTx || (Boolean(treatAsOwnChannelFlood) && pathBytes.length === 0));
  if (canBindIdentity && incomingId) {
    window.payloadIdentityHex = incomingId;
    pendingByIdentity.set(identityId, { ...window });
  }
  if (window.payloadIdentityHex && incomingId && window.payloadIdentityHex !== incomingId) {
    return;
  }

  if (pathBytes.length === 0) return;

  const segments = meshcoreSplitPathHashSegments(pathBytes, pathHashSizeBytes);
  if (segments.length === 0) return;

  const prev =
    useRelayCoverageStore.getState().coverageFor(identityId, window.messageId)?.heardRepeaters ??
    [];
  const byId = new Map<number, HeardRepeater>(prev.map((r) => [r.nodeId, r]));
  let changed = false;

  for (const segment of segments) {
    const matches = listMeshcorePathPrefixMatches(segment, candidates, pubKeyByNodeId);
    let credited: MeshcoreHeardRepeater | null = null;
    let skippedSelf = false;

    for (const nodeId of matches) {
      if (nodeId === myNodeNum) {
        skippedSelf = true;
        continue;
      }
      const repeater = resolveRepeater(nodeId);
      if (repeater) {
        credited = repeater;
        break;
      }
    }
    if (!credited && meshcorePathOriginIsSelf(segment, myNodeNum, pathHashSizeBytes, myPubKey)) {
      skippedSelf = true;
    }
    // Flood path hops are forwarders. Unresolved hashes still prove network reach.
    if (!credited && !skippedSelf && matches.length === 0 && segment.length > 0) {
      const hex = pathSegmentHex(segment);
      credited = {
        nodeId: syntheticHeardNodeIdFromPathSegment(segment),
        name: hex,
      };
    }
    if (!credited) continue;

    const next: HeardRepeater = {
      nodeId: credited.nodeId,
      name: credited.name,
      snr: snr ?? credited.snr,
      rssi: rssi ?? credited.rssi,
    };
    const existing = byId.get(next.nodeId);
    if (
      existing &&
      existing.name === next.name &&
      existing.snr === next.snr &&
      existing.rssi === next.rssi
    ) {
      continue;
    }
    byId.set(next.nodeId, next);
    changed = true;
  }

  if (!changed && byId.size === prev.length) return;

  useRelayCoverageStore.getState().set(identityId, window.messageId, {
    protocol: 'meshcore',
    mode: 'confirmed',
    heardRepeaters: [...byId.values()],
  });
}

/** True when MeshCore contact `hw_model` is a relay role we prefer for heard-repeat. */
export function isMeshcoreHeardRepeatRole(hwModel: string | null | undefined): boolean {
  return hwModel === 'Repeater' || hwModel === 'Room';
}

export function resolveMeshcoreHeardRepeaterFromNode(
  nodeId: number,
  node: { long_name?: string | null; short_name?: string | null; hw_model?: string | null } | null,
): MeshcoreHeardRepeater | null {
  if (!node || !isMeshcoreHeardRepeatRole(node.hw_model)) return null;
  const name = node.long_name?.trim() || node.short_name?.trim() || undefined;
  return { nodeId, name };
}

/** Any foreign contact as a path hop (fallback when role is not Repeater/Room). */
export function resolveMeshcoreHeardPathHopFromNode(
  nodeId: number,
  node: { long_name?: string | null; short_name?: string | null } | null,
): MeshcoreHeardRepeater | null {
  if (!node) return null;
  const name = node.long_name?.trim() || node.short_name?.trim() || undefined;
  return { nodeId, name };
}
