import { MeshDevice } from '@meshtastic/core';
import { TransportHTTP } from '@meshtastic/transport-http';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

import { isMainProcessBleTimeoutMessage } from './bleConnectErrors';
import {
  getPortSignature,
  persistSerialPortIdentity,
  selectGrantedSerialPort,
} from './serialPortSignature';
import { TransportNobleIpc } from './transportNobleIpc';
import { TransportWebBluetoothIpc } from './transportWebBluetoothIpc';
import type { ConnectionType, NobleBleSessionId } from './types';

// HTTP base connection: timeouts and retries to avoid hanging on slow mDNS or flaky networks.
const HTTP_CONNECT_TIMEOUT_MS = 15_000;
const HTTP_PREFLIGHT_RETRIES = 3;
const HTTP_PREFLIGHT_RETRY_DELAY_MS = 2_000;
const BLE_CONNECT_MAX_ATTEMPTS = 2;
const BLE_CONNECT_RETRY_DELAY_MS = 1_500;

function logMeshtasticDeviceConnection(detail: string): void {
  const fn = window.electronAPI?.log?.logDeviceConnection;
  if (typeof fn === 'function') void fn(detail);
}

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => {
    ac.abort();
  }, timeoutMs);
  return fetch(url, { signal: ac.signal }).finally(() => {
    clearTimeout(t);
  });
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
      console.debug(
        `[connection] HTTP preflight attempt ${attempt}/${HTTP_PREFLIGHT_RETRIES} failed: ${lastErr.message}`,
      );
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

/**
 * Create a BLE connection to a Meshtastic device.
 *
 * On Mac/Windows: The main process NobleBleManager must have already discovered the peripheral
 * (via startNobleBleScanning) before this is called.
 *
 * On Linux: Uses Web Bluetooth directly in the renderer.
 */
