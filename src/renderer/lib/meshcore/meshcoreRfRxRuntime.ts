/**
 * MeshCore RF RX (event 136) handling, extracted from the runtime side-effect listener so each
 * step (sender resolution, raw-packet parse, hop tracking, foreign-LoRa bridging, MQTT packet
 * log) stays independently testable and under the cognitive-complexity limit.
 *
 * Failure point: DB / MQTT IPC rejections are logged; Zustand stores stay authoritative for UI.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { parseMeshCoreRfPacket } from '../../../shared/meshcoreRfPacketParse';
import { MAX_DEVICE_LOGS, MAX_TELEMETRY_POINTS } from '../../hooks/meshcore/meshcoreHookPreamble';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { upsertNode, upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import {
  classifyPayload,
  classifyProximity,
  extractMeshtasticSenderId,
  meshtasticSenderIdForRawLogFallback,
  type PacketClass,
} from '../foreignLoraDetection';
import { applyMeshcoreLateRfHopEnrichment } from '../meshcoreLateRfHopEnrichment';
import { buildMeshcorePathResolutionFromNodes } from '../meshcorePathChainDisplay';
import {
  meshcoreRawPacketLogFromBytesFallback,
  meshcoreRawPacketResolveFromParsed,
  meshcoreRfIsSelfOriginated,
  meshcoreRfNodeHashCandidates,
  meshcoreRfResolvePathSender,
} from '../meshcoreRawPacketSender';
import { shouldCoalesceSelfFloodAdvert } from '../meshcoreRawSelfFloodAdvertCoalesce';
import {
  CONTACT_TYPE_LABELS,
  mergeHwModelOnContactUpdate,
  meshcoreMergeContactHopsAwayFromPrevious,
  pubkeyToNodeId,
} from '../meshcoreUtils';
import { getMeshtasticConnectedMyNodeNum } from '../meshtasticConnectedNodeRef';
import type { DomainEvent } from '../protocols/Protocol';
import { MAX_RAW_PACKET_LOG_ENTRIES } from '../rawPacketLogConstants';
import { getStoredMeshProtocol } from '../storedMeshProtocol';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import { MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS } from '../timeConstants';
import type { MeshNode, MQTTStatus, TelemetryPoint } from '../types';
import { recordMeshcoreRfRx, resolveMeshcoreHeardRepeaterFromNode } from './heardRepeatTracker';
import type { DeviceLogEntry, MeshCoreSelfInfo, RxPacketEntry } from './meshcoreHookTypes';
import { persistMeshcoreNodeInfoAfterAdvert } from './meshcoreLiveContactPersist';
import {
  type MeshcoreMqttPacketLogBucket,
  tryTakeMeshcoreMqttPacketLogToken,
} from './meshcoreMqttPacketLogThrottle';

export type MeshcoreRfRxPayload = Extract<DomainEvent, { type: 'meshcore_rf_rx' }>['payload'];

/** Runtime state RF RX needs — owned by `useMeshcoreRuntime`, wired from `attachMeshcoreConnSideEffects`. */
export interface MeshcoreRfRxDeps {
  myNodeNumRef: RefObject<number>;
  meshcoreIdentityIdRef: RefObject<string | null>;
  readNodes: () => Map<number, MeshNode>;
  pubKeyMapRef: RefObject<Map<number, Uint8Array>>;
  pubKeyPrefixMapRef: RefObject<Map<string, number>>;
  nicknameMapRef: RefObject<Map<number, string>>;
  selfInfoRef: RefObject<MeshCoreSelfInfo | null>;
  rawPacketsRef: RefObject<RxPacketEntry[]>;
  mqttStatusRef: RefObject<MQTTStatus>;
  lastPacketLogPublishFailureLogAtRef: RefObject<number>;
  /** Token bucket created once at attach time; shared across every RF RX in the session. */
  mqttPacketLogBucket: MeshcoreMqttPacketLogBucket;
  setDeviceLogs: Dispatch<SetStateAction<DeviceLogEntry[]>>;
  setSignalTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  setRawPackets: Dispatch<SetStateAction<RxPacketEntry[]>>;
}

