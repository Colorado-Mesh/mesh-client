import { useMemo } from 'react';

import {
  resolveIdentityIdForProtocol,
  resolvePrimaryIdentityIdForProtocol,
} from '../lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { useRadioProvider } from '../lib/radio/providerFactory';
import type { IdentityId, MeshProtocol } from '../lib/types';
import { useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';

export interface ActiveMeshIdentity {
  protocol: MeshProtocol;
  meshtasticIdentityId: IdentityId | null;
  meshcoreIdentityId: IdentityId | null;
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
  const capabilities = useRadioProvider(protocol);
  const focusedIdentityId = protocol === 'meshtastic' ? meshtasticIdentityId : meshcoreIdentityId;

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
