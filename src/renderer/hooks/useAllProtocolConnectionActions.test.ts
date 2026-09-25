import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAllProtocolConnectionActions } from './useAllProtocolConnectionActions';

vi.mock('./useConnect', () => ({
  useConnect: () => vi.fn().mockResolvedValue('id-driver'),
}));

describe('useAllProtocolConnectionActions', () => {
  it('returns connection actions for every protocol', () => {
    const { result } = renderHook(() => useAllProtocolConnectionActions());

    expect(Object.keys(result.current)).toEqual(['meshtastic', 'meshcore', 'reticulum']);
    for (const protocol of ['meshtastic', 'meshcore', 'reticulum'] as const) {
      expect(result.current[protocol].connect).toEqual(expect.any(Function));
      expect(result.current[protocol].connectAutomatic).toEqual(expect.any(Function));
      expect(result.current[protocol].disconnect).toEqual(expect.any(Function));
    }
  });
});
