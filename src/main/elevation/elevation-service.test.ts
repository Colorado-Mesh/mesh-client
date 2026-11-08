import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const netHarness = { isOnline: true };

vi.mock('electron', () => ({
  net: {
    isOnline: () => netHarness.isOnline,
  },
}));

import { createElevationService } from './elevation-service';

describe('createElevationService sampleProfile', () => {
  let userDataPath: string;

  beforeEach(() => {
    netHarness.isOnline = true;
    userDataPath = mkdtempSync(path.join(tmpdir(), 'elevation-svc-'));
  });

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true });
  });

  it('does not treat Node navigator.onLine=undefined as offline (uses net.isOnline)', async () => {
    // Regression: Node exposes global navigator with onLine undefined (falsy).
    expect(typeof navigator).toBe('object');
    expect(navigator.onLine).toBeUndefined();
    netHarness.isOnline = true;

    const elev = Array.from({ length: 64 }, () => 1600);
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ elevation: elev }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const svc = createElevationService({
      getAppVersion: () => '0.0.0-test',
      userDataPath,
      fetchImpl,
    });

    const res = await svc.sampleProfile({
      start: { lat: 39.7, lon: -105.0 },
      end: { lat: 39.75, lon: -104.95 },
      frequencyMhz: 915,
      antennaHeightStartM: 2,
      antennaHeightEndM: 2,
      sampleCount: 16,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usedNetwork).toBe(true);
    expect(res.data.samples.some((s) => s.elevationM != null)).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('returns offline when Electron reports offline and no local DEM', async () => {
    netHarness.isOnline = false;
    const fetchImpl = vi.fn();
    const svc = createElevationService({
      getAppVersion: () => '0.0.0-test',
      userDataPath,
      fetchImpl,
    });

    const res = await svc.sampleProfile({
      start: { lat: 39.7, lon: -105.0 },
      end: { lat: 39.75, lon: -104.95 },
      frequencyMhz: 915,
      sampleCount: 16,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('offline');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honors deps.isOnline over net.isOnline', async () => {
    netHarness.isOnline = true;
    const fetchImpl = vi.fn();
    const svc = createElevationService({
      getAppVersion: () => '0.0.0-test',
      userDataPath,
      fetchImpl,
      isOnline: () => false,
    });

    const res = await svc.sampleProfile({
      start: { lat: 39.7, lon: -105.0 },
      end: { lat: 39.75, lon: -104.95 },
      sampleCount: 8,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('offline');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
