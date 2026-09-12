import { useMemo } from 'react';

import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { IdentityId, MeshProtocol } from '../lib/types';
import { useActiveMeshIdentity } from './useActiveMeshIdentity';
import type { PanelActionsByProtocol } from './useAllProtocolPanelActions';
import { useConnectionQueue } from './useConnectionStatus';
import { useConnectionView } from './useConnectionView';
import { useMessages } from './useMessages';
import { useNodes } from './useNodes';
import { type PanelActionsBundle, usePanelActions } from './usePanelActions';
import { useProtocolConnectionActions } from './useProtocolConnection';

export interface ProtocolFacade {
  protocol: MeshProtocol;
  focusedIdentityId: IdentityId | null;
  identityIdByProtocol: Record<MeshProtocol, IdentityId | null>;
  reticulumIdentityId: IdentityId | null;
  capabilities: ProtocolCapabilities;
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
  panelPrebuilt: PanelActionsByProtocol,
): ProtocolFacade {
  const { identityIdByProtocol, focusedIdentityId, capabilities } = useActiveMeshIdentity(protocol);
  const reticulumIdentityId = identityIdByProtocol.reticulum;
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
      identityIdByProtocol,
      reticulumIdentityId,
      capabilities,
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
      identityIdByProtocol,
      reticulumIdentityId,
      capabilities,
      connection,
      connectionView,
      queue,
      panel,
      nodes,
      messages,
    ],
  );
}
