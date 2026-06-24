import { Connection, SerialConnection, WebSerialConnection } from '@liamcottle/meshcore.js';

import { withTimeout } from '../../../../shared/withTimeout';
import { isMeshcoreRetryableBleErrorMessage } from '../../bleConnectErrors';
import { closeSerialPortIfOpen } from '../../connection';
import { MeshcoreCompanionTxEchoFilter } from '../../meshcoreCompanionTxEchoFilter';
import { MeshcoreWebBluetoothConnection } from '../../meshcoreWebBluetoothConnection';
import { createSerializedWritableStream } from '../../meshtastic/meshtasticTransportLossDetection';
import { parseTcpAddress } from '../../parseTcpAddress';
import { persistSerialPortIdentity, selectGrantedSerialPort } from '../../serialPortSignature';
import { TransportWebBluetoothIpc } from '../../transportWebBluetoothIpc';
import type { NobleBleSessionId } from '../../types';

// ─── Public params type ───────────────────────────────────────────────────────

export type MeshCoreTransportParams =
  | { transport: 'ble'; blePeripheralId?: string }
  | { transport: 'tcp'; host: string }
  | { transport: 'serial' };

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Create and open a raw MeshCore `Connection` for the given transport.
 * The caller is responsible for calling `conn.close()` when done.
 */
export async function createMeshCoreConnection(
  params: MeshCoreTransportParams,
): Promise<Connection> {
  if (params.transport === 'tcp') return connectTcp(params.host);
  if (params.transport === 'serial') return connectSerial();
  // BLE: Linux uses Web Bluetooth renderer-side; Mac/Windows use Noble IPC
  if (rendererLikelyLinux()) return connectBleWebBluetooth();
  if (!params.blePeripheralId) throw new Error('BLE peripheral ID required');
  return connectBleNoble(params.blePeripheralId);
}

// ─── Platform detection ───────────────────────────────────────────────────────

function rendererLikelyWin32(): boolean {
  try {
    if (typeof process !== 'undefined' && process.platform === 'win32') return true;
  } catch {
    // catch-no-log-ok process access can throw in renderer bundles
  }
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/Windows/i.test(ua)) return true;
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  if (plat && /Windows/i.test(plat)) return true;
  return !!(navigator.platform && /Win/i.test(navigator.platform));
}

function rendererLikelyLinux(): boolean {
  try {
    if (typeof process !== 'undefined' && process.platform === 'linux') return true;
  } catch {
    // catch-no-log-ok process access can throw in renderer bundles
  }
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/Linux/i.test(ua)) return true;
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  if (plat && /Linux/i.test(plat)) return true;
  return !!(navigator.platform && /Linux/i.test(navigator.platform));
}

// ─── Timeouts / retry limits ──────────────────────────────────────────────────

const NOBLE_IPC_CONNECT_TIMEOUT_MS = 120_000;

/** WinRT + companion handshake can be slower than CoreBluetooth. */
const NOBLE_IPC_HANDSHAKE_TIMEOUT_MS = rendererLikelyWin32()
  ? 45_000
  : rendererLikelyLinux()
    ? 60_000
    : 20_000;

const NOBLE_IPC_CONNECT_MAX_ATTEMPTS = 2;
const WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS = 2;
const WEB_BLUETOOTH_CONNECT_RETRY_DELAY_MS = 1_500;

// ─── Internal type shims ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SerialConnectionInstance extends InstanceType<typeof SerialConnection> {}

interface NobleIpcMeshcoreConnectionInstance {
  emit(event: string | number, ...args: unknown[]): void;
  onConnected(): Promise<void>;
  onDisconnected(): void;
  onFrameReceived(frame: Uint8Array): void;
}

const MeshcoreConnectionBase =
  Connection as unknown as new () => NobleIpcMeshcoreConnectionInstance;

// ─── TCP ──────────────────────────────────────────────────────────────────────

class IpcTcpConnection {
  private readonly host: string;
  private readonly port: number;
  private inner: SerialConnectionInstance | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(host: string, port = 5000) {
    this.host = host;
    this.port = port;
  }

  async connect(): Promise<void> {
    class TcpOverIpc extends (SerialConnection as unknown as new () => SerialConnectionInstance) {
      async write(bytes: Uint8Array) {
        try {
          await window.electronAPI.meshcore.tcp.write(Array.from(bytes));
        } catch (e) {
          console.error('[IpcTcpConnection] write error', e);
          throw e;
        }
      }
      async close() {
        await window.electronAPI.meshcore.tcp.disconnect();
      }
    }

    try {
      const instance = new TcpOverIpc();
      this.inner = instance;
      const offData = window.electronAPI.meshcore.tcp.onData((bytes) => {
        void instance.onDataReceived(bytes);
      });
      const offDisc = window.electronAPI.meshcore.tcp.onDisconnected(() => {
        instance.onDisconnected();
      });
      this.cleanupFns = [offData, offDisc];
      await window.electronAPI.meshcore.tcp.connect(this.host, this.port);
      await instance.onConnected();
    } catch (e) {
      console.error('[IpcTcpConnection] connect/onConnected error', e);
      this.cleanup();
      throw e;
    }
  }

