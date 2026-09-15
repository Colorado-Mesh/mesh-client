import {
  Connection,
  Constants,
  SerialConnection,
  WebSerialConnection,
} from '@liamcottle/meshcore.js';

import { formatHostForSocket } from '@/shared/connectHost';

import { withTimeout } from '../../../../shared/withTimeout';
import { isMeshcoreRetryableBleErrorMessage } from '../../bleConnectErrors';
import { connectGattWithScanBusyRetry } from '../../bleReconnectHelper';
import { closeSerialPortIfOpen } from '../../connection';
import {
  isMeshcoreTcpOpenHopDeadAccepted,
  notifyMeshcoreTcpWriteDead,
} from '../../meshcore/meshcoreTcpInitBurst';
import { patchMeshcoreCompanionTxEchoFilter } from '../../meshcoreCompanionTxEchoFilter';
import { notifyBlePrimaryRfLinkReady } from '../../meshcoreDualNobleBleInit';
import { createSerializedWritableStream } from '../../meshtastic/meshtasticTransportLossDetection';
import { parseTcpAddress } from '../../parseTcpAddress';
import { openSerialPortWithTimeout } from '../../serialPortRecovery';
import { persistSerialPortIdentity, selectGrantedSerialPort } from '../../serialPortSignature';
import { MESHCORE_BLE_DEVICE_QUERY_TIMEOUT_MS } from '../../timeConstants';
import type { GattBleSessionId } from '../../types';

// ─── Public params type ───────────────────────────────────────────────────────

export type MeshCoreTransportParams =
  | { transport: 'ble'; blePeripheralId?: string }
  | { transport: 'tcp'; host: string }
  | { transport: 'serial' };

/** Drain and invoke IPC unsubscribe fns (idempotent). Shared by TCP/GATT wrappers. */
function releaseIpcCleanupFns(cleanupFns: (() => void)[]): void {
  const fns = cleanupFns.splice(0, cleanupFns.length);
  for (const fn of fns) fn();
}

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
  if (!params.blePeripheralId) throw new Error('BLE peripheral ID required');
  return connectBleGatt(params.blePeripheralId);
}

// ─── Platform detection ───────────────────────────────────────────────────────

function rendererLikelyWin32(): boolean {
  try {
    if (typeof process !== 'undefined' && process.platform === 'win32') return true;
  } catch {
    // catch-no-log-ok process access can throw in renderer bundles
  }
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
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
  const ua = navigator.userAgent;
  if (/Linux/i.test(ua)) return true;
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  if (plat && /Linux/i.test(plat)) return true;
  return !!(navigator.platform && /Linux/i.test(navigator.platform));
}

// ─── Timeouts / retry limits ──────────────────────────────────────────────────

const GATT_IPC_CONNECT_TIMEOUT_MS = 120_000;

/** WinRT + companion handshake can be slower than CoreBluetooth. */
const GATT_IPC_HANDSHAKE_TIMEOUT_MS = rendererLikelyWin32()
  ? 45_000
  : rendererLikelyLinux()
    ? 60_000
    : 20_000;

const GATT_IPC_CONNECT_MAX_ATTEMPTS = 2;

// ─── Internal type shims ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SerialConnectionInstance extends InstanceType<typeof SerialConnection> {}

interface GattIpcMeshcoreConnectionInstance {
  emit(event: string | number, ...args: unknown[]): void;
  onConnected(): Promise<void>;
  onDisconnected(): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
  onFrameReceived(frame: Uint8Array): void;
}

const MeshcoreConnectionBase = Connection as unknown as new () => GattIpcMeshcoreConnectionInstance;

// ─── TCP ──────────────────────────────────────────────────────────────────────

class IpcTcpConnection {
  /** Serialises concurrent MeshCore TCP connects so reconnect cannot supersede mid-handshake. */
  private static meshcoreTcpConnectChain = Promise.resolve();

  private readonly host: string;
  private readonly port: number;
  private inner: SerialConnectionInstance | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(host: string, port = 5000) {
    this.host = host;
    this.port = port;
  }

  /** Unsubscribe preload IPC listeners (idempotent). Does not disconnect the TCP socket. */
  private releaseIpcListeners(): void {
    releaseIpcCleanupFns(this.cleanupFns);
  }

