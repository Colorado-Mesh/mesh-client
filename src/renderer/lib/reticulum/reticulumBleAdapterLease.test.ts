// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NOBLE_BLE_YIELD_RELEASED_EVENT } from '@/renderer/lib/nobleBleYieldReleased';
import { releaseReticulumBleRnodeConnect } from '@/renderer/lib/reticulum/reticulumBleAdapterLease';

describe('reticulumBleAdapterLease', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.bleCoexistence.releaseScan).mockClear();
  });

  it('releaseReticulumBleRnodeConnect dispatches NOBLE_BLE_YIELD_RELEASED_EVENT', async () => {
    const listener = vi.fn();
    window.addEventListener(NOBLE_BLE_YIELD_RELEASED_EVENT, listener);
    try {
      await releaseReticulumBleRnodeConnect();
      expect(window.electronAPI.bleCoexistence.releaseScan).toHaveBeenCalledWith('reticulum');
      expect(listener).toHaveBeenCalled();
    } finally {
      window.removeEventListener(NOBLE_BLE_YIELD_RELEASED_EVENT, listener);
    }
  });
});