/** Node lookup + identity refs shared by Meshtastic-sender and hops-away RF updates. */
type MeshcoreRfRxNodeLookupDeps = Pick<
  MeshcoreRfRxDeps,
  'myNodeNumRef' | 'meshcoreIdentityIdRef' | 'readNodes'
>;

interface MeshcoreRfParseContext {
  parsed: ReturnType<typeof parseMeshCoreRfPacket>;
  routeTypeString: string | null;
  payloadTypeString: string | null;
  hopCount: number;
  pathBytes: number[];
  pathHashSizeBytes: 1 | 2 | 3;
  fromNodeId: number | null;
  messageFingerprintHex: string | null;
  transportScopeCode: number | null;
  transportReturnCode: number | null;
  advertName: string | null;
  advertLat: number | null;
  advertLon: number | null;
  advertTimestampSec: number | null;
  parseOk: boolean;
}

interface MeshcoreRfMqttPacketLogFields {
  rawHex: string;
  len: number;
  packetType?: number;
  route?: string;
  payloadLen: number;
  hash?: string;
}

/** Last successfully queued RF transport codes per node — skip redundant IPC on stable codes. */
const lastPersistedRfTransportByNodeId = new Map<number, string>();

function persistMeshcoreContactRfTransport(
  nodeId: number,
  transportCodes: readonly [number, number],
): void {
  const key = `${transportCodes[0]}:${transportCodes[1]}`;
  if (lastPersistedRfTransportByNodeId.get(nodeId) === key) return;
  lastPersistedRfTransportByNodeId.set(nodeId, key);
  void window.electronAPI.db
    .updateMeshcoreContactRfTransport(nodeId, transportCodes[0], transportCodes[1])
    .catch((e: unknown) => {
      // Allow a later packet to retry after a failed write.
      if (lastPersistedRfTransportByNodeId.get(nodeId) === key) {
        lastPersistedRfTransportByNodeId.delete(nodeId);
      }
      console.warn(
        '[meshcoreRfRxRuntime] updateMeshcoreContactRfTransport error ' + errLikeToLogString(e),
      );
    });
}

function persistMeshcoreContactLastRf(
  nodeId: number,
  snr: number,
  rssi: number,
  hopsAway: number,
  nowSec: number,
): void {
  void window.electronAPI.db
    .updateMeshcoreContactLastRf(nodeId, snr, rssi, hopsAway, nowSec)
    .catch((e: unknown) => {
      console.warn(
        '[meshcoreRfRxRuntime] updateMeshcoreContactLastRf error ' + errLikeToLogString(e),
      );
    });
}

function persistMeshcoreRfHopHistory(
  nodeId: number,
  now: number,
  hopsAway: number,
  snr: number,
  rssi: number,
): void {
  void useDiagnosticsStore
    .getState()
    .saveMeshcoreHopHistory(nodeId, now, hopsAway, snr, rssi)
    .catch((e: unknown) => {
      console.warn('[meshcoreRfRxRuntime] saveMeshcoreHopHistory error ' + errLikeToLogString(e));
    });
}

function updateKnownMeshtasticSenderNode(
  senderId: number,
  now: number,
  snr: number,
  rssi: number,
  deps: MeshcoreRfRxNodeLookupDeps,
): void {
  if (senderId === deps.myNodeNumRef.current) return;
  const existing = deps.readNodes().get(senderId);
  const storeId = deps.meshcoreIdentityIdRef.current;
  if (!existing || !storeId) return;
  const nowSec = Math.floor(now / 1000);
  const nextLastHeard = Math.max(existing.last_heard, nowSec);
  if (existing.last_heard === nextLastHeard && existing.snr === snr && existing.rssi === rssi) {
    return;
  }
  upsertNodeRecord(
    storeId,
    meshNodeToNodeRecord({
      ...existing,
      last_heard: nextLastHeard,
      snr,
      rssi,
    }),
  );
}

