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

  it('meshcore unread badge uses accessible cyan fill for contrast', () => {
    expect(PROTOCOL_THEME.meshcore.unreadBadgeFillClass).toBe('bg-cyan-800 text-white');
    expect(PROTOCOL_THEME.meshcore.railActiveClass).toContain('cyan');
    expect(contrastRatio('#ffffff', '#155e75')).toBeGreaterThanOrEqual(4.5);
  });

  it('reticulum unread badge uses accessible amber fill for contrast', () => {
    expect(PROTOCOL_THEME.reticulum.unreadBadgeFillClass).toBe('bg-amber-800 text-white');
    expect(PROTOCOL_THEME.reticulum.railActiveClass).toContain('amber');
    expect(contrastRatio('#ffffff', '#92400e')).toBeGreaterThanOrEqual(4.5);
  });

  it('active rail monograms keep 4.5:1 on the tinted rail button', () => {
    // Tint is ~15% of the accent over slate-900; checking against slate-800 is the stricter case.
    expect(contrastRatio('#86efac', '#1e293b')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#22d3ee', '#1e293b')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#fbbf24', '#1e293b')).toBeGreaterThanOrEqual(4.5);
  });
});
