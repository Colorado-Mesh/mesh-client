import { describe, expect, it } from 'vitest';

import {
  formatMeshcomInstalledFirmware,
  meshcomFirmwareDisplay,
  meshcomHwDisplay,
  meshcomHwLabel,
} from './meshcomHwIds';

describe('meshcomHwIds', () => {
  it('labels known and unknown hardware ids', () => {
    expect(meshcomHwLabel(43)).toBe('HELTEC-V3');
    expect(meshcomHwLabel(47)).toBe('TBEAM-SUP');
    expect(meshcomHwLabel(61)).toBe('T-WATCH-S3');
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

  it('formats installed firmware as MeshCom-Firmware release tags', () => {
    expect(formatMeshcomInstalledFirmware('4.40 a', '20261122-065703')).toBe('4.40a.11.22');
    expect(formatMeshcomInstalledFirmware('4.40 a')).toBe('4.40a');
    expect(formatMeshcomInstalledFirmware('4.40a (build: Nov 22 2026 / 14:30:00)')).toBe(
      '4.40a.11.22',
    );
    expect(formatMeshcomInstalledFirmware('4.40 a (build: Mar 5 2026)')).toBe('4.40a.03.05');
    expect(formatMeshcomInstalledFirmware('4.40a-rm5', '20261122-065703')).toBe('4.40a.11.22-rm5');
    expect(formatMeshcomInstalledFirmware('4.40a.11.22')).toBe('4.40a.11.22');
    expect(formatMeshcomInstalledFirmware(undefined, '20261122-065703')).toBe('11.22');
    expect(formatMeshcomInstalledFirmware(null)).toBeNull();
  });
});
