/**
 * Post-PacketRouter MeshCom ingest: upsert contacts/messages into Zustand + SQLite.
 *
 * Failure point: DB IPC errors — logged; store state remains authoritative.
 * Fallback: skip DB write; UI still updates from Zustand.
 */
import { MESHCOM_CONTACT_CAP_DEFAULT } from '@/shared/meshcomConstants';

import { recordEnvironmentReading } from '../../stores/environmentTelemetryStore';
import { deleteMessage, upsertMessage, useMessageStore } from '../../stores/messageStore';
import {
  type NodeRecord,
  removeNode,
  upsertNodeRecord,
  useNodeStore,
} from '../../stores/nodeStore';
import { persistDbWrite } from '../dbPersistRetry';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { applyMeshcomMheardStations } from '../meshcom/applyMeshcomMheardStations';
import { meshcomCallForNodeId, registerMeshcomCallsign } from '../meshcom/meshcomCallRegistry';
import {
  isMeshcomNodeIdPlaceholderCallsign,
  meshcomNodeIdPlaceholderCallsign,
  normalizeMeshcomCallsign,
} from '../meshcom/meshcomCallsign';
import { maybeAlertMeshcomWatchlistCallsign } from '../meshcom/meshcomCallsignWatchlist';
import { shouldApplyMeshcomContact } from '../meshcom/meshcomLocallyDeletedContacts';
import { noteMeshcomNetworkTimeFromText } from '../meshcom/meshcomNetworkTime';
import { meshcomPersistIdentityId } from '../meshcom/meshcomPersistIdentity';
import type { DomainEvent } from '../protocols/Protocol';
import { recordRadioSelfPosition } from '../radioSelfPosition';
import { chatMessageToMessageRecord, messageRecordToChatMessage } from '../storeRecordAdapters';
import type { IdentityId } from '../types';

export interface MeshcomIngestOptions {
  getMyNodeNum?: () => number;
}

function channelIdxForEvent(channelIndex: number, to: number, myNodeNum: number): number {
  // MeshCom: 0 = ALL, -1 = DM, positive = group.
  if (channelIndex > 0) return channelIndex;
  if (to !== 0 && myNodeNum !== 0 && to === myNodeNum) return -1;
  if (to !== 0 && to !== 0xffffffff) return -1;
  return channelIndex === 0 ? 0 : channelIndex;
}

function nodeRecordFor(
  identityId: IdentityId,
  nodeId: number,
): ReturnType<typeof useNodeStore.getState>['nodes'][IdentityId][number] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent.
  return useNodeStore.getState().nodes[identityId]?.[nodeId];
}

function callsignFromNode(identityId: IdentityId, nodeId: number): string {
  // Match meshcomSelfCallsign.meshcomCallForNode — broadcast is never a callsign.
  if (nodeId === 0 || nodeId === 0xffffffff) return '';
  const fromRegistry = meshcomCallForNodeId(nodeId);
  if (fromRegistry) return fromRegistry;
  const record = nodeRecordFor(identityId, nodeId);
  const name = record?.longName?.trim() || record?.shortName?.trim();
  if (name) return normalizeMeshcomCallsign(name);
  // Last resort only — prefer registry / node_info so hydrate does not remint nodeIds.
  return nodeId > 0 ? meshcomNodeIdPlaceholderCallsign(nodeId) : '';
}

/** Durable peer callsign for this node — not the generated `N{hex(nodeId)}` placeholder. */
function isDurableMeshcomCallsign(callsign: string, nodeId: number): boolean {
  return Boolean(callsign) && !isMeshcomNodeIdPlaceholderCallsign(callsign, nodeId);
}

/**
 * Persist destination for SQLite: ALL=`*`, GRC=digits, DM=peer callsign.
 * Never invent `NFFFFFFFF` from broadcast `to`.
 */
