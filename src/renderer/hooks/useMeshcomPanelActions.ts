import { useMemo } from 'react';

import type { MeshcomRuntime } from '../runtime/useMeshcomRuntime';

/** MeshCom panel callbacks backed by the App-mounted protocol runtime. */
export function useMeshcomPanelActions(runtime: MeshcomRuntime) {
  // Depend on the individual callbacks — MeshCom's runtime object identity churns with
  // MQTT/messages/nodes; pinning `[runtime]` alone has left Contacts holding a stale
  // setNodeFavorited after debug/HMR cycles.
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
    [
      runtime.clearRawPackets,
      runtime.deleteNode,
      runtime.deviceCommands,
      runtime.getFullNodeLabel,
      runtime.getPickerStyleNodeLabel,
      runtime.hydrateRawPackets,
      runtime.refreshMessagesFromDb,
      runtime.refreshNodesFromDb,
      runtime.refreshOurPosition,
      runtime.requestRefresh,
      runtime.sendPositionToDevice,
      runtime.sendReaction,
      runtime.setNodeFavorited,
      runtime.setOwner,
    ],
  );
}