export async function createBleConnection(
  peripheralId?: string,
  sessionId: NobleBleSessionId = 'meshtastic',
): Promise<MeshDevice> {
  const isLinux = navigator.userAgent.toLowerCase().includes('linux');
  const connectStartedAt = Date.now();
  console.debug('[connection] createBleConnection start', peripheralId, { isLinux });

  if (isLinux) {
    // Reset the pairing retry count so the first attempt uses the default PIN
    window.electronAPI.resetBlePairingRetryCount();

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= BLE_CONNECT_MAX_ATTEMPTS; attempt++) {
      const attemptStartedAt = Date.now();
      const transport = new TransportWebBluetoothIpc(sessionId);
      console.debug('[connection] createBleConnection: using Web Bluetooth transport on Linux', {
        attempt,
        maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
      });

      // On Linux, requestDevice() must be called with a user gesture
      // If no peripheralId provided, initiate device selection now
      let deviceId = peripheralId;
      try {
        if (!deviceId) {
          console.debug('[connection] createBleConnection: requesting device selection (Linux)');
          const deviceInfo = await transport.requestDevice();
          deviceId = deviceInfo.deviceId;
          const deviceName = deviceInfo.deviceName;
          console.debug('[connection] createBleConnection: device selected', deviceId, deviceName);
        }

        // Now connect to the device
        await transport.connect();
        if (attempt > 1) {
          console.info('[connection] createBleConnection recovered on retry', {
            sessionId,
            deviceId,
            attempt,
            maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
            totalElapsedMs: Date.now() - connectStartedAt,
          });
        }
        console.debug('[connection] createBleConnection: connected on Linux');
        return new MeshDevice(transport as any);
      } catch (err) {
        lastError = err;
        // Clean up transport on failure before retry
        try {
          await transport.disconnect();
        } catch (cleanupErr) {
          console.debug('[connection] createBleConnection: cleanup error on failure', cleanupErr);
        }

        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = /timed out/i.test(message);
        const isPairingError =
          err instanceof Error && (err as Error & { isPairingRelated?: boolean }).isPairingRelated;
        console.warn('[connection] createBleConnection attempt failed', {
          sessionId,
          deviceId,
          attempt,
          maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
          isTimeout,
          isPairingError,
          attemptElapsedMs: Date.now() - attemptStartedAt,
          totalElapsedMs: Date.now() - connectStartedAt,
          message,
        });
        // Don't retry on pairing errors (user needs to fix pairing, not retry)
        if (isPairingError || !isTimeout || attempt >= BLE_CONNECT_MAX_ATTEMPTS) {
          break;
        }
        await new Promise<void>((r) => setTimeout(r, BLE_CONNECT_RETRY_DELAY_MS));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('BLE connection failed');
  }

  // Mac/Windows: use Noble IPC transport
  // Subscribe to IPC events before telling main to connect, so no fromRadio
  // packets emitted during the initial drain are dropped.
  if (!peripheralId) {
    throw new Error('BLE peripheral ID required on Mac/Windows');
  }
  const transport = new TransportNobleIpc(sessionId);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= BLE_CONNECT_MAX_ATTEMPTS; attempt++) {
    const attemptStartedAt = Date.now();
    try {
      const connectResult = await window.electronAPI.connectNobleBle(sessionId, peripheralId);
      if (!connectResult.ok) {
        throw new Error(connectResult.error || 'BLE connect failed');
      }
      if (attempt > 1) {
        console.info('[connection] createBleConnection recovered on retry', {
          sessionId,
          peripheralId,
          attempt,
          maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
          totalElapsedMs: Date.now() - connectStartedAt,
        });
      }
      console.debug('[connection] createBleConnection connected', peripheralId);
      console.debug('[connection] createBleConnection elapsedMs', Date.now() - connectStartedAt);
      return new MeshDevice(transport as any);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = isMainProcessBleTimeoutMessage(message) || /timed out/i.test(message);
      console.warn('[connection] createBleConnection attempt failed', {
        sessionId,
        peripheralId,
        attempt,
        maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
        isTimeout,
        attemptElapsedMs: Date.now() - attemptStartedAt,
        totalElapsedMs: Date.now() - connectStartedAt,
        message,
      });
      if (!isTimeout || attempt >= BLE_CONNECT_MAX_ATTEMPTS) {
        break;
      }
      await new Promise<void>((r) => setTimeout(r, BLE_CONNECT_RETRY_DELAY_MS));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('BLE connection failed');
}

/**
 * Create a connection to a Meshtastic device.
 *
 * Serial: Triggers navigator.serial.requestPort() which Electron
 *   intercepts via select-serial-port.
 *
 * HTTP: Connects directly to a WiFi-enabled Meshtastic node.
 *
 * BLE: Use createBleConnection() instead.
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
    case 'ble':
      throw new Error('Use createBleConnection(peripheralId) for BLE connections');

    case 'serial': {
      console.debug('[connection] createConnection: serial');
      if (!navigator.serial?.requestPort) {
        throw new Error('Web Serial API not available');
      }
      const SERIAL_CONNECT_TIMEOUT_MS = 15_000;
      const serialApi = navigator.serial;
      const origRequestPort = serialApi.requestPort.bind(serialApi);
      let capturedSerialPort: SerialPort | null = null;
      serialApi.requestPort = async (options?: { filters?: unknown[] }) => {
        const p = await origRequestPort(options);
        capturedSerialPort = p;
        return p;
      };
      try {
        const serialPromise = TransportWebSerial.create(115200);
        const serialTimeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => {
            reject(
              new Error(`Serial connection timed out after ${SERIAL_CONNECT_TIMEOUT_MS / 1000}s`),
            );
          }, SERIAL_CONNECT_TIMEOUT_MS),
        );
        transport = await Promise.race([serialPromise, serialTimeoutPromise]);
      } finally {
        serialApi.requestPort = origRequestPort;
      }
      if (capturedSerialPort) {
        persistSerialPortIdentity(capturedSerialPort);
      }
      {
        const parts = ['transport=serial', 'stack=meshtastic'];
        if (capturedSerialPort) {
          const pid = (capturedSerialPort as SerialPort & { portId?: string }).portId;
          const sig = getPortSignature(capturedSerialPort);
          if (pid) parts.push(`portId=${pid}`);
          if (sig.usbVendorId != null) parts.push(`usbVendorId=${sig.usbVendorId}`);
          if (sig.usbProductId != null) parts.push(`usbProductId=${sig.usbProductId}`);
        }
        logMeshtasticDeviceConnection(parts.join(' '));
      }
      break;
    }

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
      // Normalize bare IPv6 addresses - browsers require brackets: [fe80::1]
      if (host.includes(':') && !host.startsWith('[')) {
        host = `[${host}]`;
      }
      console.debug(`[connection] createConnection: http address=${host} tls=${useTls}`);
      const connectionUrl = `${useTls ? 'https' : 'http'}://${host}`;
      await httpPreflightWithRetries(connectionUrl);
      const createPromise = TransportHTTP.create(host, useTls);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(
            new Error(`Connection to ${host} timed out after ${HTTP_CONNECT_TIMEOUT_MS / 1000}s`),
          );
        }, HTTP_CONNECT_TIMEOUT_MS),
      );
      transport = await Promise.race([createPromise, timeoutPromise]);
      {
        const httpPort = useTls ? 443 : 80;
        logMeshtasticDeviceConnection(
          `transport=http stack=meshtastic host=${host} tls=${useTls} port=${httpPort}`,
        );
      }
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
 * Attempt to reconnect to a previously-granted serial port without
 * requiring a new user gesture. Uses navigator.serial.getPorts() to
 * enumerate ports that were previously granted permission.
 *
 * @param lastPortId - The portId stored from the last manual selection when
 *   Chromium exposes it; otherwise matching uses saved USB/Bluetooth signature
 *   from `serialPortSignature.ts` (same store as MeshCore).
 */
export async function reconnectSerial(lastPortId?: string | null): Promise<MeshDevice> {
  if (!navigator.serial?.getPorts) {
    throw new Error('Web Serial API not available');
  }
  const ports = await navigator.serial.getPorts();
  console.debug(
    `[connection] reconnectSerial: getPorts returned ${ports.length} port(s), lastPortId=${lastPortId ?? 'none'}`,
  );
  const port = selectGrantedSerialPort(ports, lastPortId);
  persistSerialPortIdentity(port);
  console.debug(
    `[connection] reconnectSerial: using port portId=${(port as SerialPort & { portId?: string }).portId ?? 'none'} usbVendor=${port.getInfo?.().usbVendorId ?? 'n/a'} usbProduct=${port.getInfo?.().usbProductId ?? 'n/a'}`,
  );

  const transport = await TransportWebSerial.createFromPort(port, 115200);
  {
    const sig = getPortSignature(port);
    const pid = (port as SerialPort & { portId?: string }).portId;
    const parts = ['transport=serial', 'stack=meshtastic'];
    if (pid) parts.push(`portId=${pid}`);
    if (sig.usbVendorId != null) parts.push(`usbVendorId=${sig.usbVendorId}`);
    if (sig.usbProductId != null) parts.push(`usbProductId=${sig.usbProductId}`);
    logMeshtasticDeviceConnection(parts.join(' '));
  }
  const device = new MeshDevice(transport as any);
  return device;
}

/**
 * Safely disconnect from a device, handling transports that may not
 * have a disconnect() method (e.g. TransportHTTP).
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
      // HTTP transport doesn't implement disconnect() - manually close the streams
      try {
        await device.transport.toDevice.close();
      } catch (e) {
        console.debug('[connection] safeDisconnect toDevice.close', e);
      }

      // Close fromDevice stream to prevent GC leaks and lingering fetches (HTTP)
      try {
        await (device.transport.fromDevice as ReadableStream).cancel();
      } catch (e) {
        console.debug('[connection] safeDisconnect fromDevice.cancel', e);
      }
    } else {
      console.warn('[Meshtastic] Disconnect error:', err);
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
