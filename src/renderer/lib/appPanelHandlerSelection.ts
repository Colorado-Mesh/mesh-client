import type { ProtocolCapabilities } from './radio/BaseRadioProvider';

type HandlerSelectionCapabilities = Pick<
  ProtocolCapabilities,
  | 'hasFullPositionConfig'
  | 'hasCompanionContactManagementConfig'
  | 'hasShutdown'
  | 'hasChannelConfig'
>;

export function resolvePanelPositionSendHandler<T>(
  capabilities: HandlerSelectionCapabilities,
  meshtasticHandler: T,
  meshcoreHandler: T,
): T | undefined {
  if (capabilities.hasFullPositionConfig) return meshtasticHandler;
  if (capabilities.hasCompanionContactManagementConfig) return meshcoreHandler;
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

/** Radio Device User/Identity Apply — MeshCore uses setAdvertName; Meshtastic uses setOwner. */
export function resolvePanelSetOwnerHandler<T>(
  capabilities: HandlerSelectionCapabilities,
  meshtasticHandler: T,
  meshcoreHandler: T,
): T | undefined {
  if (capabilities.hasCompanionContactManagementConfig) return meshcoreHandler;
  if (capabilities.hasChannelConfig) return meshtasticHandler;
  return undefined;
}
