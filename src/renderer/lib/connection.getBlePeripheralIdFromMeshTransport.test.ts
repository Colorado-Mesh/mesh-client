import { describe, expect, it } from 'vitest';

import { getBlePeripheralIdFromMeshTransport } from './connection';

describe('getBlePeripheralIdFromMeshTransport', () => {
  it('returns the id from a transport exposing getConnectedDeviceId()', () => {
    const transport = { getConnectedDeviceId: () => 'AA:BB:CC:DD:EE:FF' };
    expect(getBlePeripheralIdFromMeshTransport(transport)).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('returns null when getConnectedDeviceId() itself resolves nothing yet', () => {
    const transport = { getConnectedDeviceId: () => null };
    expect(getBlePeripheralIdFromMeshTransport(transport)).toBeNull();
  });

  it('returns null for transports without getConnectedDeviceId (Noble, serial, http, tcp)', () => {
    expect(getBlePeripheralIdFromMeshTransport({})).toBeNull();
    expect(getBlePeripheralIdFromMeshTransport(null)).toBeNull();
    expect(getBlePeripheralIdFromMeshTransport(undefined)).toBeNull();
  });
});