  get connection(): Connection {
    if (!this.inner) throw new Error('IpcTcpConnection not connected');
    return this.inner;
  }

  cleanup(): void {
    this.cleanupFns.forEach((fn) => {
      fn();
    });
    this.cleanupFns = [];
  }
}

async function connectTcp(hostAddr: string): Promise<Connection> {
  const { host, port } = parseTcpAddress(hostAddr);
  const tcp = new IpcTcpConnection(host, port);
  await tcp.connect();
  return tcp.connection;
}

// ─── Serial ───────────────────────────────────────────────────────────────────

/** WebSerialConnection instance — meshcore.js assigns `.writable` for frame writes. */
type MeshcoreWebSerialConn = Connection & { writable: WritableStream<Uint8Array> };

/**
 * MeshCore's WebSerialConnection calls `this.writable.getWriter()` per frame write with no
 * serialization; concurrent init RPCs (getSelfInfo, getContacts, getChannels, setAdvertLatLong)
 * throw WritableStream locked and stall contact sync.
 *
 * Patch the connection instance (not the SerialPort) so native port methods keep correct `this`.
 */
export function patchMeshcoreWebSerialWritable(
  conn: MeshcoreWebSerialConn,
  rawWritable: WritableStream<Uint8Array>,
): void {
  conn.writable = createSerializedWritableStream(rawWritable);
}

async function openSerialPort(port: SerialPort): Promise<Connection> {
  persistSerialPortIdentity(port);
  await (port as unknown as { open(opts: object): Promise<void> }).open({ baudRate: 115200 });
  const rawWritable = port.writable;
  const conn = new (WebSerialConnection as unknown as new (port: unknown) => MeshcoreWebSerialConn)(
    port,
  );
  patchMeshcoreWebSerialWritable(conn, rawWritable);
  return conn;
}

async function connectSerial(): Promise<Connection> {
  if (!navigator.serial?.requestPort) throw new Error('Web Serial API not available');
  const port = await navigator.serial.requestPort();
  return openSerialPort(port);
}

/** Gesture-free serial reconnect using a previously granted port id or signature. */
export async function reconnectMeshcoreSerial(lastPortId?: string | null): Promise<Connection> {
  if (!navigator.serial?.getPorts) {
    throw new Error('Web Serial API not available');
  }
  const ports = await navigator.serial.getPorts();
  const port = selectGrantedSerialPort(ports, lastPortId);
  await closeSerialPortIfOpen(port);
  return openSerialPort(port);
}

// ─── BLE: Noble IPC (Mac / Windows) ──────────────────────────────────────────

class IpcNobleConnection {
  /** Serialises concurrent meshcore Noble connects to avoid adapter contention. */
  private static meshcoreConnectChain = Promise.resolve();

