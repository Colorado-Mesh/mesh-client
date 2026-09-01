import { touch } from '@/shared/touch';

import {
  isMeshcorePathHashMode,
  type MeshcorePathHashMode,
  meshcorePathHashSizeFromMode,
  meshcorePubkeyPathPrefix,
  meshcoreUnpackPathLenByte,
} from '../../shared/meshcorePathHash';
import { MESHCORE_OUT_PATH_LEN_MAX } from './meshcoreUtils';

export type MeshcoreTracePrimeStrategy = 'none' | 'passive' | 'flood';
export function meshcoreStoredPathLooksLikeFullPubKey(
  path: Uint8Array | undefined,
  pubKey: Uint8Array,
): boolean {
  if (!path || path.length === 0 || pubKey.length === 0) return false;
  if (path.length !== pubKey.length) return false;
  for (let i = 0; i < path.length; i++) {
    if (path[i] !== pubKey[i]) return false;
  }
  return true;
}

/**
 * Whether companion `outPathLen` means a multi-hop route exists.
 * Plain lengths 0..{@link MESHCORE_OUT_PATH_LEN_MAX} are last-byte-index (0 = direct).
 * Larger values are packed path_length bytes (low 6 bits = hop count) — e.g. 64 (0x40) is
 * 0 hops with 2-byte hashes, not "64 hops".
 */
export function meshcoreRadioContactPathLenSaysMultiHop(
  radioContactPathLen: number | null | undefined,
): boolean {
  if (radioContactPathLen == null || !Number.isFinite(radioContactPathLen)) return false;
  const len = Math.trunc(radioContactPathLen);
  if (len < 0) return false;
  if (len <= MESHCORE_OUT_PATH_LEN_MAX) return len >= 1;
  return meshcoreUnpackPathLenByte(len).hopCount >= 1;
}

/**
 * Hash size for path seeds from companion `outPathLen`.
 * Packed path_length bytes encode size in the high 2 bits; plain 0..61 lengths do not.
 */
export function meshcoreHashSizeFromRadioContactPathLen(
  radioContactPathLen: number | null | undefined,
): 1 | 2 | 3 {
  if (radioContactPathLen == null || !Number.isFinite(radioContactPathLen)) return 1;
  const len = Math.trunc(radioContactPathLen);
  if (len < 0) return 1;
  if (len <= MESHCORE_OUT_PATH_LEN_MAX) return 1;
  return meshcoreUnpackPathLenByte(len).hashSizeBytes;
}

/**
 * Prefer per-contact packed `outPathLen` hash size; else companion `path.hash.mode`.
 * Contact-specific packed lengths stay authoritative when present.
 */
export function meshcoreHashSizeForTraceSeed(
  radioContactPathLen: number | null | undefined,
  companionPathHashMode?: MeshcorePathHashMode | null,
): 1 | 2 | 3 {
  if (radioContactPathLen != null && Number.isFinite(radioContactPathLen)) {
    const len = Math.trunc(radioContactPathLen);
    if (len > MESHCORE_OUT_PATH_LEN_MAX) {
      return meshcoreUnpackPathLenByte(len).hashSizeBytes;
    }
  }
  if (isMeshcorePathHashMode(companionPathHashMode)) {
    return meshcorePathHashSizeFromMode(companionPathHashMode);
  }
  return meshcoreHashSizeFromRadioContactPathLen(radioContactPathLen);
}

/**
 * Whether cached route bytes are safe to use for trace/ping.
 * Multi-hop must not use the full destination pubkey — only hash-segment paths (≥2 bytes).
 * Zero-hop may use a 1-byte pubkey prefix (direct retry may escalate to full key at send time).
 */
export function meshcoreIsUsableTraceStoredPath(
  path: Uint8Array | undefined,
  hopsAway: number | null | undefined,
  pubKey: Uint8Array,
): boolean {
  if (!path || path.length === 0) return false;
  const hops = hopsAway ?? 0;
  if (meshcoreStoredPathLooksLikeFullPubKey(path, pubKey)) {
    return hops === 0;
  }
  if (hops >= 1 && path.length === pubKey.length) return false;
  // Hash-segment count must cover hop count (1-hop → 2 bytes, 3-hop → 4 bytes, …).
  if (hops >= 1 && path.length < hops + 1) return false;
  return true;
}

