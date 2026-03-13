import { MeshDevice } from '@meshtastic/core';
import { TransportHTTP } from '@meshtastic/transport-http';
import { TransportWebBluetooth } from '@meshtastic/transport-web-bluetooth';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

import type { ConnectionType } from './types';

// HTTP base connection: timeouts and retries to avoid hanging on slow mDNS or flaky networks.
const HTTP_CONNECT_TIMEOUT_MS = 15_000;
const HTTP_PREFLIGHT_RETRIES = 3;
const HTTP_PREFLIGHT_RETRY_DELAY_MS = 2_000;

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
}

async function httpPreflightWithRetries(connectionUrl: string): Promise<void> {
  const reportUrl = `${connectionUrl}/json/report`;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= HTTP_PREFLIGHT_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(reportUrl, HTTP_CONNECT_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < HTTP_PREFLIGHT_RETRIES) {
        await new Promise((r) => setTimeout(r, HTTP_PREFLIGHT_RETRY_DELAY_MS));
      }
    }
  }
  const msg =
    lastErr?.name === 'AbortError'
      ? `Connection timed out after ${HTTP_CONNECT_TIMEOUT_MS / 1000}s. Try the device's IP address if you use meshtastic.local.`
      : (lastErr?.message ?? 'Connection failed');
  throw new Error(msg);
}

// Cached BluetoothDevice from the most recent successful BLE connection.
// navigator.bluetooth.getDevices() is not available in all Electron builds,
// so we capture the reference by intercepting requestDevice() instead.
let capturedBleDevice: BluetoothDevice | null = null;

export function clearCapturedBleDevice(): void {
  capturedBleDevice = null;
}

/**
 * Create a connection to a Meshtastic device.
 *
 * BLE: Triggers Chromium's navigator.bluetooth.requestDevice() which
 *   Electron intercepts via select-bluetooth-device. The main process
 *   sends the device list to the renderer for user selection.
 *
 * Serial: Triggers navigator.serial.requestPort() which Electron
 *   intercepts via select-serial-port. Same flow as BLE.
 *
 * HTTP: Connects directly to a WiFi-enabled Meshtastic node.
 */
