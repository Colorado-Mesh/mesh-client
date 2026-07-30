// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isReticulumBleRnodeInterfaceRow,
  isReticulumBleRnodeOnline,
} from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import {
  prepareReticulumBleRnodeConnect,
  releaseReticulumBleRnodeConnect,
} from '@/renderer/lib/reticulum/reticulumBleAdapterLease';
import {
  type ReticulumNobleBleYieldMutableState,
  syncReticulumNobleBleYield,
} from '@/renderer/lib/reticulum/reticulumNobleBleYield';

vi.mock('@/renderer/lib/reticulum/reticulumBleAdapterLease', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    prepareReticulumBleRnodeConnect: vi.fn().mockResolvedValue(true),
    releaseReticulumBleRnodeConnect: vi.fn().mockResolvedValue(undefined),
  };
});

describe('syncReticulumNobleBleYield', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.bleCoexistence.getState).mockResolvedValue({
      connections: [],
      scanOwner: null,
    });
    vi.mocked(prepareReticulumBleRnodeConnect).mockClear();
    vi.mocked(releaseReticulumBleRnodeConnect).mockClear();
  });

  const BLE_ROW = {
    id: 'ble-rnode',
    name: 'BLE RNode',
    type: 'rnode',
    enabled: true,
    status: 'down',
    serial_port: 'ble://AA:BB:CC:DD:EE:FF',
  };

  it('prepares yield when offline BLE RNode is present', async () => {
    const state = { yieldActive: false };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [BLE_ROW],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: Date.now() + 30_000,
      },
      state,
    );
    expect(prepareReticulumBleRnodeConnect).toHaveBeenCalled();
    expect(state.yieldActive).toBe(true);
  });

  it('does not mark yield active or release when prepare fails', async () => {
    vi.mocked(prepareReticulumBleRnodeConnect).mockResolvedValueOnce(false);
    const state: ReticulumNobleBleYieldMutableState = { yieldActive: false };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [BLE_ROW],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: Date.now() + 30_000,
      },
      state,
    );
    expect(prepareReticulumBleRnodeConnect).toHaveBeenCalled();
    expect(releaseReticulumBleRnodeConnect).not.toHaveBeenCalled();
    expect(state.yieldActive).toBe(false);
    expect(state.lastPrepareFailedAtMs).toBeTypeOf('number');
  });

  it('backs off repeat prepare after a failure during grace', async () => {
    vi.mocked(prepareReticulumBleRnodeConnect).mockResolvedValue(false);
    const now = Date.now();
    const state = { yieldActive: false, lastPrepareFailedAtMs: now - 1_000 };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [BLE_ROW],
        nowMs: now,
        bleConnectGraceExpiresAt: now + 30_000,
      },
      state,
    );
    expect(prepareReticulumBleRnodeConnect).not.toHaveBeenCalled();
    expect(releaseReticulumBleRnodeConnect).not.toHaveBeenCalled();
  });

  it('stops re-yielding after grace expires when noble still owns the scan', async () => {
    const now = Date.now();
    const state = { yieldActive: false };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [BLE_ROW],
        nowMs: now,
        bleConnectGraceExpiresAt: now - 1_000,
      },
      state,
    );
    expect(prepareReticulumBleRnodeConnect).not.toHaveBeenCalled();
    expect(releaseReticulumBleRnodeConnect).not.toHaveBeenCalled();
    expect(state.yieldActive).toBe(false);
  });

  it('releases an active yield after grace expires without reticulum scan lock', async () => {
    const now = Date.now();
    const state = { yieldActive: true };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [BLE_ROW],
        nowMs: now,
        bleConnectGraceExpiresAt: now - 1_000,
      },
      state,
    );
    expect(releaseReticulumBleRnodeConnect).toHaveBeenCalled();
    expect(state.yieldActive).toBe(false);
  });

  it('tracks main-process yield and releases when RNode already online', async () => {
    vi.mocked(window.electronAPI.bleCoexistence.getState).mockResolvedValue({
      connections: [],
      scanOwner: 'reticulum',
    });
    const state = { yieldActive: false };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [{ ...BLE_ROW, status: 'up' }],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: Date.now() + 30_000,
      },
      state,
    );
    expect(prepareReticulumBleRnodeConnect).not.toHaveBeenCalled();
    expect(releaseReticulumBleRnodeConnect).toHaveBeenCalled();
    expect(state.yieldActive).toBe(false);
  });

  it('does not release main-process yield on empty interfaces during grace', async () => {
    vi.mocked(window.electronAPI.bleCoexistence.getState).mockResolvedValue({
      connections: [],
      scanOwner: 'reticulum',
    });
    const state = { yieldActive: false };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: Date.now() + 30_000,
      },
      state,
    );
    expect(state.yieldActive).toBe(true);
    expect(releaseReticulumBleRnodeConnect).not.toHaveBeenCalled();
  });

  it('releases yield when a non-empty snapshot confirms no enabled BLE RNode', async () => {
    vi.mocked(window.electronAPI.bleCoexistence.getState).mockResolvedValue({
      connections: [],
      scanOwner: 'reticulum',
    });
    const state = { yieldActive: true };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: true,
        interfaces: [
          {
            id: 'tcp-hub',
            name: 'TCP',
            type: 'tcpclient',
            enabled: true,
            status: 'up',
          },
        ],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: Date.now() + 30_000,
      },
      state,
    );
    expect(releaseReticulumBleRnodeConnect).toHaveBeenCalled();
    expect(state.yieldActive).toBe(false);
  });

  it('releases yield when sidecar becomes inactive', async () => {
    const state = { yieldActive: true };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: false,
        interfaces: [],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: 0,
      },
      state,
    );
    expect(releaseReticulumBleRnodeConnect).toHaveBeenCalled();
    expect(state.yieldActive).toBe(false);
  });

  it('releases untracked main-process scan lock on sidecar stop', async () => {
    vi.mocked(window.electronAPI.bleCoexistence.getState).mockResolvedValue({
      connections: [],
      scanOwner: 'reticulum',
    });
    const state = { yieldActive: false };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: false,
        interfaces: [],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: 0,
      },
      state,
    );
    expect(releaseReticulumBleRnodeConnect).toHaveBeenCalled();
  });

  it('does not release orphan scan lock when inactive sync is aborted', async () => {
    vi.mocked(window.electronAPI.bleCoexistence.getState).mockResolvedValue({
      connections: [],
      scanOwner: 'reticulum',
    });
    const abort = new AbortController();
    abort.abort();
    const state = { yieldActive: false };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: false,
        interfaces: [],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: 0,
        signal: abort.signal,
      },
      state,
    );
    expect(releaseReticulumBleRnodeConnect).not.toHaveBeenCalled();
  });

  it('does not release active yield when inactive sync is aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const state = { yieldActive: true };
    await syncReticulumNobleBleYield(
      {
        sidecarActive: false,
        interfaces: [],
        nowMs: Date.now(),
        bleConnectGraceExpiresAt: 0,
        signal: abort.signal,
      },
      state,
    );
    expect(releaseReticulumBleRnodeConnect).not.toHaveBeenCalled();
    expect(state.yieldActive).toBe(true);
  });
});

describe('reticulumBleRnodeOnline helpers', () => {
  it('detects BLE RNode interface rows', () => {
    expect(
      isReticulumBleRnodeInterfaceRow({
        type: 'rnode',
        enabled: true,
        serial_port: 'ble://aa:bb:cc:dd:ee:ff',
      }),
    ).toBe(true);
  });

  it('detects online BLE RNode status', () => {
    const bleRow = {
      type: 'rnode',
      enabled: true,
      serial_port: 'ble://aa:bb:cc:dd:ee:ff',
    };
    expect(isReticulumBleRnodeOnline({ ...bleRow, status: 'online' })).toBe(true);
    expect(isReticulumBleRnodeOnline({ ...bleRow, status: 'down' })).toBe(false);
  });
});
