/**
 * Sniffer log, RF diagnostics, and SNR/hop node patches driven by the
 * `PacketRouter` `raw_packet` event.
 *
 * `MeshtasticProtocol.decodeRawPacket` already serializes every MeshPacket and
 * carries hop/port metadata, so the runtime no longer needs its own
 * `device.events.onMeshPacket` subscription for this.
 *
 * Failure point: diagnostics and the sniffer ring buffer are display-only — a
 * missing node row simply skips the patch; chat/node ingest is unaffected.
 */
import type { Dispatch, SetStateAction } from 'react';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { upsertNodeRecord } from '../../stores/nodeStore';
import { persistDbWrite } from '../dbPersistRetry';
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import { errLikeToLogString } from '../errLikeToLogString';
import { getIdentityNode } from '../identityStoreReads';
import { mergeMeshtasticLivePacketLastHeard } from '../meshtasticLastHeard';
import type { RawPacketEntry } from '../protocols/Protocol';
import { MESHTASTIC_CAPABILITIES } from '../radio/BaseRadioProvider';
import {
  MAX_RAW_PACKET_LOG_ENTRIES,
  type MeshtasticRawPacketEntry,
} from '../rawPacketLogConstants';
import { MAX_TELEMETRY_POINTS } from '../sessionMemoryCaps';
import { getStoredMeshProtocol } from '../storedMeshProtocol';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import type { IdentityId, MeshNode, TelemetryPoint } from '../types';
import { processMeshtasticNodeDiagnostics } from './meshtasticProcessNodeDiagnostics';

export interface MeshtasticRawPacketSideEffectsDeps {
  getMyNodeNum: () => number;
  getIsConfiguring: () => boolean;
  setRawPackets: Dispatch<SetStateAction<MeshtasticRawPacketEntry[]>>;
  setSignalTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  touchLastData: () => void;
}

function appendRawPacketLog(
  payload: RawPacketEntry,
  deps: MeshtasticRawPacketSideEffectsDeps,
): void {
  try {
    const fromNodeId = payload.fromNodeId;
    const entry: MeshtasticRawPacketEntry = {
      ts: payload.ts,
      snr: payload.snr,
      rssi: payload.rssi,
      raw: payload.raw,
      fromNodeId,
      portLabel: payload.portLabel,
      viaMqtt: payload.viaMqtt,
      isLocal:
        fromNodeId === deps.getMyNodeNum() &&
        !payload.viaMqtt &&
        payload.portLabel === 'TELEMETRY_APP',
      hopsAway: payload.hopsAway,
    };
    deps.setRawPackets((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_RAW_PACKET_LOG_ENTRIES
        ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
        : next;
    });
  } catch (e) {
    console.debug(
      '[meshtasticRawPacketSideEffects] raw packet log entry failed ' + errLikeToLogString(e),
    );
  }
}

function applySignalAndHops(
  identityId: IdentityId,
  payload: RawPacketEntry,
  from: number,
  deps: MeshtasticRawPacketSideEffectsDeps,
): void {
  const myNodeNum = deps.getMyNodeNum();
  const hasSignal = Boolean(payload.snr || payload.rssi);
  const hasHopUpdate = payload.hopsAway !== undefined && from !== myNodeNum;
  if (!hasSignal && !hasHopUpdate) return;

  const existing = getIdentityNode(identityId, from);
  if (!existing) return;

  const isStale =
    existing.last_heard > 0 &&
    Date.now() - existing.last_heard > MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs;
  const node: MeshNode = {
    ...existing,
    ...(payload.snr ? { snr: payload.snr } : {}),
    ...(payload.rssi ? { rssi: payload.rssi } : {}),
    ...(hasSignal
      ? {
          last_heard: mergeMeshtasticLivePacketLastHeard(
            existing.last_heard || 0,
            Date.now(),
            deps.getIsConfiguring(),
          ),
        }
      : {}),
    ...(hasHopUpdate && !isStale ? { hops_away: payload.hopsAway } : {}),
    source: 'rf',
    heard_via_mqtt_only: false,
    via_mqtt: payload.viaMqtt,
  };
  upsertNodeRecord(identityId, meshNodeToNodeRecord(node));
  persistDbWrite('meshtastic raw packet node', () => window.electronAPI.db.saveNode(node));
  processMeshtasticNodeDiagnostics(node, myNodeNum, getIdentityNode(identityId, myNodeNum) ?? null);
}

function handleRawPacket(
  identityId: IdentityId,
  payload: RawPacketEntry,
  deps: MeshtasticRawPacketSideEffectsDeps,
): void {
  deps.touchLastData();
  const from = payload.fromNodeId;
  if (!from) return;

  if (getStoredMeshProtocol() === 'meshtastic') {
    appendRawPacketLog(payload, deps);
    if (typeof payload.portnum === 'number') {
      useDiagnosticsStore.getState().recordNoisePort(from, payload.portnum);
    }
    // Skip packet id 0 — protobuf assigns no unique id for no-ack / non-broadcast.
    if (payload.packetId != null && payload.packetId !== 0) {
      useDiagnosticsStore.getState().recordPacketPath(payload.packetId, from, {
        transport: 'rf',
        snr: payload.snr,
        rssi: payload.rssi,
        timestamp: Date.now(),
      });
    }
  }

  applySignalAndHops(identityId, payload, from, deps);

  if (payload.snr || payload.rssi) {
    deps.setSignalTelemetry((prev) =>
      [...prev, { timestamp: Date.now(), snr: payload.snr, rssi: payload.rssi }].slice(
        -MAX_TELEMETRY_POINTS,
      ),
    );
  }
}

/** Attach sniffer / RF diagnostics side effects for one Meshtastic identity. */
export function attachMeshtasticRawPacketSideEffects(
  identityId: IdentityId,
  deps: MeshtasticRawPacketSideEffectsDeps,
): () => void {
  return attachTypedPacketListener(identityId, 'raw_packet', (payload) => {
    handleRawPacket(identityId, payload, deps);
  });
}
