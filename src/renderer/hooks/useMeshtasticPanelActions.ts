import { useDevice } from './useDevice';

/** Meshtastic panel callbacks still backed by the legacy hook until remote-admin paths move to protocol APIs. */
export function useMeshtasticPanelActions() {
  const device = useDevice();
  return {
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
    getNodes: device.getNodes,
  };
}
