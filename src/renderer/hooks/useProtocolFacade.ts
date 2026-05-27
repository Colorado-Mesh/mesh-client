import { useMemo } from 'react';

import type { MeshProtocol } from '../lib/types';
import type { UseDeviceReturn, UseMeshCoreReturn } from './legacyHookTypes';
import { useActiveMeshIdentity } from './useActiveMeshIdentity';
import { useConnectionQueue } from './useConnectionStatus';
import { useLegacyConnectionView } from './useLegacyConnectionView';
import { useMessages } from './useMessages';
import { useNodes } from './useNodes';
import { type PanelActionsBundle, usePanelActions } from './usePanelActions';
import {
  type ProtocolConnectionActions,
  useProtocolConnectionActions,
} from './useProtocolConnection';

export interface ProtocolFacade {
  protocol: MeshProtocol;
  focusedIdentityId: string | null;
  meshtasticIdentityId: string | null;
  meshcoreIdentityId: string | null;
  connection: ProtocolConnectionActions;
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
export function useProtocolFacade(
  protocol: MeshProtocol,
  meshtastic: UseDeviceReturn,
  meshcore: UseMeshCoreReturn,
): ProtocolFacade {
  const { meshtasticIdentityId, meshcoreIdentityId, focusedIdentityId } =
    useActiveMeshIdentity(protocol);
  const connection = useProtocolConnectionActions(protocol, meshtastic, meshcore);
  const legacy = protocol === 'meshcore' ? meshcore : meshtastic;
  const connectionView = useLegacyConnectionView(focusedIdentityId, legacy);
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