/** Builds the RX device-log suffix and, for known Meshtastic-class senders, bumps last_heard. */
export function resolveMeshcoreRfSenderInfo(
  rawU8: Uint8Array | null,
  loraPacketClass: PacketClass | null,
  now: number,
  snr: number,
  rssi: number,
  deps: MeshcoreRfRxNodeLookupDeps,
): string {
  if (!rawU8 || rawU8.length < 8 || loraPacketClass == null) return '';
  if (loraPacketClass === 'meshcore') return ' [meshcore]';
  if (loraPacketClass !== 'meshtastic') return '';

  const senderId = extractMeshtasticSenderId(rawU8);
  if (senderId === null) return '';
  updateKnownMeshtasticSenderNode(senderId, now, snr, rssi, deps);
  return ` from=0x${senderId.toString(16)}`;
}

function appendMeshcoreRfDeviceLog(
  deps: Pick<MeshcoreRfRxDeps, 'setDeviceLogs'>,
  now: number,
  senderInfo: string,
  snr: number,
  rssi: number,
): void {
  const entry: DeviceLogEntry = {
    ts: now,
    level: 'debug',
    source: 'meshcore',
    message: `RX${senderInfo} SNR=${snr.toFixed(2)}dB RSSI=${rssi}dBm`,
  };
  deps.setDeviceLogs((prev) => {
    const next = [...prev, entry];
    return next.length > MAX_DEVICE_LOGS ? next.slice(next.length - MAX_DEVICE_LOGS) : next;
  });
}

function appendMeshcoreRfSignalTelemetry(
  deps: Pick<MeshcoreRfRxDeps, 'setSignalTelemetry'>,
  now: number,
  snr: number,
  rssi: number,
): void {
  const sigPoint: TelemetryPoint = { timestamp: now, snr, rssi };
  deps.setSignalTelemetry((prev) => [...prev, sigPoint].slice(-MAX_TELEMETRY_POINTS));
}

/**
 * Raw packet log: always run the in-house MeshCore parse (LOG_RX is MeshCore RF only). Do not
 * gate on `classifyPayload` — Meshtastic-shaped heuristics can mis-label MeshCore frames.
 */
function buildMeshcoreRfParseContext(
  rawU8: Uint8Array,
  pubKeyPrefixMap: Map<string, number>,
): MeshcoreRfParseContext {
  const parsed = parseMeshCoreRfPacket(rawU8);
  if (parsed.ok) {
    const fromNodeId = meshcoreRawPacketResolveFromParsed(parsed, pubKeyPrefixMap);
    if (fromNodeId != null && parsed.transportCodes) {
      persistMeshcoreContactRfTransport(fromNodeId, parsed.transportCodes);
    }
    return {
      parsed,
      routeTypeString: parsed.routeTypeString,
      payloadTypeString: parsed.payloadTypeString,
      hopCount: parsed.hopCount,
      pathBytes: parsed.pathBytes,
      pathHashSizeBytes: parsed.pathHashSizeBytes,
      fromNodeId,
      messageFingerprintHex: parsed.messageFingerprintHex,
      transportScopeCode: parsed.transportCodes?.[0] ?? null,
      transportReturnCode: parsed.transportCodes?.[1] ?? null,
      advertName: parsed.advert && parsed.advert.name.length > 0 ? parsed.advert.name : null,
      advertLat: parsed.advert?.latitudeDeg ?? null,
      advertLon: parsed.advert?.longitudeDeg ?? null,
      advertTimestampSec: parsed.advert?.timestampSec ?? null,
      parseOk: true,
    };
  }

  const fb = meshcoreRawPacketLogFromBytesFallback(rawU8, pubKeyPrefixMap);
  return {
    parsed,
    routeTypeString: fb?.routeTypeString ?? null,
    payloadTypeString: fb?.payloadTypeString ?? null,
    hopCount: fb?.hopCount ?? 0,
    pathBytes: fb?.pathBytes ?? [],
    pathHashSizeBytes: fb?.pathHashSizeBytes ?? 1,
    fromNodeId: fb?.fromNodeId ?? null,
    messageFingerprintHex: null,
    transportScopeCode: null,
    transportReturnCode: null,
    advertName: null,
    advertLat: null,
    advertLon: null,
    advertTimestampSec: null,
    parseOk: false,
  };
}

