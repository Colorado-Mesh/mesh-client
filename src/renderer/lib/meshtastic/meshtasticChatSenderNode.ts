import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import type { IdentityId } from '../types';

/** Ensure a chat sender exists in identity-scoped node store (mirrors legacy ensureNodeExists). */
export function ensureMeshtasticChatSenderInNodeStore(
  identityId: IdentityId,
  nodeId: number,
  opts?: { lastHeardAt?: number; source?: 'rf' | 'mqtt' },
): void {
  if (nodeId <= 0) return;
  const lastHeardAt = opts?.lastHeardAt ?? Date.now();
  const existing = useNodeStore.getState().nodes[identityId]?.[nodeId];
  if (!existing) {
    upsertNodeRecord(identityId, {
      nodeId,
      lastHeardAt,
      source: opts?.source ?? 'rf',
      heardViaMqttOnly: opts?.source === 'mqtt' ? true : undefined,
    });
    return;
  }
  if ((existing.lastHeardAt ?? 0) < lastHeardAt) {
    upsertNodeRecord(identityId, { nodeId, lastHeardAt });
  }
}
