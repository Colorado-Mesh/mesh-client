import { describe, expect, it, vi } from 'vitest';

import type { MeshComDeviceHandle } from '../protocols/MeshComProtocol';
import { encodeMeshcomBleCommand } from './meshcomBleFrame';
import {
  encodeMeshcomDeviceCommand,
  meshcomDeviceCommandsSupported,
  sendMeshcomDeviceCommand,
} from './meshcomDeviceCommands';

describe('meshcomDeviceCommands', () => {
  it('supports serial, ble, and netconsole', () => {
    expect(meshcomDeviceCommandsSupported('serial')).toBe(true);
    expect(meshcomDeviceCommandsSupported('ble')).toBe(true);
    expect(meshcomDeviceCommandsSupported('netconsole')).toBe(true);
    expect(meshcomDeviceCommandsSupported('udp')).toBe(false);
    expect(meshcomDeviceCommandsSupported('tcp')).toBe(false);
  });

  it('encodes serial/NET Console CRLF and BLE 0xA0 frames', () => {
    const serial = encodeMeshcomDeviceCommand('serial', '--info');
    expect(new TextDecoder().decode(serial)).toBe('--info\r\n');
    const netconsole = encodeMeshcomDeviceCommand('netconsole', '--info');
    expect(new TextDecoder().decode(netconsole)).toBe('--info\r\n');
    const ble = encodeMeshcomDeviceCommand('ble', '--info');
    expect(ble).toEqual(encodeMeshcomBleCommand('--info'));
  });

  it('sendMeshcomDeviceCommand writes and rejects udp', async () => {
    const write = vi.fn(async () => {});
    const handle = {
      transport: 'serial',
      connection: { write },
    } as unknown as MeshComDeviceHandle;
    const result = await sendMeshcomDeviceCommand(handle, 'info');
    expect(result.command).toBe('--info');
    expect(write).toHaveBeenCalledOnce();

    await expect(
      sendMeshcomDeviceCommand({ ...handle, transport: 'udp' }, '--info'),
    ).rejects.toThrow(/Serial, BLE, or NET Console/);
  });
});
