import { meshcorePubkeyPathPrefix } from '../../shared/meshcorePathHash';

/** True when `path` is the full 32-byte destination pubkey (not a hashed route). */
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
  if (hops >= 1 && path.length < 2) return false;
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
}): MeshcoreRepeaterTraceRoutePlan {
  let storedPath = opts.storedPath;
  if (storedPath && !meshcoreIsUsableTraceStoredPath(storedPath, opts.hopsAway, opts.pubKey)) {
    storedPath = undefined;
  }
  if (
    (!storedPath || storedPath.length <= 1) &&
    opts.pathFromHistory &&
    meshcoreIsUsableTraceStoredPath(opts.pathFromHistory, opts.hopsAway, opts.pubKey) &&
    opts.pathFromHistory.length > 1
  ) {
    storedPath = opts.pathFromHistory;
  }

  const hopsAway = opts.hopsAway;
  const needsRoutePrime =
    (!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1);
  const pathTooShort = !storedPath || storedPath.length <= 1;
  const uiSaysMultiHop = (hopsAway ?? 0) >= 1;
  const radioSaysMultiHop = opts.radioContactPathLen != null && opts.radioContactPathLen >= 1;

  let outPathSeed =
    storedPath && storedPath.length > 0 ? storedPath : meshcorePubkeyPathPrefix(opts.pubKey, 1);
  if (outPathSeed.length === 1 && outPathSeed[0] === 0 && opts.pubKey[0] !== 0) {
    outPathSeed = meshcorePubkeyPathPrefix(opts.pubKey, 1);
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

/** 0-hop direct-retry: retry trace with full pubkey when the 1-byte prefix attempt fails. */
export function meshcoreTraceDirectRetryEligible(
  hopsAway: number | null | undefined,
  tracePathLen: number,
): boolean {
  return (hopsAway ?? 0) === 0 && tracePathLen === 1;
}

/**
 * Fast-fail ping when the radio confirms a multi-hop route but bytes are missing, or UI shows
 * 2+ hops with no path. Single-hop (UI) may still probe trace or use a synthesized relay path.
 */
export function meshcoreShouldAbortMultiHopPingNoRoute(
  pathTooShort: boolean,
  hopsAway: number | null | undefined,
  uiSaysMultiHop: boolean,
  radioSaysMultiHop: boolean,
): boolean {
  if (!pathTooShort) return false;
  if (radioSaysMultiHop) return true;
  const hops = hopsAway ?? 0;
  return uiSaysMultiHop && hops >= 2;
}

/** Build 1-byte-hash-mode path [relayPrefix, destPrefix] for a single known direct repeater relay. */
export function meshcoreSynthesizeOneHopTracePath(
  destPubKey: Uint8Array,
  directRelayPubKeys: readonly Uint8Array[],
): Uint8Array | undefined {
  for (const relayKey of directRelayPubKeys) {
    if (relayKey.length === 0 || destPubKey.length === 0) continue;
    if (meshcoreStoredPathLooksLikeFullPubKey(relayKey, destPubKey)) continue;
    const relayByte = (relayKey[0] ?? 0) & 0xff;
    const destByte = (destPubKey[0] ?? 0) & 0xff;
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
