import { describe, expect, it } from 'vitest';

import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { PROTOCOL_THEME } from './protocolTheme';

describe('protocolTheme', () => {
  it('defines theme for every registered protocol', () => {
    for (const protocol of REGISTERED_MESH_PROTOCOLS) {
      expect(PROTOCOL_THEME[protocol]).toBeDefined();
      expect(PROTOCOL_THEME[protocol].displayName.length).toBeGreaterThan(0);
      expect(PROTOCOL_THEME[protocol].unreadBadgeFillClass).toMatch(/^bg-/);
    }
  });

  it('gives every protocol a unique two-letter rail monogram', () => {
    const monograms = REGISTERED_MESH_PROTOCOLS.map((p) => PROTOCOL_THEME[p].monogram);
    expect(monograms).toEqual(['MT', 'MC']);
    expect(new Set(monograms).size).toBe(monograms.length);
  });

  it('keeps protocol identity colors fixed, independent of the themeable accent', () => {
    for (const theme of Object.values(PROTOCOL_THEME)) {
      expect(theme.railActiveClass).not.toMatch(/brand-green|bright-green/);
      expect(theme.nameTextClass).not.toMatch(/brand-green|bright-green/);
    }
    expect(PROTOCOL_THEME.meshtastic.railActiveClass).toContain('meshtastic-500');
  });

  it('uses the style guide scale tokens: 500 on the rail, 700 under white badge text', () => {
    for (const protocol of REGISTERED_MESH_PROTOCOLS) {
      expect(PROTOCOL_THEME[protocol].railActiveClass).toContain(`text-${protocol}-500`);
      expect(PROTOCOL_THEME[protocol].nameTextClass).toBe(`text-${protocol}-500`);
      expect(PROTOCOL_THEME[protocol].unreadBadgeFillClass).toBe(`bg-${protocol}-700 text-white`);
    }
  });

  // Contrast of the scale steps themselves is checked against styles.css in styleTokens.test.ts.
});
