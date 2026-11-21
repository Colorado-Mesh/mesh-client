import { describe, expect, it, vi } from 'vitest';

import type { MeshComDeviceHandle } from '../protocols/MeshComProtocol';
import { refreshMeshcomDeviceSettings } from './refreshMeshcomDeviceSettings';

describe('refreshMeshcomDeviceSettings', () => {
  it('rejects unsupported transports', async () => {
    const handle = {
      transport: 'udp',
      connection: { write: vi.fn() },
      deviceSettings: { complete: false, call: null },
      deviceSettingsWaiters: [],
    } as unknown as MeshComDeviceHandle;
    await expect(refreshMeshcomDeviceSettings(handle, 'meshcom:test')).rejects.toThrow(
      /Serial or BLE/,
    );
  });
});
