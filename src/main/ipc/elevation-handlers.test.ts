import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleMap = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handleMap.set(channel, fn);
    },
  },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

vi.mock('../elevation/elevation-service', () => ({
  createElevationService: () => ({
    sampleProfile: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        samples: [],
        totalDistanceM: 0,
        frequencyMhz: 915,
        antennaHeightStartM: 2,
        antennaHeightEndM: 2,
        clearance: 'unknown',
        minClearanceM: null,
        usedNetwork: false,
        fullyOffline: true,
      },
    }),
    estimateHgt: vi.fn().mockResolvedValue({
      ok: true,
      data: { tileNames: ['N39W105'], missingTileNames: ['N39W105'], missingBytes: 1 },
    }),
    downloadHgt: vi.fn().mockResolvedValue({ ok: true, data: { completed: 1, failed: 0 } }),
    cancelDownload: vi.fn(),
    cacheStats: vi.fn().mockResolvedValue({ sampleEntries: 0, hgtTiles: 0, hgtBytes: 0 }),
    clearCache: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('elevation IPC handlers', () => {
  beforeEach(async () => {
    handleMap.clear();
    vi.resetModules();
    const { registerElevationIpcHandlers, resetElevationServiceForTests } =
      await import('./elevation-handlers');
    resetElevationServiceForTests();
    registerElevationIpcHandlers({
      getAppVersion: () => 'test',
      userDataPath: '/tmp/elevation-test',
      getMainWindow: () => null,
    });
  });

  it('rejects invalid sampleProfile requests', async () => {
    const res = await handleMap.get('elevation:sampleProfile')!({}, { start: { lat: 1 } });
    expect(res).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: 'invalid_request' },
    });
  });

  it('accepts a valid sampleProfile request', async () => {
    const res = await handleMap.get('elevation:sampleProfile')!(
      {},
      {
        start: { lat: 39.7, lon: -105.0 },
        end: { lat: 40.0, lon: -105.2 },
      },
    );
    expect(res).toMatchObject({ ok: true });
  });

  it('rejects oversized HGT bounds', async () => {
    const res = await handleMap.get('elevation:estimateHgt')!(
      {},
      {
        south: 0,
        west: 0,
        north: 20,
        east: 20,
      },
    );
    expect(res).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });
});
