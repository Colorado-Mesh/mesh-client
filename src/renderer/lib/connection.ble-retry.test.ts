import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@meshtastic/core', () => ({
  MeshDevice: vi.fn().mockImplementation(function MeshDevice(transport: unknown) {
    return { transport };
  }),
}));

vi.mock('./meshcoreDualNobleBleInit', () => ({
  notifyNobleBlePrimaryRfLinkReady: vi.fn(),
}));

vi.mock('./transportNobleIpc', () => ({
  TransportNobleIpc: vi.fn().mockImplementation(function TransportNobleIpc(sessionId: string) {
    return {
      sessionId,
      fromDevice: new ReadableStream<Uint8Array>(),
      toDevice: new WritableStream<Uint8Array>(),
    };
  }),
}));

const { mockRequestDevice, mockRequestGrantedDevice, mockConnect } = vi.hoisted(() => ({
  mockRequestDevice: vi.fn(),
  mockRequestGrantedDevice: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('./transportWebBluetoothIpc', () => ({
  TransportWebBluetoothIpc: vi.fn().mockImplementation(function TransportWebBluetoothIpc() {
    return {
      requestDevice: mockRequestDevice,
      requestGrantedDevice: mockRequestGrantedDevice,
      connect: mockConnect,
      disconnect: vi.fn().mockResolvedValue(undefined),
      fromDevice: new ReadableStream<Uint8Array>(),
      toDevice: new WritableStream<Uint8Array>(),
    };
  }),
}));

import { MeshDevice } from '@meshtastic/core';

import { createBleConnection } from './connection';

describe('createBleConnection retry behavior', () => {
  let userAgentSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    mockRequestDevice.mockClear();
    mockRequestGrantedDevice.mockClear();
    mockConnect.mockClear();
    vi.mocked(MeshDevice).mockClear();
    mockRequestDevice.mockResolvedValue({ deviceId: 'linux-dev-1', deviceName: 'Radio' });
    mockRequestGrantedDevice.mockResolvedValue({ deviceId: 'linux-granted', deviceName: 'Radio' });
    mockConnect.mockResolvedValue(undefined);
    userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    vi.mocked(window.electronAPI.connectNobleBle).mockClear();
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.resetBlePairingRetryCount).mockImplementation(() => {});
  });

  afterEach(() => {
    userAgentSpy?.mockRestore();
    userAgentSpy = null;
  });

  it('retries once on main-process BLE timeout errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockResolvedValueOnce({ ok: false, error: 'BLE connectAsync timed out after 30000ms' })
      .mockResolvedValueOnce({ ok: true });

    const device = await createBleConnection('ble-device-1', 'meshtastic');

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.connectNobleBle).toHaveBeenNthCalledWith(
      1,
      'meshtastic',
      'ble-device-1',
    );
    expect(window.electronAPI.connectNobleBle).toHaveBeenNthCalledWith(
      2,
      'meshtastic',
      'ble-device-1',
    );
    expect(MeshDevice).toHaveBeenCalledTimes(1);
    expect(device).toBeTruthy();
  });

  it('logs createBleConnection start as a single readable line (no [object Object])', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await createBleConnection('ble-device-log', 'meshtastic');
    const startMsg = debugSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('createBleConnection start'),
    )?.[0] as string | undefined;
    expect(startMsg).toBeDefined();
    expect(startMsg).not.toContain('[object Object]');
    expect(startMsg).toContain('peripheralId=ble-device-log');
    expect(startMsg).toContain('sessionId=meshtastic');
    expect(startMsg).toContain('isLinux=false');
    debugSpy.mockRestore();
  });

  it('does not retry non-timeout BLE errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({
      ok: false,
      error: 'Bluetooth adapter is not available',
    });

    await expect(createBleConnection('ble-device-2', 'meshtastic')).rejects.toThrow(
      'Bluetooth adapter is not available',
    );
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(1);
  });
});

describe('createBleConnection Linux Web Bluetooth', () => {
  let userAgentSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    mockRequestDevice.mockClear();
    mockRequestGrantedDevice.mockClear();
    mockConnect.mockClear();
    vi.mocked(MeshDevice).mockClear();
    mockRequestDevice.mockResolvedValue({ deviceId: 'linux-dev-1', deviceName: 'Radio' });
    mockRequestGrantedDevice.mockResolvedValue({ deviceId: 'linux-granted', deviceName: 'Radio' });
    mockConnect.mockResolvedValue(undefined);
    userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    vi.mocked(window.electronAPI.resetBlePairingRetryCount).mockImplementation(() => {});
  });

  afterEach(() => {
    userAgentSpy?.mockRestore();
    userAgentSpy = null;
  });

  it('calls requestGrantedDevice when peripheralId is provided (auto-reconnect)', async () => {
    const onLinkHealthy = vi.fn();
    await createBleConnection('linux-granted-id', 'meshtastic', onLinkHealthy);

    expect(mockRequestGrantedDevice).toHaveBeenCalledWith('linux-granted-id');
    expect(mockRequestDevice).not.toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledWith(onLinkHealthy);
    expect(MeshDevice).toHaveBeenCalledTimes(1);
  });

  it('calls requestDevice when peripheralId is omitted (picker flow)', async () => {
    await createBleConnection(undefined, 'meshtastic');

    expect(mockRequestDevice).toHaveBeenCalled();
    expect(mockRequestGrantedDevice).not.toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledWith(undefined);
  });
});
