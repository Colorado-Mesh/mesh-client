import { useMemo } from 'react';

import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { useRadioProvider } from '../lib/radio/providerFactory';
import type { IdentityId, MeshProtocol } from '../lib/types';
import { type IdentityRecord, useIdentityStore } from '../stores/identityStore';

function identityIdForProtocol(
  identities: Record<IdentityId, IdentityRecord>,
  activeIdentityId: IdentityId | null,
  protocol: MeshProtocol,
): IdentityId | null {
  if (activeIdentityId) {
    const active = identities[activeIdentityId];
    if (active?.protocol.type === protocol) return activeIdentityId;
  }
  const matches = Object.values(identities)
    .filter((i) => i.protocol.type === protocol)
    .sort((a, b) => a.createdAt - b.createdAt);
  return matches[0]?.id ?? null;
}

export interface ActiveMeshIdentity {
  protocol: MeshProtocol;
  meshtasticIdentityId: IdentityId | null;
  meshcoreIdentityId: IdentityId | null;
  focusedIdentityId: IdentityId | null;
  capabilities: ProtocolCapabilities;
}

/**
 * Identity-scoped orchestration for the active protocol tab. Prefer capability checks
 * over `protocol ===` when gating UI.
 */
export function useActiveMeshIdentity(protocol: MeshProtocol): ActiveMeshIdentity {
  const meshtasticIdentityId = useIdentityStore((s) =>
    identityIdForProtocol(s.identities, s.activeIdentityId, 'meshtastic'),
  );
  const meshcoreIdentityId = useIdentityStore((s) =>
    identityIdForProtocol(s.identities, s.activeIdentityId, 'meshcore'),
  );
  const capabilities = useRadioProvider(protocol);
  const focusedIdentityId = getIdentityIdForProtocol(protocol);

  return useMemo(
    () => ({
      protocol,
      meshtasticIdentityId,
      meshcoreIdentityId,
      focusedIdentityId,
      capabilities,
    }),
    [protocol, meshtasticIdentityId, meshcoreIdentityId, focusedIdentityId, capabilities],
  );
}
