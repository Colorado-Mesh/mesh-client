import type { ChatMessage } from '@/renderer/lib/types';

import { normalizeReticulumNodeId, reticulumHashToNodeId } from './destHash';

/** Reticulum DB/hydration uses `to: 0` when `to_hash` is absent — treat as unset. */
export function reticulumUnsetDmTo(to: number | undefined | null): boolean {
  return to == null || to === 0;
}

function isReticulumOwnNode(nodeId: number, ownNodeIds: ReadonlySet<number>): boolean {
  const normalized = normalizeReticulumNodeId(nodeId);
  for (const own of ownNodeIds) {
    if (normalizeReticulumNodeId(own) === normalized) return true;
  }
  return false;
}

/** Reticulum DM filter: uint32-normalized ids and inbound rows without `to`. */
export function reticulumMessageMatchesDmPeer(
  msg: ChatMessage,
  peerNodeId: number,
  ownNodeIds: ReadonlySet<number>,
): boolean {
  const peer = normalizeReticulumNodeId(peerNodeId);
  const sender = normalizeReticulumNodeId(msg.sender_id);
  const to = reticulumUnsetDmTo(msg.to) ? null : normalizeReticulumNodeId(msg.to!);

  if (isReticulumOwnNode(sender, ownNodeIds) && to === peer) return true;
  if (sender === peer && (to == null || isReticulumOwnNode(to, ownNodeIds))) return true;

  if (msg.reticulum_sender_hash) {
    const fromHash = normalizeReticulumNodeId(reticulumHashToNodeId(msg.reticulum_sender_hash));
    if (fromHash === peer && !isReticulumOwnNode(sender, ownNodeIds)) return true;
  }

  return false;
}
