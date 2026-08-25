import { MeshDevice } from '@meshtastic/core';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

import { isPairingRelatedError } from '@/shared/blePairingError';
import { formatHostForSocket, formatHostForUrl, parseConnectHostPort } from '@/shared/connectHost';

import { isMainProcessBleTimeoutMessage } from './bleConnectErrors';
import { connectNobleBleWithScanBusyRetry } from './bleReconnectHelper';
import {
  assertMeshtasticSerialWebStreamsAvailable,
  assertTransportReadyForMeshDevice,
  formatJsonForRendererLog,
  getMeshtasticStreamsDiagnostics,
  logMeshtasticSerialStreamDiagnostics,
} from './connectionWebStreams';
import { notifyNobleBlePrimaryRfLinkReady } from './meshcoreDualNobleBleInit';
import { armMeshtasticLateConfigureRetryableSwallow } from './meshtastic/meshtasticConfigureRetry';
import { sendMeshtasticPhoneApiDisconnect } from './meshtastic/meshtasticPhoneApiDisconnect';
import { parseMeshtasticTcpAddress } from './parseMeshtasticTcpAddress';
import {
  isBlePeripheralConflictErrorMessage,
  isBleScanBusyErrorMessage,
} from './reticulum/reticulumBleAdapterLease';
import { SERIAL_OPEN_TIMEOUT_MS, withSerialTransportTimeout } from './serialPortRecovery';
import {
  getPortSignature,
  persistSerialPortIdentity,
  selectGrantedSerialPort,
} from './serialPortSignature';
import { TransportHttpIpc } from './transportHttpIpc';
import { TransportNobleIpc } from './transportNobleIpc';
import { TransportTcpIpc } from './transportTcpIpc';
import { TransportWebBluetoothIpc } from './transportWebBluetoothIpc';
import type { ConnectionType, NobleBleSessionId } from './types';

// HTTP base connection: timeouts and retries to avoid hanging on slow mDNS or flaky networks.
const HTTP_CONNECT_TIMEOUT_MS = 15_000;
/** Meshtastic native TCP streaming API (port 4403) connect timeout — matches main-process IPC. */
const TCP_CONNECT_TIMEOUT_MS = 20_000;
const BLE_CONNECT_MAX_ATTEMPTS = 2;
const BLE_CONNECT_RETRY_DELAY_MS = 1_500;

interface ConnectTimeoutTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

/** Race connect against a timeout; always tears down transport on failure to avoid orphaned IPC sockets. */
async function connectTransportWithTimeout(
  transport: ConnectTimeoutTransport,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    await Promise.race([transport.connect(), timeoutPromise]);
  } catch (err) {
    try {
      await transport.disconnect();
    } catch {
      // catch-no-log-ok best-effort disconnect after connect failure
    }
    throw err;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Serialize Noble BLE connects per session so overlapping attempts do not emit spurious disconnects. */
const nobleBleConnectLocks = new Map<NobleBleSessionId, Promise<void>>();

async function withNobleBleConnectLock<T>(
  sessionId: NobleBleSessionId,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = nobleBleConnectLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  nobleBleConnectLocks.set(sessionId, gate);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (nobleBleConnectLocks.get(sessionId) === gate) {
      nobleBleConnectLocks.delete(sessionId);
    }
  }
}

function logMeshtasticDeviceConnection(detail: string): void {
  const fn = window.electronAPI.log.logDeviceConnection;
  if (typeof fn === 'function') void fn(detail);
}