function toCallOrGroupForPersist(
  channelIdx: number,
  identityId: IdentityId,
  toNodeId: number,
): string | null {
  if (channelIdx > 0) return String(channelIdx);
  if (channelIdx === 0) return '*';
  const peer = callsignFromNode(identityId, toNodeId);
  if (!peer || !isDurableMeshcomCallsign(peer, toNodeId)) return null;
  return peer;
}

function persistContact(
  identityId: IdentityId,
  opts: {
    callsign: string;
    nodeId: number;
    lat?: number | null;
    lon?: number | null;
    batt?: number | null;
    hwId?: number | null;
    lastHeard?: number | null;
  },
): void {
  const callsign = normalizeMeshcomCallsign(opts.callsign);
  if (!callsign || !shouldApplyMeshcomContact(callsign)) return;
  persistDbWrite('meshcom ingest contact', () =>
    window.electronAPI.db.saveMeshcomContact({
      callsign,
      identity_id: meshcomPersistIdentityId(),
      node_id: opts.nodeId >>> 0,
      lat: opts.lat ?? null,
      lon: opts.lon ?? null,
      batt: opts.batt ?? null,
      hw_id: opts.hwId ?? null,
      last_heard: opts.lastHeard ?? null,
    }),
  );
  trimMeshcomIdentityNodes(identityId, MESHCOM_CONTACT_CAP_DEFAULT);
}

/** Drop oldest non-favorited in-memory nodes when an identity exceeds the contact cap. */
function trimMeshcomIdentityNodes(identityId: IdentityId, cap: number): void {
  const bucket = useNodeStore.getState().nodes[identityId] ?? {};
  const entries: NodeRecord[] = Object.values(bucket);
  if (entries.length <= cap) return;
  const favorited = entries.filter((n) => n.favorited);
  const rest = entries
    .filter((n) => !n.favorited)
    .sort((a, b) => (a.lastHeardAt ?? 0) - (b.lastHeardAt ?? 0));
  const keepRest = Math.max(0, cap - favorited.length);
  const doomed = rest.slice(0, Math.max(0, rest.length - keepRest));
  for (const node of doomed) {
    removeNode(identityId, node.nodeId);
  }
}

function handleTextMessage(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'text_message' }>,
  options: MeshcomIngestOptions,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent.
  const record = useMessageStore.getState().messages[identityId]?.[event.payload.id];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Message may be absent.
  if (!record) return;

  const incoming = messageRecordToChatMessage(record);
  const myNodeNum = options.getMyNodeNum?.() ?? 0;
  const fromCallRaw = callsignFromNode(identityId, event.payload.from) || incoming.sender_name;
  const fromCall = normalizeMeshcomCallsign(fromCallRaw);
  const fromIsDurable = isDurableMeshcomCallsign(fromCall, event.payload.from);
  if (fromIsDurable) {
    registerMeshcomCallsign(fromCall);
  }

  // Gateway/network clock beacon (~5 min) — mesh liveness, not a chat line.
  if (noteMeshcomNetworkTimeFromText(incoming.payload)) {
    deleteMessage(identityId, event.payload.id);
    return;
  }
  if (fromIsDurable) {
    maybeAlertMeshcomWatchlistCallsign(fromCall);
  }

  const channelIdx = channelIdxForEvent(event.payload.channelIndex, event.payload.to, myNodeNum);
  const toCallOrGroup = toCallOrGroupForPersist(channelIdx, identityId, event.payload.to);
  if (channelIdx === -1 && toCallOrGroup) {
    registerMeshcomCallsign(toCallOrGroup);
  }
  const fromCallForPath = fromCall || callsignFromNode(identityId, event.payload.from);
  const digis = event.payload.rxPathCallsigns ?? [];
  const path =
    fromCallForPath && digis.length > 0
      ? [fromCallForPath, ...digis].join(',')
      : fromCallForPath
        ? fromCallForPath
        : event.payload.hopCount != null
          ? String(event.payload.hopCount)
          : null;

  if (fromIsDurable) {
    persistContact(identityId, {
      callsign: fromCall,
      nodeId: event.payload.from,
      lastHeard: Math.floor(event.payload.timestamp / 1000),
    });
  }

  persistDbWrite('meshcom ingest message', () =>
    window.electronAPI.db.saveMeshcomMessage({
      identity_id: meshcomPersistIdentityId(),
      msg_id: event.payload.id,
      from_call: fromCall || null,
      to_call_or_group: toCallOrGroup,
      text: incoming.payload,
      channel_idx: channelIdx,
      path,
      rssi: event.payload.rxRssi ?? null,
      snr: event.payload.rxSnr ?? null,
      received_via: incoming.receivedVia === 'network' ? 'network' : 'rf',
      timestamp: event.payload.timestamp,
      status: incoming.status ?? 'acked',
      received_at: incoming.receivedAt ?? Date.now(),
    }),
  );

  // Keep channel_idx aligned in the in-memory chat row for MeshCom ALL/DM/group.
  if (incoming.channel !== channelIdx) {
    upsertMessage(
      identityId,
      chatMessageToMessageRecord({
        ...incoming,
        channel: channelIdx,
      }),
    );
  }
}

