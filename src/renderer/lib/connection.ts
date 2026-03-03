import { MeshDevice } from "@meshtastic/core";
import { TransportWebBluetooth } from "@meshtastic/transport-web-bluetooth";
import { TransportWebSerial } from "@meshtastic/transport-web-serial";
import { TransportHTTP } from "@meshtastic/transport-http";
import type { ConnectionType } from "./types";

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
  httpAddress?: string
): Promise<MeshDevice> {
  let transport: { toDevice: WritableStream; fromDevice: ReadableStream; disconnect?: () => Promise<void> };

  switch (type) {
    case "ble": {
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

    case "serial":
      transport = await TransportWebSerial.create(115200);
      break;

    case "http": {
      if (!httpAddress) throw new Error("HTTP address required");
      // TransportHTTP.create() expects a raw hostname/IP, not a full URL.
      // It constructs http:// or https:// internally based on the tls flag.
      // Strip protocol if the user provided one.
      let host = httpAddress.trim();
      const useTls = host.startsWith("https://");
      host = host.replace(/^https?:\/\//, "");
      // Strip trailing slashes
      host = host.replace(/\/+$/, "");
      transport = await TransportHTTP.create(host, useTls);
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

  if (typeof navigator.bluetooth.getDevices === "function") {
    const devices = await navigator.bluetooth.getDevices();
    target = devices.find((d: any) => d.gatt && !d.gatt.connected)
      ?? devices.find((d: any) => d.gatt != null);
  } else {
    // getDevices() unavailable — fall back to the device captured at connect time
    target = capturedBleDevice ?? undefined;
  }

  if (!target) {
    throw new Error("No previously connected BLE device found for reconnection");
  }

  // Let the transport library handle GATT connection internally
  // (both createFromDevice and prepareConnection call gatt.connect())
  let transport: any;
  if (typeof (TransportWebBluetooth as any).createFromDevice === "function") {
    transport = await (TransportWebBluetooth as any).createFromDevice(target);
  } else if (typeof (TransportWebBluetooth as any).prepareConnection === "function") {
    transport = await (TransportWebBluetooth as any).prepareConnection(target);
  } else {
    throw new Error("TransportWebBluetooth has no method to create a transport from an existing device");
  }

  if (!transport) {
    throw new Error("Failed to create BLE transport for reconnection");
  }

  // Stash the BluetoothDevice reference for GATT monitoring
  (transport as any).__bluetoothDevice = target;

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
      msg.includes("not a function") ||
      msg.includes("already been closed") ||
      msg.includes("locked")
    ) {
      // BLE and HTTP transports don't implement disconnect() —
      // manually close the writable stream and GATT connection
      try {
        await device.transport.toDevice.close();
      } catch { /* already closed */ }

      // For BLE: disconnect the GATT server
      const btDevice = (device.transport as any)?.__bluetoothDevice;
      if (btDevice?.gatt?.connected) {
        try { btDevice.gatt.disconnect(); } catch { /* ignore */ }
      }
    } else {
      console.warn("Disconnect error:", err);
    }
  } finally {
    // Always complete device streams to prevent memory leaks
    try { device.complete(); } catch { /* already completed */ }
  }
}
