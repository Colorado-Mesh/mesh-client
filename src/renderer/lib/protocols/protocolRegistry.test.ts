import { describe, expect, it } from 'vitest';

import { getProtocolRegistration, listRegisteredProtocols } from './protocolRegistry';

describe('protocolRegistry', () => {
  it('lists meshtastic, meshcore, and reticulum registrations', () => {
    const types = listRegisteredProtocols().map((r) => r.type);
    expect(types).toContain('meshtastic');
    expect(types).toContain('meshcore');
    expect(types).toContain('reticulum');
  });

  it('returns null for unknown protocol type', () => {
    expect(getProtocolRegistration('not-a-protocol')).toBeNull();
  });

  it('exposes protocol instances with capabilities', () => {
    const reg = getProtocolRegistration('meshtastic');
    expect(reg?.protocol.type).toBe('meshtastic');
    expect(reg?.capabilities.hasRemoteAdmin).toBe(true);
  });

  it('sets Reticulum-specific UI capability flags', () => {
    const reticulum = getProtocolRegistration('reticulum');
    expect(reticulum?.capabilities.hasReticulumInterfaceConfig).toBe(true);
    expect(reticulum?.capabilities.hasReticulumNetworkPanel).toBe(true);
    expect(reticulum?.capabilities.nodeListTabUsesContactsLabel).toBe(false);
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
