/**
 * MeshCom network transports: EXTUDP (IPC), KISS/TCP (IPC), USB serial, BLE GATT.
 */

import { formatHostForSocket, parseConnectHostPort } from '@/shared/connectHost';
import { MESHCOM_KISS_TCP_PORT, MESHCOM_SERIAL_BAUD } from '@/shared/meshcomConstants';

import { connectGattWithScanBusyRetry } from '../../bleReconnectHelper';
import { closeSerialPortIfOpen } from '../../connection';
import { encodeMeshcomBleCommand, MESHCOM_BLE_HELLO } from '../../meshcom/meshcomBleFrame';
import { createSerializedWritableStream } from '../../meshtastic/meshtasticTransportLossDetection';
import { openSerialPortWithTimeout } from '../../serialPortRecovery';
import { persistSerialPortIdentity, selectGrantedSerialPort } from '../../serialPortSignature';
import type { TransportParams } from '../../types';

export type MeshComTransportKind = 'udp' | 'tcp' | 'serial' | 'ble';

export interface MeshComConnection {
  readonly transport: MeshComTransportKind;
  write(bytes: Uint8Array | number[]): Promise<void>;
  /** Invoked for each inbound datagram / TCP chunk (raw bytes). */
  onData: ((bytes: Uint8Array) => void) | null;
  /** Invoked when the underlying IPC bridge reports disconnect. */
  onDisconnected: (() => void) | null;
  close(): Promise<void>;
}

export interface MeshComConnectionParams {
  transport: MeshComTransportKind;
  host?: string;
  peripheralId?: string;
  /** Gesture-free serial reconnect: Chromium portId or USB signature hint. */
  portSignature?: string | null;
}