export interface MeshcoreRepeaterTraceRoutePlan {
  storedPath: Uint8Array | undefined;
  needsRoutePrime: boolean;
  pathTooShort: boolean;
  uiSaysMultiHop: boolean;
  radioSaysMultiHop: boolean;
  outPathSeed: Uint8Array;
}

/** Pure trace/ping path planning for repeater panel (0-hop and multi-hop). */
export function planMeshcoreRepeaterTraceRoute(opts: {
  storedPath: Uint8Array | undefined;
  hopsAway: number | null | undefined;
  pubKey: Uint8Array;
  radioContactPathLen: number | null;
  pathFromHistory?: Uint8Array;
  /** Companion path.hash.mode when contact outPathLen is missing/plain. */
  companionPathHashMode?: MeshcorePathHashMode | null;
}): MeshcoreRepeaterTraceRoutePlan {
  let storedPath = opts.storedPath;
  if (storedPath && !meshcoreIsUsableTraceStoredPath(storedPath, opts.hopsAway, opts.pubKey)) {
    storedPath = undefined;
  }
  if (
    (!storedPath || storedPath.length <= 1) &&
    opts.pathFromHistory &&
    meshcoreIsUsableTraceStoredPath(opts.pathFromHistory, opts.hopsAway, opts.pubKey) &&
    opts.pathFromHistory.length > 1 &&
    opts.radioContactPathLen != null &&
    opts.radioContactPathLen >= 0
  ) {
    storedPath = opts.pathFromHistory;
  }

  const hopsAway = opts.hopsAway;
  const needsRoutePrime =
    (!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1);
  const pathTooShort = !storedPath || storedPath.length <= 1;
  const uiSaysMultiHop = (hopsAway ?? 0) >= 1;
  const radioSaysMultiHop = meshcoreRadioContactPathLenSaysMultiHop(opts.radioContactPathLen);
  const hashSizeBytes = meshcoreHashSizeForTraceSeed(
    opts.radioContactPathLen,
    opts.companionPathHashMode,
  );

  let outPathSeed =
    storedPath && storedPath.length > 0
      ? storedPath
      : meshcorePubkeyPathPrefix(opts.pubKey, hashSizeBytes);
  if (
    outPathSeed.length === hashSizeBytes &&
    outPathSeed.every((b) => b === 0) &&
    opts.pubKey[0] !== 0
  ) {
    outPathSeed = meshcorePubkeyPathPrefix(opts.pubKey, hashSizeBytes);
  }

  return {
    storedPath,
    needsRoutePrime,
    pathTooShort,
    uiSaysMultiHop,
    radioSaysMultiHop,
    outPathSeed,
  };
}

/** 0-hop direct-retry: retry trace with full pubkey when a short hash-prefix attempt fails. */
export function meshcoreTraceDirectRetryEligible(
  hopsAway: number | null | undefined,
  tracePathLen: number,
): boolean {
  const hops = hopsAway ?? 0;
  if (hops !== 0) return false;
  // Prefix seeds are 1–3 bytes (hash mode); full pubkey retry uses 32 bytes.
  return tracePathLen >= 1 && tracePathLen < 32;
}

/** True when a multiplex cancel was caused by 0-hop CLI preempt (must not direct-retry). */
export function meshcoreTraceCancelledForCliPreempt(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /0-hop CLI preempted/i.test(msg);
}

/** Cancel reason passed into multiplex when 0-hop CLI must clear TraceData for drain/replies. */
export const MESHCORE_CLI_PREEMPT_TRACE_REASON = '0-hop CLI preempted stuck ping';

/**
 * Fast-fail ping when the radio confirms a multi-hop route but bytes are missing, or UI shows
 * 2+ hops with no path. Single-hop (UI) may still probe trace or use a synthesized relay path.
 */
