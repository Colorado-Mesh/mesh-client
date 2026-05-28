import { useMemo } from 'react';

import type { MeshtasticRuntime } from '../runtime/runtimeTypes';

/** Meshtastic panel callbacks backed by the App-mounted protocol runtime. */
export function useMeshtasticPanelActions(runtime: MeshtasticRuntime) {
  return useMemo(
    () => ({
      setConfig: runtime.setConfig,
      commitConfig: runtime.commitConfig,
      setDeviceChannel: runtime.setDeviceChannel,
      clearChannel: runtime.clearChannel,
      applyChannelSet: runtime.applyChannelSet,
      reboot: runtime.reboot,
      shutdown: runtime.shutdown,
      factoryReset: runtime.factoryReset,
      resetNodeDb: runtime.resetNodeDb,
      sendPositionToDevice: runtime.sendPositionToDevice,
      setOwner: runtime.setOwner,
      rebootOta: runtime.rebootOta,
      enterDfuMode: runtime.enterDfuMode,
      factoryResetConfig: runtime.factoryResetConfig,
      traceRoute: runtime.traceRoute,
      setConfigureTargetNodeNum: runtime.setConfigureTargetNodeNum,
      refreshRemoteConfigSnapshot: runtime.refreshRemoteConfigSnapshot,
      getRemoteAdminSessionStatus: runtime.getRemoteAdminSessionStatus,
      getNodeName: runtime.getNodeName,
      getPickerStyleNodeLabel: runtime.getPickerStyleNodeLabel,
      refreshOurPosition: runtime.refreshOurPosition,
      sendWaypoint: runtime.sendWaypoint,
      deleteWaypoint: runtime.deleteWaypoint,
      requestPosition: runtime.requestPosition,
      setModuleConfig: runtime.setModuleConfig,
      setCannedMessages: runtime.setCannedMessages,
      setRingtone: runtime.setRingtone,
      getNodes: runtime.getNodes,
      sendReaction: runtime.sendReaction,
      requestStoreForwardHistory: runtime.requestStoreForwardHistory,
      requestRefresh: runtime.requestRefresh,
      setNodeFavorited: runtime.setNodeFavorited,
      deleteNode: runtime.deleteNode,
      clearRawPackets: runtime.clearRawPackets,
      refreshNodesFromDb: runtime.refreshNodesFromDb,
      refreshMessagesFromDb: runtime.refreshMessagesFromDb,
      getFullNodeLabel: runtime.getFullNodeLabel,
    }),
    [runtime],
  );
}
