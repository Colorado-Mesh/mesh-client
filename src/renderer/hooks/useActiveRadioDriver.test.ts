import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearAllDrivers, setDriver } from '../lib/radio/drivers/driverRegistry';
import { MeshCoreDriver } from '../lib/radio/drivers/MeshCoreDriver';
import { MeshtasticDriver } from '../lib/radio/drivers/MeshtasticDriver';
import type { MeshProtocol } from '../lib/types';
import { useActiveRadioDriver } from './useActiveRadioDriver';

afterEach(() => {
  clearAllDrivers();
});

describe('useActiveRadioDriver', () => {
  it('returns null when no driver is registered for the protocol', () => {
    const { result } = renderHook(() => useActiveRadioDriver('meshtastic'));
    expect(result.current).toBeNull();
  });

  it('returns the registered driver for the active protocol', () => {
    const meshtastic = new MeshtasticDriver();
    setDriver('meshtastic', meshtastic);
    const { result } = renderHook(() => useActiveRadioDriver('meshtastic'));
    expect(result.current).toBe(meshtastic);
  });

  it('returns the matching driver when both protocols are registered', () => {
    const meshtastic = new MeshtasticDriver();
    const meshcore = new MeshCoreDriver();
    setDriver('meshtastic', meshtastic);
    setDriver('meshcore', meshcore);
    const meshtasticResult = renderHook(() => useActiveRadioDriver('meshtastic'));
    const meshcoreResult = renderHook(() => useActiveRadioDriver('meshcore'));
    expect(meshtasticResult.result.current).toBe(meshtastic);
    expect(meshcoreResult.result.current).toBe(meshcore);
  });

  it('returns the new driver when the protocol arg changes', () => {
    const meshtastic = new MeshtasticDriver();
    const meshcore = new MeshCoreDriver();
    setDriver('meshtastic', meshtastic);
    setDriver('meshcore', meshcore);
    const { result, rerender } = renderHook(
      ({ p }: { p: MeshProtocol }) => useActiveRadioDriver(p),
      {
        initialProps: { p: 'meshtastic' },
      },
    );
    expect(result.current).toBe(meshtastic);
    rerender({ p: 'meshcore' });
    expect(result.current).toBe(meshcore);
  });
});