export function meshcoreShouldAbortMultiHopPingNoRoute(
  pathTooShort: boolean,
  hopsAway: number | null | undefined,
  uiSaysMultiHop: boolean,
  radioSaysMultiHop: boolean,
  hasResolvedPath = false,
): boolean {
  if (hasResolvedPath) return false;
  if (!pathTooShort) return false;
  if (radioSaysMultiHop) return true;
  const hops = hopsAway ?? 0;
  return uiSaysMultiHop && hops >= 1;
}

/** Whether ping should fast-fail with pingNoRoute after route priming and path resolution. */
export function evaluateMeshcorePingRouteAbort(opts: {
  floodPrimeExhausted: boolean;
  pathResolvedComposed: boolean;
  pathTooShort: boolean;
  hopsAway: number | null | undefined;
  uiSaysMultiHop: boolean;
  radioSaysMultiHop: boolean;
  hasResolvedPath: boolean;
}): boolean {
  if (opts.floodPrimeExhausted && !opts.pathResolvedComposed) return true;
  return meshcoreShouldAbortMultiHopPingNoRoute(
    opts.pathTooShort,
    opts.hopsAway,
    opts.uiSaysMultiHop,
    opts.radioSaysMultiHop,
    opts.hasResolvedPath,
  );
}

/** Whether route priming should run before trace/ping. */
export function computeMeshcoreTracePrimeStrategy(opts: {
  needsRoutePrime: boolean;
  pathTooShort: boolean;
  hopsAway: number | null | undefined;
  hasUsableStoredPath: boolean;
  canSynthesizePath: boolean;
  skipPrime?: boolean;
}): MeshcoreTracePrimeStrategy {
  touch(opts.canSynthesizePath);
  if (opts.skipPrime || !opts.needsRoutePrime || !opts.pathTooShort) return 'none';
  if (opts.hasUsableStoredPath) return 'none';
  if (opts.hopsAway == null) return 'passive';
  const hops = opts.hopsAway;
  if (hops >= 1) return 'passive';
  return 'none';
}

/** Whether evidence-backed path synthesis can skip route priming. */
export function meshcoreCanSynthesizeTracePath(opts: {
  hopsAway: number | null | undefined;
  relayKeysForSynth: readonly Uint8Array[];
  partialDestPath: Uint8Array | undefined;
  destPubKey: Uint8Array;
}): boolean {
  const hopsForSynth = opts.hopsAway ?? 0;
  return (
    (hopsForSynth === 1 && opts.relayKeysForSynth.length > 0) ||
    (hopsForSynth === 2 &&
      opts.relayKeysForSynth.length > 0 &&
      opts.partialDestPath?.length === 2 &&
      meshcoreIsUsableTraceStoredPath(opts.partialDestPath, 1, opts.destPubKey))
  );
}

/** Build 1-byte-hash-mode path [relayPrefix, destPrefix] for a single known direct repeater relay. */
export function meshcoreSynthesizeOneHopTracePath(
  destPubKey: Uint8Array,
  directRelayPubKeys: readonly Uint8Array[],
): Uint8Array | undefined {
  for (const relayKey of directRelayPubKeys) {
    if (relayKey.length === 0 || destPubKey.length === 0) continue;
    if (meshcoreStoredPathLooksLikeFullPubKey(relayKey, destPubKey)) continue;
    const relayByte = relayKey[0] & 0xff;
    const destByte = destPubKey[0] & 0xff;
    if (relayByte === destByte && relayKey.length === destPubKey.length) {
      let sameKey = true;
      for (let i = 0; i < relayKey.length; i++) {
        if (relayKey[i] !== destPubKey[i]) {
          sameKey = false;
          break;
        }
      }
      if (sameKey) continue;
    }
    return new Uint8Array([relayByte, destByte]);
  }
  return undefined;
}

