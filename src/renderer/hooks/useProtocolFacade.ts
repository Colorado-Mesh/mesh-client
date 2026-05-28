import { useMemo } from 'react';

import type { MeshProtocol } from '../lib/types';
import { useActiveMeshIdentity } from './useActiveMeshIdentity';
import { useConnectionQueue } from './useConnectionStatus';
import { useConnectionView } from './useConnectionView';
import type { DualProtocolPanelActions } from './useDualProtocolPanelActions';
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
  connectionView: ReturnType<typeof useConnectionView>;
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
  panelPrebuilt: DualProtocolPanelActions,
): ProtocolFacade {
  const { meshtasticIdentityId, meshcoreIdentityId, focusedIdentityId } =
    useActiveMeshIdentity(protocol);
  const connection = useProtocolConnectionActions(protocol);
  const connectionView = useConnectionView(focusedIdentityId);
  const queue = useConnectionQueue(focusedIdentityId);
  const panel = usePanelActions(protocol, focusedIdentityId, panelPrebuilt);
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
