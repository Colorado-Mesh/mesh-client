import { useMeshCore } from './useMeshCore';

/** MeshCore panel callbacks backed by the legacy hook (companion RF + MQTT side effects). */
export function useMeshcorePanelActions() {
  const device = useMeshCore();
  return {
    setConfig: device.setConfig,
    commitConfig: device.commitConfig,
    setDeviceChannel: device.setDeviceChannel,
    clearChannel: device.clearChannel,
    reboot: device.reboot,
    shutdown: device.shutdown,
    factoryReset: device.factoryReset,
    resetNodeDb: device.resetNodeDb,
    sendPositionToDevice: device.sendPositionToDevice,
    setOwner: device.setOwner,
    traceRoute: device.traceRoute,
    refreshOurPosition: device.refreshOurPosition,
    sendWaypoint: device.sendWaypoint,
    deleteWaypoint: device.deleteWaypoint,
    importContacts: device.importContacts,
    refreshContacts: device.refreshContacts,
    sendAdvert: device.sendAdvert,
    syncClock: device.syncClock,
    meshcoreSetChannel: device.setMeshcoreChannel,
    meshcoreDeleteChannel: device.deleteMeshcoreChannel,
    applyMeshcoreContactAutoAdd: device.applyMeshcoreContactAutoAdd,
    applyMeshcoreTelemetryPrivacy: device.applyMeshcoreTelemetryPrivacyPolicy,
    getPickerStyleNodeLabel: device.getPickerStyleNodeLabel,
  };
}
