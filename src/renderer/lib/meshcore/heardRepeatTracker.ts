import type { HeardRepeater } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import type { IdentityId } from '@/renderer/lib/types';
import type { NodeHashCandidate } from '@/shared/meshcoreNodeHash';
import {
  meshcoreResolveNodeFromPathPrefix,
  meshcoreSplitPathHashSegments,
} from '@/shared/meshcorePathHash';

/** Window after a channel TX during which we credit rebroadcasts to that message. */
export const MESHCORE_HEARD_REPEAT_WINDOW_MS = 6000;

export type MeshcoreHashSizeBytes = 1 | 2 | 3;

export type MeshcoreHeardRepeater = HeardRepeater;

interface PendingWindow {
  messageId: string;
  identityId: IdentityId;
  openedAt: number;
  windowMs: number;
}

/** Latest open listen window per identity. */
const pendingByIdentity = new Map<IdentityId, PendingWindow>();

export function resetHeardRepeatWindowsForTests(): void {
  pendingByIdentity.clear();
}

export function openHeardRepeatWindow(
  identityId: IdentityId,
  messageId: string,
  windowMs: number = MESHCORE_HEARD_REPEAT_WINDOW_MS,
  openedAt: number = Date.now(),
): void {
  pendingByIdentity.set(identityId, {
    identityId,
    messageId,
    openedAt,
    windowMs,
  });
  useRelayCoverageStore.getState().set(identityId, messageId, {
    protocol: 'meshcore',
    mode: 'confirmed',
    heardRepeaters: [],
  });
}

function activeWindow(identityId: IdentityId, now: number): PendingWindow | null {
  const w = pendingByIdentity.get(identityId);
  if (!w) return null;
  if (now - w.openedAt > w.windowMs) return null;
  return w;
}

export interface RecordMeshcoreRfRxArgs {
  identityId: IdentityId;
  isOwnMeshcoreTx: boolean;
  pathBytes: readonly number[];
  pathHashSizeBytes: MeshcoreHashSizeBytes;
  myNodeNum: number;
  snr?: number;
  rssi?: number;
  now?: number;
  candidates: readonly NodeHashCandidate[];
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
  /** Return a repeater entry only when the resolved node is Repeater/Room; else null. */
  resolveRepeater: (nodeId: number) => MeshcoreHeardRepeater | null;
}

/**
 * Credit foreign Repeater/Room path hashes on a self-originated RF overhear to the open TX window.
 */
export function recordMeshcoreRfRx(args: RecordMeshcoreRfRxArgs): void {
  const {
    identityId,
    isOwnMeshcoreTx,
    pathBytes,
    pathHashSizeBytes,
    myNodeNum,
    snr,
    rssi,
    candidates,
    pubKeyByNodeId,
    resolveRepeater,
  } = args;
  const now = args.now ?? Date.now();
  if (!isOwnMeshcoreTx) return;
  const window = activeWindow(identityId, now);
  if (!window) return;
  if (pathBytes.length === 0) return;

  const segments = meshcoreSplitPathHashSegments(pathBytes, pathHashSizeBytes);
  if (segments.length === 0) return;

  const prev =
    useRelayCoverageStore.getState().coverageFor(identityId, window.messageId)?.heardRepeaters ??
    [];
  const byId = new Map<number, HeardRepeater>(prev.map((r) => [r.nodeId, r]));
  let changed = false;

  for (const segment of segments) {
    const nodeId = meshcoreResolveNodeFromPathPrefix(segment, [...candidates], pubKeyByNodeId);
    if (nodeId == null || nodeId === myNodeNum) continue;
    const repeater = resolveRepeater(nodeId);
    if (!repeater) continue;
    const next: HeardRepeater = {
      nodeId: repeater.nodeId,
      name: repeater.name,
      snr: snr ?? repeater.snr,
      rssi: rssi ?? repeater.rssi,
    };
    const existing = byId.get(nodeId);
    if (
      existing &&
      existing.name === next.name &&
      existing.snr === next.snr &&
      existing.rssi === next.rssi
    ) {
      continue;
    }
    byId.set(nodeId, next);
    changed = true;
  }

  if (!changed && byId.size === prev.length) return;

  useRelayCoverageStore.getState().set(identityId, window.messageId, {
    protocol: 'meshcore',
    mode: 'confirmed',
    heardRepeaters: [...byId.values()],
  });
}

/** True when MeshCore contact `hw_model` is a relay role we credit for heard-repeat. */
export function isMeshcoreHeardRepeatRole(hwModel: string | null | undefined): boolean {
  return hwModel === 'Repeater' || hwModel === 'Room';
}

export function resolveMeshcoreHeardRepeaterFromNode(
  nodeId: number,
  node: { long_name?: string | null; short_name?: string | null; hw_model?: string | null } | null,
): MeshcoreHeardRepeater | null {
  if (!node || !isMeshcoreHeardRepeatRole(node.hw_model)) return null;
  const name = node.long_name?.trim() || node.short_name?.trim() || undefined;
  return { nodeId, name };
}
