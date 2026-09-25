/**
 * Shared MeshCore / Meshtastic TCP socket bridge.
 *
 * Two `createTcpBridge` instances keep independent sockets so both stacks can
 * stay connected. The only intentional protocol fork is `writeMissing`:
 * MeshCore rejects a missing socket; Meshtastic resolves `'no-socket'`.
 */

import { type BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import net from 'net';

import { formatHostForSocket } from '../../shared/connectHost';
import {
  clearLiveSessionMeter,
  noteLiveSessionData,
  noteLiveSessionWrite,
  resetLiveSessionMeter,
} from '../live-session-meter';
import { logDeviceConnection, sanitizeLogMessage } from '../log-service';
import { meshtasticTcpWriteErrorIsNoSocket } from '../meshtasticTcpWriteResult';
import { assertIpcSender } from '../validate-ipc-sender';

export type TcpBridgeProtocol = 'meshcore' | 'meshtastic';
export type TcpBridgeWriteMissing = 'reject' | 'no-socket';

/** Max TCP toRadio write payload (DoS guard). */
export const TCP_BRIDGE_WRITE_MAX_BYTES = 256 * 1024;
/** Cap inbound TCP chunks before IPC fan-out (same as write max). */
export const TCP_BRIDGE_DATA_MAX_BYTES = TCP_BRIDGE_WRITE_MAX_BYTES;
export const TCP_BRIDGE_CONNECT_TIMEOUT_MS = 20_000;
/** Initial TCP keepalive probe delay (ms). */
export const TCP_BRIDGE_KEEPALIVE_INITIAL_DELAY_MS = 30_000;

export interface TcpBridgeDeps {
  protocol: TcpBridgeProtocol;
  writeMissing: TcpBridgeWriteMissing;
  getMainWindow: () => BrowserWindow | null;
  validateHost: (host: unknown) => asserts host is string;
}

export interface TcpBridgeHandlers {
  connect: (event: IpcMainInvokeEvent, host: string, port: number) => Promise<void>;
  write: (
    event: IpcMainInvokeEvent,
    bytes: number[],
  ) => Promise<'no-socket' | undefined> | 'no-socket';
  disconnect: (event: IpcMainInvokeEvent) => void;
  destroyForQuit: (logLabel: string) => void;
}

export interface TcpBridgeRegisterDeps {
  getMainWindow: () => BrowserWindow | null;
  validateHost: (host: unknown) => asserts host is string;
}

export function createTcpBridge(deps: TcpBridgeDeps): TcpBridgeHandlers {
  const { protocol, writeMissing, getMainWindow } = deps;
  const validateHost: (host: unknown) => asserts host is string = deps.validateHost;
  let activeSocket: net.Socket | null = null;

  const connectChannel = `${protocol}:tcp-connect`;
  const writeChannel = `${protocol}:tcp-write`;
  const disconnectChannel = `${protocol}:tcp-disconnect`;
  const dataChannel = `${protocol}:tcp-data`;
  const disconnectedChannel = `${protocol}:tcp-disconnected`;

  const connect = (event: IpcMainInvokeEvent, host: string, port: number): Promise<void> => {
    assertIpcSender(event, connectChannel);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const p = port;
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        reject(new Error('Invalid port'));
        return;
      }
      try {
        validateHost(host);
      } catch (err) {
        // catch-no-log-ok validation error forwarded to promise reject
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (activeSocket) {
        // Null before destroy so the superseded socket's 'close' does not emit
        // tcp-disconnected (renderer reconnect is driven by that event — #792).
        const prev = activeSocket;
        activeSocket = null;
        clearLiveSessionMeter(protocol);
        prev.destroy();
      }
      const socketHost = formatHostForSocket(host);
      const socket = new net.Socket();
      // MeshCore Open / official companion TCP clients use TCP_NODELAY; Node defaults can
      // Nagle-batch small companion RPCs and OpenHop peers often FIN mid-init.
      socket.setNoDelay(true);
      socket.setKeepAlive(true, TCP_BRIDGE_KEEPALIVE_INITIAL_DELAY_MS);
      activeSocket = socket;
      const connectTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (activeSocket === socket) {
          activeSocket = null;
          clearLiveSessionMeter(protocol);
        }
        socket.destroy();
        reject(new Error(`${connectChannel}: connection timeout`));
      }, TCP_BRIDGE_CONNECT_TIMEOUT_MS);
      socket.connect(p, socketHost, () => {
        clearTimeout(connectTimeout);
        console.debug(`[IPC] ${connectChannel} connected to`, sanitizeLogMessage(socketHost), p);
        logDeviceConnection(
          `transport=tcp stack=${protocol} host=${sanitizeLogMessage(socketHost)} port=${p}`,
        );
        resetLiveSessionMeter(protocol);
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      socket.on('data', (data) => {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (chunk.length > TCP_BRIDGE_DATA_MAX_BYTES) {
          console.warn(
            `[IPC] ${dataChannel} oversized chunk (${chunk.length} > ${TCP_BRIDGE_DATA_MAX_BYTES}); dropping socket`,
          );
          try {
            socket.destroy();
          } catch (e) {
            console.debug(
              `[IPC] ${dataChannel} destroy after oversize ` +
                sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
            );
          }
          return;
        }
        // Superseded sockets must not update the live session meter (#792 connect-replace).
        if (activeSocket === socket) {
          noteLiveSessionData(protocol);
        }
        getMainWindow()?.webContents.send(dataChannel, new Uint8Array(chunk));
      });
      socket.on('close', (hadError) => {
        clearTimeout(connectTimeout);
        // readableEnded=true after peer FIN; local destroy-before-null tear downs do not hit this
        // branch as active (ref cleared first). Log fields help triage n7eal post-contacts hangs.
        const remote = socket.remoteAddress
          ? `${socket.remoteAddress}:${socket.remotePort ?? '?'}`
          : 'unknown';
        console.debug(
          `[IPC] ${protocol}:tcp socket closed`,
          hadError ? '(hadError)' : '(clean)',
          `remote=${sanitizeLogMessage(remote)}`,
          `readableEnded=${socket.readableEnded}`,
          `writableEnded=${socket.writableEnded}`,
        );
        // Only notify when this socket is still the active bridge. connect/disconnect clear the
        // ref before destroy(), so superseded closes must not look like a live link drop
        // (renderer reconnect is driven by this event — see #792).
        if (activeSocket === socket) {
          activeSocket = null;
          clearLiveSessionMeter(protocol);
          getMainWindow()?.webContents.send(disconnectedChannel);
        }
        // Connect-replace / timeout destroy can close a socket that never connected.
        // Clearing the timeout above would otherwise leave the IPC invoke pending.
        if (!settled) {
          settled = true;
          reject(new Error(`${connectChannel}: closed before connect`));
        }
      });
      socket.on('error', (err) => {
        clearTimeout(connectTimeout);
        console.error(`[IPC] ${connectChannel} error:`, sanitizeLogMessage(err.message));
        if (!settled) {
          settled = true;
          reject(err);
        }
        // Do not null the active socket here. Node fires 'error' before 'close' on ECONNRESET
        // etc.; nulling early makes close's active-socket guard fail and swallows
        // tcp-disconnected (renderer never reconnects). close owns that transition.
      });
    });
  };

  const write = (
    event: IpcMainInvokeEvent,
    bytes: number[],
  ): Promise<'no-socket' | undefined> | 'no-socket' => {
    assertIpcSender(event, writeChannel);
    if (!Array.isArray(bytes) || bytes.length > TCP_BRIDGE_WRITE_MAX_BYTES) {
      return Promise.reject(
        new Error(
          `${writeChannel}: invalid or oversized payload (max ${TCP_BRIDGE_WRITE_MAX_BYTES} bytes)`,
        ),
      );
    }
    // Validate each element is a valid byte value so Uint8Array coercion is not silently lossy.
    if (!bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      return Promise.reject(new Error(`${writeChannel}: byte values must be integers 0-255`));
    }
    if (!activeSocket) {
      if (writeMissing === 'no-socket') {
        // Expected reconnect race — resolve so Electron does not log handler [error].
        console.debug(`[IPC] ${writeChannel}: no active socket`);
        return 'no-socket';
      }
      const msg = `${writeChannel}: no active socket`;
      console.warn(`[IPC] ${msg}`);
      return Promise.reject(new Error(msg));
    }
    const sock = activeSocket;
    if (writeMissing === 'no-socket' && (sock.destroyed || sock.writableEnded)) {
      console.debug(`[IPC] ${writeChannel}: no active socket`);
      return 'no-socket';
    }
    return new Promise<'no-socket' | undefined>((resolve, reject) => {
      sock.write(new Uint8Array(bytes), (err) => {
        if (err) {
          if (writeMissing === 'no-socket' && meshtasticTcpWriteErrorIsNoSocket(sock, err)) {
            console.debug(`[IPC] ${writeChannel}: no active socket`);
            resolve('no-socket');
            return;
          }
          console.error(`[IPC] ${writeChannel} error:`, sanitizeLogMessage(err.message));
          reject(err);
        } else {
          // Ignore write completions from a superseded socket.
          if (activeSocket === sock) {
            noteLiveSessionWrite(protocol);
          }
          resolve(undefined);
        }
      });
    });
  };

  const disconnect = (event: IpcMainInvokeEvent): void => {
    assertIpcSender(event, disconnectChannel);
    if (activeSocket) {
      console.debug(`[IPC] ${disconnectChannel}`);
      // Null before destroy so this teardown close is not reported as a live link drop.
      const prev = activeSocket;
      activeSocket = null;
      clearLiveSessionMeter(protocol);
      prev.destroy();
    }
  };

  const destroyForQuit = (logLabel: string): void => {
    if (!activeSocket) return;
    const prev = activeSocket;
    activeSocket = null;
    clearLiveSessionMeter(protocol);
    try {
      prev.destroy();
    } catch (err) {
      console.debug(`[main] ${logLabel}:`, err instanceof Error ? err.message : err); // log-injection-ok internal Node.js socket error during cleanup
    }
  };

  return { connect, write, disconnect, destroyForQuit };
}

