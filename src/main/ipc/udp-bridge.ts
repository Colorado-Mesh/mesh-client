/**
 * MeshCom EXTUDP companion bridge (UDP :1799).
 *
 * Binds a local datagram socket and exchanges UTF-8 JSON packets with a remote
 * MeshCom node at the same port.
 *
 * Production ships this as sibling `udp-bridge.js` so it stays out of measured index.js.
 */

import dgram from 'node:dgram';

import { type BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import { formatHostForSocket } from '../../shared/connectHost';
import { MESHCOM_EXTUDP_PORT } from '../../shared/meshcomConstants';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

/** Max UDP write / inbound datagram size (DoS guard). */
export const UDP_BRIDGE_WRITE_MAX_BYTES = 64 * 1024;

export interface UdpBridgeDeps {
  getMainWindow: () => BrowserWindow | null;
  validateHost: (host: unknown) => asserts host is string;
}

export interface UdpBridgeHandlers {
  connect: (event: IpcMainInvokeEvent, host: string) => Promise<void>;
  write: (event: IpcMainInvokeEvent, bytes: number[]) => Promise<void>;
  disconnect: (event: IpcMainInvokeEvent) => void;
  destroyForQuit: (logLabel: string) => void;
}

const CONNECT_CHANNEL = 'meshcom:udp-connect';
const WRITE_CHANNEL = 'meshcom:udp-write';
const DISCONNECT_CHANNEL = 'meshcom:udp-disconnect';
const DATA_CHANNEL = 'meshcom:udp-data';
const DISCONNECTED_CHANNEL = 'meshcom:udp-disconnected';

export function createUdpBridge(deps: UdpBridgeDeps): UdpBridgeHandlers {
  const { getMainWindow } = deps;
  const validateHost: (host: unknown) => asserts host is string = deps.validateHost;
  let activeSocket: dgram.Socket | null = null;
  let remoteHost: string | null = null;

  const closeSocket = (emitDisconnected: boolean): void => {
    if (!activeSocket) return;
    const prev = activeSocket;
    activeSocket = null;
    remoteHost = null;
    try {
      prev.close();
    } catch (err) {
      console.debug(
        `[IPC] ${DISCONNECT_CHANNEL} close:`,
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }
    if (emitDisconnected) {
      getMainWindow()?.webContents.send(DISCONNECTED_CHANNEL);
    }
  };

  const connect = (event: IpcMainInvokeEvent, host: string): Promise<void> => {
    assertIpcSender(event, CONNECT_CHANNEL);
    return new Promise<void>((resolve, reject) => {
      try {
        validateHost(host);
      } catch (err) {
        // catch-no-log-ok validation error forwarded to promise reject
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // Tear down any prior socket without reporting a live drop (connect-replace).
      closeSocket(false);

      const socketHost = formatHostForSocket(host);
      remoteHost = socketHost;
      const socket = dgram.createSocket('udp4');
      activeSocket = socket;

      const failConnect = (err: Error): void => {
        if (activeSocket === socket) {
          activeSocket = null;
          remoteHost = null;
        }
        try {
          socket.close();
        } catch (closeErr) {
          console.debug(
            `[IPC] ${CONNECT_CHANNEL} close after error:`,
            sanitizeLogMessage(closeErr instanceof Error ? closeErr.message : String(closeErr)),
          );
        }
        reject(err);
      };

      socket.once('error', (err) => {
        console.error(`[IPC] ${CONNECT_CHANNEL} error:`, sanitizeLogMessage(err.message));
        failConnect(err);
      });

      socket.on('message', (msg, rinfo) => {
        if (activeSocket !== socket) return;
        if (msg.length > UDP_BRIDGE_WRITE_MAX_BYTES) {
          console.warn(
            `[IPC] ${DATA_CHANNEL} oversized datagram (${msg.length} > ${UDP_BRIDGE_WRITE_MAX_BYTES}); dropping`,
          );
          return;
        }
        // Only forward packets from the configured remote host (port is fixed).
        if (remoteHost && rinfo.address !== remoteHost) {
          console.debug(
            `[IPC] ${DATA_CHANNEL} ignore from`,
            sanitizeLogMessage(rinfo.address),
            `(expected ${sanitizeLogMessage(remoteHost)})`,
          );
          return;
        }
        getMainWindow()?.webContents.send(DATA_CHANNEL, Array.from(msg));
      });

      socket.on('close', () => {
        if (activeSocket === socket) {
          activeSocket = null;
          remoteHost = null;
          getMainWindow()?.webContents.send(DISCONNECTED_CHANNEL);
        }
      });

      socket.bind(MESHCOM_EXTUDP_PORT, () => {
        socket.removeAllListeners('error');
        socket.on('error', (err) => {
          console.error(`[IPC] meshcom:udp error:`, sanitizeLogMessage(err.message));
          if (activeSocket === socket) {
            closeSocket(true);
          }
        });
        console.debug(
          `[IPC] ${CONNECT_CHANNEL} bound :${MESHCOM_EXTUDP_PORT} →`,
          sanitizeLogMessage(socketHost),
        );
        resolve();
      });
    });
  };

  const write = (event: IpcMainInvokeEvent, bytes: number[]): Promise<void> => {
    assertIpcSender(event, WRITE_CHANNEL);
    if (!Array.isArray(bytes) || bytes.length > UDP_BRIDGE_WRITE_MAX_BYTES) {
      return Promise.reject(
        new Error(
          `${WRITE_CHANNEL}: invalid or oversized payload (max ${UDP_BRIDGE_WRITE_MAX_BYTES} bytes)`,
        ),
      );
    }
    if (!bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      return Promise.reject(new Error(`${WRITE_CHANNEL}: byte values must be integers 0-255`));
    }
    if (!activeSocket || !remoteHost) {
      const msg = `${WRITE_CHANNEL}: no active socket`;
      console.warn(`[IPC] ${msg}`);
      return Promise.reject(new Error(msg));
    }
    const sock = activeSocket;
    const host = remoteHost;
    return new Promise<void>((resolve, reject) => {
      sock.send(Buffer.from(bytes), MESHCOM_EXTUDP_PORT, host, (err) => {
        if (err) {
          console.error(`[IPC] ${WRITE_CHANNEL} error:`, sanitizeLogMessage(err.message));
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };

  const disconnect = (event: IpcMainInvokeEvent): void => {
    assertIpcSender(event, DISCONNECT_CHANNEL);
    if (activeSocket) {
      console.debug(`[IPC] ${DISCONNECT_CHANNEL}`);
      // Null before close so the close handler does not double-emit disconnected.
      const prev = activeSocket;
      activeSocket = null;
      remoteHost = null;
      try {
        prev.close();
      } catch (err) {
        console.debug(
          `[IPC] ${DISCONNECT_CHANNEL} close:`,
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      }
    }
  };

  const destroyForQuit = (logLabel: string): void => {
    if (!activeSocket) return;
    const prev = activeSocket;
    activeSocket = null;
    remoteHost = null;
    try {
      prev.close();
    } catch (err) {
      console.debug(`[main] ${logLabel}:`, err instanceof Error ? err.message : err); // log-injection-ok internal Node.js socket error during cleanup
    }
  };

  return { connect, write, disconnect, destroyForQuit };
}

let registeredBridge: UdpBridgeHandlers | null = null;

export function registerUdpBridgeIpcHandlers(deps: UdpBridgeDeps): void {
  const bridge = createUdpBridge(deps);
  ipcMain.handle('meshcom:udp-connect', bridge.connect);
  ipcMain.handle('meshcom:udp-write', bridge.write);
  ipcMain.handle('meshcom:udp-disconnect', bridge.disconnect);
  registeredBridge = bridge;
}

export function destroyRegisteredUdpBridgeSockets(logLabel: string): void {
  registeredBridge?.destroyForQuit(logLabel);
}
