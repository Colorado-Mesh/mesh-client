import { describe, expect, it, vi } from 'vitest';

import {
  resolvePanelPositionSendHandler,
  resolvePanelRebootHandler,
  resolvePanelSetOwnerHandler,
} from './appPanelHandlerSelection';

const meshtasticCapabilities = {
  hasFullPositionConfig: true,
  hasCompanionContactManagementConfig: false,
  hasMeshcomDeviceCommands: false,
  hasShutdown: true,
  hasChannelConfig: true,
};
const meshcoreCapabilities = {
  hasFullPositionConfig: false,
  hasCompanionContactManagementConfig: true,
  hasMeshcomDeviceCommands: false,
  hasShutdown: false,
  hasChannelConfig: false,
};
const unsupportedCapabilities = {
  hasFullPositionConfig: false,
  hasCompanionContactManagementConfig: false,
  hasMeshcomDeviceCommands: false,
  hasShutdown: false,
  hasChannelConfig: false,
};
const meshcomCapabilities = {
  hasFullPositionConfig: false,
  hasCompanionContactManagementConfig: false,
  hasMeshcomDeviceCommands: true,
  hasShutdown: false,
  hasChannelConfig: false,
};

describe('App panel handler selection', () => {
  it('selects position handlers by capabilities', () => {
    const meshtastic = vi.fn();
    const meshcore = vi.fn();
    const meshcom = vi.fn();

    expect(resolvePanelPositionSendHandler(meshtasticCapabilities, meshtastic, meshcore)).toBe(
      meshtastic,
    );
    expect(resolvePanelPositionSendHandler(meshcoreCapabilities, meshtastic, meshcore)).toBe(
      meshcore,
    );
    expect(
      resolvePanelPositionSendHandler(meshcomCapabilities, meshtastic, meshcore, meshcom),
    ).toBe(meshcom);
    expect(
      resolvePanelPositionSendHandler(unsupportedCapabilities, meshtastic, meshcore),
    ).toBeUndefined();
  });

  it('selects reboot handlers by capabilities', () => {
    const meshtastic = vi.fn();
    const meshcore = vi.fn();
    const unsupported = vi.fn();

    expect(
      resolvePanelRebootHandler(meshtasticCapabilities, meshtastic, meshcore, unsupported),
    ).toBe(meshtastic);
    expect(resolvePanelRebootHandler(meshcoreCapabilities, meshtastic, meshcore, unsupported)).toBe(
      meshcore,
    );
    expect(
      resolvePanelRebootHandler(unsupportedCapabilities, meshtastic, meshcore, unsupported),
    ).toBe(unsupported);
  });

  it('selects setOwner handlers by capabilities', () => {
    const meshtastic = vi.fn();
    const meshcore = vi.fn();
    const meshcom = vi.fn();

    expect(resolvePanelSetOwnerHandler(meshtasticCapabilities, meshtastic, meshcore)).toBe(
      meshtastic,
    );
    expect(resolvePanelSetOwnerHandler(meshcoreCapabilities, meshtastic, meshcore)).toBe(meshcore);
    expect(resolvePanelSetOwnerHandler(meshcomCapabilities, meshtastic, meshcore, meshcom)).toBe(
      meshcom,
    );
    expect(
      resolvePanelSetOwnerHandler(unsupportedCapabilities, meshtastic, meshcore),
    ).toBeUndefined();
  });
});
