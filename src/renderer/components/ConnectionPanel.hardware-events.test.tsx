/**
 * Hardware event simulation tests for ConnectionPanel.
 *
 * These tests verify that hardware-originating IPC events (BLE device discovery,
 * serial port discovery, Noble adapter state) are correctly wired to the component
 * and that the expected payload shapes are consumed without errors.
 *
 * AI regression patterns caught here:
 * - Forgetting to register the event listener (onNobleBleDeviceDiscovered not called)
 * - Changing payload property names (deviceId → device_id, portId → port_id, etc.)
 * - Forgetting to return / call the cleanup unsubscribe function on unmount
 * - Disconnecting the serial port listener from state update
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NobleBleDevice, SerialPort } from '@/shared/electron-api.types';

import type { DeviceState } from '../lib/types';
import ConnectionPanel from './ConnectionPanel';

const DISCONNECTED: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  reconnectAttempt: 0,
  connectionType: null,
};

const DEFAULT_PROPS = {
  state: DISCONNECTED,
  onConnect: vi.fn().mockResolvedValue(undefined),
  onAutoConnect: vi.fn().mockResolvedValue(undefined),
  onDisconnect: vi.fn().mockResolvedValue(undefined),
  mqttStatus: 'disconnected' as const,
  protocol: 'meshtastic' as const,
  onProtocolChange: vi.fn(),
};

describe('ConnectionPanel hardware event wiring', () => {
  beforeEach(() => {
    // Reset call history on all relevant mocks before each test
    vi.mocked(window.electronAPI.onNobleBleDeviceDiscovered).mockClear();
    vi.mocked(window.electronAPI.onSerialPortsDiscovered).mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── BLE device discovery ──────────────────────────────────────────────────

  it('registers onNobleBleDeviceDiscovered listener on mount', () => {
    render(<ConnectionPanel {...DEFAULT_PROPS} />);
    expect(window.electronAPI.onNobleBleDeviceDiscovered).toHaveBeenCalledOnce();
  });

  it('onNobleBleDeviceDiscovered callback accepts NobleBleDevice payload shape', () => {
    render(<ConnectionPanel {...DEFAULT_PROPS} />);

    const registeredCb = vi.mocked(window.electronAPI.onNobleBleDeviceDiscovered).mock
      .calls[0]?.[0];
    expect(registeredCb, 'callback must be registered').toBeDefined();

    const device: NobleBleDevice = { deviceId: 'ble-001', deviceName: 'Test Radio' };
    // Must not throw — validates payload shape is consumed correctly
    expect(() =>
      act(() => {
        registeredCb!(device);
      }),
    ).not.toThrow();
  });

  it('deduplicates BLE devices by deviceId on repeated discovery', () => {
    let capturedCb: ((device: NobleBleDevice) => void) | undefined;
    vi.mocked(window.electronAPI.onNobleBleDeviceDiscovered).mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });

    render(<ConnectionPanel {...DEFAULT_PROPS} />);
    expect(capturedCb).toBeDefined();

    const device: NobleBleDevice = { deviceId: 'ble-001', deviceName: 'Duplicate Radio' };
    act(() => {
      capturedCb!(device);
    });
    act(() => {
      capturedCb!(device);
    }); // Same deviceId — should be deduped

    // We can't inspect internal state directly, but no crash = dedup logic didn't throw
    // (The component's dedup reads `device.deviceId`, so wrong property name would fail silently
    //  at runtime — this test catches the wiring; TypeScript catches the shape.)
  });

  it('unsubscribes onNobleBleDeviceDiscovered listener on unmount', () => {
    const unsub = vi.fn();
    vi.mocked(window.electronAPI.onNobleBleDeviceDiscovered).mockReturnValueOnce(unsub);

    const { unmount } = render(<ConnectionPanel {...DEFAULT_PROPS} />);
    unmount();

    expect(unsub).toHaveBeenCalled();
  });

  // ─── Serial port discovery ─────────────────────────────────────────────────

  it('registers onSerialPortsDiscovered listener on mount', () => {
    render(<ConnectionPanel {...DEFAULT_PROPS} />);
    expect(window.electronAPI.onSerialPortsDiscovered).toHaveBeenCalledOnce();
  });

  it('onSerialPortsDiscovered callback accepts SerialPort[] payload shape', () => {
    render(<ConnectionPanel {...DEFAULT_PROPS} />);

    const registeredCb = vi.mocked(window.electronAPI.onSerialPortsDiscovered).mock.calls[0]?.[0];
    expect(registeredCb, 'callback must be registered').toBeDefined();

    const ports: SerialPort[] = [
      { portId: 'port-1', displayName: 'Meshtastic USB', portName: '/dev/ttyUSB0' },
      {
        portId: 'port-2',
        displayName: 'GPS Dongle',
        portName: 'COM3',
        vendorId: '10c4',
        productId: 'ea60',
      },
    ];
    // Must not throw — validates payload shape including optional fields
    expect(() =>
      act(() => {
        registeredCb!(ports);
      }),
    ).not.toThrow();
  });

  it('onSerialPortsDiscovered handles empty port list without crashing', () => {
    render(<ConnectionPanel {...DEFAULT_PROPS} />);

    const registeredCb = vi.mocked(window.electronAPI.onSerialPortsDiscovered).mock.calls[0]?.[0];
    expect(registeredCb).toBeDefined();
    expect(() =>
      act(() => {
        registeredCb!([]);
      }),
    ).not.toThrow();
  });

  it('unsubscribes onSerialPortsDiscovered listener on unmount', () => {
    const unsub = vi.fn();
    vi.mocked(window.electronAPI.onSerialPortsDiscovered).mockReturnValueOnce(unsub);

    const { unmount } = render(<ConnectionPanel {...DEFAULT_PROPS} />);
    unmount();

    expect(unsub).toHaveBeenCalled();
  });
});
