// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const README = readFileSync(join(__dirname, '../../README.md'), 'utf-8');
const NOBLE_MANAGER = readFileSync(join(__dirname, 'noble-ble-manager.ts'), 'utf-8');

describe('Linux BLE guidance contracts (regression)', () => {
  it('documents release guidance for extracted binaries and AppImage limitations', () => {
    expect(README).toContain('Scenario 2: Running a Downloaded Release Binary');
    expect(README).toContain('For extracted archives (`.tar.gz`, `.zip`, or `linux-unpacked`)');
    expect(README).toContain('You cannot apply `setcap` directly to an AppImage');
  });

  it('keeps runtime capability error wording aligned with release guidance', () => {
    expect(NOBLE_MANAGER).toContain('For release builds, run setcap on the extracted executable');
    expect(NOBLE_MANAGER).toContain('not the .AppImage wrapper');
  });

  it('retains Fedora fallback instructions for ambient-cap launch', () => {
    expect(README).toContain('Fedora troubleshooting: `libffmpeg.so` missing after `setcap`');
    expect(README).toContain('sudo setcap -r ./node_modules/electron/dist/electron');
    expect(README).toContain('--ambient-caps +net_raw');
  });
});
