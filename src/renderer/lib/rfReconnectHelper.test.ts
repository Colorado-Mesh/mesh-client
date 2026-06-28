// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconnectRfFromLastConnection } from './rfReconnectHelper';
import type { MeshProtocol } from './types';

const STORAGE_KEY = (protocol: MeshProtocol) => `mesh-client:lastConnection:${protocol}`;

describe('reconnectRfFromLastConnection', () => {
  const handlers = {
    connectBleAutomatic: vi.fn().mockResolvedValue(undefined),
    connectBleDirect: vi.fn().mockResolvedValue(undefined),
    connectSerialAutomatic: vi.fn().mockResolvedValue(undefined),
    connectHttp: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    window.electronAPI.startNobleBleScanning = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.stopNobleBleScanning = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.onNobleBleDeviceDiscovered = vi.fn(() => () => {});
  });

  it('reconnects serial using stored port id', async () => {
    localStorage.setItem(
      STORAGE_KEY('meshtastic'),
      JSON.stringify({ type: 'serial', serialPortId: 'port-abc' }),
    );
    await reconnectRfFromLastConnection('meshtastic', 'serial', handlers);
    expect(handlers.connectSerialAutomatic).toHaveBeenCalledWith('port-abc');
  });

  it('reconnects Meshtastic HTTP using stored address', async () => {
    localStorage.setItem(
      STORAGE_KEY('meshtastic'),
      JSON.stringify({ type: 'http', httpAddress: '192.168.1.10' }),
    );
    await reconnectRfFromLastConnection('meshtastic', 'http', handlers);
    expect(handlers.connectHttp).toHaveBeenCalledWith('192.168.1.10');
  });

  it('reconnects MeshCore TCP (http type) using stored address', async () => {
    localStorage.setItem(
      STORAGE_KEY('meshcore'),
      JSON.stringify({ type: 'http', httpAddress: 'meshcore.local:9000' }),
    );
    await reconnectRfFromLastConnection('meshcore', 'http', handlers);
    expect(handlers.connectHttp).toHaveBeenCalledWith('meshcore.local:9000');
  });

  it('on Linux uses direct BLE connect (Web Bluetooth user gesture path)', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    localStorage.setItem(
      STORAGE_KEY('meshtastic'),
      JSON.stringify({ type: 'ble', bleDeviceId: 'ble-1' }),
    );
    await reconnectRfFromLastConnection('meshtastic', 'ble', handlers);
    expect(handlers.connectBleDirect).toHaveBeenCalledWith('ble-1');
    expect(handlers.connectBleAutomatic).not.toHaveBeenCalled();
  });
});
