import { useMemo } from 'react';

import { resolveIdentityIdForProtocol } from '../lib/identityByProtocol';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { useRadioProvider } from '../lib/radio/providerFactory';
import type { IdentityId, MeshProtocol } from '../lib/types';
import { useIdentityStore } from '../stores/identityStore';

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
    resolveIdentityIdForProtocol(s.identities, s.activeIdentityId, 'meshtastic'),
  );
  const meshcoreIdentityId = useIdentityStore((s) =>
    resolveIdentityIdForProtocol(s.identities, s.activeIdentityId, 'meshcore'),
  );
  const capabilities = useRadioProvider(protocol);
  const focusedIdentityId = useIdentityStore((s) =>
    resolveIdentityIdForProtocol(s.identities, s.activeIdentityId, protocol),
  );

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
