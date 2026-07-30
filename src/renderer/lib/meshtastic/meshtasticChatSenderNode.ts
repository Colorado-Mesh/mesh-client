import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import type { IdentityId } from '../types';

/** Ensure a chat sender exists in the identity-scoped node store (store-side `ensureNodeExists`). */
export function ensureMeshtasticChatSenderInNodeStore(
  identityId: IdentityId,
  nodeId: number,
  opts?: { lastHeardAt?: number; source?: 'rf' | 'mqtt' },
): void {
  if (nodeId <= 0) return;
  const lastHeardAt = opts?.lastHeardAt ?? Date.now();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
  const existing = useNodeStore.getState().nodes[identityId]?.[nodeId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
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
