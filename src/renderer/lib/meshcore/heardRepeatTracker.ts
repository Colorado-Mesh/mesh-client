import type { HeardRepeater } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import type { IdentityId } from '@/renderer/lib/types';
import { decodeMeshcoreGroupText, meshcoreChannelHash } from '@/shared/meshcoreGroupText';
import { meshcoreNodeHash, type NodeHashCandidate } from '@/shared/meshcoreNodeHash';
import { meshcoreSplitPathHashSegments } from '@/shared/meshcorePathHash';
import {
  type MeshCorePathInvariantPayloadId,
  meshCorePathInvariantPayloadIdsEqual,
} from '@/shared/meshcoreRfPacketParse';

/** Window after a channel TX during which we credit rebroadcasts to that message.
 * Large meshes often need ≥60s for multi-hop floods to return; keep headroom. */
export const MESHCORE_HEARD_REPEAT_WINDOW_MS = 120_000;

export type MeshcoreHashSizeBytes = 1 | 2 | 3;

export type MeshcoreHeardRepeater = HeardRepeater;

/** Seconds before the recorded send time a decrypted GRP_TXT timestamp may fall (clock rounding). */
const OWN_GRP_TXT_TIMESTAMP_EARLY_SEC = 2;

/** What our own channel flood decrypts to; used to recognise its rebroadcasts. */
export interface MeshcoreOwnChannelFloodExpectation {
  channelIndex: number;
  /** Radio node name; firmware prefixes channel text with `"name: "`. */
  senderName: string;
  wireText: string;
  sentAtSec: number;
}

interface PendingWindow {
  messageId: string;
  identityId: IdentityId;
  openedAt: number;
  windowMs: number;
  expect?: MeshcoreOwnChannelFloodExpectation;
  /**
   * Path-invariant flood id (type||payload). Bound from own TX or a GRP_TXT that decrypts to
   * {@link expect}; once set, only matching rebroadcasts credit.
   */
  payloadIdentity?: MeshCorePathInvariantPayloadId;
}

/** Latest open listen window per identity. */
const pendingByIdentity = new Map<IdentityId, PendingWindow>();

/** Radio channel secrets by index, published by the MeshCore runtime. */
const channelSecretsByIndex = new Map<number, Uint8Array>();

export function setMeshcoreHeardRepeatChannelSecrets(
  channels: readonly { index: number; secret: Uint8Array }[],
): void {
  channelSecretsByIndex.clear();
  for (const ch of channels) {
    if (ch.secret.length === 16) channelSecretsByIndex.set(ch.index, ch.secret);
  }
}

export function clearMeshcoreHeardRepeatChannelSecrets(): void {
  channelSecretsByIndex.clear();
}

export function resetHeardRepeatWindowsForTests(): void {
  pendingByIdentity.clear();
  channelSecretsByIndex.clear();
}

/** True when a GRP_TXT inner payload decrypts to our expected channel message. */
function grpTxtMatchesExpectation(
  innerPayload: Uint8Array,
  expect: MeshcoreOwnChannelFloodExpectation,
  windowMs: number,
): boolean {
  const secret = channelSecretsByIndex.get(expect.channelIndex);
  if (!secret || innerPayload.length === 0) return false;
  if (innerPayload[0] !== meshcoreChannelHash(secret)) return false;
  const decoded = decodeMeshcoreGroupText(secret, innerPayload);
  if (!decoded) return false;
  const latestSec = expect.sentAtSec + Math.ceil(windowMs / 1000);
  if (
    decoded.timestampSec < expect.sentAtSec - OWN_GRP_TXT_TIMESTAMP_EARLY_SEC ||
    decoded.timestampSec > latestSec
  ) {
    return false;
  }
  return decoded.text === `${expect.senderName}: ${expect.wireText}`;
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
  expect?: MeshcoreOwnChannelFloodExpectation,
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
    ...(expect ? { expect } : {}),
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
  // Force signed high bit → always negative in JS (real node ids use >>> 0, so ≥ 0).
  return h | 0x80000000 | 0;
}

/** True when `nodeId` was minted by {@link syntheticHeardNodeIdFromPathSegment} (negative). */
export function isSyntheticHeardNodeId(nodeId: number): boolean {
  return nodeId < 0;
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
   * `isOwnMeshcoreTx` is usually false on repeater overhears. When true, the packet
   * is credited only once it (or an earlier rebroadcast of the same payload) decrypts
   * to the window's {@link MeshcoreOwnChannelFloodExpectation}.
   */
  treatAsOwnChannelFlood?: boolean;
  pathBytes: readonly number[];
  pathHashSizeBytes: MeshcoreHashSizeBytes;
  myNodeNum: number;
  /** Used to skip self on path segments; prefer pubkey prefix over XOR-fold. */
  myPubKey?: Uint8Array | null;
  /**
   * Path-invariant flood id ({@link MeshCorePathInvariantPayloadId}). When the
   * window already bound an id, mismatched packets are ignored (foreign floods).
   * Own TX, or a GRP_TXT whose `innerPayload` decrypts to the expectation, binds the id.
   */
  payloadIdentity?: MeshCorePathInvariantPayloadId | null;
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
 * - Bind the path-invariant payload id from own-TX echo, or from a GRP_TXT that decrypts with the
 *   send's channel secret to `"senderName: wireText"` with a timestamp near the send.
 * - Once bound, mismatched ids are ignored. Unbound windows never credit GRP_TXT forwarders,
 *   so other people's channel traffic in the window does not count as "Heard by".
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
    payloadIdentity,
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

  const incomingId = payloadIdentity ?? null;
  if (!window.payloadIdentity && incomingId) {
    // Bind from own TX, or from a GRP_TXT that decrypts to our own channel message.
    const ownGrpTxt =
      !isOwnMeshcoreTx &&
      Boolean(treatAsOwnChannelFlood) &&
      window.expect != null &&
      grpTxtMatchesExpectation(incomingId.innerPayload, window.expect, window.windowMs);
    if (isOwnMeshcoreTx || ownGrpTxt) {
      window.payloadIdentity = incomingId;
      pendingByIdentity.set(identityId, { ...window });
    }
  }
  if (window.payloadIdentity) {
    if (incomingId && !meshCorePathInvariantPayloadIdsEqual(window.payloadIdentity, incomingId)) {
      return;
    }
  } else if (!isOwnMeshcoreTx) {
    // Unconfirmed channel flood: may be anyone's traffic, never credit it.
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
