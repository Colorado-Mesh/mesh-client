import { describe, expect, it } from 'vitest';

import { meshcomFirmwareDisplay, meshcomHwDisplay, meshcomHwLabel } from './meshcomHwIds';

describe('meshcomHwIds', () => {
  it('labels known and unknown hardware ids', () => {
    expect(meshcomHwLabel(43)).toBe('HELTEC-V3');
    expect(meshcomHwLabel(999)).toBe('HW#999');
    expect(meshcomHwLabel(undefined)).toBe('');
  });

  it('expands stored abbreviations for node detail', () => {
    expect(meshcomHwDisplay('HELTEC-V3')).toContain('HELTEC-V3');
    expect(meshcomHwDisplay('HELTEC-V3')).toContain('WiFi LoRa 32 v3');
    expect(meshcomHwDisplay('HW#99')).toBe('HW#99');
    expect(meshcomHwDisplay('')).toBeNull();
    expect(meshcomHwDisplay(undefined)).toBeNull();
  });

  it('formats firmware with optional sub', () => {
    expect(meshcomFirmwareDisplay('4.35p')).toBe('4.35p');
    expect(meshcomFirmwareDisplay(4.4, 'beta')).toBe('4.4 (beta)');
    expect(meshcomFirmwareDisplay(null, 'only')).toBe('only');
    expect(meshcomFirmwareDisplay(undefined)).toBeNull();
  });
});