/** Update hops_away/SNR/RSSI on a known MeshCore node from the RF packet's own hop count. */
export function applyMeshcoreRfHopsAwayUpdate(
  fromNodeId: number | null,
  hopCount: number,
  now: number,
  snr: number,
  rssi: number,
  deps: MeshcoreRfRxNodeLookupDeps,
): void {
  if (fromNodeId === null || fromNodeId === deps.myNodeNumRef.current) return;
  const existing = deps.readNodes().get(fromNodeId);
  const storeId = deps.meshcoreIdentityIdRef.current;
  if (!existing || !storeId) return;

  const nowSec = Math.floor(now / 1000);
  const mergedHopsAway = meshcoreMergeContactHopsAwayFromPrevious(hopCount, existing.hops_away, 0);
  const updated: MeshNode = {
    ...existing,
    hops_away: mergedHopsAway ?? hopCount,
    snr,
    rssi,
    last_heard: Math.max(existing.last_heard, nowSec),
    source: 'rf',
    heard_via_mqtt_only: false,
    via_mqtt: false,
  };

  const unchanged =
    existing.hops_away === updated.hops_away &&
    existing.snr === snr &&
    existing.rssi === rssi &&
    existing.last_heard === updated.last_heard &&
    existing.source === updated.source &&
    existing.heard_via_mqtt_only === updated.heard_via_mqtt_only &&
    existing.via_mqtt === updated.via_mqtt;
  if (unchanged) return;

  upsertNodeRecord(storeId, meshNodeToNodeRecord(updated));
  persistMeshcoreContactLastRf(fromNodeId, snr, rssi, mergedHopsAway ?? hopCount, nowSec);
  persistMeshcoreRfHopHistory(fromNodeId, now, mergedHopsAway ?? hopCount, snr, rssi);
}

/**
 * Companion push 128 is pubkey-only. Apply the on-air ADVERT name + device role so the contact
 * list / Rooms tab show the advertised identity instead of `Node-XXXXXXXX`.
 */