function handleNodeInfo(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'node_info' }>,
): void {
  const info = event.payload;
  if (info.meshcomMheard) {
    applyMeshcomMheardStations(identityId, [info.meshcomMheard], info.lastHeardAt ?? Date.now());
    return;
  }
  const callsign = normalizeMeshcomCallsign(info.longName ?? info.shortName ?? '');
  const nodeId = callsign ? registerMeshcomCallsign(callsign) : info.nodeId;
  if (!nodeId && !callsign) return;

  const resolvedId = nodeId || info.nodeId;
  const contactCall = callsign || `N${resolvedId.toString(16).toUpperCase()}`;
  if (!shouldApplyMeshcomContact(contactCall)) {
    // PacketRouter already upserted — drop the resurrected row for tombstoned callsigns.
    removeNode(identityId, resolvedId);
    return;
  }

  // MeshCom node_info carries POS/MHEARD fields upsertNode drops — use full record merge.
  upsertNodeRecord(identityId, {
    nodeId: resolvedId,
    longName: callsign || info.longName,
    shortName: info.shortName ?? (callsign ? callsign.slice(0, 4) : undefined),
    hwModel: info.hwModel,
    lastHeardAt: info.lastHeardAt,
    latitude: info.latitude,
    longitude: info.longitude,
    altitude: info.altitude,
    batteryLevel: info.batteryLevel,
    voltage: info.voltage,
    snr: info.snr,
    rssi: info.rssi,
    hopsAway: info.hopsAway,
    firmwareVersion: info.firmwareVersion,
    source: 'rf',
  });

  persistContact(identityId, {
    callsign: contactCall,
    nodeId: resolvedId,
    lat: info.latitude ?? null,
    lon: info.longitude ?? null,
    batt: info.batteryLevel ?? null,
    lastHeard: info.lastHeardAt ?? Math.floor(Date.now() / 1000),
  });
}

