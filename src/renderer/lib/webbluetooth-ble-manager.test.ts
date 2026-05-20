import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLE_TO_RADIO_PAYLOAD_CAP } from '@/shared/bleAttWriteLimit';

import {
  probeWebBluetoothToRadioChunkLimitBytes,
  WebBluetoothManager,
} from './webbluetooth-ble-manager';

/** Test-only view of private WebBluetoothManager fields. */
interface ManagerTestHarness {
  device: BluetoothDevice | null;
  toRadioCharacteristic: BluetoothRemoteGATTCharacteristic | null;
  fromRadioCharacteristic: BluetoothRemoteGATTCharacteristic | null;
  meshtasticFromRadioReadPump: boolean;
  gattKeepaliveTimer: ReturnType<typeof setInterval> | null;
  fromNumNotifyHandler: (() => void) | null;
  trySubscribeFromNum(service: BluetoothRemoteGATTService): Promise<void>;
  writeToRadio(data: Uint8Array): Promise<void>;
  setLinkHealthyCallback(callback: (() => void) | null): void;
  startGattKeepalive(): void;
}

describe('probeWebBluetoothToRadioChunkLimitBytes', () => {
  it('returns null when maximumWriteValueLength is absent', () => {
    const ch = { uuid: 'test' } as BluetoothRemoteGATTCharacteristic;
    expect(probeWebBluetoothToRadioChunkLimitBytes(ch)).toBe(null);
  });

  it('returns capped positive maximumWriteValueLength', () => {
    const ch = {
      uuid: 'test',
      maximumWriteValueLength: 50,
    } as BluetoothRemoteGATTCharacteristic;
    expect(probeWebBluetoothToRadioChunkLimitBytes(ch)).toBe(50);
  });

  it('caps at BLE_TO_RADIO_PAYLOAD_CAP', () => {
    const ch = {
      uuid: 'test',
      maximumWriteValueLength: 9000,
    } as BluetoothRemoteGATTCharacteristic;
    expect(probeWebBluetoothToRadioChunkLimitBytes(ch)).toBe(BLE_TO_RADIO_PAYLOAD_CAP);
  });

  it('ignores non-positive values', () => {
    expect(
      probeWebBluetoothToRadioChunkLimitBytes({
        uuid: 'x',
        maximumWriteValueLength: 0,
      } as BluetoothRemoteGATTCharacteristic),
    ).toBe(null);
  });
});

