import { useMemo } from 'react';

import type { UseDeviceReturn } from './legacyHookTypes';

/** Meshtastic panel callbacks backed by a single App-mounted legacy instance. */
export function useMeshtasticPanelActions(device: UseDeviceReturn) {
  return useMemo(
    () => ({
      setConfig: device.setConfig,
      commitConfig: device.commitConfig,
      setDeviceChannel: device.setDeviceChannel,
      clearChannel: device.clearChannel,
      applyChannelSet: device.applyChannelSet,
      reboot: device.reboot,
      shutdown: device.shutdown,
      factoryReset: device.factoryReset,
      resetNodeDb: device.resetNodeDb,
      sendPositionToDevice: device.sendPositionToDevice,
      setOwner: device.setOwner,
      rebootOta: device.rebootOta,
      enterDfuMode: device.enterDfuMode,
      factoryResetConfig: device.factoryResetConfig,
      traceRoute: device.traceRoute,
      setConfigureTargetNodeNum: device.setConfigureTargetNodeNum,
      refreshRemoteConfigSnapshot: device.refreshRemoteConfigSnapshot,
      getRemoteAdminSessionStatus: device.getRemoteAdminSessionStatus,
      getNodeName: device.getNodeName,
      getPickerStyleNodeLabel: device.getPickerStyleNodeLabel,
      refreshOurPosition: device.refreshOurPosition,
      sendWaypoint: device.sendWaypoint,
      deleteWaypoint: device.deleteWaypoint,
      requestPosition: device.requestPosition,
      setModuleConfig: device.setModuleConfig,
      setCannedMessages: device.setCannedMessages,
      setRingtone: device.setRingtone,
      getNodes: device.getNodes,
      sendReaction: device.sendReaction,
      requestStoreForwardHistory: device.requestStoreForwardHistory,
      requestRefresh: device.requestRefresh,
      setNodeFavorited: device.setNodeFavorited,
      deleteNode: device.deleteNode,
      clearRawPackets: device.clearRawPackets,
    }),
    [device],
  );
}
