import { afterEach, describe, expect, it } from 'vitest';

import { clearAllDrivers, clearDriver, getDriver, setDriver } from './driverRegistry';
import { MeshCoreDriver } from './MeshCoreDriver';
import { MeshtasticDriver } from './MeshtasticDriver';

afterEach(() => {
  clearAllDrivers();
});

describe('driverRegistry', () => {
  it('returns null for an unregistered protocol', () => {
    expect(getDriver('meshtastic')).toBeNull();
    expect(getDriver('meshcore')).toBeNull();
  });

  it('stores and retrieves drivers by protocol', () => {
    const meshtastic = new MeshtasticDriver();
    const meshcore = new MeshCoreDriver();
    setDriver('meshtastic', meshtastic);
    setDriver('meshcore', meshcore);
    expect(getDriver('meshtastic')).toBe(meshtastic);
    expect(getDriver('meshcore')).toBe(meshcore);
  });

  it('replaces an existing driver when set again', () => {
    const first = new MeshtasticDriver();
    const second = new MeshtasticDriver();
    setDriver('meshtastic', first);
    setDriver('meshtastic', second);
    expect(getDriver('meshtastic')).toBe(second);
  });

  it('throws when registering a driver under the wrong protocol', () => {
    const meshcore = new MeshCoreDriver();
    expect(() => {
      setDriver('meshtastic', meshcore);
    }).toThrow(/protocol mismatch/);
  });

  it('clears a single protocol without affecting others', () => {
    setDriver('meshtastic', new MeshtasticDriver());
    setDriver('meshcore', new MeshCoreDriver());
    clearDriver('meshtastic');
    expect(getDriver('meshtastic')).toBeNull();
    expect(getDriver('meshcore')).not.toBeNull();
  });

  it('clears all drivers', () => {
    setDriver('meshtastic', new MeshtasticDriver());
    setDriver('meshcore', new MeshCoreDriver());
    clearAllDrivers();
    expect(getDriver('meshtastic')).toBeNull();
    expect(getDriver('meshcore')).toBeNull();
  });
});
