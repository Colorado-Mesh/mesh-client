import type { Dispatch, RefObject, SetStateAction } from 'react';

import { BatchedRingBufferAppender } from '../batchedRingBufferAppender';
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import { errLikeToLogString } from '../errLikeToLogString';
import type { MeshcomRxEvent } from '../protocols/Protocol';
import { MAX_RAW_PACKET_LOG_ENTRIES, type MeshcomRawPacketEntry } from '../rawPacketLogConstants';
import type { IdentityId } from '../types';

export interface MeshcomRawPacketSideEffectsDeps {
  setRawPackets: Dispatch<SetStateAction<MeshcomRawPacketEntry[]>>;
  rawPacketsRef?: RefObject<MeshcomRawPacketEntry[]>;
}

const rawPacketAppenders = new WeakMap<
  Dispatch<SetStateAction<MeshcomRawPacketEntry[]>>,
  BatchedRingBufferAppender<MeshcomRawPacketEntry>
>();

function rawPacketAppenderFor(
  deps: MeshcomRawPacketSideEffectsDeps,
): BatchedRingBufferAppender<MeshcomRawPacketEntry> {
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

function mapRxToEntry(payload: MeshcomRxEvent): MeshcomRawPacketEntry {
  return {
    ts: payload.ts,
    snr: payload.snr,
    rssi: payload.rssi,
    kind: payload.kind,
    transport: payload.transport,
    originCallsign: payload.originCallsign,
    digis: [...payload.digis],
    hopsAway: payload.hopsAway,
    fromNodeId: payload.fromNodeId,
    ...(payload.msgId != null ? { msgId: payload.msgId } : {}),
    ...(payload.viaServer != null ? { viaServer: payload.viaServer } : {}),
    raw: payload.raw,
  };
}

function appendRawPacketLog(payload: MeshcomRxEvent, deps: MeshcomRawPacketSideEffectsDeps): void {
  try {
    rawPacketAppenderFor(deps).append(mapRxToEntry(payload));
  } catch (e) {
    console.debug(
      '[meshcomRawPacketSideEffects] raw packet log entry failed ' + errLikeToLogString(e),
    );
  }
}

/** Discard captures queued before Clear; later appends flush normally. */
export function clearMeshcomRawPacketPending(
  setRawPackets: Dispatch<SetStateAction<MeshcomRawPacketEntry[]>>,
): void {
  rawPacketAppenders.get(setRawPackets)?.clearPending();
}

/** Attach sniffer side effects for one MeshCom identity. */
export function attachMeshcomRawPacketSideEffects(
  identityId: IdentityId,
  deps: MeshcomRawPacketSideEffectsDeps,
): () => void {
  return attachTypedPacketListener(identityId, 'meshcom_rx', (payload) => {
    appendRawPacketLog(payload, deps);
  });
}