export function meshcoreDirectRepeaterRelayPubKeys(
  nodes: ReadonlyMap<number, { hops_away?: number | null; hw_model?: string | null }>,
  pubKeyByNodeId: ReadonlyMap<number, Uint8Array>,
  excludeNodeId: number,
): Uint8Array[] {
  const keys: Uint8Array[] = [];
  for (const [id, node] of nodes) {
    if (id === excludeNodeId) continue;
    if ((node.hops_away ?? 0) !== 0) continue;
    if (node.hw_model != null && node.hw_model !== 'Repeater') continue;
    const pk = pubKeyByNodeId.get(id);
    if (pk && pk.length > 0) keys.push(pk);
  }
  return keys;
}

/**
 * Evidence-backed trace path synthesis for multi-hop targets (no blind pubkey guessing).
 * - hops 1: [relayPrefix, destPrefix] via direct 0-hop repeater
 * - hops 2: prepend a 0-hop relay byte to a known 2-byte path toward dest
 * - hops 3+: only return stored paths with enough segments for the hop count
 */
export function meshcoreSynthesizeMultiHopTracePath(opts: {
  destPubKey: Uint8Array;
  hopsAway: number | null | undefined;
  nodes: ReadonlyMap<number, { hops_away?: number | null; hw_model?: string | null }>;
  pubKeyByNodeId: ReadonlyMap<number, Uint8Array>;
  excludeNodeId: number;
  pathByNodeId: ReadonlyMap<number, Uint8Array>;
}): Uint8Array | undefined {
  const hops = opts.hopsAway ?? 0;
  if (hops <= 0) return undefined;

  const relayKeys = meshcoreDirectRepeaterRelayPubKeys(
    opts.nodes,
    opts.pubKeyByNodeId,
    opts.excludeNodeId,
  );

  if (hops === 1) {
    return meshcoreSynthesizeOneHopTracePath(opts.destPubKey, relayKeys);
  }

  const storedToDest = opts.pathByNodeId.get(opts.excludeNodeId);
  if (hops >= 3) {
    if (
      storedToDest &&
      storedToDest.length > hops &&
      meshcoreIsUsableTraceStoredPath(storedToDest, hops, opts.destPubKey)
    ) {
      return storedToDest;
    }
    return undefined;
  }

  // hops === 2: prepend direct relay byte to a known 1-hop (2-byte) path toward dest
  const oneHopPath =
    storedToDest?.length === 2 && meshcoreIsUsableTraceStoredPath(storedToDest, 1, opts.destPubKey)
      ? storedToDest
      : undefined;
  if (!oneHopPath) return undefined;

  for (const relayKey of relayKeys) {
    const relayByte = relayKey[0] & 0xff;
    const composed = new Uint8Array([relayByte, oneHopPath[0], oneHopPath[1]]);
    if (meshcoreIsUsableTraceStoredPath(composed, 2, opts.destPubKey)) {
      return composed;
    }
  }
  return undefined;
}

/** Resolve trace outPath seed after planning, priming, and multi-hop synthesis. */
export function resolveMeshcoreTraceOutPathSeed(opts: {
  tracePlan: MeshcoreRepeaterTraceRoutePlan;
  pubKey: Uint8Array;
  hopsAway: number | null | undefined;
  nodeId: number;
  nodes: ReadonlyMap<number, { hops_away?: number | null; hw_model?: string | null }>;
  pubKeyByNodeId: ReadonlyMap<number, Uint8Array>;
  pathByNodeId: ReadonlyMap<number, Uint8Array>;
}): { outPath: Uint8Array; composed: boolean } {
  if (!opts.tracePlan.pathTooShort) {
    return { outPath: opts.tracePlan.outPathSeed, composed: false };
  }
  const synthesized = meshcoreSynthesizeMultiHopTracePath({
    destPubKey: opts.pubKey,
    hopsAway: opts.hopsAway,
    nodes: opts.nodes,
    pubKeyByNodeId: opts.pubKeyByNodeId,
    excludeNodeId: opts.nodeId,
    pathByNodeId: opts.pathByNodeId,
  });
  if (synthesized) {
    return { outPath: synthesized, composed: true };
  }
  return { outPath: opts.tracePlan.outPathSeed, composed: false };
}
