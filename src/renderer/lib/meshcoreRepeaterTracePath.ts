import { touch } from '@/shared/touch';

import {
  isMeshcorePathHashMode,
  type MeshcorePathHashMode,
  meshcorePathHashSizeFromMode,
  meshcorePubkeyPathPrefix,
  meshcoreRadioContactRoute,
} from '../../shared/meshcorePathHash';

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
 * The low 6 bits are the hop count at every hash size: 64 (0x40) is 0 hops with 2-byte
 * hashes, not "64 hops", and -127 (0x81 read as int8) is 1 hop with 3-byte hashes.
 */
export function meshcoreRadioContactPathLenSaysMultiHop(
  radioContactPathLen: number | null | undefined,
): boolean {
  const route = meshcoreRadioContactRoute(radioContactPathLen);
  return route != null && route.hopCount >= 1;
}

/**
 * Hash size for path seeds from companion `outPathLen`.
 * Packed path_length bytes encode size in the high 2 bits; plain 0..61 lengths do not.
 */
export function meshcoreHashSizeFromRadioContactPathLen(
  radioContactPathLen: number | null | undefined,
): 1 | 2 | 3 {
  return meshcoreRadioContactRoute(radioContactPathLen)?.hashSizeBytes ?? 1;
}

/**
 * Hash size of a contact's route for trace/ping.
 * A route the radio knows (1+ hops) is read at the size its own length byte packs: a plain
 * length is 1-byte hashes even when the companion is in 2-byte mode. A packed zero-hop length
 * (0x40, 0x80) also carries its size. Otherwise companion `path.hash.mode` decides.
 */
export function meshcoreHashSizeForTraceSeed(
  radioContactPathLen: number | null | undefined,
  companionPathHashMode?: MeshcorePathHashMode | null,
): 1 | 2 | 3 {
  const route = meshcoreRadioContactRoute(radioContactPathLen);
  if (route && (route.hopCount >= 1 || route.hashSizeBytes > 1)) {
    return route.hashSizeBytes;
  }
  if (isMeshcorePathHashMode(companionPathHashMode)) {
    return meshcorePathHashSizeFromMode(companionPathHashMode);
  }
  return 1;
}

/**
 * Hop count a ping plans its route from.
 *
 * The radio sends all 64 path bytes with a contact, and only the length byte says how many of
 * them are the route (firmware replaces the route with `copyPath` and never clears the rest).
 * A length of zero hops (0x00, 0x40, 0x80) means the radio itself sends to this contact direct.
 * When such a contact's buffer still holds bytes an older route left behind, those bytes are
 * not a route and the hop count the app read from them is not one either, so the ping goes
 * direct.
 * Any other case keeps the displayed hop count, including a direct contact with a clean
 * buffer that adverts show at 1+ hops (the ping may then go through a known relay).
 */
export function meshcoreTracePingHopsAway(opts: {
  displayedHopsAway: number | null | undefined;
  radioContactPathLen: number | null | undefined;
  /** From a fresh read of the radio contact; see `meshcoreContactHasLeftoverPathBytes`. */
  radioPathLeftover: boolean | undefined;
}): number | null | undefined {
  if (meshcoreTracePingRadioSaysDirect(opts.radioContactPathLen) && opts.radioPathLeftover) {
    return 0;
  }
  return opts.displayedHopsAway;
}

/** Whether the radio's length byte for a contact says it is heard direct (zero hops). */
export function meshcoreTracePingRadioSaysDirect(
  radioContactPathLen: number | null | undefined,
): boolean {
  return meshcoreRadioContactRoute(radioContactPathLen)?.hopCount === 0;
}

/**
 * Whether a ping tries the node direct before the route it planned.
 *
 * True when the radio's length byte gives no route (0xFF: a Status or Telemetry flood resend
 * resets the route to this and keeps it when no path comes back), the contact's path buffer
 * still holds an older route's bytes, and the app shows the node 1+ hops away. The radio no
 * longer uses those bytes, and the hops may come from them. A node that is in range answers
 * the direct try; one that is not falls back to the planned route. A contact the radio never
 * routed has a clean buffer and is not tried direct.
 */
