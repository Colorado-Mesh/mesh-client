import { describe, expect, it, vi } from 'vitest';

import { connectionDriver } from './drivers/ConnectionDriver';
import { resolveMeshcoreActiveConnection } from './meshcoreResolveActiveConnection';

describe('resolveMeshcoreActiveConnection', () => {
  it('returns existing connRef without touching the driver', () => {
    const handle = { id: 'live' } as never;
    const connRef = { current: handle };
    const meshcoreDriverConnectedRef = { current: true };
    const meshcoreIdentityIdRef = { current: 'meshcore-1' };
    const meshcorePendingDriverIdentityRef = { current: null };
    const getHandleSpy = vi.spyOn(connectionDriver, 'getHandle');

    expect(
      resolveMeshcoreActiveConnection({
        connRef,
        meshcoreDriverConnectedRef,
        meshcoreIdentityIdRef,
        meshcorePendingDriverIdentityRef,
      }),
    ).toBe(handle);
    expect(getHandleSpy).not.toHaveBeenCalled();
    getHandleSpy.mockRestore();
  });

  it('re-syncs connRef from ConnectionDriver when ref was cleared', () => {
    const handle = { id: 'driver' } as never;
    const connRef = { current: null };
    const meshcoreDriverConnectedRef = { current: false };
    const meshcoreIdentityIdRef = { current: 'meshcore-abc' };
    const meshcorePendingDriverIdentityRef = { current: null };
    vi.spyOn(connectionDriver, 'getHandle').mockReturnValue(handle);

    expect(
      resolveMeshcoreActiveConnection({
        connRef,
        meshcoreDriverConnectedRef,
        meshcoreIdentityIdRef,
        meshcorePendingDriverIdentityRef,
      }),
    ).toBe(handle);
    expect(connRef.current).toBe(handle);
    expect(meshcoreDriverConnectedRef.current).toBe(true);
    vi.restoreAllMocks();
  });
});
