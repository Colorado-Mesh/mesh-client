/**
 * Post-`PacketRouter` MeshCore side effects (contacts → SQLite).
 *
 * Failure point: DB IPC errors — logged; store remains authoritative.
 */
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import type { IdentityId } from '../types';

/** MeshCore contacts belong in meshcore_contacts SQLite, not the Meshtastic nodes table. */
function persistContactNodes(identityId: IdentityId): void {
  // Legacy conn events and refreshContacts persist via saveMeshcoreContact.
  void identityId;
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