export function meshcoreTracePingTriesDirectFirst(opts: {
  hopsAway: number | null | undefined;
  radioContactPathLen: number | null | undefined;
  /** From a fresh read of the radio contact; see `meshcoreContactHasLeftoverPathBytes`. */
  radioPathLeftover: boolean | undefined;
}): boolean {
  if ((opts.hopsAway ?? 0) < 1 || opts.radioPathLeftover !== true) return false;
  return meshcoreTracePingRadioHasNoRoute(opts.radioContactPathLen);
}

/** Whether the radio's length byte for a contact says it has no route (0xFF read either way). */
export function meshcoreTracePingRadioHasNoRoute(
  radioContactPathLen: number | null | undefined,
): boolean {
  const len = radioContactPathLen;
  return typeof len === 'number' && Number.isFinite(len) && meshcoreRadioContactRoute(len) == null;
}

/**
 * Route to keep after a ping the destination answered itself (zero hops, one entry): the
 * destination's own prefix at the path hash size. The reply entry often has another length.
 * The 8-byte full-key try would be counted as seven hops by room login and repeater admin, which
 * count hops from the stored bytes. A 3-byte hash goes out as a 2-byte entry, and the next ping
 * rejects 2 bytes as not a whole 3-byte hash.
 */
export function meshcoreTraceZeroHopStoredPath(
  replyPath: Uint8Array,
  destPubKey: Uint8Array,
  hashSizeBytes: 1 | 2 | 3,
): Uint8Array {
  if (
    replyPath.length === hashSizeBytes &&
    replyPath.every((byte, index) => byte === destPubKey[index])
  ) {
    return replyPath;
  }
  return meshcorePubkeyPathPrefix(destPubKey, hashSizeBytes);
}

/** Whether `path` is the first bytes of the destination's public key. */
function meshcorePathIsDestKeyPrefix(path: Uint8Array, destPubKey: Uint8Array): boolean {
  if (path.length === 0 || path.length > destPubKey.length) return false;
  return path.every((byte, i) => byte === destPubKey[i]);
}

/**
 * Minimum bytes of a stored route (the shared path map, path history) for hopsAway.
 * Zero-hop: one dest prefix. Multi-hop at 1-byte hashes: the relays plus one trailing byte
 * (`hops + 1`). Multi-hop at 2- or 3-byte hashes: the relay hashes only (`hops * hashSize`).
 * See {@link meshcoreTraceOutboundFromStoredPath} for the two shapes.
 */
export function meshcoreTracePathMinByteLength(
  hopsAway: number | null | undefined,
  hashSizeBytes: 1 | 2 | 3,
): number {
  const hops = Math.max(0, hopsAway ?? 0);
  if (hops === 0) return hashSizeBytes;
  if (hashSizeBytes === 1) return hops + 1;
  return hops * hashSizeBytes;
}

/**
 * Relay hashes of a stored multi-hop route, in the order a packet travels out.
 *
 * Stored routes come in two shapes. With 1-byte hashes the app slices a plain contact length
 * `n` as `n + 1` bytes, so a stored route is its relays plus one trailing byte; room login and
 * repeater admin count hops as `length - 1` and depend on that. The trailing byte is whatever
 * followed the route in the radio's path buffer, not a hop, and must never be sent as one.
 * With 2- and 3-byte hashes the stored route is exactly the radio's relay hashes.
 */
export function meshcoreTraceOutboundFromStoredPath(
  storedPath: Uint8Array,
  hashSizeBytes: 1 | 2 | 3,
): Uint8Array {
  if (hashSizeBytes === 1) return storedPath.slice(0, Math.max(0, storedPath.length - 1));
  return storedPath.slice();
}