  private readonly peripheralId: string;
  private readonly sessionId: NobleBleSessionId;
  private readonly txEchoFilter = new MeshcoreCompanionTxEchoFilter();
  private inner: NobleIpcMeshcoreConnectionInstance | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(peripheralId: string, sessionId: NobleBleSessionId = 'meshcore') {
    this.peripheralId = peripheralId;
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    const runConnect = async () => {
      const { sessionId } = this;
      const txEchoFilter = this.txEchoFilter;

      class NobleOverIpc extends MeshcoreConnectionBase {
        constructor(private readonly session: NobleBleSessionId) {
          super();
        }
        async sendToRadioFrame(data: Uint8Array) {
          txEchoFilter.noteOutbound(data);
          this.emit('tx', data);
          await this.write(data);
        }
        async write(bytes: Uint8Array) {
          await window.electronAPI.nobleBleToRadio(this.session, bytes);
        }
        async close() {
          await window.electronAPI.disconnectNobleBle(this.session);
        }
      }

      const instance = new NobleOverIpc(sessionId) as unknown as NobleIpcMeshcoreConnectionInstance;
      this.inner = instance;

      let rejectHandshakeOnDisconnect: ((err: Error) => void) | undefined;
      const disconnectAbortsHandshake = new Promise<never>((_, reject) => {
        rejectHandshakeOnDisconnect = reject;
      });
      disconnectAbortsHandshake.catch(() => {});

      const offData = window.electronAPI.onNobleBleFromRadio(({ sessionId: sid, bytes }) => {
        if (sid !== sessionId) return;
        const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (txEchoFilter.isEcho(frame)) return;
        instance.onFrameReceived(frame);
      });
      const offDisc = window.electronAPI.onNobleBleDisconnected((sid) => {
        if (sid !== sessionId) return;
        console.warn(`[IpcNobleConnection:${sessionId}] peripheral disconnected`);
        instance.onDisconnected();
        const r = rejectHandshakeOnDisconnect;
        rejectHandshakeOnDisconnect = undefined;
        r?.(
          new Error(
            'BLE peripheral disconnected during handshake (pairing step finished or link lost — retry connect)',
          ),
        );
      });
      const offAbort = window.electronAPI.onNobleBleConnectAborted(
        ({ sessionId: sid, message }) => {
          if (sid !== sessionId) return;
          console.warn(`[IpcNobleConnection:${sessionId}] connect aborted by main: ${message}`);
          const r = rejectHandshakeOnDisconnect;
          rejectHandshakeOnDisconnect = undefined;
          r?.(new Error(message));
        },
      );
      this.cleanupFns = [offData, offDisc, offAbort];

      try {
        await withTimeout(
          window.electronAPI.connectNobleBle(sessionId, this.peripheralId).then((result) => {
            if (!result.ok) throw new Error(result.error || 'BLE connect failed');
          }),
          NOBLE_IPC_CONNECT_TIMEOUT_MS,
          'MeshCore BLE IPC open',
        );

        if (rejectHandshakeOnDisconnect === undefined) {
          console.warn(
            `[IpcNobleConnection:${sessionId}] disconnect raced ahead of handshake — will fail immediately`,
          );
        }

        const handshakeStart = Date.now();
        await withTimeout(
          Promise.race([
            instance.onConnected().then(() => {
              rejectHandshakeOnDisconnect = undefined;
              console.info(
                `[IpcNobleConnection:${sessionId}] onConnected() resolved after ${
                  Date.now() - handshakeStart
                }ms`,
              );
            }),
            disconnectAbortsHandshake,
          ]),
          NOBLE_IPC_HANDSHAKE_TIMEOUT_MS,
          'MeshCore BLE protocol handshake',
        );
      } catch (err) {
        try {
          await window.electronAPI.disconnectNobleBle(sessionId);
        } catch {
          // catch-no-log-ok best-effort disconnect after connect failure
        }
        this.cleanup();
        this.inner = null;
        throw err;
      }
    };

    if (this.sessionId !== 'meshcore') {
      await runConnect();
      return;
    }

    const prev = IpcNobleConnection.meshcoreConnectChain;
    let releaseChain!: () => void;
    IpcNobleConnection.meshcoreConnectChain = new Promise<void>((resolve) => {
      releaseChain = resolve;
    });
    await prev;
    try {
      await runConnect();
    } finally {
      releaseChain();
    }
  }

  get connection(): Connection {
    if (!this.inner) throw new Error('IpcNobleConnection not connected');
    return this.inner as unknown as Connection;
  }

  cleanup(): void {
    this.cleanupFns.forEach((fn) => {
      fn();
    });
    this.cleanupFns = [];
    void window.electronAPI.disconnectNobleBle(this.sessionId).catch(() => {});
  }
}

async function connectBleNoble(blePeripheralId: string): Promise<Connection> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= NOBLE_IPC_CONNECT_MAX_ATTEMPTS; attempt++) {
    const nobleConn = new IpcNobleConnection(blePeripheralId);
    try {
      await nobleConn.connect();
      return nobleConn.connection;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = isMeshcoreRetryableBleErrorMessage(msg);
      console.warn(
        `[MeshCoreTransport] Noble BLE attempt ${attempt}/${NOBLE_IPC_CONNECT_MAX_ATTEMPTS} failed: ${msg}`,
      );
      nobleConn.cleanup();
      if (!isRetryable || attempt >= NOBLE_IPC_CONNECT_MAX_ATTEMPTS) throw err;
      await new Promise<void>((r) => setTimeout(r, 1500));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('BLE connect failed');
}

// ─── BLE: Web Bluetooth (Linux) ───────────────────────────────────────────────

async function connectBleWebBluetooth(): Promise<Connection> {
  window.electronAPI.resetBlePairingRetryCount('meshcore');
  let reuseDeviceId: string | null = null;

  for (let attempt = 1; attempt <= WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS; attempt++) {
    const transport = new TransportWebBluetoothIpc('meshcore');
    try {
      const conn = new MeshcoreWebBluetoothConnection(transport);
      await conn.connect(reuseDeviceId ?? undefined);
      return conn;
    } catch (err) {
      const deviceInfo = transport.getDeviceInfo();
      reuseDeviceId = deviceInfo?.deviceId ?? transport.getLastGrantedDeviceId() ?? reuseDeviceId;
      try {
        await transport.disconnect();
      } catch {
        // catch-no-log-ok Web Bluetooth cleanup on failed attempt
      }

      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('timed out');
      const isPairingError =
        err instanceof Error &&
        (err as Error & { isPairingRelated?: boolean }).isPairingRelated === true;

      console.warn(
        `[MeshCoreTransport] Web Bluetooth attempt ${attempt}/${WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS} failed: ${msg}`,
      );

      if (isPairingError || !isTimeout || attempt >= WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS) throw err;
      if (!reuseDeviceId) {
        throw new Error(
          'Bluetooth connection timed out before a device could be reused. Tap Connect again to retry.',
        );
      }
      await new Promise<void>((r) => setTimeout(r, WEB_BLUETOOTH_CONNECT_RETRY_DELAY_MS));
    }
  }
  throw new Error('BLE connect failed after all attempts');
}
