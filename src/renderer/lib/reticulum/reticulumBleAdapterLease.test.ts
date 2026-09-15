// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLE_ADAPTER_LEASE_RELEASED_EVENT,
  releaseReticulumBleRnodeConnect,
} from '@/renderer/lib/reticulum/reticulumBleAdapterLease';

describe('reticulumBleAdapterLease', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.bleCoexistence.releaseScan).mockClear();
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
