import { useIdentityStore } from '../stores/identityStore';
import type { IdentityId, MeshProtocol } from './types';

/** First identity id registered for a protocol type (Meshtastic / MeshCore tab). */
export function getIdentityIdForProtocol(protocol: MeshProtocol): IdentityId | null {
  const match = Object.values(useIdentityStore.getState().identities).find(
    (i) => i.protocol.type === protocol,
  );
  return match?.id ?? null;
}
