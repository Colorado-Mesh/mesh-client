import { useMemo } from 'react';

import type { ReticulumRuntime } from '../runtime/useReticulumRuntime';

/** Reticulum panel callbacks backed by the App-mounted protocol runtime. */
export function useReticulumPanelActions(runtime: ReticulumRuntime) {
  return useMemo(
    () => ({
      getFullNodeLabel: runtime.getFullNodeLabel,
      getPickerStyleNodeLabel: runtime.getPickerStyleNodeLabel,
      refreshNodesFromDb: runtime.refreshNodesFromDb,
      refreshMessagesFromDb: runtime.refreshMessagesFromDb,
      requestRefresh: runtime.requestRefresh,
      setNodeFavorited: runtime.setNodeFavorited,
      sendReaction: runtime.sendReaction,
      sendAttachment: runtime.sendAttachment,
      handleSidecarEvent: runtime.handleSidecarEvent,
      clearRawPackets: runtime.clearRawPackets,
    }),
    [runtime],
  );
}