function handleTelemetry(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'telemetry' }>,
): void {
  const t = event.payload;
  const existing = nodeRecordFor(identityId, t.nodeId);
  const existingCall = normalizeMeshcomCallsign(existing?.longName ?? existing?.shortName ?? '');
  const fromRegistry = meshcomCallForNodeId(t.nodeId);
  // Prefer a real callsign; never overwrite one with a generated N{hex} placeholder.
  const callsign =
    (fromRegistry && isDurableMeshcomCallsign(fromRegistry, t.nodeId) ? fromRegistry : '') ||
    (existingCall && isDurableMeshcomCallsign(existingCall, t.nodeId) ? existingCall : '') ||
    existingCall ||
    meshcomNodeIdPlaceholderCallsign(t.nodeId);
  if (!shouldApplyMeshcomContact(callsign)) {
    removeNode(identityId, t.nodeId);
    return;
  }

  upsertNodeRecord(identityId, {
    nodeId: t.nodeId,
    // Keep a prior real longName when telemetry only knows the hash id.
    longName:
      existingCall && isDurableMeshcomCallsign(existingCall, t.nodeId)
        ? existingCall
        : fromRegistry && isDurableMeshcomCallsign(fromRegistry, t.nodeId)
          ? fromRegistry
          : callsign,
    batteryLevel: t.batteryLevel ?? existing?.batteryLevel,
    voltage: t.voltage ?? existing?.voltage,
    lastHeardAt: Math.floor(t.timestamp / 1000),
    source: 'rf',
  });

  const hasEnv =
    t.temperature != null ||
    t.relativeHumidity != null ||
    t.barometricPressure != null ||
    t.gasResistance != null ||
    t.co2 != null;
  if (hasEnv) {
    recordEnvironmentReading(
      'meshcom',
      identityId,
      t.nodeId,
      {
        temperature: t.temperature,
        relativeHumidity: t.relativeHumidity,
        barometricPressure: t.barometricPressure,
        gasResistance: t.gasResistance,
        co2: t.co2,
      },
      'rf',
    );
  }

  if (t.batteryLevel != null && isDurableMeshcomCallsign(callsign, t.nodeId)) {
    persistContact(identityId, {
      callsign,
      nodeId: t.nodeId,
      batt: t.batteryLevel,
      lastHeard: Math.floor(t.timestamp / 1000),
    });
  }
}

function handlePosition(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'position' }>,
  options: MeshcomIngestOptions,
): void {
  const { nodeId, latitude, longitude, timestamp } = event.payload;
  const existing = nodeRecordFor(identityId, nodeId);
  const existingCall = normalizeMeshcomCallsign(existing?.longName ?? existing?.shortName ?? '');
  const fromRegistry = meshcomCallForNodeId(nodeId);
  const callsign =
    (fromRegistry && isDurableMeshcomCallsign(fromRegistry, nodeId) ? fromRegistry : '') ||
    (existingCall && isDurableMeshcomCallsign(existingCall, nodeId) ? existingCall : '') ||
    existingCall ||
    meshcomNodeIdPlaceholderCallsign(nodeId);

  const myNodeNum = options.getMyNodeNum?.() ?? 0;
  if (myNodeNum > 0 && nodeId === myNodeNum) {
    recordRadioSelfPosition('meshcom', latitude, longitude);
  }

  if (!shouldApplyMeshcomContact(callsign)) {
    if (myNodeNum === 0 || nodeId !== myNodeNum) {
      removeNode(identityId, nodeId);
    }
    return;
  }

  upsertNodeRecord(identityId, {
    nodeId,
    longName:
      existingCall && isDurableMeshcomCallsign(existingCall, nodeId)
        ? existingCall
        : fromRegistry && isDurableMeshcomCallsign(fromRegistry, nodeId)
          ? fromRegistry
          : callsign,
    latitude,
    longitude,
    lastHeardAt: Math.floor(timestamp / 1000),
  });

  if (isDurableMeshcomCallsign(callsign, nodeId)) {
    maybeAlertMeshcomWatchlistCallsign(callsign);
  }

  if (isDurableMeshcomCallsign(callsign, nodeId)) {
    persistContact(identityId, {
      callsign,
      nodeId,
      lat: latitude,
      lon: longitude,
      lastHeard: Math.floor(timestamp / 1000),
    });
  }
}

function createListener(
  identityId: IdentityId,
  options: MeshcomIngestOptions,
): PacketRouterListener {
  return (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'text_message':
        handleTextMessage(identityId, event, options);
        break;
      case 'node_info':
        handleNodeInfo(identityId, event);
        break;
      case 'position':
        handlePosition(identityId, event, options);
        break;
      case 'telemetry':
        handleTelemetry(identityId, event);
        break;
      default:
        break;
    }
  };
}

export function attachMeshcomIngest(
  identityId: IdentityId,
  options: MeshcomIngestOptions = {},
): () => void {
  return packetRouter.addListener(createListener(identityId, options));
}

/** @internal Exported for tests. */
export {
  handleNodeInfo as meshcomIngestHandleNodeInfo,
  handleTextMessage as meshcomIngestHandleTextMessage,
};