const registeredBridges: TcpBridgeHandlers[] = [];

/** Register both protocol bridges. Channel name literals keep check:ipc-contract aligned. */
export function registerTcpBridgeIpcHandlers(deps: TcpBridgeRegisterDeps): void {
  const meshcore = createTcpBridge({
    protocol: 'meshcore',
    writeMissing: 'reject',
    getMainWindow: deps.getMainWindow,
    validateHost: deps.validateHost,
  });
  ipcMain.handle('meshcore:tcp-connect', meshcore.connect);
  ipcMain.handle('meshcore:tcp-write', meshcore.write);
  ipcMain.handle('meshcore:tcp-disconnect', meshcore.disconnect);

  const meshtastic = createTcpBridge({
    protocol: 'meshtastic',
    writeMissing: 'no-socket',
    getMainWindow: deps.getMainWindow,
    validateHost: deps.validateHost,
  });
  ipcMain.handle('meshtastic:tcp-connect', meshtastic.connect);
  ipcMain.handle('meshtastic:tcp-write', meshtastic.write);
  ipcMain.handle('meshtastic:tcp-disconnect', meshtastic.disconnect);

  registeredBridges.push(meshcore, meshtastic);
}

/** Destroy both protocol sockets on quit / will-quit. */
export function destroyRegisteredTcpBridgeSockets(logLabel: string): void {
  for (const bridge of registeredBridges) {
    bridge.destroyForQuit(logLabel);
  }
}