export async function createConnection(
  type: ConnectionType,
  httpAddress?: string,
): Promise<MeshDevice> {
  let transport: {
    toDevice: WritableStream;
    fromDevice: ReadableStream;
    disconnect?: () => Promise<void>;
  };

  switch (type) {
    case 'ble': {
      // Intercept requestDevice to capture the BluetoothDevice reference
      // before the transport library discards it. This is more reliable than
      // navigator.bluetooth.getDevices() which isn't available in all builds.
      const origRequestDevice = navigator.bluetooth.requestDevice.bind(navigator.bluetooth);
      navigator.bluetooth.requestDevice = async (options?: RequestDeviceOptions) => {
        const device = await origRequestDevice(options);
        capturedBleDevice = device;
        return device;
      };
      try {
        transport = await TransportWebBluetooth.create();
      } finally {
        navigator.bluetooth.requestDevice = origRequestDevice;
      }
      if (capturedBleDevice) {
        (transport as any).__bluetoothDevice = capturedBleDevice;
      }
      break;
    }

    case 'serial':
      transport = await TransportWebSerial.create(115200);
      break;

    case 'http': {
      if (!httpAddress) throw new Error('HTTP address required');
      // TransportHTTP.create() expects a raw hostname/IP, not a full URL.
      // It constructs http:// or https:// internally based on the tls flag.
      // Strip protocol if the user provided one.
      let host = httpAddress.trim();
      const useTls = host.startsWith('https://');
      host = host.replace(/^https?:\/\//, '');
      // Strip trailing slashes
      host = host.replace(/\/+$/, '');
      const connectionUrl = `${useTls ? 'https' : 'http'}://${host}`;
      await httpPreflightWithRetries(connectionUrl);
      const createPromise = TransportHTTP.create(host, useTls);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Connection to ${host} timed out after ${HTTP_CONNECT_TIMEOUT_MS / 1000}s`),
            ),
          HTTP_CONNECT_TIMEOUT_MS,
        ),
      );
      transport = await Promise.race([createPromise, timeoutPromise]);
      break;
    }

    default:
      throw new Error(`Unknown connection type: ${type}`);
  }

  const device = new MeshDevice(transport as any);

  // NOTE: Do NOT call device.configure() here. It must be called AFTER
  // event subscriptions are set up in useDevice.ts, otherwise the initial
  // node/channel/config dump is emitted before any listeners exist.

  return device;
}

/**
 * Attempt to reconnect to a previously-paired BLE device without
 * requiring a new user gesture. Uses navigator.bluetooth.getDevices()
 * to find the device that was previously granted permission.
 */
export async function reconnectBle(): Promise<MeshDevice> {
  let target: BluetoothDevice | undefined;

  if (typeof navigator.bluetooth.getDevices === 'function') {
    const devices = await navigator.bluetooth.getDevices();
    // Prefer disconnected-but-known GATT; else any with gatt; else first granted
    // device — gatt is often null until connect(); createFromDevice/prepareConnection
    // will call gatt.connect(). On some Electron builds getDevices() stays empty
    // after grant; ConnectionPanel uses onConnect('ble') in the gesture path only.
    target =
      devices.find((d: any) => d.gatt && !d.gatt.connected) ??
      devices.find((d: any) => d.gatt != null) ??
      (devices.length > 0 ? devices[0] : undefined);
  } else {
    // getDevices() unavailable — fall back to the device captured at connect time
    target = capturedBleDevice ?? undefined;
  }

  if (!target) {
    throw new Error('No previously connected BLE device found for reconnection');
  }

  // Let the transport library handle GATT connection internally
  // (both createFromDevice and prepareConnection call gatt.connect())
  let transport: any;
  if (typeof (TransportWebBluetooth as any).createFromDevice === 'function') {
    transport = await (TransportWebBluetooth as any).createFromDevice(target);
  } else if (typeof (TransportWebBluetooth as any).prepareConnection === 'function') {
    transport = await (TransportWebBluetooth as any).prepareConnection(target);
  } else {
    throw new Error(
      'TransportWebBluetooth has no method to create a transport from an existing device',
    );
  }

  if (!transport) {
    throw new Error('Failed to create BLE transport for reconnection');
  }

  // Stash the BluetoothDevice reference for GATT monitoring
  (transport as any).__bluetoothDevice = target;

  const device = new MeshDevice(transport as any);
  return device;
}

/**
 * Attempt to reconnect to a previously-granted serial port without
 * requiring a new user gesture. Uses navigator.serial.getPorts() to
 * enumerate ports that were previously granted permission.
 *
 * @param lastPortId - The portId stored from the last manual selection.
 *   Used to match the correct port when multiple ports are available.
 */
export async function reconnectSerial(lastPortId?: string | null): Promise<MeshDevice> {
  if (!navigator.serial?.getPorts) {
    throw new Error('Web Serial API not available');
  }
  const ports = await navigator.serial.getPorts();
  if (ports.length === 0) {
    throw new Error('No previously granted serial ports found');
  }
  // Try to match the previously-selected port by ID; fall back to first
  let port: SerialPort | undefined;
  if (lastPortId) {
    port = (ports as any[]).find((p: any) => p.portId === lastPortId);
  }
  port = port ?? ports[0];

  const transport = await TransportWebSerial.createFromPort(port, 115200);
  const device = new MeshDevice(transport as any);
  return device;
}

/**
 * Safely disconnect from a device, handling transports that may not
 * have a disconnect() method (e.g. TransportWebBluetooth).
 */
export async function safeDisconnect(device: MeshDevice): Promise<void> {
  try {
    await device.disconnect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('not a function') ||
      msg.includes('already been closed') ||
      msg.includes('locked')
    ) {
      // BLE and HTTP transports don't implement disconnect() —
      // manually close the writable stream and GATT connection
      try {
        await device.transport.toDevice.close();
      } catch (e) {
        console.debug('[connection] safeDisconnect toDevice.close', e);
      }

      // For BLE: disconnect the GATT server
      const btDevice = (device.transport as any)?.__bluetoothDevice;
      if (btDevice?.gatt?.connected) {
        try {
          btDevice.gatt.disconnect();
        } catch (e) {
          console.debug('[connection] safeDisconnect gatt.disconnect', e);
        }
      }
    } else {
      console.warn('Disconnect error:', err);
    }
  } finally {
    // Always complete device streams to prevent memory leaks
    try {
      device.complete();
    } catch (e) {
      console.debug('[connection] safeDisconnect complete', e);
    }
  }
}
