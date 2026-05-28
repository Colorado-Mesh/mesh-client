import { describe, expect, it } from 'vitest';

import { getProtocolRegistration, listRegisteredProtocols } from './protocolRegistry';

describe('protocolRegistry', () => {
  it('lists meshtastic and meshcore registrations', () => {
    const types = listRegisteredProtocols().map((r) => r.type);
    expect(types).toContain('meshtastic');
    expect(types).toContain('meshcore');
  });

  it('returns null for unknown protocol type', () => {
    expect(getProtocolRegistration('reticulum')).toBeNull();
  });

  it('exposes protocol instances with capabilities', () => {
    const reg = getProtocolRegistration('meshtastic');
    expect(reg?.protocol.type).toBe('meshtastic');
    expect(reg?.capabilities.hasRemoteAdmin).toBe(true);
  });

  it('sets MeshCore-specific UI capability flags', () => {
    const meshcore = getProtocolRegistration('meshcore');
    expect(meshcore?.capabilities.nodeListTabUsesContactsLabel).toBe(true);
    expect(meshcore?.capabilities.modulesTabUsesRepeatersLabel).toBe(true);
    expect(meshcore?.capabilities.hasJsonRadioConfigImport).toBe(true);
    const meshtastic = getProtocolRegistration('meshtastic');
    expect(meshtastic?.capabilities.nodeListTabUsesContactsLabel).toBe(false);
    expect(meshtastic?.capabilities.modulesTabUsesRepeatersLabel).toBe(false);
  });
});