/** Inverse of {@link meshcoreTraceOutboundFromStoredPath}: relay hashes back to a stored route. */
export function meshcoreTraceStoredPathFromOutbound(
  outboundRelays: Uint8Array,
  destPubKey: Uint8Array,
  hashSizeBytes: 1 | 2 | 3,
): Uint8Array {
  if (hashSizeBytes !== 1) return outboundRelays.slice();
  const stored = new Uint8Array(outboundRelays.length + 1);
  stored.set(outboundRelays, 0);
  stored.set(destPubKey.subarray(0, 1), outboundRelays.length);
  return stored;
}

/**
 * Most entries a trace path may hold: the companion rejects `SendTracePath` above
 * `MAX_PATH_SIZE` (64) entries, and each forward appends one SNR byte to a 64-byte buffer.
 */
export const MESHCORE_TRACE_MAX_PATH_ENTRIES = 64;

/**
 * Expand outbound relay hashes into a TRACE path that returns to the initiator.
 *
 * Firmware reports a trace (`onTraceRecv`) to whoever hears the packet after its last entry.
 * For a destination that is not RF-adjacent to us, the path must loop back through the
 * outbound relays: `[...relays, dest, ...relays reversed]`. A relay may handle the packet
 * twice because the TRACE packet hash covers the growing SNR count
 * (`Packet::calculatePacketHash`). With no relays the path is a single dest prefix.
 */
export function meshcoreExpandTracePathWithAutoReturn(
  outboundRelays: Uint8Array,
  destPubKey: Uint8Array,
  hashSizeBytes: 1 | 2 | 3,
): Uint8Array {
  const dest = meshcorePubkeyPathPrefix(destPubKey, hashSizeBytes);
  if (outboundRelays.length === 0) return dest;
  if (outboundRelays.length % hashSizeBytes !== 0) return outboundRelays;

  const relays: Uint8Array[] = [];
  for (let i = 0; i < outboundRelays.length; i += hashSizeBytes) {
    relays.push(outboundRelays.subarray(i, i + hashSizeBytes));
  }
  const full = [...relays, dest, ...relays.slice().reverse()];
  const out = new Uint8Array(full.length * hashSizeBytes);
  full.forEach((seg, i) => {
    out.set(seg, i * hashSizeBytes);
  });
  return out;
}

export interface MeshcoreTraceOutboundLeg {
  /** Relay entries then the destination entry, as the reply carried them. */
  pathHashes: number[];
  /** SNR each relay heard the trace at on the way out, in dB. */
  pathSnrsDb: number[];
  /** SNR the destination heard the trace at, in dB. */
  destSnrDb: number;
}

/**
 * The outbound half of an auto-return trace reply, for display.
 *
 * The reply lists `[...relays, dest, ...relays reversed]` with one SNR per entry (the SNR that
 * node heard the packet at) and a final SNR for this radio hearing the last relay. Shown whole,
 * a route of one relay reads as three hops that end at the destination. The outbound leg keeps
 * the relays, the destination and the SNR the destination heard the trace at.
 * Returns null when the reply is not a whole round trip.
 */
export function meshcoreTraceOutboundLegOfRoundTrip(opts: {
  pathHashes: readonly number[];
  pathSnrsDb: readonly number[];
  entryBytes: number;
}): MeshcoreTraceOutboundLeg | null {
  const { pathHashes, pathSnrsDb, entryBytes } = opts;
  if (entryBytes <= 0 || pathHashes.length % entryBytes !== 0) return null;
  const entries = pathHashes.length / entryBytes;
  if (entries < 3 || entries % 2 === 0) return null;
  const relayCount = (entries - 1) / 2;
  const destSnrDb = pathSnrsDb.at(relayCount);
  if (destSnrDb === undefined) return null;
  return {
    pathHashes: pathHashes.slice(0, (relayCount + 1) * entryBytes),
    pathSnrsDb: pathSnrsDb.slice(0, relayCount),
    destSnrDb,
  };
}