function toUint8Array(bytes: Uint8Array | number[]): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function releaseCleanupFns(fns: (() => void)[]): void {
  for (const fn of fns) {
    try {
      fn();
    } catch (err) {
      console.debug(
        '[MeshComTransport] cleanup ' + (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  fns.length = 0;
}

class IpcUdpConnection implements MeshComConnection {
  readonly transport = 'udp' as const;
  onData: ((bytes: Uint8Array) => void) | null = null;
  onDisconnected: (() => void) | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(private readonly host: string) {}

  async connect(): Promise<void> {
    const offData = window.electronAPI.meshcom.udp.onData((bytes) => {
      const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      this.onData?.(frame);
    });
    const offDisc = window.electronAPI.meshcom.udp.onDisconnected(() => {
      this.onDisconnected?.();
    });
    this.cleanupFns = [offData, offDisc];
    await window.electronAPI.meshcom.udp.connect(this.host);
  }

  async write(bytes: Uint8Array | number[]): Promise<void> {
    await window.electronAPI.meshcom.udp.write(Array.from(toUint8Array(bytes)));
  }

  async close(): Promise<void> {
    releaseCleanupFns(this.cleanupFns);
    await window.electronAPI.meshcom.udp.disconnect();
  }
}

class IpcKissTcpConnection implements MeshComConnection {
  readonly transport = 'tcp' as const;
  onData: ((bytes: Uint8Array) => void) | null = null;
  onDisconnected: (() => void) | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async connect(): Promise<void> {
    const offData = window.electronAPI.meshcom.tcp.onData((bytes) => {
      const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      this.onData?.(frame);
    });
    const offDisc = window.electronAPI.meshcom.tcp.onDisconnected(() => {
      this.onDisconnected?.();
    });
    this.cleanupFns = [offData, offDisc];
    await window.electronAPI.meshcom.tcp.connect(this.host, this.port);
  }

  async write(bytes: Uint8Array | number[]): Promise<void> {
    await window.electronAPI.meshcom.tcp.write(Array.from(toUint8Array(bytes)));
  }

  async close(): Promise<void> {
    releaseCleanupFns(this.cleanupFns);
    await window.electronAPI.meshcom.tcp.disconnect();
  }
}

/** Web Serial console at {@link MESHCOM_SERIAL_BAUD}. */
class WebSerialMeshComConnection implements MeshComConnection {
  readonly transport = 'serial' as const;
  onData: ((bytes: Uint8Array) => void) | null = null;
  onDisconnected: (() => void) | null = null;

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writable: WritableStream<Uint8Array> | null = null;
  private closed = false;
  private disconnectListener: ((event: Event) => void) | null = null;

  constructor(private readonly portSignature?: string | null) {}

  async connect(): Promise<void> {
    if (!navigator.serial) {
      throw new Error('Web Serial API not available');
    }

    let port: SerialPort;
    if (this.portSignature) {
      const ports = await navigator.serial.getPorts();
      port = selectGrantedSerialPort(ports, this.portSignature);
    } else {
      port = await navigator.serial.requestPort();
    }

    await closeSerialPortIfOpen(port);
    persistSerialPortIdentity(port);
    await openSerialPortWithTimeout(port, MESHCOM_SERIAL_BAUD, 'MeshCom serial open');

    this.port = port;
    const rawWritable = port.writable;
    if (!rawWritable) {
      await closeSerialPortIfOpen(port);
      this.port = null;
      throw new Error('MeshCom serial port has no writable stream');
    }
    this.writable = createSerializedWritableStream(rawWritable);

    this.disconnectListener = () => {
      void this.handlePortDisconnect();
    };
    port.addEventListener('disconnect', this.disconnectListener);

    void this.startReadLoop(port);
  }

  private async startReadLoop(port: SerialPort): Promise<void> {
    const readable = port.readable;
    if (!readable) {
      await this.handlePortDisconnect();
      return;
    }
    const reader = readable.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || this.closed) break;
        if (value.byteLength > 0) {
          this.onData?.(value);
        }
      }
    } catch (err) {
      if (!this.closed) {
        console.debug(
          '[MeshComTransport] serial read ' + (err instanceof Error ? err.message : String(err)),
        );
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // catch-no-log-ok stream already closed during teardown
      }
      if (this.reader === reader) this.reader = null;
      if (!this.closed) {
        await this.handlePortDisconnect();
      }
    }
  }

  private async handlePortDisconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detachDisconnectListener();
    this.onDisconnected?.();
    await this.teardownPort();
  }

  private detachDisconnectListener(): void {
    if (this.port && this.disconnectListener) {
      this.port.removeEventListener('disconnect', this.disconnectListener);
    }
    this.disconnectListener = null;
  }

  private async teardownPort(): Promise<void> {
    const reader = this.reader;
    this.reader = null;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // catch-no-log-ok cancel during close race
      }
      try {
        reader.releaseLock();
      } catch {
        // catch-no-log-ok already released
      }
    }
    this.writable = null;
    const port = this.port;
    this.port = null;
    if (port) {
      await closeSerialPortIfOpen(port);
    }
  }

  async write(bytes: Uint8Array | number[]): Promise<void> {
    if (!this.writable || this.closed) {
      throw new Error('MeshCom serial port is not open');
    }
    const writer = this.writable.getWriter();
    try {
      await writer.write(toUint8Array(bytes));
    } finally {
      try {
        writer.releaseLock();
      } catch {
        // catch-no-log-ok virtual writer release
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detachDisconnectListener();
    await this.teardownPort();
  }
}

/** Sidecar GATT Nordic UART + MeshCom `{HELLO}` handshake. */
class IpcBleMeshComConnection implements MeshComConnection {
  readonly transport = 'ble' as const;
  onData: ((bytes: Uint8Array) => void) | null = null;
  onDisconnected: (() => void) | null = null;

  private readonly sessionId = 'meshcom' as const;
  private cleanupFns: (() => void)[] = [];
  private connected = false;

  constructor(private readonly peripheralId: string) {}

  async connect(): Promise<void> {
    const { sessionId } = this;
    let rejectOnDisconnect: ((err: Error) => void) | undefined;
    const disconnectAborts = new Promise<never>((_, reject) => {
      rejectOnDisconnect = reject;
    });
    disconnectAborts.catch(() => {
      // catch-no-log-ok expected when handshake wins the race
    });

    const offData = window.electronAPI.onGattFromRadio(({ sessionId: sid, bytes }) => {
      if (sid !== sessionId) return;
      const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      this.onData?.(frame);
    });
    const offDisc = window.electronAPI.onGattDisconnected((sid) => {
      if (sid !== sessionId) return;
      releaseCleanupFns(this.cleanupFns);
      this.connected = false;
      const r = rejectOnDisconnect;
      rejectOnDisconnect = undefined;
      r?.(new Error('MeshCom BLE peripheral disconnected during connect'));
      this.onDisconnected?.();
    });
    this.cleanupFns = [offData, offDisc];

    try {
      await connectGattWithScanBusyRetry(sessionId, this.peripheralId);
      await window.electronAPI.gattToRadio(sessionId, MESHCOM_BLE_HELLO);
      rejectOnDisconnect = undefined;
      this.connected = true;
    } catch (err) {
      try {
        await window.electronAPI.disconnectGatt(sessionId);
      } catch {
        // catch-no-log-ok best-effort disconnect after connect failure
      }
      releaseCleanupFns(this.cleanupFns);
      this.connected = false;
      throw err;
    }
  }

  async write(bytes: Uint8Array | number[]): Promise<void> {
    if (!this.connected) {
      throw new Error('MeshCom BLE is not connected');
    }
    const data = toUint8Array(bytes);
    // Already a phone frame (len byte matches buffer length).
    if (data.length >= 2 && data[0] === data.length) {
      await window.electronAPI.gattToRadio(this.sessionId, data);
      return;
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/\r?\n$/, '');
    // Console commands (`--…`) and `{DST}text` injects need BLE CMD framing.
    if (text.startsWith('--') || /^\{[^}]+\}/.test(text)) {
      await window.electronAPI.gattToRadio(this.sessionId, encodeMeshcomBleCommand(text));
      return;
    }
    await window.electronAPI.gattToRadio(this.sessionId, data);
  }

  async close(): Promise<void> {
    releaseCleanupFns(this.cleanupFns);
    this.connected = false;
    await window.electronAPI.disconnectGatt(this.sessionId).catch((e: unknown) => {
      console.debug('[MeshComTransport] BLE disconnect ' + String(e));
    });
  }
}

