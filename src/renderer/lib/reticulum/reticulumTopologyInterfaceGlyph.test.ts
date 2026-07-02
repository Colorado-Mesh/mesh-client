import { describe, expect, it } from 'vitest';

import { normalizeReticulumInterfaceGlyphType } from './reticulumTopologyInterfaceGlyph';

describe('normalizeReticulumInterfaceGlyphType', () => {
  it('maps interface type strings to glyph categories', () => {
    expect(normalizeReticulumInterfaceGlyphType('WifiInterface')).toBe('wifi');
    expect(normalizeReticulumInterfaceGlyphType('RNodeInterface')).toBe('lora');
    expect(normalizeReticulumInterfaceGlyphType('TCPClientInterface')).toBe('tcp');
    expect(normalizeReticulumInterfaceGlyphType('SerialInterface')).toBe('serial');
    expect(normalizeReticulumInterfaceGlyphType('')).toBe('tcp');
  });
});