/**
 * Whether cached route bytes are safe to use for trace/ping at this path-hash size.
 * Multi-hop must not use the full destination pubkey — only hash-segment paths.
 * Zero-hop may use a dest pubkey prefix (direct retry may escalate to full key at send time).
 */
export function meshcoreIsUsableTraceStoredPath(
  path: Uint8Array | undefined,
  hopsAway: number | null | undefined,
  pubKey: Uint8Array,
  hashSizeBytes: 1 | 2 | 3 = 1,
): boolean {
  if (!path || path.length === 0) return false;
  const hops = hopsAway ?? 0;
  if (meshcoreStoredPathLooksLikeFullPubKey(path, pubKey)) {
    return hops === 0;
  }
  if (hops >= 1 && path.length === pubKey.length) return false;
  if (path.length % hashSizeBytes !== 0) return false;
  return path.length >= meshcoreTracePathMinByteLength(hops, hashSizeBytes);
}

export interface MeshcoreRepeaterTraceRoutePlan {
  storedPath: Uint8Array | undefined;
  needsRoutePrime: boolean;
  pathTooShort: boolean;
  uiSaysMultiHop: boolean;
  radioSaysMultiHop: boolean;
  outPathSeed: Uint8Array;
  hashSizeBytes: 1 | 2 | 3;
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
  const hashSizeBytes = meshcoreHashSizeForTraceSeed(
    opts.radioContactPathLen,
    opts.companionPathHashMode,
  );
  const minPathBytes = meshcoreTracePathMinByteLength(opts.hopsAway, hashSizeBytes);

  let storedPath = opts.storedPath;
  if (
    storedPath &&
    !meshcoreIsUsableTraceStoredPath(storedPath, opts.hopsAway, opts.pubKey, hashSizeBytes)
  ) {
    storedPath = undefined;
  }
  if (
    (!storedPath || storedPath.length < minPathBytes) &&
    opts.pathFromHistory &&
    meshcoreIsUsableTraceStoredPath(
      opts.pathFromHistory,
      opts.hopsAway,
      opts.pubKey,
      hashSizeBytes,
    ) &&
    // The radio must know a route: 0xFF / -1 is none, and a 3-byte length arrives negative.
    meshcoreRadioContactRoute(opts.radioContactPathLen) != null
  ) {
    storedPath = opts.pathFromHistory;
  }

  const hopsAway = opts.hopsAway;
  const radioSaysMultiHop = meshcoreRadioContactPathLenSaysMultiHop(opts.radioContactPathLen);
  // A zero-hop trace has one entry: the destination's own key prefix. Anything else stored
  // for a direct contact is what an older route left in the radio's path buffer, and tracing
  // it reaches a neighbour (or nobody) instead of the destination.
  if (
    hopsAway === 0 &&
    !radioSaysMultiHop &&
    storedPath &&
    !meshcorePathIsDestKeyPrefix(storedPath, opts.pubKey)
  ) {
    storedPath = undefined;
  }
  const pathTooShort = !storedPath || storedPath.length < minPathBytes;
  const needsRoutePrime = pathTooShort && (hopsAway == null || hopsAway >= 1);
  const uiSaysMultiHop = (hopsAway ?? 0) >= 1;

  let outPathSeed: Uint8Array;
  if (storedPath && storedPath.length >= minPathBytes) {
    outPathSeed = storedPath;
  } else if ((hopsAway ?? 0) === 0) {
    // Zero-hop always seeds a dest prefix at the mesh path-hash width (1/2/3).
    outPathSeed = meshcorePubkeyPathPrefix(opts.pubKey, hashSizeBytes);
  } else if (storedPath && storedPath.length > 0) {
    outPathSeed = storedPath;
  } else {
    outPathSeed = meshcorePubkeyPathPrefix(opts.pubKey, hashSizeBytes);
  }
  if (
    (hopsAway ?? 0) === 0 &&
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
    hashSizeBytes,
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
  /** Path hash size from contact packed outPathLen / companion path.hash.mode. */
  hashSizeBytes?: 1 | 2 | 3;
}): boolean {
  const hopsForSynth = opts.hopsAway ?? 0;
  const hashSizeBytes = opts.hashSizeBytes ?? 1;
  const oneHopByteLen = meshcoreTracePathMinByteLength(1, hashSizeBytes);
  return (
    (hopsForSynth === 1 && opts.relayKeysForSynth.length > 0) ||
    (hopsForSynth === 2 &&
      opts.relayKeysForSynth.length > 0 &&
      opts.partialDestPath?.length === oneHopByteLen &&
      meshcoreIsUsableTraceStoredPath(opts.partialDestPath, 1, opts.destPubKey, hashSizeBytes))
  );
}

