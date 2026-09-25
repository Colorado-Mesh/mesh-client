/**
 * MeshCore hop-ACK (event 130) resolution shared by the runtime side-effect listener.
 *
 * Failure point: SQLite status write on timeout — logged here; Zustand chat rows stay
 * authoritative for the UI. Event 130 status writes are logged by the side-effect listener.
 */
import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

import {
  meshcoreDeviceAckLookupKeys,
  meshcoreDmAckKeyU32,
  meshcorePendingDmAckMapKeys,
  type PendingDmAckEntry,
} from '../../hooks/meshcore/meshcoreHookPreamble';
import { updateMessageStatus, useMessageStore } from '../../stores/messageStore';
import { computePathHash, usePathHistoryStore } from '../../stores/pathHistoryStore';
import { errLikeToLogString } from '../errLikeToLogString';
import type { MeshcoreDmAckPendingParams } from '../meshcoreDmAckDelivery';
import type { IdentityId } from '../types';

/** MeshCore firmware RESP codes: 0x80 = ACK, 0x81 = NACK (may arrive signed). */
const MESHCORE_RESP_CODE_NACK = 0x81;

export type MeshcoreDmAckStatus = 'acked' | 'failed';

export interface ArmMeshcoreDmAckPendingDeps {
  pendingAcks: Map<number, PendingDmAckEntry>;
  /** Read when the timer fires so a self-id learned after send still matches the row. */
  getSelfNodeId: () => number;
  outPath?: Uint8Array | null;
  hopsAway?: number;
}

/**
 * Track a companion-accepted DM until event 130 or `estTimeoutMs`.
 * The runtime owns `pendingAcks`; chat send registers through this helper.
 */
export function armMeshcoreDmAckPending(
  params: MeshcoreDmAckPendingParams,
  deps: ArmMeshcoreDmAckPendingDeps,
): void {
  const { identityId, ackKeyU32, estTimeoutMs, destNodeId } = params;
  const pendingMapKeys = meshcorePendingDmAckMapKeys(ackKeyU32);
  const outPathRaw = deps.outPath;
  const sendPathBytes = outPathRaw != null && outPathRaw.length > 0 ? Array.from(outPathRaw) : [];
  const sendPathHash = sendPathBytes.length > 0 ? computePathHash(sendPathBytes) : '';
  const hopsAway = deps.hopsAway ?? 0;
  if (sendPathBytes.length > 0 && destNodeId != null) {
    usePathHistoryStore.getState().recordPathUpdated(destNodeId, sendPathBytes, hopsAway, false);
  }
  const timeoutId = setTimeout(() => {
    for (const k of pendingMapKeys) {
      deps.pendingAcks.delete(k);
    }
    if (destNodeId != null && sendPathHash.length > 0) {
      usePathHistoryStore.getState().recordOutcome(destNodeId, sendPathHash, false);
    }
    syncMeshcoreDmAckToMessageStore(identityId, ackKeyU32, deps.getSelfNodeId(), 'failed');
    void window.electronAPI.db
      .updateMeshcoreMessageStatus(ackKeyU32, 'failed')
      .catch((e: unknown) => {
        console.warn(
          '[meshcoreDmAckRuntime] updateMeshcoreMessageStatus (DM ack timeout) error ' +
            errLikeToLogString(e),
        );
      });
  }, estTimeoutMs);
  const pendingEntry: PendingDmAckEntry = {
    timeoutId,
    mapKeys: pendingMapKeys,
    canonicalPacketIdU32: ackKeyU32,
    destNodeId,
    pathHash: sendPathHash,
  };
  for (const k of pendingMapKeys) {
    deps.pendingAcks.set(k, pendingEntry);
  }
}

export interface MeshcoreDmAckResolution {
  isNack: boolean;
  newStatus: MeshcoreDmAckStatus;
  /** Pending send this ACK belongs to, when the device code still matches a live entry. */
  pending: PendingDmAckEntry | null;
  /** Canonical uint32 packet id to apply the status to. */
  ackKeyU32: number;
}

/** Pure: match a device ACK code against pending sends without mutating the map. */
export function resolveMeshcoreDmAck(
  ackCode: number,
  pendingAcks: ReadonlyMap<number, PendingDmAckEntry>,
): MeshcoreDmAckResolution {
  const isNack = ackCode === MESHCORE_RESP_CODE_NACK || ackCode === 129;
  const newStatus: MeshcoreDmAckStatus = isNack ? 'failed' : 'acked';
  let pending: PendingDmAckEntry | null = null;
  for (const lookupKey of meshcoreDeviceAckLookupKeys(ackCode)) {
    pending = pendingAcks.get(lookupKey) ?? null;
    if (pending) break;
  }
  return {
    isNack,
    newStatus,
    pending,
    ackKeyU32: pending?.canonicalPacketIdU32 ?? meshcoreDmAckKeyU32(ackCode),
  };
}

/**
 * Resolve the ACK and consume the matching pending entry (clears its timeout and every
 * alias key). Returns the same shape as {@link resolveMeshcoreDmAck}.
 */
export function applyMeshcoreDmAckToPending(
  ackCode: number,
  pendingAcks: Map<number, PendingDmAckEntry>,
): MeshcoreDmAckResolution {
  const resolution = resolveMeshcoreDmAck(ackCode, pendingAcks);
  if (resolution.pending) {
    clearTimeout(resolution.pending.timeoutId);
    for (const key of resolution.pending.mapKeys) {
      pendingAcks.delete(key);
    }
  }
  return resolution;
}

function isOutboundMeshcoreDmRecord(rec: { from: number; to: number; status?: string }): boolean {
  return rec.to !== 0xffffffff && !isMeshtasticBroadcastNodeNum(rec.to) && rec.to > 0;
}

/** Identity-scoped chat rows from {@link useSendMessage} use numeric ids after rename. */
export function syncMeshcoreDmAckToMessageStore(
  identityId: IdentityId,
  ackKeyU32: number,
  selfId: number,
  newStatus: MeshcoreDmAckStatus,
): boolean {
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  let matched = false;
  for (const [id, rec] of Object.entries(byId)) {
    if (rec.from !== selfId) continue;
    if (rec.status !== 'sending' && rec.status !== 'failed') continue;
    if (!/^\d+$/.test(id)) continue;
    if (meshcoreDmAckKeyU32(Number(id)) !== ackKeyU32) continue;
    updateMessageStatus(identityId, id, newStatus);
    matched = true;
  }
  if (matched) return true;

  // Do not apply ambiguous single-inflight fallback: a late/mis-keyed ACK 130 must
  // not rename/ack the sole outbound DM when packet ids do not match.
  const inflight = Object.entries(byId).filter(
    ([, rec]) => rec.status === 'sending' && rec.from === selfId && isOutboundMeshcoreDmRecord(rec),
  );
  if (inflight.length > 0) {
    console.debug(
      `[meshcoreDmAckRuntime] dropping unmatched DM ack ${ackKeyU32} (${inflight.length} inflight outbound)`,
    );
  }
  return false;
}
