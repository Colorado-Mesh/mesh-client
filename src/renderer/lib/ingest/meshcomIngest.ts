/**
 * Post-PacketRouter MeshCom ingest: upsert contacts/messages into Zustand + SQLite.
 *
 * Failure point: DB IPC errors — logged; store state remains authoritative.
 * Fallback: skip DB write; UI still updates from Zustand.
 */
import { recordEnvironmentReading } from '../../stores/environmentTelemetryStore';
import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { removeNode, upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import { persistDbWrite } from '../dbPersistRetry';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { registerMeshcomCallsign } from '../meshcom/meshcomCallRegistry';
import {
  callsignToNodeId,
  normalizeMeshcomCallsign,
  parseMeshcomSrcPath,
} from '../meshcom/meshcomCallsign';
import { meshcomHwLabel } from '../meshcom/meshcomHwIds';
import { shouldApplyMeshcomContact } from '../meshcom/meshcomLocallyDeletedContacts';
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
  const record = nodeRecordFor(identityId, nodeId);
  const name = record?.longName?.trim() || record?.shortName?.trim();
  if (name) return normalizeMeshcomCallsign(name);
  return nodeId > 0 ? `N${nodeId.toString(16).toUpperCase()}` : '';
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
      identity_id: identityId,
      node_id: opts.nodeId >>> 0,
      lat: opts.lat ?? null,
      lon: opts.lon ?? null,
      batt: opts.batt ?? null,
      hw_id: opts.hwId ?? null,
      last_heard: opts.lastHeard ?? null,
    }),
  );
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
  const fromCall = callsignFromNode(identityId, event.payload.from) || incoming.sender_name;
  const toCall = callsignFromNode(identityId, event.payload.to);
  if (fromCall) registerMeshcomCallsign(fromCall);
  if (toCall && toCall !== '*') registerMeshcomCallsign(toCall);
  const channelIdx = channelIdxForEvent(event.payload.channelIndex, event.payload.to, myNodeNum);
  const path = event.payload.hopCount != null ? String(event.payload.hopCount) : null;

  persistContact(identityId, {
    callsign: fromCall,
    nodeId: event.payload.from,
    lastHeard: Math.floor(event.payload.timestamp / 1000),
  });

  persistDbWrite('meshcom ingest message', () =>
    window.electronAPI.db.saveMeshcomMessage({
      identity_id: identityId,
      msg_id: event.payload.id,
      from_call: fromCall || null,
      to_call_or_group: toCall || null,
      text: incoming.payload,
      channel_idx: channelIdx,
      path,
      rssi: event.payload.rxRssi ?? null,
      snr: event.payload.rxSnr ?? null,
      received_via: 'rf',
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
  const callsign =
    normalizeMeshcomCallsign(existing?.longName ?? existing?.shortName ?? '') ||
    `N${t.nodeId.toString(16).toUpperCase()}`;
  if (!shouldApplyMeshcomContact(callsign)) {
    removeNode(identityId, t.nodeId);
    return;
  }

  upsertNodeRecord(identityId, {
    nodeId: t.nodeId,
    longName: callsign,
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

  if (t.batteryLevel != null) {
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
  const callsign =
    normalizeMeshcomCallsign(existing?.longName ?? existing?.shortName ?? '') ||
    `N${nodeId.toString(16).toUpperCase()}`;

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
    longName: callsign,
    latitude,
    longitude,
    lastHeardAt: Math.floor(timestamp / 1000),
  });

  persistContact(identityId, {
    callsign,
    nodeId,
    lat: latitude,
    lon: longitude,
    lastHeard: Math.floor(timestamp / 1000),
  });
}

/**
 * Apply a parsed EXTUDP inbound frame into stores + SQLite (transport → DomainEvent bridge).
 * Exported for the MeshCom runtime / transport layer.
 */
export function ingestMeshcomExtUdpFrame(
  identityId: IdentityId,
  frame: {
    type: string;
    src?: string;
    dst?: string;
    msg?: string;
    msg_id?: string;
    rssi?: number;
    snr?: number;
    hw_id?: number;
    lat?: number;
    long?: number;
    batt?: number;
  },
): void {
  const pathParse = parseMeshcomSrcPath(frame.src ?? '');
  const origin = pathParse.origin;
  if (!origin) return;
  const nodeId = registerMeshcomCallsign(origin);
  const now = Date.now();

  const allowContact = shouldApplyMeshcomContact(origin);

  if (frame.type === 'msg' && frame.msg != null && frame.dst != null) {
    const dst = normalizeMeshcomCallsign(frame.dst === '*' ? '' : frame.dst) || frame.dst;
    if (dst && dst !== '*') registerMeshcomCallsign(dst);
    const channelIdx = frame.dst === '*' || frame.dst === '0' ? 0 : -1;
    const msgId = frame.msg_id ?? `meshcom:${origin}:${now}`;
    if (allowContact) {
      upsertNodeRecord(identityId, {
        nodeId,
        longName: origin,
        lastHeardAt: Math.floor(now / 1000),
        snr: frame.snr,
        rssi: frame.rssi,
        hopsAway: pathParse.hopCount,
        hwModel: meshcomHwLabel(frame.hw_id) || undefined,
        source: 'rf',
      });
    }
    upsertMessage(
      identityId,
      chatMessageToMessageRecord({
        storeId: msgId,
        sender_id: nodeId,
        sender_name: origin,
        payload: frame.msg,
        channel: channelIdx,
        timestamp: now,
        to: dst && dst !== '*' ? callsignToNodeId(dst) : undefined,
        rxSnr: frame.snr,
        rxRssi: frame.rssi,
        receivedVia: 'rf',
        rxHops: pathParse.hopCount,
      }),
    );
    if (allowContact) {
      persistContact(identityId, {
        callsign: origin,
        nodeId,
        hwId: frame.hw_id ?? null,
        lastHeard: Math.floor(now / 1000),
      });
    }
    persistDbWrite('meshcom EXTUDP msg', () =>
      window.electronAPI.db.saveMeshcomMessage({
        identity_id: identityId,
        msg_id: msgId,
        from_call: origin,
        to_call_or_group: dst || '*',
        text: frame.msg!,
        channel_idx: channelIdx,
        path: pathParse.digis.length ? pathParse.digis.join(',') : null,
        rssi: frame.rssi ?? null,
        snr: frame.snr ?? null,
        hw_id: frame.hw_id ?? null,
        received_via: 'rf',
        timestamp: now,
        status: 'acked',
        received_at: now,
      }),
    );
    return;
  }

  if (frame.type === 'pos') {
    if (!allowContact) return;
    upsertNodeRecord(identityId, {
      nodeId,
      longName: origin,
      latitude: frame.lat,
      longitude: frame.long,
      lastHeardAt: Math.floor(now / 1000),
      batteryLevel: frame.batt,
      snr: frame.snr,
      rssi: frame.rssi,
      hopsAway: pathParse.hopCount,
      hwModel: meshcomHwLabel(frame.hw_id) || undefined,
      source: 'rf',
    });
    persistContact(identityId, {
      callsign: origin,
      nodeId,
      lat: frame.lat ?? null,
      lon: frame.long ?? null,
      batt: frame.batt ?? null,
      hwId: frame.hw_id ?? null,
      lastHeard: Math.floor(now / 1000),
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
