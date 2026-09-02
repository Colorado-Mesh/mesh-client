import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSyncFormFromConfig } from './useSyncFormFromConfig';

describe('useSyncFormFromConfig', () => {
  it('strips protobuf metadata before applying config to form state', () => {
    const applyConfig = vi.fn();

    renderHook(() => {
      useSyncFormFromConfig(
        { $typeName: 'meshtastic.Config.DeviceConfig', role: 0, serialEnabled: true },
        applyConfig,
      );
    });

    expect(applyConfig).toHaveBeenCalledWith({ role: 0, serialEnabled: true });
    expect(applyConfig.mock.calls[0][0]).not.toHaveProperty('$typeName');
  });

  it('applies a slice holding a 64-bit protobuf field without throwing', () => {
    const applyConfig = vi.fn();
    // A fresh object each render: dedupe has to compare by value, and the 64-bit
    // `powermon_enables` field decodes as a bigint.
    const { rerender } = renderHook(() => {
      useSyncFormFromConfig(
        { $typeName: 'meshtastic.Config.PowerConfig', isPowerSaving: true, powermonEnables: 0n },
        applyConfig,
      );
    });

    expect(applyConfig).toHaveBeenCalledWith({ isPowerSaving: true, powermonEnables: 0n });

    rerender();
    expect(applyConfig).toHaveBeenCalledTimes(1);
  });

  it('skips sync when config slice is empty', () => {
    const applyConfig = vi.fn();

    renderHook(() => {
      useSyncFormFromConfig(null, applyConfig);
    });

    expect(applyConfig).not.toHaveBeenCalled();
  });
});