function applyMeshcoreRfAdvertToStore(
  ctx: MeshcoreRfParseContext,
  now: number,
  snr: number,
  rssi: number,
  deps: MeshcoreRfRxDeps,
): void {
  if (!ctx.parsed.ok || ctx.parsed.advert == null) return;
  const advert = ctx.parsed.advert;
  const identityId = deps.meshcoreIdentityIdRef.current;
  if (!identityId) return;
  const publicKey = advert.publicKey;
  if (publicKey.length !== 32) return;
  const nodeId = pubkeyToNodeId(publicKey);
  if (nodeId === 0 || nodeId === deps.myNodeNumRef.current) return;

  const name = advert.name.trim();
  const incomingHw = CONTACT_TYPE_LABELS[advert.deviceRole] ?? 'Unknown';
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
  const existing = useNodeStore.getState().nodes[identityId]?.[nodeId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Node may be absent when its identity bucket is missing.
  const hwModel = mergeHwModelOnContactUpdate(existing?.hwModel, incomingHw);
  const lastHeardAt = advert.timestampSec > 0 ? advert.timestampSec : Math.floor(now / 1000);

  persistMeshcoreNodeInfoAfterAdvert(
    identityId,
    {
      nodeId,
      longName: name || undefined,
      lastHeardAt,
      publicKey,
      hwModel,
    },
    { contactType: advert.deviceRole },
  );

  upsertNode(identityId, {
    nodeId,
    ...(name ? { longName: name } : {}),
    hwModel,
    lastHeardAt,
    publicKey,
  });

  const after = useNodeStore.getState().nodes[identityId][nodeId];
  const mergedHops = meshcoreMergeContactHopsAwayFromPrevious(ctx.hopCount, after.hopsAway, 0);
  upsertNodeRecord(identityId, {
    ...after,
    hopsAway: mergedHops ?? ctx.hopCount,
    snr,
    rssi,
    source: 'rf',
    heardViaMqttOnly: false,
    viaMqtt: false,
  });
}

function buildMeshcoreRfRawPacketEntry(
  ctx: MeshcoreRfParseContext,
  effectiveFromNodeId: number | null,
  now: number,
  snr: number,
  rssi: number,
  rawU8: Uint8Array,
): RxPacketEntry {
  return {
    ts: now,
    snr,
    rssi,
    raw: rawU8,
    routeTypeString: ctx.routeTypeString,
    payloadTypeString: ctx.payloadTypeString,
    hopCount: ctx.hopCount,
    pathBytes: ctx.pathBytes,
    pathHashSizeBytes: ctx.pathHashSizeBytes,
    fromNodeId: effectiveFromNodeId,
    messageFingerprintHex: ctx.messageFingerprintHex,
    transportScopeCode: ctx.transportScopeCode,
    transportReturnCode: ctx.transportReturnCode,
    advertName: ctx.advertName,
    advertLat: ctx.advertLat,
    advertLon: ctx.advertLon,
    advertTimestampSec: ctx.advertTimestampSec,
    parseOk: ctx.parseOk,
  };
}

function computeNextRawPacketLog(
  prev: RxPacketEntry[],
  rxEntry: RxPacketEntry,
  myId: number,
): RxPacketEntry[] {
  const last = prev.at(-1);
  const shouldCoalesce =
    myId !== 0 &&
    shouldCoalesceSelfFloodAdvert(last, rxEntry, myId, MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS);
  const next = shouldCoalesce ? [...prev.slice(0, -1), rxEntry] : [...prev, rxEntry];
  return next.length > MAX_RAW_PACKET_LOG_ENTRIES
    ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
    : next;
}

function pushMeshcoreRfRawPacketLog(
  deps: Pick<MeshcoreRfRxDeps, 'setRawPackets' | 'rawPacketsRef' | 'myNodeNumRef'>,
  rxEntry: RxPacketEntry,
): void {
  deps.setRawPackets((prev) => {
    const trimmed = computeNextRawPacketLog(prev, rxEntry, deps.myNodeNumRef.current);
    // Sync before React commit so same-tick chat ingest sees this row.
    deps.rawPacketsRef.current = trimmed;
    return trimmed;
  });
}

function buildMeshcoreRfMqttPacketLogFields(
  ctx: MeshcoreRfParseContext,
  rawU8: Uint8Array,
): MeshcoreRfMqttPacketLogFields {
  return {
    rawHex: Array.from(rawU8, (b) => b.toString(16).padStart(2, '0')).join(''),
    len: rawU8.length,
    payloadLen: rawU8.length,
    packetType: ctx.parsed.ok ? ctx.parsed.payloadTypeNibble : undefined,
    route: ctx.routeTypeString ?? undefined,
    hash: ctx.messageFingerprintHex ?? undefined,
  };
}

/**
 * Noisy payload types for MeshCore:
 * FLOOD (1001) discovery floods indicate routing loops or lost paths;
 * FLOOD + ADVERT (1002) are flood-routed advertisements (room or device).
 */
function recordMeshcoreRfNoisePorts(
  ctx: MeshcoreRfParseContext,
  effectiveFromNodeId: number | null,
): void {
  if (effectiveFromNodeId == null || ctx.routeTypeString !== 'FLOOD') return;
  const port = ctx.parsed.ok && ctx.parsed.advert != null ? 1002 : 1001;
  useDiagnosticsStore.getState().recordNoisePort(effectiveFromNodeId, port);
}

function resolveMeshcoreRfBridgeSender(
  ctx: MeshcoreRfParseContext,
  effectiveFromNodeId: number | null,
  rssi: number,
  myNodeNum: number,
  meshcoreNodes: Map<number, MeshNode>,
): { rfSenderId: number | undefined; rfDisplayName: string | undefined } {
  let rfSenderId = effectiveFromNodeId ?? undefined;
  let rfDisplayName: string | undefined;
  if (!ctx.parsed.ok) return { rfSenderId, rfDisplayName };

  const parsed = ctx.parsed;
  if (rfSenderId == null && parsed.advert) {
    const advertId = pubkeyToNodeId(parsed.advert.publicKey);
    if (advertId !== 0) rfSenderId = advertId;
    if (parsed.advert.name.length > 0) rfDisplayName = parsed.advert.name;
  } else if (ctx.advertName) {
    rfDisplayName = ctx.advertName;
  }
  if (rfSenderId == null && parsed.pathBytes.length > 0) {
    const useAllContacts = ctx.hopCount <= 2 && rssi > -80 && parsed.pathBytes.length > 0;
    const pathCandidates = meshcoreRfNodeHashCandidates(
      meshcoreNodes,
      myNodeNum,
      useAllContacts ? { rssi: undefined } : { rssi },
    );
    const pathId = meshcoreRfResolvePathSender(parsed.pathBytes, pathCandidates);
    if (pathId != null) rfSenderId = pathId;
  }
  return { rfSenderId, rfDisplayName };
}

interface MeshcoreRfBridgeIdentity {
  rfSenderId: number | undefined;
  rfDisplayName: string | undefined;
  isOwnMeshcoreTx: boolean;
}

function finalizeMeshcoreRfBridgeIdentity(
  sender: { rfSenderId: number | undefined; rfDisplayName: string | undefined },
  isSelfRf: boolean,
  effectiveFromNodeId: number | null,
  myNodeNum: number,
  meshcoreNodes: Map<number, MeshNode>,
  deps: Pick<MeshcoreRfRxDeps, 'selfInfoRef' | 'nicknameMapRef'>,
): MeshcoreRfBridgeIdentity {
  let { rfSenderId, rfDisplayName } = sender;
  const isOwnMeshcoreTx =
    isSelfRf ||
    (rfSenderId != null && rfSenderId === myNodeNum) ||
    (effectiveFromNodeId != null && effectiveFromNodeId === myNodeNum);

  if (isOwnMeshcoreTx && myNodeNum !== 0) {
    rfSenderId = myNodeNum;
    rfDisplayName =
      rfDisplayName ??
      deps.selfInfoRef.current?.name.trim() ??
      meshcoreNodes.get(myNodeNum)?.long_name ??
      meshcoreNodes.get(myNodeNum)?.short_name ??
      deps.nicknameMapRef.current.get(myNodeNum);
  }
  if (rfSenderId != null && rfDisplayName == null) {
    const known = meshcoreNodes.get(rfSenderId);
    rfDisplayName =
      known?.long_name ?? known?.short_name ?? deps.nicknameMapRef.current.get(rfSenderId);
  }
  return { rfSenderId, rfDisplayName, isOwnMeshcoreTx };
}

/**
 * MeshCore radio RF RX → Meshtastic Foreign LoRa bridge (local overhear only, not contact-list
 * sync). Returns `skip: true` when the caller's original `handleRfRx` would have returned early
 * (proximity gate failed, or no identified sender/fingerprint) — the remaining RF RX steps
 * (generic foreign-LoRa fingerprinting, MQTT packet log) must then be skipped too.
 */
function bridgeMeshcoreRfToForeignLora(
  ctx: MeshcoreRfParseContext,
  loraPacketClass: PacketClass | null,
  effectiveFromNodeId: number | null,
  rawU8: Uint8Array,
  snr: number,
  rssi: number,
  deps: MeshcoreRfRxDeps,
): { skip: boolean } {
  if (loraPacketClass !== 'meshcore') return { skip: false };
  const mtNode = getMeshtasticConnectedMyNodeNum();
  if (mtNode <= 0) return { skip: false };

  const myNodeNum = deps.myNodeNumRef.current;
  const selfPubKey =
    myNodeNum !== 0
      ? (deps.pubKeyMapRef.current.get(myNodeNum) ?? deps.selfInfoRef.current?.publicKey)
      : undefined;
  const isSelfRf = myNodeNum !== 0 && meshcoreRfIsSelfOriginated(rawU8, selfPubKey, myNodeNum);

  const meshcoreNodes = deps.readNodes();
  const sender = resolveMeshcoreRfBridgeSender(
    ctx,
    effectiveFromNodeId,
    rssi,
    myNodeNum,
    meshcoreNodes,
  );
  const identity = finalizeMeshcoreRfBridgeIdentity(
    sender,
    isSelfRf,
    effectiveFromNodeId,
    myNodeNum,
    meshcoreNodes,
    deps,
  );

  const proximity = classifyProximity(rssi || undefined, snr || undefined);
  let rfFingerprint =
    identity.rfSenderId == null && ctx.messageFingerprintHex
      ? ctx.messageFingerprintHex
      : undefined;
  if (identity.isOwnMeshcoreTx) rfFingerprint = undefined;

  // Local RF only — skip distant mesh floods (identified or not).
  if (proximity !== 'very-close' && proximity !== 'nearby') return { skip: true };
  if (identity.rfSenderId == null && rfFingerprint == null) return { skip: true };

  useDiagnosticsStore
    .getState()
    .recordForeignLora(
      mtNode,
      'meshcore',
      rssi || undefined,
      snr || undefined,
      identity.rfSenderId,
      deps.readNodes,
      'meshcore-radio-rf',
      rfFingerprint,
      identity.rfDisplayName,
    );
  return { skip: false };
}

/** Foreign LoRa fingerprinting: only flag non-MeshCore packets (requires known self node ID). */
function recordMeshcoreForeignLoraFingerprint(
  rawU8: Uint8Array | null,
  loraPacketClass: PacketClass | null,
  snr: number,
  rssi: number,
  deps: Pick<MeshcoreRfRxDeps, 'myNodeNumRef' | 'readNodes'>,
): void {
  if (getStoredMeshProtocol() !== 'meshcore') return;
  if (deps.myNodeNumRef.current === 0) return;
  if (!rawU8 || loraPacketClass == null || loraPacketClass === 'meshcore') return;

  const senderId = loraPacketClass === 'meshtastic' ? extractMeshtasticSenderId(rawU8) : null;
  useDiagnosticsStore
    .getState()
    .recordForeignLora(
      deps.myNodeNumRef.current,
      loraPacketClass,
      rssi || undefined,
      snr || undefined,
      senderId ?? undefined,
      deps.readNodes,
    );
}

function publishMeshcoreRfMqttPacketLog(
  fields: MeshcoreRfMqttPacketLogFields | null,
  snr: number,
  rssi: number,
  deps: Pick<
    MeshcoreRfRxDeps,
    'mqttStatusRef' | 'lastPacketLogPublishFailureLogAtRef' | 'selfInfoRef' | 'mqttPacketLogBucket'
  >,
): void {
  if (deps.mqttStatusRef.current !== 'connected') return;
  const nowMs = Date.now();
  if (!tryTakeMeshcoreMqttPacketLogToken(deps.mqttPacketLogBucket, nowMs)) return;
  void window.electronAPI.mqtt
    .publishMeshcorePacketLog({
      origin: deps.selfInfoRef.current?.name ?? 'mesh-client',
      snr,
      rssi,
      rawHex: fields?.rawHex,
      len: fields?.len,
      packetType: fields?.packetType,
      route: fields?.route,
      payloadLen: fields?.payloadLen,
      hash: fields?.hash,
    })
    .catch((e: unknown) => {
      const t = Date.now();
      if (t - deps.lastPacketLogPublishFailureLogAtRef.current >= 30_000) {
        deps.lastPacketLogPublishFailureLogAtRef.current = t;
        console.warn(
          '[meshcoreRfRxRuntime] MQTT packet-log publish failed ' + errLikeToLogString(e),
        );
      }
    });
}

/**
 * Credit Repeater/Room path hashes on self-originated channel TX overhear (relay coverage).
 * Additive only — does not alter hops-away, Foreign LoRa bridge, or repeater-admin flows.
 */
function applyMeshcoreHeardRepeatFromRfRx(
  ctx: MeshcoreRfParseContext,
  effectiveFromNodeId: number | null,
  rawU8: Uint8Array,
  snr: number,
  rssi: number,
  now: number,
  deps: MeshcoreRfRxDeps,
): void {
  const identityId = deps.meshcoreIdentityIdRef.current;
  if (!identityId) return;
  const myNodeNum = deps.myNodeNumRef.current;
  if (myNodeNum === 0) return;

  const selfPubKey =
    deps.pubKeyMapRef.current.get(myNodeNum) ?? deps.selfInfoRef.current?.publicKey;
  const isSelfRf = meshcoreRfIsSelfOriginated(rawU8, selfPubKey, myNodeNum);
  const isOwnMeshcoreTx =
    isSelfRf || (effectiveFromNodeId != null && effectiveFromNodeId === myNodeNum);
  if (!isOwnMeshcoreTx) return;

  const nodes = deps.readNodes();
  const resolution = buildMeshcorePathResolutionFromNodes(nodes);
  recordMeshcoreRfRx({
    identityId,
    isOwnMeshcoreTx: true,
    pathBytes: ctx.pathBytes,
    pathHashSizeBytes: ctx.pathHashSizeBytes,
    myNodeNum,
    snr,
    rssi,
    now,
    candidates: resolution.candidates,
    pubKeyByNodeId: resolution.pubKeyByNodeId,
    resolveRepeater: (nodeId) =>
      resolveMeshcoreHeardRepeaterFromNode(nodeId, nodes.get(nodeId) ?? null),
  });
}

/**
 * Full RF RX (event 136) handling: device log + signal telemetry, raw packet log with hop/foreign
 * LoRa bridging, and throttled MQTT packet-log publish. Mirrors the original inline
 * `handleRfRx` — including its early return once the foreign-LoRa proximity gate fails, which
 * skips the generic fingerprinting pass and the MQTT publish below it.
 */
export function handleMeshcoreRfRx(payload: MeshcoreRfRxPayload, deps: MeshcoreRfRxDeps): void {
  const { lastSnr: snr, lastRssi: rssi, raw: rawU8 } = payload;
  const now = Date.now();
  const loraPacketClass = rawU8 ? classifyPayload(rawU8) : null;

  // `readNodes()` materializes a fresh Map from identity records; snapshot once per RF packet
  // so the several has/get lookups (and the recordForeignLora callback) share one O(n) rebuild.
  const nodesSnapshot = deps.readNodes();
  const cachedDeps: MeshcoreRfRxDeps = { ...deps, readNodes: () => nodesSnapshot };

  const senderInfo = resolveMeshcoreRfSenderInfo(
    rawU8,
    loraPacketClass,
    now,
    snr,
    rssi,
    cachedDeps,
  );
  appendMeshcoreRfDeviceLog(deps, now, senderInfo, snr, rssi);
  appendMeshcoreRfSignalTelemetry(deps, now, snr, rssi);

  let mqttFields: MeshcoreRfMqttPacketLogFields | null = null;

  if (rawU8) {
    const ctx = buildMeshcoreRfParseContext(rawU8, deps.pubKeyPrefixMapRef.current);
    applyMeshcoreRfHopsAwayUpdate(ctx.fromNodeId, ctx.hopCount, now, snr, rssi, cachedDeps);
    applyMeshcoreRfAdvertToStore(ctx, now, snr, rssi, deps);

    const effectiveFromNodeId =
      ctx.fromNodeId ?? meshtasticSenderIdForRawLogFallback(ctx.parseOk, rawU8);
    const rxEntry = buildMeshcoreRfRawPacketEntry(ctx, effectiveFromNodeId, now, snr, rssi, rawU8);
    pushMeshcoreRfRawPacketLog(deps, rxEntry);
    applyMeshcoreHeardRepeatFromRfRx(ctx, effectiveFromNodeId, rawU8, snr, rssi, now, cachedDeps);

    if (
      ctx.parseOk &&
      (ctx.payloadTypeString === 'TXT_MSG' || ctx.payloadTypeString === 'GRP_TXT')
    ) {
      applyMeshcoreLateRfHopEnrichment(deps.meshcoreIdentityIdRef.current, {
        payloadTypeString: ctx.payloadTypeString,
        hopCount: ctx.hopCount,
        fromNodeId: effectiveFromNodeId,
        messageFingerprintHex: ctx.messageFingerprintHex,
        parseOk: true,
        now,
        myNodeNum: deps.myNodeNumRef.current,
      });
    }

    mqttFields = buildMeshcoreRfMqttPacketLogFields(ctx, rawU8);
    recordMeshcoreRfNoisePorts(ctx, effectiveFromNodeId);

    const bridgeResult = bridgeMeshcoreRfToForeignLora(
      ctx,
      loraPacketClass,
      effectiveFromNodeId,
      rawU8,
      snr,
      rssi,
      cachedDeps,
    );
    if (bridgeResult.skip) return;
  }

  recordMeshcoreForeignLoraFingerprint(rawU8, loraPacketClass, snr, rssi, cachedDeps);
  publishMeshcoreRfMqttPacketLog(mqttFields, snr, rssi, deps);
}
