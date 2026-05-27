import { useIdentityStore } from '../stores/identityStore';
import type { IdentityId, MeshProtocol } from './types';

/** Active or earliest-created identity for a protocol tab (deterministic when multiple exist). */
export function getIdentityIdForProtocol(protocol: MeshProtocol): IdentityId | null {
  const { identities, activeIdentityId } = useIdentityStore.getState();
  if (activeIdentityId) {
    const active = identities[activeIdentityId];
    if (active?.protocol.type === protocol) return activeIdentityId;
  }
  const matches = Object.values(identities)
    .filter((i) => i.protocol.type === protocol)
    .sort((a, b) => a.createdAt - b.createdAt);
  return matches[0]?.id ?? null;
}