/** Maps opaque `pipeTo` failures inside @meshtastic/transport-web-serial to a clearer error. */
function rethrowIfTransportWebSerialPipeToFailed(err: unknown, phase: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('pipeTo')) {
    throw err instanceof Error ? err : new Error(String(err));
  }
  const diagJson = formatJsonForRendererLog({
    ...getMeshtasticStreamsDiagnostics(),
  });
  console.error(
    `[connection] Meshtastic serial ${phase}: pipeTo failure err=${msg} diagnostics=${diagJson}`,
  );
  throw new Error(
    `Meshtastic serial failed during ${phase} (Web Streams pipe). Often occurs when @meshtastic/core stream helpers are unavailable or the serial port streams are invalid. Diagnostics were logged to the console.`,
  );
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
  onLinkHealthy?: () => void,
): Promise<MeshDevice> {
  const isLinux = navigator.userAgent.toLowerCase().includes('linux');
  const connectStartedAt = Date.now();
  console.debug(
    `[connection] createBleConnection start peripheralId=${peripheralId ?? 'none'} sessionId=${sessionId} isLinux=${isLinux}`,
  );

  if (isLinux) {
    // Reset the pairing retry count so the first attempt uses the default PIN
    window.electronAPI.resetBlePairingRetryCount();

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= BLE_CONNECT_MAX_ATTEMPTS; attempt++) {
      const attemptStartedAt = Date.now();
      const transport = new TransportWebBluetoothIpc(sessionId);
      console.debug(
        `[connection] createBleConnection: using Web Bluetooth transport on Linux ${formatJsonForRendererLog(
          { attempt, maxAttempts: BLE_CONNECT_MAX_ATTEMPTS },
        )}`,
      );

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
        } else {
          console.debug(
            `[connection] createBleConnection: reusing granted device ${deviceId} (Linux)`,
          );
          await transport.requestGrantedDevice(deviceId);
        }

        // Now connect to the device
        await transport.connect(onLinkHealthy);
        if (attempt > 1) {
          console.info(
            `[connection] createBleConnection recovered on retry ${formatJsonForRendererLog({
              sessionId,
              deviceId,
              attempt,
              maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
              totalElapsedMs: Date.now() - connectStartedAt,
            })}`,
          );
        }
        console.debug('[connection] createBleConnection: connected on Linux');
        assertTransportReadyForMeshDevice(transport, 'Meshtastic BLE (Linux Web Bluetooth)');
        return new MeshDevice(transport);
      } catch (err) {
        lastError = err;
        // Clean up transport on failure before retry
        try {
          await transport.disconnect();
        } catch (cleanupErr) {
          console.debug(
            `[connection] createBleConnection: cleanup error on failure ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
          );
        }

        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = /timed out/i.test(message);
        const isPairingError = isPairingRelatedError(err);
        console.warn(
          `[connection] createBleConnection attempt failed ${formatJsonForRendererLog({
            sessionId,
            deviceId,
            attempt,
            maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
            isTimeout,
            isPairingError,
            attemptElapsedMs: Date.now() - attemptStartedAt,
            totalElapsedMs: Date.now() - connectStartedAt,
            message,
          })}`,
        );
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
  return withNobleBleConnectLock(sessionId, async () => {
    for (let attempt = 1; attempt <= BLE_CONNECT_MAX_ATTEMPTS; attempt++) {
      const attemptStartedAt = Date.now();
      try {
        // Waits out short Reticulum Noble yields (BLE RNode) instead of hard-failing;
        // peripheral conflict and other errors still fail immediately.
        await connectNobleBleWithScanBusyRetry(sessionId, peripheralId);
        notifyNobleBlePrimaryRfLinkReady(sessionId);
        if (attempt > 1) {
          console.info(
            `[connection] createBleConnection recovered on retry ${formatJsonForRendererLog({
              sessionId,
              peripheralId,
              attempt,
              maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
              totalElapsedMs: Date.now() - connectStartedAt,
            })}`,
          );
        }
        console.debug('[connection] createBleConnection connected', peripheralId);
        console.debug('[connection] createBleConnection elapsedMs', Date.now() - connectStartedAt);
        assertTransportReadyForMeshDevice(transport, 'Meshtastic BLE (Noble)');
        return new MeshDevice(transport);
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = isMainProcessBleTimeoutMessage(message) || /timed out/i.test(message);
        // Scan-busy already waited up to BLE_SCAN_BUSY_MAX_WAIT_MS; conflict is terminal.
        const noMoreAttempts =
          isBleScanBusyErrorMessage(message) || isBlePeripheralConflictErrorMessage(message);
        console.warn(
          `[connection] createBleConnection attempt failed ${formatJsonForRendererLog({
            sessionId,
            peripheralId,
            attempt,
            maxAttempts: BLE_CONNECT_MAX_ATTEMPTS,
            isTimeout,
            attemptElapsedMs: Date.now() - attemptStartedAt,
            totalElapsedMs: Date.now() - connectStartedAt,
            message,
          })}`,
        );
        if (noMoreAttempts || !isTimeout || attempt >= BLE_CONNECT_MAX_ATTEMPTS) {
          break;
        }
        await new Promise<void>((r) => setTimeout(r, BLE_CONNECT_RETRY_DELAY_MS));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('BLE connection failed');
  });
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
      assertMeshtasticSerialWebStreamsAvailable();
      console.debug(
        `[connection] Meshtastic serial Web Streams OK ${formatJsonForRendererLog({
          ...getMeshtasticStreamsDiagnostics(),
        })}`,
      );
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
              new Error(`Serial connection timed out after ${SERIAL_OPEN_TIMEOUT_MS / 1000}s`),
            );
          }, SERIAL_OPEN_TIMEOUT_MS),
        );
        try {
          transport = await Promise.race([serialPromise, serialTimeoutPromise]);
        } catch (err) {
          console.debug(
            `[connection] TransportWebSerial.create failed ${err instanceof Error ? err.message : String(err)}`,
          );
          rethrowIfTransportWebSerialPipeToFailed(err, 'TransportWebSerial.create');
        }
      } finally {
        serialApi.requestPort = origRequestPort;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
      if (capturedSerialPort) {
        persistSerialPortIdentity(capturedSerialPort);
      }
      {
        const parts = ['transport=serial', 'stack=meshtastic'];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
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
      let rawAddress = httpAddress.trim();
      const useTls = rawAddress.startsWith('https://');
      rawAddress = rawAddress.replace(/^https?:\/\//, '');
      rawAddress = rawAddress.replace(/\/+$/, '');
      const { host, port } = parseConnectHostPort(rawAddress, useTls ? 443 : 80);
      const urlHost = formatHostForUrl(host, port);
      console.debug(`[connection] createConnection: http address=${urlHost} tls=${useTls}`);
      const transport = new TransportHttpIpc(urlHost, useTls);
      await connectTransportWithTimeout(
        transport,
        HTTP_CONNECT_TIMEOUT_MS,
        `Connection to ${urlHost} timed out after ${HTTP_CONNECT_TIMEOUT_MS / 1000}s`,
      );
      logMeshtasticDeviceConnection(
        `transport=http stack=meshtastic host=${urlHost} tls=${useTls} port=${port}`,
      );
      assertTransportReadyForMeshDevice(transport, 'Meshtastic HTTP');
      return new MeshDevice(transport);
    }

    case 'tcp': {
      if (!httpAddress) throw new Error('TCP address required');
      const { host, port } = parseMeshtasticTcpAddress(httpAddress);
      const socketHost = formatHostForSocket(host);
      console.debug(`[connection] createConnection: tcp address=${socketHost}:${port}`);
      const transport = new TransportTcpIpc(socketHost, port);
      await connectTransportWithTimeout(
        transport,
        TCP_CONNECT_TIMEOUT_MS,
        `Connection to ${socketHost}:${port} timed out after ${TCP_CONNECT_TIMEOUT_MS / 1000}s`,
      );
      logMeshtasticDeviceConnection(
        `transport=tcp stack=meshtastic host=${socketHost} port=${port}`,
      );
      assertTransportReadyForMeshDevice(transport, 'Meshtastic TCP');
      return new MeshDevice(transport);
    }

    default:
      throw new Error(`Unknown connection type: ${type}`);
  }

  // NOTE: Do NOT call device.configure() here. It must be called AFTER
  // event subscriptions are set up in useMeshtasticRuntime, otherwise the initial
  // node/channel/config dump is emitted before any listeners exist.

  assertTransportReadyForMeshDevice(transport, 'Meshtastic serial');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- External SDK value is validated by surrounding boundary logic.
  return new MeshDevice(transport as any);
}

/** Resolve the underlying Web Serial port from Meshtastic transport wrappers. */
export function getSerialPortFromMeshTransport(transport: unknown): SerialPort | null {
  const candidate = transport as { port?: SerialPort; connection?: SerialPort } | null | undefined;
  if (candidate?.port && typeof candidate.port.close === 'function') {
    return candidate.port;
  }
  if (candidate?.connection && typeof candidate.connection.close === 'function') {
    return candidate.connection;
  }
  return null;
}

/**
 * Resolve the Linux Web Bluetooth device id a gesture-based connect actually landed on.
 * `createBleConnection`'s Linux picker flow may run without a caller-supplied peripheralId
 * (e.g. ConnectionPanel's Reconnect button), so this backfills reconnect state afterward —
 * otherwise a later automatic reconnect has no id and falls back to `requestDevice()`, which
 * Chromium refuses to run without a live user gesture.
 */
export function getBlePeripheralIdFromMeshTransport(transport: unknown): string | null {
  const candidate = transport as { getConnectedDeviceId?: () => string | null } | null | undefined;
  if (typeof candidate?.getConnectedDeviceId === 'function') {
    return candidate.getConnectedDeviceId();
  }
  return null;
}

/** Best-effort close of an open Web Serial port before reconnect. */
export async function closeSerialPortIfOpen(port: SerialPort): Promise<void> {
  if (!port.readable && !port.writable) return;
  try {
    await port.close();
  } catch (e) {
    console.debug(
      `[connection] closeSerialPortIfOpen ${e instanceof Error ? e.message : String(e)}`,
    );
  }
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
  await closeSerialPortIfOpen(port);
  persistSerialPortIdentity(port);
  console.debug(
    `[connection] reconnectSerial: using port portId=${(port as SerialPort & { portId?: string }).portId ?? 'none'} usbVendor=${port.getInfo().usbVendorId ?? 'n/a'} usbProduct=${port.getInfo().usbProductId ?? 'n/a'}`,
  );

  assertMeshtasticSerialWebStreamsAvailable();
  console.debug(
    `[connection] reconnectSerial Web Streams OK ${formatJsonForRendererLog({
      ...getMeshtasticStreamsDiagnostics(),
    })}`,
  );
  let transport: Awaited<ReturnType<typeof TransportWebSerial.createFromPort>>;
  try {
    transport = await withSerialTransportTimeout(
      TransportWebSerial.createFromPort(port, 115200),
      'Meshtastic serial reconnect',
    );
  } catch (err) {
    console.warn(
      `[connection] TransportWebSerial.createFromPort failed ${err instanceof Error ? err.message : String(err)}`,
    );
    logMeshtasticSerialStreamDiagnostics('reconnectSerial createFromPort failed', null, port);
    rethrowIfTransportWebSerialPipeToFailed(err, 'TransportWebSerial.createFromPort');
  }
  {
    const sig = getPortSignature(port);
    const pid = (port as SerialPort & { portId?: string }).portId;
    const parts = ['transport=serial', 'stack=meshtastic'];
    if (pid) parts.push(`portId=${pid}`);
    if (sig.usbVendorId != null) parts.push(`usbVendorId=${sig.usbVendorId}`);
    if (sig.usbProductId != null) parts.push(`usbProductId=${sig.usbProductId}`);
    logMeshtasticDeviceConnection(parts.join(' '));
  }
  assertTransportReadyForMeshDevice(transport, 'Meshtastic serial (reconnect)');
  return new MeshDevice(transport);
}

/** Best-effort cancel of Meshtastic inbound decode stream (serial and HTTP). */
async function cancelMeshtasticFromDeviceBestEffort(
  transport: MeshDevice['transport'],
): Promise<void> {
  const fromDevice = transport.fromDevice as ReadableStream | undefined;
  if (!fromDevice || typeof fromDevice.cancel !== 'function') return;
  try {
    await fromDevice.cancel();
  } catch (e) {
    console.debug(
      `[connection] safeDisconnect fromDevice.cancel ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Safely disconnect from a device, handling transports that may not
 * have a disconnect() method (e.g. TransportHTTP).
 */
function isBenignMeshtasticDisconnectError(msg: string): boolean {
  return (
    msg.includes('not a function') ||
    msg.includes('already been closed') ||
    msg.includes('locked') ||
    msg.includes("reading 'close'") ||
    msg.includes('Cannot read properties of undefined')
  );
}

async function closeMeshtasticTransportStreamsBestEffort(
  transport: MeshDevice['transport'] | undefined,
): Promise<void> {
  if (!transport) return;
  try {
    const toDevice = transport.toDevice as
      { close?: () => Promise<void>; getWriter?: () => unknown } | undefined;
    if (toDevice != null && typeof toDevice.close === 'function') {
      await toDevice.close();
    }
  } catch (e) {
    console.debug(
      `[connection] safeDisconnect toDevice.close ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  await cancelMeshtasticFromDeviceBestEffort(transport);
  // device.disconnect() (SDK) can throw before reaching its own `await this.transport.disconnect()`
  // call (e.g. a race with an in-flight queue write/heartbeat) — ensure the underlying HTTP
  // polling interval / TCP socket is still torn down rather than left orphaned until the next
  // connect's defensive cleanup runs. Harmless no-op if already disconnected.
  const transportDisconnect = (transport as { disconnect?: () => Promise<void> }).disconnect;
  if (typeof transportDisconnect === 'function') {
    try {
      await transportDisconnect.call(transport);
    } catch (e) {
      console.debug(
        `[connection] safeDisconnect transport.disconnect ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

export async function safeDisconnect(device: MeshDevice): Promise<void> {
  // Arm the swallow window before teardown: device.disconnect() clears the SDK queue, so any
  // in-flight sendPacket().wait() then rejects with "Packet does not exist". These are expected
  // teardown races and must not surface as unhandled-rejection error logs.
  armMeshtasticLateConfigureRetryableSwallow();
  // Serial only: tell firmware PhoneAPI to reset before we drop the CDC streams (#895).
  if (getSerialPortFromMeshTransport(device.transport)) {
    await sendMeshtasticPhoneApiDisconnect(device);
  }
  try {
    await device.disconnect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isBenignMeshtasticDisconnectError(msg)) {
      console.warn(
        `[useMeshtasticRuntime] Disconnect error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // HTTP and torn-down transports may lack disconnect() or already-closed streams.
    await closeMeshtasticTransportStreamsBestEffort(device.transport);
  } finally {
    const serialPort = getSerialPortFromMeshTransport(device.transport);
    if (serialPort) {
      await cancelMeshtasticFromDeviceBestEffort(device.transport);
      await closeSerialPortIfOpen(serialPort);
      logMeshtasticSerialStreamDiagnostics(
        'safeDisconnect after serial teardown',
        device.transport,
        serialPort,
      );
    }
    // Always complete device streams to prevent memory leaks
    try {
      device.complete();
    } catch (e) {
      console.debug(
        `[connection] safeDisconnect complete ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
