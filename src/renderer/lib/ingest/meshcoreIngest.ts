/**
 * Post-`PacketRouter` MeshCore side effects (contacts → SQLite).
 *
 * Failure point: DB IPC errors — logged; store remains authoritative.
 */
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import { nodeRecordToMeshNode } from '../storeRecordAdapters';
import type { IdentityId } from '../types';

function persistContactNodes(identityId: IdentityId): void {
  const byId = useNodeStore.getState().nodes[identityId] ?? {};
  for (const record of Object.values(byId)) {
    const meshNode = nodeRecordToMeshNode(record);
    void window.electronAPI.db.saveNode(meshNode).catch((e: unknown) => {
      console.debug('[meshcoreIngest] saveNode failed ' + errLikeToLogString(e));
    });
  }
}

function createListener(identityId: IdentityId): PacketRouterListener {
  return (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'node_info':
        persistContactNodes(identityId);
        break;
      case 'device_contacts':
        persistContactNodes(identityId);
        break;
      default:
        break;
    }
  };
}

export function attachMeshcoreIngest(identityId: IdentityId): () => void {
  return packetRouter.addListener(createListener(identityId));
}
