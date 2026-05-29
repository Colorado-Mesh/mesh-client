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

  it('skips sync when config slice is empty', () => {
    const applyConfig = vi.fn();

    renderHook(() => {
      useSyncFormFromConfig(null, applyConfig);
    });

    expect(applyConfig).not.toHaveBeenCalled();
  });
});