  async connect(): Promise<void> {
    const runConnect = async (): Promise<void> => {
      const releaseListeners = (): void => {
        this.releaseIpcListeners();
      };
      let notifiedDisconnect = false;
      const notifyDisconnectedOnce = (instance: SerialConnectionInstance): void => {
        if (notifiedDisconnect) return;
        notifiedDisconnect = true;
        releaseListeners();
        instance.onDisconnected();
      };
      class TcpOverIpc extends (SerialConnection as unknown as new () => SerialConnectionInstance) {
        async write(bytes: Uint8Array) {
          try {
            await window.electronAPI.meshcore.tcp.write(Array.from(bytes));
          } catch (e) {
            // OpenHop-accepted dead bridge: expected; keep noise at debug (stats/outbox thrash).
            if (isMeshcoreTcpOpenHopDeadAccepted()) {
              console.debug('[IpcTcpConnection] write on OpenHop dead bridge', e);
            } else {
              console.error('[IpcTcpConnection] write error', e);
            }
            // Fail closed so meshcore.js stops issuing RPCs after the bridge is gone
            // (n7eal: peer FIN → no active socket write storm).
            notifyDisconnectedOnce(this);
            // Latch bridge-dead in the runtime immediately — do not wait for
            // meshcore:tcp-disconnected IPC (can arrive after getChannels/configured).
            notifyMeshcoreTcpWriteDead();
            throw e;
          }
        }
        async close() {
          releaseListeners();
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
          notifyDisconnectedOnce(instance);
        });
        this.cleanupFns = [offData, offDisc];
        await window.electronAPI.meshcore.tcp.connect(this.host, this.port);
        await instance.onConnected();
      } catch (e) {
        console.error('[IpcTcpConnection] connect/onConnected error', e);
        this.releaseIpcListeners();
        throw e;
      }
    };