/**
 * Build outbound intermediate path `[relayPrefix]` for a single known direct repeater relay.
 * Prefix width follows path hash mode. Callers expand with
 * {@link meshcoreExpandTracePathWithAutoReturn} before SendTracePath so TraceData returns.
 */
export function meshcoreSynthesizeOneHopTracePath(
  destPubKey: Uint8Array,
  directRelayPubKeys: readonly Uint8Array[],
  hashSizeBytes: 1 | 2 | 3 = 1,
): Uint8Array | undefined {
  for (const relayKey of directRelayPubKeys) {
    if (relayKey.length < hashSizeBytes || destPubKey.length < hashSizeBytes) continue;
    if (meshcoreStoredPathLooksLikeFullPubKey(relayKey, destPubKey)) continue;
    const relayPrefix = meshcorePubkeyPathPrefix(relayKey, hashSizeBytes);
    const destPrefix = meshcorePubkeyPathPrefix(destPubKey, hashSizeBytes);
    let samePrefix = true;
    for (let i = 0; i < hashSizeBytes; i++) {
      if (relayPrefix[i] !== destPrefix[i]) {
        samePrefix = false;
        break;
      }
    }
    if (samePrefix) continue;
    return new Uint8Array(relayPrefix);
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
 * Evidence-backed outbound intermediate path for multi-hop targets (no blind pubkey guessing).
 * - hops 1: [relayPrefix] via direct 0-hop repeater
 * - hops 2: prepend a 0-hop relay prefix to a known 1-hop intermediate path
 * - hops 3+: only return stored paths with enough segments for the hop count
 * Callers expand with {@link meshcoreExpandTracePathWithAutoReturn} before SendTracePath.
 */
export function meshcoreSynthesizeMultiHopTracePath(opts: {
  destPubKey: Uint8Array;
  hopsAway: number | null | undefined;
  nodes: ReadonlyMap<number, { hops_away?: number | null; hw_model?: string | null }>;
  pubKeyByNodeId: ReadonlyMap<number, Uint8Array>;
  excludeNodeId: number;
  pathByNodeId: ReadonlyMap<number, Uint8Array>;
  /** Path hash size from contact packed outPathLen / companion path.hash.mode. */
  hashSizeBytes?: 1 | 2 | 3;
}): Uint8Array | undefined {
  const hops = opts.hopsAway ?? 0;
  if (hops <= 0) return undefined;
  const hashSizeBytes = opts.hashSizeBytes ?? 1;

  const relayKeys = meshcoreDirectRepeaterRelayPubKeys(
    opts.nodes,
    opts.pubKeyByNodeId,
    opts.excludeNodeId,
  );

  if (hops === 1) {
    return meshcoreSynthesizeOneHopTracePath(opts.destPubKey, relayKeys, hashSizeBytes);
  }

  const storedToDest = opts.pathByNodeId.get(opts.excludeNodeId);
  if (hops >= 3) {
    if (
      storedToDest &&
      meshcoreIsUsableTraceStoredPath(storedToDest, hops, opts.destPubKey, hashSizeBytes)
    ) {
      return meshcoreTraceOutboundFromStoredPath(storedToDest, hashSizeBytes);
    }
    return undefined;
  }

  // hops === 2: prepend a direct relay prefix to the relay of a known 1-hop stored route
  const oneHopStoredLen = meshcoreTracePathMinByteLength(1, hashSizeBytes);
  const oneHopRelay =
    storedToDest?.length === oneHopStoredLen &&
    meshcoreIsUsableTraceStoredPath(storedToDest, 1, opts.destPubKey, hashSizeBytes)
      ? meshcoreTraceOutboundFromStoredPath(storedToDest, hashSizeBytes)
      : undefined;
  if (!oneHopRelay) return undefined;

  for (const relayKey of relayKeys) {
    if (relayKey.length < hashSizeBytes) continue;
    const relayPrefix = meshcorePubkeyPathPrefix(relayKey, hashSizeBytes);
    const composed = new Uint8Array(hashSizeBytes + oneHopRelay.length);
    composed.set(relayPrefix, 0);
    composed.set(oneHopRelay, hashSizeBytes);
    return composed;
  }
  return undefined;
}

export interface MeshcoreResolvedTraceOutPath {
  /** Path bytes sent on the wire (auto-return expanded for multi-hop). */
  outPath: Uint8Array;
  /** Outbound relay hashes only (no dest / return); the dest seed for zero-hop. */
  outboundPath: Uint8Array;
  /**
   * The route in the shape the shared path map and path history hold
   * ({@link meshcoreTraceOutboundFromStoredPath}). Undefined when a multi-hop target has no
   * route: the ping must then fail with no route instead of tracing the dest seed.
   */
  storedPath: Uint8Array | undefined;
  composed: boolean;
  /** True when outPath is an auto-return round trip (multi-hop repeater ping). */
  autoReturn: boolean;
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
  /** Path hash size from contact packed outPathLen / companion path.hash.mode. */
  hashSizeBytes?: 1 | 2 | 3;
}): MeshcoreResolvedTraceOutPath {
  const hashSizeBytes = opts.hashSizeBytes ?? opts.tracePlan.hashSizeBytes;
  const hops = opts.hopsAway ?? 0;

  if (hops === 0) {
    const seed = opts.tracePlan.outPathSeed;
    return {
      outPath: seed,
      outboundPath: seed,
      storedPath: seed,
      composed: false,
      autoReturn: false,
    };
  }

  // Multi-hop: the wire path is built from relay hashes only, whatever shape the route is
  // stored in, and loops TraceData back through the relays.
  let outbound: Uint8Array | undefined;
  let storedPath: Uint8Array | undefined;
  let composed = false;
  if (!opts.tracePlan.pathTooShort && opts.tracePlan.storedPath) {
    storedPath = opts.tracePlan.storedPath;
    outbound = meshcoreTraceOutboundFromStoredPath(storedPath, hashSizeBytes);
  } else {
    outbound = meshcoreSynthesizeMultiHopTracePath({
      destPubKey: opts.pubKey,
      hopsAway: opts.hopsAway,
      nodes: opts.nodes,
      pubKeyByNodeId: opts.pubKeyByNodeId,
      excludeNodeId: opts.nodeId,
      pathByNodeId: opts.pathByNodeId,
      hashSizeBytes,
    });
    if (outbound) {
      composed = true;
      storedPath = meshcoreTraceStoredPathFromOutbound(outbound, opts.pubKey, hashSizeBytes);
    }
  }

  const relayCount = outbound ? outbound.length / hashSizeBytes : 0;
  const routable =
    outbound != null &&
    outbound.length > 0 &&
    Number.isInteger(relayCount) &&
    relayCount * 2 + 1 <= MESHCORE_TRACE_MAX_PATH_ENTRIES;
  if (!outbound || !routable) {
    return {
      outPath: opts.tracePlan.outPathSeed,
      outboundPath: new Uint8Array(0),
      storedPath: undefined,
      composed: false,
      autoReturn: false,
    };
  }
  return {
    outPath: meshcoreExpandTracePathWithAutoReturn(outbound, opts.pubKey, hashSizeBytes),
    outboundPath: outbound,
    storedPath,
    composed,
    autoReturn: true,
  };
}
