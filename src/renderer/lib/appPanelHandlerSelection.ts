import type { ProtocolCapabilities } from './radio/BaseRadioProvider';

type HandlerSelectionCapabilities = Pick<
  ProtocolCapabilities,
  | 'hasFullPositionConfig'
  | 'hasCompanionContactManagementConfig'
  | 'hasMeshcomDeviceCommands'
  | 'hasShutdown'
  | 'hasChannelConfig'
>;

export function resolvePanelPositionSendHandler<T>(
  capabilities: HandlerSelectionCapabilities,
  meshtasticHandler: T,
  meshcoreHandler: T,
  meshcomHandler?: T,
): T | undefined {
  if (capabilities.hasFullPositionConfig) return meshtasticHandler;
  if (capabilities.hasCompanionContactManagementConfig) return meshcoreHandler;
  if (capabilities.hasMeshcomDeviceCommands) return meshcomHandler;
  return undefined;
}

export function resolvePanelRebootHandler<T>(
  capabilities: HandlerSelectionCapabilities,
  meshtasticHandler: T,
  meshcoreHandler: T,
  unsupportedHandler: T,
): T {
  if (capabilities.hasShutdown) return meshtasticHandler;
  if (capabilities.hasCompanionContactManagementConfig) return meshcoreHandler;
  return unsupportedHandler;
}

/** Radio Device User/Identity Apply — MeshCore setAdvertName; Meshtastic setOwner; MeshCom --setcall. */
export function resolvePanelSetOwnerHandler<T>(
  capabilities: HandlerSelectionCapabilities,
  meshtasticHandler: T,
  meshcoreHandler: T,
  meshcomHandler?: T,
): T | undefined {
  if (capabilities.hasCompanionContactManagementConfig) return meshcoreHandler;
  if (capabilities.hasChannelConfig) return meshtasticHandler;
  if (capabilities.hasMeshcomDeviceCommands) return meshcomHandler;
  return undefined;
}
