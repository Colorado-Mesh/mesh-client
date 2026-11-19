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
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { BatchedRingBufferAppender } from '../batchedRingBufferAppender';
import { getConnectedMeshcoreBleMac } from '../connectedMeshcoreBleMac';
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import { errLikeToLogString } from '../errLikeToLogString';
import { getIdentityNode } from '../identityStoreReads';
import { enqueueNodeWrite } from '../ingest/coalescedNodeWrites';
import { shouldSuppressMeshtasticNodeHear } from '../meshcoreBleMacMeshtasticNodeId';
import { mergeMeshtasticLivePacketLastHeard } from '../meshtasticLastHeard';
import { effectiveLastHeardMs } from '../nodeStatus';
import { perfSpanSync } from '../perfTrace';
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
  /** Optional: keeps a live ref of the ring buffer (tests / future hop correlation). */
  rawPacketsRef?: RefObject<MeshtasticRawPacketEntry[]>;
}

const rawPacketAppenders = new WeakMap<
  Dispatch<SetStateAction<MeshtasticRawPacketEntry[]>>,
  BatchedRingBufferAppender<MeshtasticRawPacketEntry>
>();

function rawPacketAppenderFor(
  deps: MeshtasticRawPacketSideEffectsDeps,
): BatchedRingBufferAppender<MeshtasticRawPacketEntry> {
  let appender = rawPacketAppenders.get(deps.setRawPackets);
  if (!appender) {
    appender = new BatchedRingBufferAppender(deps.setRawPackets, MAX_RAW_PACKET_LOG_ENTRIES, {
      syncBeforeCommit: deps.rawPacketsRef
        ? (next) => {
            deps.rawPacketsRef!.current = next;
          }
        : undefined,
    });
    rawPacketAppenders.set(deps.setRawPackets, appender);
  }
  return appender;
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
      ...(payload.packetId != null ? { packetId: payload.packetId } : {}),
      ...(payload.relayNode != null ? { relayNode: payload.relayNode } : {}),
    };
    rawPacketAppenderFor(deps).append(entry);
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
    Date.now() - effectiveLastHeardMs(existing.last_heard) >
      MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs;
  const node: MeshNode = {
    ...existing,
    // MQTT gateways often attach gateway-local snr/rssi; keep node RF signal RF-only.
    ...(!payload.viaMqtt && payload.snr ? { snr: payload.snr } : {}),
    ...(!payload.viaMqtt && payload.rssi ? { rssi: payload.rssi } : {}),
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
  perfSpanSync('rf:meshtastic:nodeStore', () => {
    enqueueNodeWrite(identityId, meshNodeToNodeRecord(node), { persist: true });
  });
  // Per-packet observation (hop history / packet counts); analysis stays debounced in the store.
  perfSpanSync('rf:meshtastic:diagnostics', () => {
    processMeshtasticNodeDiagnostics(
      node,
      myNodeNum,
      getIdentityNode(identityId, myNodeNum) ?? null,
    );
  });
}

function handleRawPacket(
  identityId: IdentityId,
  payload: RawPacketEntry,
  deps: MeshtasticRawPacketSideEffectsDeps,
): void {
  perfSpanSync('rf:meshtastic:rawPacket', () => {
    deps.touchLastData();
    const from = payload.fromNodeId;
    if (!from) return;

    // Connected MeshCore BLE MAC → skip all packet-wide side effects (diagnostics, SNR, hops).
    if (shouldSuppressMeshtasticNodeHear(from, getConnectedMeshcoreBleMac())) {
      return;
    }

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
  });
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
