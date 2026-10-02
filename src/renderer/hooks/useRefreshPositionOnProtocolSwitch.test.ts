import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeshProtocol } from '../lib/types';
import { useRefreshPositionOnProtocolSwitch } from './useRefreshPositionOnProtocolSwitch';

describe('useRefreshPositionOnProtocolSwitch', () => {
  it('does not refresh on initial mount', () => {
    const refresh = vi.fn();
    renderHook(() => {
      useRefreshPositionOnProtocolSwitch('meshcore', refresh);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once per protocol change', () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ protocol }: { protocol: MeshProtocol }) => {
        useRefreshPositionOnProtocolSwitch(protocol, refresh);
      },
      { initialProps: { protocol: 'meshcore' as MeshProtocol } },
    );

    rerender({ protocol: 'meshtastic' });
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ protocol: 'meshcore' });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not refresh when only the refresh callback identity changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ refresh }: { refresh: () => void }) => {
        useRefreshPositionOnProtocolSwitch('meshtastic', refresh);
      },
      { initialProps: { refresh: first } },
    );

    rerender({ refresh: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
