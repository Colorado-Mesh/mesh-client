import { describe, expect, it, vi } from 'vitest';

import {
  resolvePanelPositionSendHandler,
  resolvePanelRebootHandler,
} from './appPanelHandlerSelection';

const meshtasticCapabilities = {
  hasFullPositionConfig: true,
  hasCompanionContactManagementConfig: false,
  hasShutdown: true,
};
const meshcoreCapabilities = {
  hasFullPositionConfig: false,
  hasCompanionContactManagementConfig: true,
  hasShutdown: false,
};
const unsupportedCapabilities = {
  hasFullPositionConfig: false,
  hasCompanionContactManagementConfig: false,
  hasShutdown: false,
};

describe('App panel handler selection', () => {
  it('selects position handlers by capabilities', () => {
    const meshtastic = vi.fn();
    const meshcore = vi.fn();

    expect(resolvePanelPositionSendHandler(meshtasticCapabilities, meshtastic, meshcore)).toBe(
      meshtastic,
    );
    expect(resolvePanelPositionSendHandler(meshcoreCapabilities, meshtastic, meshcore)).toBe(
      meshcore,
    );
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
});
