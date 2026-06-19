import { useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import {
  resolveIdentityIdForProtocol,
  resolvePrimaryIdentityIdForProtocol,
} from './identityByProtocol';
import {
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
} from './offlineProtocolIdentities';
import type { IdentityId } from './types';

export interface DebugIdentityBucketSnapshot {
  offlineId: IdentityId;
  primaryId: IdentityId | null;
  resolvedId: IdentityId | null;
  primaryTransportStatuses: string[];
  offlineMessageCount: number;
  primaryMessageCount: number;
  offlineNodeCount: number;
  primaryNodeCount: number;
  offlineNewestMessageTs: number | null;
  primaryNewestMessageTs: number | null;
}

export interface DebugSnapshot {
  capturedAt: string;
  activeIdentityId: IdentityId | null;
  meshtastic: DebugIdentityBucketSnapshot;
  meshcore: DebugIdentityBucketSnapshot;
}

function newestMessageTimestamp(identityId: IdentityId | null): number | null {
  if (!identityId) return null;
  const bucket = useMessageStore.getState().messages[identityId];
  if (!bucket) return null;
  let max = 0;
  for (const row of Object.values(bucket)) {
    if (row.timestamp > max) max = row.timestamp;
  }
  return max > 0 ? max : null;
}

function buildProtocolBucketSnapshot(
  protocol: 'meshtastic' | 'meshcore',
): DebugIdentityBucketSnapshot {
  const { identities, activeIdentityId } = useIdentityStore.getState();
  const offlineId =
    protocol === 'meshtastic' ? OFFLINE_MESHTASTIC_IDENTITY_ID : OFFLINE_MESHCORE_IDENTITY_ID;
  const primaryId = resolvePrimaryIdentityIdForProtocol(identities, activeIdentityId, protocol);
  const resolvedId = resolveIdentityIdForProtocol(identities, activeIdentityId, protocol);
  const messages = useMessageStore.getState().messages;
  const nodes = useNodeStore.getState().nodes;
  const primaryRec = primaryId ? identities[primaryId] : undefined;

  return {
    offlineId,
    primaryId,
    resolvedId,
    primaryTransportStatuses: primaryRec?.transports.map((t) => t.status) ?? [],
    offlineMessageCount: Object.keys(messages[offlineId] ?? {}).length,
    primaryMessageCount: primaryId ? Object.keys(messages[primaryId] ?? {}).length : 0,
    offlineNodeCount: Object.keys(nodes[offlineId] ?? {}).length,
    primaryNodeCount: primaryId ? Object.keys(nodes[primaryId] ?? {}).length : 0,
    offlineNewestMessageTs: newestMessageTimestamp(offlineId),
    primaryNewestMessageTs: newestMessageTimestamp(primaryId),
  };
}

/** Renderer-side support snapshot for bug reports (identity buckets + store counts). */
export function buildDebugSnapshot(): DebugSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    activeIdentityId: useIdentityStore.getState().activeIdentityId,
    meshtastic: buildProtocolBucketSnapshot('meshtastic'),
    meshcore: buildProtocolBucketSnapshot('meshcore'),
  };
}

export async function copyDebugSnapshotToClipboard(): Promise<boolean> {
  const text = JSON.stringify(buildDebugSnapshot(), null, 2);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}
