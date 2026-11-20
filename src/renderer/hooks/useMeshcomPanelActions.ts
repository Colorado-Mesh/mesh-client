import { useMemo } from 'react';

import type { MeshcomRuntime } from '../runtime/useMeshcomRuntime';

/** MeshCom panel callbacks backed by the App-mounted protocol runtime. */
export function useMeshcomPanelActions(runtime: MeshcomRuntime) {
  return useMemo(
    () => ({
      getFullNodeLabel: runtime.getFullNodeLabel,
      getPickerStyleNodeLabel: runtime.getPickerStyleNodeLabel,
      refreshNodesFromDb: runtime.refreshNodesFromDb,
      refreshMessagesFromDb: runtime.refreshMessagesFromDb,
      requestRefresh: runtime.requestRefresh,
      refreshOurPosition: runtime.refreshOurPosition,
      setOwner: runtime.setOwner,
      sendPositionToDevice: runtime.sendPositionToDevice,
      setNodeFavorited: runtime.setNodeFavorited,
      // ProtocolRuntime types deleteNode optional; MeshCom always provides it.
      deleteNode: runtime.deleteNode as (nodeId: number) => Promise<void>,
      sendReaction: runtime.sendReaction,
      clearRawPackets: runtime.clearRawPackets,
      hydrateRawPackets: runtime.hydrateRawPackets,
      deviceCommands: runtime.deviceCommands,
    }),
    [runtime],
  );
}
