import { useMemo } from 'react';

import type { MeshProtocol } from '../lib/types';
import { useMeshcoreRuntimeContext } from '../runtime/MeshcoreRuntimeContext';
import { useMeshtasticRuntimeContext } from '../runtime/MeshtasticRuntimeContext';
import { useActiveMeshIdentity } from './useActiveMeshIdentity';
import { useConnectionQueue } from './useConnectionStatus';
import { useLegacyConnectionView } from './useLegacyConnectionView';
import { useMessages } from './useMessages';
import { useNodes } from './useNodes';
import { type PanelActionsBundle, usePanelActions } from './usePanelActions';
import { useProtocolConnectionActions } from './useProtocolConnection';

export interface ProtocolFacade {
  protocol: MeshProtocol;
  focusedIdentityId: string | null;
  meshtasticIdentityId: string | null;
  meshcoreIdentityId: string | null;
  connection: ReturnType<typeof useProtocolConnectionActions>;
  connectionView: ReturnType<typeof useLegacyConnectionView>;
  queue: ReturnType<typeof useConnectionQueue>;
  panel: PanelActionsBundle;
  nodes: ReturnType<typeof useNodes>;
  messages: ReturnType<typeof useMessages>;
}

/**
 * Single orchestration surface for the active protocol tab ([#377]). App and panels should
 * prefer this over duplicating per-protocol field selection.
 */
export function useProtocolFacade(protocol: MeshProtocol): ProtocolFacade {
  const meshtastic = useMeshtasticRuntimeContext();
  const meshcore = useMeshcoreRuntimeContext();
  const { meshtasticIdentityId, meshcoreIdentityId, focusedIdentityId } =
    useActiveMeshIdentity(protocol);
  const connection = useProtocolConnectionActions(protocol);
  const connectionView = useLegacyConnectionView(focusedIdentityId);
  const queue = useConnectionQueue(focusedIdentityId);
  const panel = usePanelActions(protocol, focusedIdentityId, meshtastic, meshcore);
  const nodes = useNodes(focusedIdentityId);
  const messages = useMessages(focusedIdentityId);

  return useMemo(
    () => ({
      protocol,
      focusedIdentityId,
      meshtasticIdentityId,
      meshcoreIdentityId,
      connection,
      connectionView,
      queue,
      panel,
      nodes,
      messages,
    }),
    [
      protocol,
      focusedIdentityId,
      meshtasticIdentityId,
      meshcoreIdentityId,
      connection,
      connectionView,
      queue,
      panel,
      nodes,
      messages,
    ],
  );
}
