/**
 * Sync MeshCom self callsign → myNodeNum / node row, and repair early outbound rows
 * stamped with from:0 before identity was known.
 */

import { getConnection, setConnection } from '../../stores/connectionStore';
import { remapMessageNodeId, upsertMessage, useMessageStore } from '../../stores/messageStore';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import { errLikeToLogString } from '../errLikeToLogString';
import type { IdentityId } from '../types';
import { meshcomCallForNodeId, registerMeshcomCallsign } from './meshcomCallRegistry';
import { callsignToNodeId, normalizeMeshcomCallsign } from './meshcomCallsign';
import { meshcomOutboundDest } from './meshcomChannel';
import { meshcomPersistIdentityId } from './meshcomPersistIdentity';

/** Hydrate placeholder when SQLite has no from_call — treat as missing for self-repair. */
const MESHCOM_UNKNOWN_SENDER_NAME = 'Unknown';

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

/** Registry first, then nodeStore longName — same fallback as sendChatOnIdentity outbound. */
function meshcomCallForNode(identityId: IdentityId, nodeId: number): string {
  if (nodeId === 0 || nodeId === 0xffffffff) return '';
  const fromRegistry = meshcomCallForNodeId(nodeId);
  if (fromRegistry) return fromRegistry;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent.
  return useNodeStore.getState().nodes[identityId]?.[nodeId]?.longName?.trim() || '';
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
    const next =
      !row.senderName || row.senderName === MESHCOM_UNKNOWN_SENDER_NAME
        ? { ...row, senderName: callsign }
        : row;
    if (next !== row) upsertMessage(identityId, next);
    const toCallOrGroup =
      next.channelIndex > 0
        ? meshcomOutboundDest({ channelIndex: next.channelIndex })
        : next.to !== 0xffffffff
          ? meshcomCallForNode(identityId, next.to) || null
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

/**
 * Remap any `from:0` (and Unknown senderName) rows to the known self node and re-persist.
 * Safe to call whenever self is known — independent of the 0→resolved transition.
 */
export function repairMeshcomZeroFromRows(
  identityId: IdentityId,
  callsignRaw: string,
  myNodeNum: number,
): void {
  const callsign = normalizeMeshcomCallsign(callsignRaw);
  if (!callsign || myNodeNum <= 0) return;
  const bucket = useMessageStore.getState().messages[identityId] ?? {};
  const hasZero = Object.values(bucket).some((row) => row.from === 0);
  if (!hasZero) return;
  remapMessageNodeId(identityId, 0, myNodeNum);
  rePersistOutboundAfterSelfRemap(identityId, callsign, myNodeNum);
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

  // Always repair from:0 rows when self is known (settings-first or late hydrate).
  repairMeshcomZeroFromRows(identityId, callsign, resolved);

  return resolved;
}

/** Resolve self callsign for hydrate-time repair (node row / connection myNodeNum). */
export function meshcomSelfCallsignForIdentity(identityId: IdentityId): string {
  const my = getConnection(identityId)?.myNodeNum ?? 0;
  if (my <= 0) return '';
  return meshcomCallForNode(identityId, my);
}
