import { meshtasticNodeLacksDisplayIdentity } from '@/shared/nodeNameUtils';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { effectiveLastHeardMs } from '../nodeStatus';
import type { MeshNode } from '../types';

/** Match the NODEINFO request debounce window in meshtasticRuntimeWireEffects. */
export const MESHTASTIC_NODEINFO_AWAIT_MS = 5 * MS_PER_MINUTE;

/**
 * True only while we may still receive a NodeInfo reply (recent traffic + connected radio).
 * Chat-only stubs with no identity should not show a perpetual Loading state.
 */
export function meshtasticNodeAwaitingNodeInfo(
  node: MeshNode,
  opts?: { isConnected?: boolean; nowMs?: number; awaitWindowMs?: number },
): boolean {
  if (!meshtasticNodeLacksDisplayIdentity(node, node.node_id)) return false;
  if (node.role !== undefined) return false;
  if (opts?.isConnected === false) return false;

  const nowMs = opts?.nowMs ?? Date.now();
  const heardMs = effectiveLastHeardMs(node.last_heard, nowMs);
  if (!heardMs) return false;

  const windowMs = opts?.awaitWindowMs ?? MESHTASTIC_NODEINFO_AWAIT_MS;
  return nowMs - heardMs <= windowMs;
}