describe('WebBluetoothManager writeToRadio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeManager(sessionId: 'meshtastic' | 'meshcore' = 'meshtastic'): {
    mgr: WebBluetoothManager;
    harness: ManagerTestHarness;
  } {
    const mgr = new WebBluetoothManager(sessionId);
    const harness = mgr as unknown as ManagerTestHarness;
    harness.device = {
      id: 'test-device',
      gatt: { connected: true },
    } as BluetoothDevice;
    return { mgr, harness };
  }

  function mockToRadioChar(writeWithoutResponse: boolean): BluetoothRemoteGATTCharacteristic {
    return {
      properties: {
        read: false,
        write: true,
        writeWithoutResponse,
        reliableWrite: false,
        notify: false,
        indicate: false,
        authenticatedSignedWrites: false,
      },
      writeValue: vi.fn().mockResolvedValue(undefined),
      writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
    } as unknown as BluetoothRemoteGATTCharacteristic;
  }

  function mockFromRadioChar(): BluetoothRemoteGATTCharacteristic {
    return {
      properties: {
        read: true,
        write: false,
        writeWithoutResponse: false,
        reliableWrite: false,
        notify: true,
        indicate: false,
        authenticatedSignedWrites: false,
      },
      readValue: vi.fn().mockResolvedValue(new DataView(new ArrayBuffer(0))),
    } as unknown as BluetoothRemoteGATTCharacteristic;
  }

  it('uses writeValueWithoutResponse when writeWithoutResponse is true', async () => {
    const { mgr, harness } = makeManager();
    const toRadio = mockToRadioChar(true);
    harness.toRadioCharacteristic = toRadio;
    harness.fromRadioCharacteristic = mockFromRadioChar();
    harness.meshtasticFromRadioReadPump = false;

    await mgr.writeToRadio(new Uint8Array([1, 2, 3]));

    expect(toRadio.writeValueWithoutResponse).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(toRadio.writeValue).not.toHaveBeenCalled();
  });

  it('falls back to writeValue when writeWithoutResponse is false', async () => {
    const { mgr, harness } = makeManager();
    const toRadio = mockToRadioChar(false);
    harness.toRadioCharacteristic = toRadio;
    harness.fromRadioCharacteristic = mockFromRadioChar();
    harness.meshtasticFromRadioReadPump = false;

    await mgr.writeToRadio(new Uint8Array([4, 5]));

    expect(toRadio.writeValue).toHaveBeenCalledWith(new Uint8Array([4, 5]));
    expect(toRadio.writeValueWithoutResponse).not.toHaveBeenCalled();
  });

  it('schedules post-write safety read in meshtastic notify mode', async () => {
    const { mgr, harness } = makeManager();
    const fromRadio = mockFromRadioChar();
    harness.toRadioCharacteristic = mockToRadioChar(true);
    harness.fromRadioCharacteristic = fromRadio;
    harness.meshtasticFromRadioReadPump = false;

    await mgr.writeToRadio(new Uint8Array([1]));
    expect(fromRadio.readValue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(fromRadio.readValue).toHaveBeenCalled();
  });

  it('drains immediately and schedules follow-up reads in meshtasticFromRadioReadPump mode', async () => {
    const { mgr, harness } = makeManager();
    const fromRadio = mockFromRadioChar();
    harness.toRadioCharacteristic = mockToRadioChar(true);
    harness.fromRadioCharacteristic = fromRadio;
    harness.meshtasticFromRadioReadPump = true;

    await mgr.writeToRadio(new Uint8Array([1]));

    // Immediate drain runs synchronously with the write
    expect(fromRadio.readValue).toHaveBeenCalledTimes(1);

    // Follow-up reads fire at scheduled delays to catch slow LoRa responses
    await vi.advanceTimersByTimeAsync(100);
    expect(fromRadio.readValue).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(400); // 500ms total
    expect(fromRadio.readValue).toHaveBeenCalledTimes(3);
  });

  it('invokes link-healthy callback after writeToRadio', async () => {
    const { mgr, harness } = makeManager();
    const onHealthy = vi.fn();
    mgr.setLinkHealthyCallback(onHealthy);
    harness.toRadioCharacteristic = mockToRadioChar(true);
    harness.fromRadioCharacteristic = mockFromRadioChar();

    await mgr.writeToRadio(new Uint8Array([1]));

    expect(onHealthy).toHaveBeenCalledTimes(1);
  });

  it('runs GATT keepalive reads on notify path when fromRadio is readable', async () => {
    const { harness } = makeManager();
    const fromRadio = mockFromRadioChar();
    harness.fromRadioCharacteristic = fromRadio;
    harness.meshtasticFromRadioReadPump = false;

    harness.startGattKeepalive();
    expect(harness.gattKeepaliveTimer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fromRadio.readValue).toHaveBeenCalled();
  });

  describe('fromNum notify', () => {
    it('drains fromRadio when fromNum notify fires (covers unsolicited mesh traffic)', async () => {
      const { harness } = makeManager();
      const fromRadio = mockFromRadioChar();
      harness.fromRadioCharacteristic = fromRadio;

      let capturedHandler: (() => void) | null = null;
      const mockFromNum = {
        addEventListener: vi.fn((_event: string, handler: () => void) => {
          capturedHandler = handler;
        }),
        removeEventListener: vi.fn(),
        startNotifications: vi.fn().mockResolvedValue(undefined),
      };
      const mockService = {
        getCharacteristic: vi.fn().mockResolvedValue(mockFromNum),
      };

      await harness.trySubscribeFromNum(mockService as unknown as BluetoothRemoteGATTService);
      expect(mockFromNum.startNotifications).toHaveBeenCalled();
      expect(capturedHandler).not.toBeNull();
      expect(harness.fromNumNotifyHandler).not.toBeNull();

      // Fire the handler as the BLE stack would when fromNum changes
      capturedHandler!();
      await Promise.resolve();

      expect(fromRadio.readValue).toHaveBeenCalledTimes(1);
    });

    it('silently skips fromNum when the characteristic is not available', async () => {
      const { harness } = makeManager();
      const mockService = {
        getCharacteristic: vi
          .fn()
          .mockRejectedValue(new DOMException('Not found', 'NotFoundError')),
      };

      await expect(
        harness.trySubscribeFromNum(mockService as unknown as BluetoothRemoteGATTService),
      ).resolves.toBeUndefined();

      expect(harness.fromNumNotifyHandler).toBeNull();
    });
  });
});

describe('WebBluetoothManager acquireGrantedDeviceById', () => {
  it('reuses device from navigator.bluetooth.getDevices()', async () => {
    const mockDevice = {
      id: 'granted-radio',
      name: 'T-Beam',
      addEventListener: vi.fn(),
    } as unknown as BluetoothDevice;
    const getDevices = vi.fn().mockResolvedValue([mockDevice]);
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: { getDevices },
    });

    const mgr = new WebBluetoothManager('meshtastic');
    const device = await mgr.acquireGrantedDeviceById('granted-radio');

    expect(getDevices).toHaveBeenCalled();
    expect(device).toBe(mockDevice);
    expect((mgr as unknown as ManagerTestHarness).device).toBe(mockDevice);
  });

  it('throws when granted device id is not in getDevices()', async () => {
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: { getDevices: vi.fn().mockResolvedValue([]) },
    });

    const mgr = new WebBluetoothManager('meshtastic');
    await expect(mgr.acquireGrantedDeviceById('missing-id')).rejects.toThrow(
      /no longer available/i,
    );
  });
});
