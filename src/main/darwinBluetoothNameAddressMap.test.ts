// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  loadDarwinBluetoothNameAddressMap,
  parseDarwinBluetoothNameAddressMap,
  resolveDarwinScanAddress,
} from './darwinBluetoothNameAddressMap';

const FIXTURE = {
  SPBluetoothDataType: [
    {
      device_connected: [
        {
          'MeshCore-🛜 NV0N 01': {
            device_address: 'AC:A7:04:00:D6:F1',
            device_services: '0x400000 < BLE >',
          },
        },
        {
          'RNode 41F4': {
            device_address: 'F0:9E:9E:77:98:D5',
            device_services: '0x400000 < BLE >',
          },
        },
      ],
      device_not_connected: [
        {
          MeshCore: { device_address: 'AA:BB:CC:DD:EE:01' },
        },
        {
          MeshCore: { device_address: 'AA:BB:CC:DD:EE:02' },
        },
        {
          Basement: { device_address: 'D4:A3:3D:7D:E4:CC' },
        },
      ],
    },
  ],
};

describe('parseDarwinBluetoothNameAddressMap', () => {
  it('maps unique names including emoji MeshCore GAP names', () => {
    const map = parseDarwinBluetoothNameAddressMap(FIXTURE);
    expect(map.get('MeshCore-🛜 NV0N 01')).toBe('ac:a7:04:00:d6:f1');
    expect(map.get('RNode 41F4')).toBe('f0:9e:9e:77:98:d5');
    expect(map.get('Basement')).toBe('d4:a3:3d:7d:e4:cc');
  });

  it('omits names that resolve to more than one MAC', () => {
    const map = parseDarwinBluetoothNameAddressMap(FIXTURE);
    expect(map.has('MeshCore')).toBe(false);
  });

  it('returns empty for malformed input', () => {
    expect(parseDarwinBluetoothNameAddressMap(null).size).toBe(0);
    expect(parseDarwinBluetoothNameAddressMap({}).size).toBe(0);
  });
});

describe('loadDarwinBluetoothNameAddressMap', () => {
  it('parses JSON from the reader', async () => {
    const map = await loadDarwinBluetoothNameAddressMap(() =>
      Promise.resolve(JSON.stringify(FIXTURE)),
    );
    expect(map.get('MeshCore-🛜 NV0N 01')).toBe('ac:a7:04:00:d6:f1');
  });
});

describe('resolveDarwinScanAddress', () => {
  const map = new Map([
    ['MeshCore-🛜 NV0N 01', 'ac:a7:04:00:d6:f1'],
    ['Basement', 'd4:a3:3d:7d:e4:cc'],
  ]);

  it('prefers Noble address when the OS exposes one', () => {
    expect(resolveDarwinScanAddress('AA:BB:CC:DD:EE:FF', 'MeshCore-🛜 NV0N 01', map)).toBe(
      'AA:BB:CC:DD:EE:FF',
    );
  });

  it('falls back to unique GAP name when Noble address is empty (macOS)', () => {
    expect(resolveDarwinScanAddress('', 'MeshCore-🛜 NV0N 01', map)).toBe('ac:a7:04:00:d6:f1');
    expect(resolveDarwinScanAddress('unknown', 'MeshCore-🛜 NV0N 01', map)).toBe(
      'ac:a7:04:00:d6:f1',
    );
  });

  it('matches GAP names case-insensitively when the exact key is missing', () => {
    expect(resolveDarwinScanAddress(undefined, 'basement', map)).toBe('d4:a3:3d:7d:e4:cc');
  });

  it('returns undefined when the advertised name is missing or not unique', () => {
    expect(resolveDarwinScanAddress('', undefined, map)).toBeUndefined();
    expect(resolveDarwinScanAddress('', 'MeshCore', map)).toBeUndefined();
  });
});
