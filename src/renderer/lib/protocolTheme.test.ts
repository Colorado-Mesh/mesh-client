import { describe, expect, it } from 'vitest';

import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { PROTOCOL_THEME, protocolHeaderBorderClass } from './protocolTheme';

describe('protocolTheme', () => {
  it('defines theme for every registered protocol', () => {
    for (const protocol of REGISTERED_MESH_PROTOCOLS) {
      expect(PROTOCOL_THEME[protocol]).toBeDefined();
      expect(PROTOCOL_THEME[protocol].displayName.length).toBeGreaterThan(0);
      expect(PROTOCOL_THEME[protocol].unreadBadgeFillClass).toMatch(/^bg-/);
    }
  });

  it('protocolHeaderBorderClass uses gray when not configured', () => {
    expect(protocolHeaderBorderClass('meshtastic', false)).toBe('border-gray-700');
    expect(protocolHeaderBorderClass('meshcore', false)).toBe('border-gray-700');
  });

  it('protocolHeaderBorderClass uses protocol accent when configured', () => {
    expect(protocolHeaderBorderClass('meshtastic', true)).toBe(
      PROTOCOL_THEME.meshtastic.headerBorderConfigured,
    );
    expect(protocolHeaderBorderClass('meshcore', true)).toBe(
      PROTOCOL_THEME.meshcore.headerBorderConfigured,
    );
  });
});
