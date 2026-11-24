/**
 * Sync MeshCom self callsign → myNodeNum / node row, and repair early outbound rows
 * stamped with from:0 before identity was known.
 */

import { getConnection, setConnection } from '../../stores/connectionStore';
import { remapMessageNodeId, upsertMessage, useMessageStore } from '../../stores/messageStore';
import { upsertNodeRecord } from '../../stores/nodeStore';
import { errLikeToLogString } from '../errLikeToLogString';
import type { IdentityId } from '../types';
import { meshcomCallForNodeId, registerMeshcomCallsign } from './meshcomCallRegistry';
import { callsignToNodeId, normalizeMeshcomCallsign } from './meshcomCallsign';
import { meshcomOutboundDest } from './meshcomChannel';
import { meshcomPersistIdentityId } from './meshcomPersistIdentity';

export interface ApplyMeshcomSelfCallsignOpts {
  operatorName?: string;
  batteryLevel?: number | null;
  voltage?: number | null;
  setDeviceOwner?: (owner: { longName: string; shortName: string; isLicensed: boolean }) => void;
  setMyNodeNum?: (nodeId: number) => void;
}

/** Duck-typed read of MeshCom device handle callsign fields (avoids protocol import). */
export function meshcomCallsignFromDeviceHandle(handle: unknown): {
  callsign: string;
  operatorName?: string;
} {
  if (!handle || typeof handle !== 'object') return { callsign: '' };
  const h = handle as {
    operatorCallsign?: string;
    deviceSettings?: { call?: string | null; operatorName?: string | null };
  };
  const callsign =
    normalizeMeshcomCallsign(h.operatorCallsign ?? '') ||
    normalizeMeshcomCallsign(h.deviceSettings?.call ?? '');
  const operatorName = h.deviceSettings?.operatorName?.trim() || undefined;
  return { callsign, ...(operatorName ? { operatorName } : {}) };
}

function rePersistOutboundAfterSelfRemap(
  identityId: IdentityId,
  callsign: string,
  myNodeNum: number,
): void {
  const bucket = useMessageStore.getState().messages[identityId] ?? {};
  const persistId = meshcomPersistIdentityId();
  for (const row of Object.values(bucket)) {
    if (row.from !== myNodeNum) continue;
    if (row.status !== 'sending' && row.status !== 'acked' && row.status !== 'failed') continue;
    const next = row.senderName ? row : { ...row, senderName: callsign };
    if (next !== row) upsertMessage(identityId, next);
    const toCallOrGroup =
      next.channelIndex > 0
        ? meshcomOutboundDest({ channelIndex: next.channelIndex })
        : next.to !== 0xffffffff
          ? meshcomCallForNodeId(next.to) || null
          : '*';
    void window.electronAPI.db
      .saveMeshcomMessage({
        identity_id: persistId,
        msg_id: next.id,
        from_call: callsign,
        to_call_or_group: toCallOrGroup,
        text: next.payload,
        channel_idx: next.channelIndex,
        received_via: 'rf',
        timestamp: next.timestamp,
        status: next.status,
        received_at: next.receivedAt ?? Date.now(),
      })
      .catch((e: unknown) => {
        console.warn(
          'mcL1120 [meshcomSelfCallsign] saveMeshcomMessage failed ' + errLikeToLogString(e),
        );
      });
  }
}

/** Sync MeshCom self callsign → myNodeNum / node row (settings, setOwner, learned TX echo). */
export function applyMeshcomSelfCallsign(
  identityId: IdentityId,
  callsignRaw: string,
  opts?: ApplyMeshcomSelfCallsignOpts,
): number {
  const callsign = normalizeMeshcomCallsign(callsignRaw);
  if (!callsign) return 0;
  registerMeshcomCallsign(callsign);
  const resolved = callsignToNodeId(callsign);
  if (!resolved) return 0;

  const prevMy = getConnection(identityId)?.myNodeNum ?? 0;

  opts?.setDeviceOwner?.({
    longName: callsign,
    shortName: opts.operatorName || callsign.slice(0, 4),
    isLicensed: true,
  });
  opts?.setMyNodeNum?.(resolved);
  setConnection(identityId, { myNodeNum: resolved });
  upsertNodeRecord(identityId, {
    nodeId: resolved,
    longName: callsign,
    shortName: (opts?.operatorName || callsign).slice(0, 4),
    batteryLevel: opts?.batteryLevel ?? undefined,
    voltage: opts?.voltage ?? undefined,
    lastHeardAt: Date.now(),
  });

  // Early sends stamped from:0 stay left/"00" until remapped to the real self id.
  if (prevMy === 0 && resolved > 0) {
    remapMessageNodeId(identityId, 0, resolved);
    rePersistOutboundAfterSelfRemap(identityId, callsign, resolved);
  }

  return resolved;
}
