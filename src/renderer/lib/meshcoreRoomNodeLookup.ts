import type { IdentityId } from '@/renderer/lib/types';
import { useNodeStore } from '@/renderer/stores/nodeStore';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Resolve a MeshCore room-server node id by stable public-key hex (survives node-id churn). */
export function resolveMeshcoreRoomNodeId(
  identityId: IdentityId,
  roomPubKeyHex: string,
): number | undefined {
  const byIdentity = useNodeStore.getState().nodes;
  if (!(identityId in byIdentity)) return undefined;
  const nodes = byIdentity[identityId];
  const want = roomPubKeyHex.toLowerCase();
  for (const node of Object.values(nodes)) {
    const hex = node.publicKey ? toHex(node.publicKey) : node.publicKeyHex?.toLowerCase();
    if (hex === want) return node.nodeId;
  }
  return undefined;
}
