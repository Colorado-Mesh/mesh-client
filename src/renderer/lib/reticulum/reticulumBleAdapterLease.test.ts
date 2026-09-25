// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireReticulumBleScan,
  BLE_ADAPTER_LEASE_RELEASED_EVENT,
  releaseReticulumBleRnodeConnect,
} from '@/renderer/lib/reticulum/reticulumBleAdapterLease';

describe('reticulumBleAdapterLease', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.bleCoexistence.releaseScan).mockClear();
    vi.mocked(window.electronAPI.bleCoexistence.acquireScan).mockReset();
    vi.mocked(window.electronAPI.bleCoexistence.acquireScan).mockResolvedValue({
      ok: true,
      connections: [],
      scanOwner: 'reticulum',
    });
  });

  it('acquireReticulumBleScan returns true when acquire succeeds', async () => {
    await expect(acquireReticulumBleScan()).resolves.toBe(true);
  });

  it('acquireReticulumBleScan returns false on scan_busy without throwing', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(window.electronAPI.bleCoexistence.acquireScan).mockResolvedValue({
      ok: false,
      code: 'scan_busy',
      owner: 'gatt',
      connections: [],
      scanOwner: 'gatt',
    });
    try {
      await expect(acquireReticulumBleScan()).resolves.toBe(false);
      expect(debug).toHaveBeenCalled();
    } finally {
      debug.mockRestore();
    }
  });

  it('releaseReticulumBleRnodeConnect dispatches BLE_ADAPTER_LEASE_RELEASED_EVENT', async () => {
    const listener = vi.fn();
    window.addEventListener(BLE_ADAPTER_LEASE_RELEASED_EVENT, listener);
    try {
      await releaseReticulumBleRnodeConnect();
      expect(window.electronAPI.bleCoexistence.releaseScan).toHaveBeenCalledWith('reticulum');
      expect(listener).toHaveBeenCalled();
    } finally {
      window.removeEventListener(BLE_ADAPTER_LEASE_RELEASED_EVENT, listener);
    }
  });

  it('releases the scan lease without dispatching when notify is false', async () => {
    const listener = vi.fn();
    window.addEventListener(BLE_ADAPTER_LEASE_RELEASED_EVENT, listener);
    try {
      await releaseReticulumBleRnodeConnect({ notify: false });
      expect(window.electronAPI.bleCoexistence.releaseScan).toHaveBeenCalledWith('reticulum');
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(BLE_ADAPTER_LEASE_RELEASED_EVENT, listener);
    }
  });
});