/** Open a MeshCom companion connection for the given transport params. */
export async function createMeshComConnection(
  params: MeshComConnectionParams,
): Promise<MeshComConnection> {
  switch (params.transport) {
    case 'udp': {
      if (!params.host) throw new Error('MeshCom UDP requires host');
      const { host } = parseConnectHostPort(params.host, 0);
      const socketHost = formatHostForSocket(host);
      const conn = new IpcUdpConnection(socketHost);
      await conn.connect();
      return conn;
    }
    case 'tcp': {
      if (!params.host) throw new Error('MeshCom KISS/TCP requires host');
      const { host, port } = parseConnectHostPort(params.host, MESHCOM_KISS_TCP_PORT);
      const socketHost = formatHostForSocket(host);
      const conn = new IpcKissTcpConnection(socketHost, port);
      await conn.connect();
      return conn;
    }
    case 'serial': {
      const conn = new WebSerialMeshComConnection(params.portSignature);
      await conn.connect();
      return conn;
    }
    case 'ble': {
      if (!params.peripheralId) throw new Error('MeshCom BLE peripheral ID required');
      const conn = new IpcBleMeshComConnection(params.peripheralId);
      await conn.connect();
      return conn;
    }
    default: {
      const _exhaustive: never = params.transport;
      throw new Error(`MeshCom unsupported transport: ${String(_exhaustive)}`);
    }
  }
}

/** Map ConnectionDriver {@link TransportParams} onto MeshCom transport params. */
export function transportParamsToMeshCom(params: TransportParams): MeshComConnectionParams {
  switch (params.type) {
    case 'udp':
      return { transport: 'udp', host: params.host };
    case 'tcp':
      return { transport: 'tcp', host: params.host };
    case 'http':
      // KISS UI uses `'http'` like MeshCore companion TCP.
      return { transport: 'tcp', host: params.host };
    case 'serial':
      return { transport: 'serial', portSignature: params.portSignature };
    case 'ble':
      return { transport: 'ble', peripheralId: params.peripheralId };
    default:
      throw new Error(`MeshCom unsupported TransportParams type: ${params.type}`);
  }
}
