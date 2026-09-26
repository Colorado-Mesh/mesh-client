import { describe, expect, it } from 'vitest';

import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { PROTOCOL_THEME } from './protocolTheme';
import { contrastRatio } from './wcagContrast';

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
    expect(monograms).toEqual(['MT', 'MC', 'RN']);
    expect(new Set(monograms).size).toBe(monograms.length);
  });

  it('keeps protocol identity colors fixed, independent of the themeable accent', () => {
    for (const theme of Object.values(PROTOCOL_THEME)) {
      expect(theme.railActiveClass).not.toMatch(/brand-green|bright-green/);
      expect(theme.nameTextClass).not.toMatch(/brand-green|bright-green/);
    }
    expect(PROTOCOL_THEME.meshtastic.railActiveClass).toContain('emerald-300');
  });

  it('meshtastic unread badge uses the emerald-700 fill under white text', () => {
    expect(PROTOCOL_THEME.meshtastic.unreadBadgeFillClass).toBe('bg-emerald-700 text-white');
    expect(contrastRatio('#ffffff', '#047857')).toBeGreaterThanOrEqual(4.5);
  });

  it('meshcore unread badge uses accessible cyan fill for contrast', () => {
    expect(PROTOCOL_THEME.meshcore.unreadBadgeFillClass).toBe('bg-cyan-700 text-white');
    expect(PROTOCOL_THEME.meshcore.railActiveClass).toContain('cyan');
    expect(contrastRatio('#ffffff', '#0e7490')).toBeGreaterThanOrEqual(4.5);
  });

  it('reticulum uses the yellow scale (not amber, which reads as caution)', () => {
    expect(PROTOCOL_THEME.reticulum.unreadBadgeFillClass).toBe('bg-yellow-700 text-white');
    expect(PROTOCOL_THEME.reticulum.railActiveClass).toContain('yellow-400');
    expect(PROTOCOL_THEME.reticulum.railActiveClass).not.toContain('amber');
    expect(contrastRatio('#ffffff', '#a16207')).toBeGreaterThanOrEqual(4.5);
  });

  it('active rail monograms keep 4.5:1 on the tinted rail button', () => {
    // Tint is ~15% of the accent over zinc-900; checking against zinc-800 is the stricter case.
    expect(contrastRatio('#6ee7b7', '#27272a')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#22d3ee', '#27272a')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#facc15', '#27272a')).toBeGreaterThanOrEqual(4.5);
  });
});
