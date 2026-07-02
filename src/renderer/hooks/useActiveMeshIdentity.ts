import { useMemo } from 'react';

import {
  resolveIdentityIdForProtocol,
  resolvePrimaryIdentityIdForProtocol,
} from '../lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { type IdentityId, type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '../lib/types';
import { useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';

export interface ActiveMeshIdentity {
  protocol: MeshProtocol;
  /** @deprecated Prefer identityIdByProtocol */
  meshtasticIdentityId: IdentityId | null;
  /** @deprecated Prefer identityIdByProtocol */
  meshcoreIdentityId: IdentityId | null;
  identityIdByProtocol: Record<MeshProtocol, IdentityId | null>;
  focusedIdentityId: IdentityId | null;
  capabilities: ProtocolCapabilities;
}

function useBucketCounts(primaryId: IdentityId | null, offlineId: IdentityId) {
  const primaryMsgCount = useMessageStore((s) =>
    primaryId ? Object.keys(s.messages[primaryId] ?? {}).length : 0,
  );
  const offlineMsgCount = useMessageStore((s) => Object.keys(s.messages[offlineId] ?? {}).length);
  const primaryNodeCount = useNodeStore((s) =>
    primaryId ? Object.keys(s.nodes[primaryId] ?? {}).length : 0,
  );
  const offlineNodeCount = useNodeStore((s) => Object.keys(s.nodes[offlineId] ?? {}).length);
  return { primaryMsgCount, offlineMsgCount, primaryNodeCount, offlineNodeCount };
}

function useResolvedIdentityId(protocol: MeshProtocol): IdentityId | null {
  const identities = useIdentityStore((s) => s.identities);
  const activeIdentityId = useIdentityStore((s) => s.activeIdentityId);
  const offlineId = getOfflineIdentityIdForProtocol(protocol);
  const primaryId = resolvePrimaryIdentityIdForProtocol(identities, activeIdentityId, protocol);
  // Bucket counts subscribe message/node stores so resolution updates after connect.
  useBucketCounts(primaryId, offlineId);

  return resolveIdentityIdForProtocol(identities, activeIdentityId, protocol);
}

/**
 * Identity-scoped orchestration for the active protocol tab. Prefer capability checks
 * over `protocol ===` when gating UI.
 */
export function useActiveMeshIdentity(protocol: MeshProtocol): ActiveMeshIdentity {
  const meshtasticIdentityId = useResolvedIdentityId('meshtastic');
  const meshcoreIdentityId = useResolvedIdentityId('meshcore');
  const reticulumIdentityId = useResolvedIdentityId('reticulum');
  const capabilities = useRadioProvider(protocol);

  const identityIdByProtocol = useMemo((): Record<MeshProtocol, IdentityId | null> => {
    const map = {} as Record<MeshProtocol, IdentityId | null>;
    for (const p of REGISTERED_MESH_PROTOCOLS) {
      if (p === 'meshtastic') map[p] = meshtasticIdentityId;
      else if (p === 'meshcore') map[p] = meshcoreIdentityId;
      else map[p] = reticulumIdentityId;
    }
    return map;
  }, [meshtasticIdentityId, meshcoreIdentityId, reticulumIdentityId]);

  const focusedIdentityId = identityIdByProtocol[protocol];

  return useMemo(
    () => ({
      protocol,
      meshtasticIdentityId,
      meshcoreIdentityId,
      identityIdByProtocol,
      focusedIdentityId,
      capabilities,
    }),
    [
      protocol,
      meshtasticIdentityId,
      meshcoreIdentityId,
      identityIdByProtocol,
      focusedIdentityId,
      capabilities,
    ],
  );
}
