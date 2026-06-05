import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import {
  MESHCORE_UNKNOWN_SENDER_STUB_ID,
  meshcoreMergeChannelDisplayNameOntoNode,
  minimalMeshcoreChatNode,
} from '../meshcoreUtils';
import { lastHeardToUnixSeconds, mergeMeshcoreLastHeardFromAdvert } from '../nodeStatus';
import { meshNodeToNodeRecord, nodeRecordToMeshNode } from '../storeRecordAdapters';
import type { IdentityId } from '../types';

export interface EnsureMeshcoreChatSenderOpts {
  lastHeardAtMs?: number;
  displayName?: string;
  source?: 'rf' | 'mqtt';
  hopsAway?: number;
  heardViaMqtt?: boolean;
}

/** Ensure a MeshCore chat sender exists in identity-scoped node store with fresh last_heard. */
export function ensureMeshcoreChatSenderInNodeStore(
  identityId: IdentityId,
  nodeId: number,
  opts?: EnsureMeshcoreChatSenderOpts,
): void {
  if (nodeId <= 0 || nodeId === MESHCORE_UNKNOWN_SENDER_STUB_ID) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const incomingSec = lastHeardToUnixSeconds(opts?.lastHeardAtMs ?? Date.now());
  const existing = useNodeStore.getState().nodes[identityId]?.[nodeId];
  const mergedSec = mergeMeshcoreLastHeardFromAdvert(incomingSec, existing?.lastHeardAt, nowSec);
  if (mergedSec <= 0) return;

  const source = opts?.source ?? 'rf';
  const prevSec = lastHeardToUnixSeconds(existing?.lastHeardAt ?? 0);

  if (!existing) {
    let stub = minimalMeshcoreChatNode(
      nodeId,
      opts?.displayName?.trim() || `Node-${nodeId.toString(16).toUpperCase()}`,
      mergedSec,
      source,
    );
    if (opts?.displayName) {
      stub = meshcoreMergeChannelDisplayNameOntoNode(stub, opts.displayName);
    }
    if (opts?.hopsAway != null) stub = { ...stub, hops_away: opts.hopsAway };
    if (opts?.heardViaMqtt) {
      stub = { ...stub, heard_via_mqtt: true, heard_via_mqtt_only: source === 'mqtt' };
    }
    upsertNodeRecord(identityId, meshNodeToNodeRecord(stub));
    return;
  }

  let meshNode = nodeRecordToMeshNode(existing);
  const displayName = opts?.displayName?.trim();
  if (displayName) {
    meshNode = meshcoreMergeChannelDisplayNameOntoNode(meshNode, displayName);
  }

  const patch: Parameters<typeof upsertNodeRecord>[1] = { nodeId };
  let changed = mergedSec > prevSec;

  if (mergedSec > prevSec) patch.lastHeardAt = mergedSec;
  if (opts?.hopsAway != null && existing.hopsAway !== opts.hopsAway) {
    patch.hopsAway = opts.hopsAway;
    changed = true;
  }
  if (opts?.heardViaMqtt && !existing.heardViaMqtt) {
    patch.heardViaMqtt = true;
    if (source === 'mqtt') patch.heardViaMqttOnly = true;
    changed = true;
  }
  if (source !== 'rf' && existing.source !== source) {
    patch.source = source;
    changed = true;
  }
  if (displayName && meshNode.long_name && meshNode.long_name !== existing.longName) {
    patch.longName = meshNode.long_name;
    patch.shortName = '';
    changed = true;
  }

  if (!changed) return;
  upsertNodeRecord(identityId, { ...existing, ...patch });
}