    const prev = IpcTcpConnection.meshcoreTcpConnectChain;
    let releaseChain!: () => void;
    IpcTcpConnection.meshcoreTcpConnectChain = new Promise<void>((resolve) => {
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
    if (!this.inner) throw new Error('IpcTcpConnection not connected');
    return this.inner;
  }

  cleanup(): void {
    this.releaseIpcListeners();
  }
}

async function connectTcp(hostAddr: string): Promise<Connection> {
  const { host, port } = parseTcpAddress(hostAddr);
  const socketHost = formatHostForSocket(host);
  const tcp = new IpcTcpConnection(socketHost, port);
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
  await openSerialPortWithTimeout(port, 115200, 'MeshCore serial open');
  const rawWritable = port.writable;
  const conn = new (WebSerialConnection as unknown as new (port: unknown) => MeshcoreWebSerialConn)(
    port,
  );
  if (rawWritable) {
    patchMeshcoreWebSerialWritable(conn, rawWritable);
  }
  patchMeshcoreCompanionTxEchoFilter(conn);
  return conn;
}

async function connectSerial(): Promise<Connection> {
  if (!navigator.serial?.requestPort) throw new Error('Web Serial API not available');
  const port = await navigator.serial.requestPort();
  await closeSerialPortIfOpen(port);
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

// ─── BLE: sidecar GATT (all platforms) ───────────────────────────────────────

class IpcSidecarGattConnection {
  /** Serialises concurrent meshcore GATT connects to avoid adapter contention. */
  private static meshcoreConnectChain = Promise.resolve();

  private readonly peripheralId: string;
  private readonly sessionId: GattBleSessionId;
  private inner: GattIpcMeshcoreConnectionInstance | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(peripheralId: string, sessionId: GattBleSessionId = 'meshcore') {
    this.peripheralId = peripheralId;
    this.sessionId = sessionId;
  }

  /** Unsubscribe preload IPC listeners (idempotent). Does not disconnect GATT. */
  private releaseIpcListeners(): void {
    releaseIpcCleanupFns(this.cleanupFns);
  }

  async connect(): Promise<void> {
    const runConnect = async () => {
      const { sessionId } = this;
      const releaseListeners = (): void => {
        this.releaseIpcListeners();
      };

      class GattOverIpc extends MeshcoreConnectionBase {
        constructor(private readonly session: GattBleSessionId) {
          super();
        }
        async onConnected() {
          await withTimeout(
            (this as unknown as Connection).deviceQuery(
              Constants.SupportedCompanionProtocolVersion,
            ),
            MESHCORE_BLE_DEVICE_QUERY_TIMEOUT_MS,
            'MeshCore BLE deviceQuery',
          );
          this.emit('connected');
        }
        async sendToRadioFrame(data: Uint8Array) {
          this.emit('tx', data);
          await this.write(data);
        }
        async write(bytes: Uint8Array) {
          await window.electronAPI.gattToRadio(this.session, bytes);
        }
        async close() {
          releaseListeners();
          await window.electronAPI.disconnectGatt(this.session);
        }
      }

      const instance = new GattOverIpc(sessionId) as unknown as GattIpcMeshcoreConnectionInstance;
      patchMeshcoreCompanionTxEchoFilter(instance);
      this.inner = instance;

      let rejectHandshakeOnDisconnect: ((err: Error) => void) | undefined;
      const disconnectAbortsHandshake = new Promise<never>((_, reject) => {
        rejectHandshakeOnDisconnect = reject;
      });
      disconnectAbortsHandshake.catch(() => {});

      const offData = window.electronAPI.onGattFromRadio(({ sessionId: sid, bytes }) => {
        if (sid !== sessionId) return;
        const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        instance.onFrameReceived(frame);
      });
      const offDisc = window.electronAPI.onGattDisconnected((sid) => {
        if (sid !== sessionId) return;
        console.warn(`[IpcSidecarGattConnection:${sessionId}] peripheral disconnected`);
        releaseListeners();
        instance.onDisconnected();
        const r = rejectHandshakeOnDisconnect;
        rejectHandshakeOnDisconnect = undefined;
        r?.(
          new Error(
            'BLE peripheral disconnected during handshake (pairing step finished or link lost — retry connect)',
          ),
        );
      });
      const offAbort = window.electronAPI.onGattConnectAborted(({ sessionId: sid, message }) => {
        if (sid !== sessionId) return;
        console.warn(`[IpcSidecarGattConnection:${sessionId}] connect aborted by main: ${message}`);
        releaseListeners();
        const r = rejectHandshakeOnDisconnect;
        rejectHandshakeOnDisconnect = undefined;
        r?.(new Error(message));
      });
      this.cleanupFns = [offData, offDisc, offAbort];

      try {
        await withTimeout(
          connectGattWithScanBusyRetry(sessionId, this.peripheralId),
          GATT_IPC_CONNECT_TIMEOUT_MS,
          'MeshCore BLE IPC open',
        );

        if (rejectHandshakeOnDisconnect === undefined) {
          console.warn(
            `[IpcSidecarGattConnection:${sessionId}] disconnect raced ahead of handshake — will fail immediately`,
          );
        }

        const handshakeStart = Date.now();
        await withTimeout(
          Promise.race([
            instance.onConnected().then(() => {
              rejectHandshakeOnDisconnect = undefined;
              notifyBlePrimaryRfLinkReady(sessionId);
              console.info(
                `[IpcSidecarGattConnection:${sessionId}] onConnected() resolved after ${
                  Date.now() - handshakeStart
                }ms`,
              );
            }),
            disconnectAbortsHandshake,
          ]),
          GATT_IPC_HANDSHAKE_TIMEOUT_MS,
          'MeshCore BLE protocol handshake',
        );
      } catch (err) {
        try {
          await window.electronAPI.disconnectGatt(sessionId);
        } catch {
          // catch-no-log-ok best-effort disconnect after connect failure
        }
        this.releaseIpcListeners();
        this.inner = null;
        throw err;
      }
    };

    if (this.sessionId !== 'meshcore') {
      await runConnect();
      return;
    }

    const prev = IpcSidecarGattConnection.meshcoreConnectChain;
    let releaseChain!: () => void;
    IpcSidecarGattConnection.meshcoreConnectChain = new Promise<void>((resolve) => {
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
    if (!this.inner) throw new Error('IpcSidecarGattConnection not connected');
    return this.inner as unknown as Connection;
  }

  cleanup(): void {
    this.releaseIpcListeners();
    void window.electronAPI.disconnectGatt(this.sessionId).catch((e: unknown) => {
      console.debug('[MeshCoreTransport] GATT cleanup disconnect ' + String(e));
    });
  }
}

async function connectBleGatt(blePeripheralId: string): Promise<Connection> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= GATT_IPC_CONNECT_MAX_ATTEMPTS; attempt++) {
    const gattConn = new IpcSidecarGattConnection(blePeripheralId);
    try {
      await gattConn.connect();
      return gattConn.connection;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = isMeshcoreRetryableBleErrorMessage(msg);
      console.warn(
        `[MeshCoreTransport] GATT BLE attempt ${attempt}/${GATT_IPC_CONNECT_MAX_ATTEMPTS} failed: ${msg}`,
      );
      gattConn.cleanup();
      if (!isRetryable || attempt >= GATT_IPC_CONNECT_MAX_ATTEMPTS) throw err;
      await new Promise<void>((r) => setTimeout(r, 1500));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('BLE connect failed');
}
