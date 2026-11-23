/**
 * MeshCom EXTUDP companion bridge (UDP :1799).
 *
 * Binds a local datagram socket and exchanges UTF-8 JSON packets with a remote
 * MeshCom node at the same port.
 *
 * Production ships this as sibling `udp-bridge.js` so it stays out of measured index.js.
 */

import dgram from 'node:dgram';
import dns from 'node:dns';

import { type BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  formatHostForSocket,
  isValidIpv4Literal,
  stripConnectHostBrackets,
} from '../../shared/connectHost';
import { MESHCOM_EXTUDP_PORT } from '../../shared/meshcomConstants';
import { MS_PER_SECOND } from '../../shared/timeConstants';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

/**
 * Max outbound write size (renderer → node). Kept generous for forward-compat;
 * EXTUDP JSON itself is tiny.
 */
export const UDP_BRIDGE_WRITE_MAX_BYTES = 64 * 1024;

/**
 * Max inbound datagram forwarded to the renderer. EXTUDP JSON (msg/pos/tele) is
 * well under a few KiB; rejecting larger peer floods before IPC expansion.
 */
export const UDP_BRIDGE_INBOUND_MAX_BYTES = 4 * 1024;

/** Cap configured-peer datagrams forwarded to renderer IPC per window. */
export const UDP_BRIDGE_INBOUND_RATE_MAX = 60;
export const UDP_BRIDGE_INBOUND_RATE_WINDOW_MS = MS_PER_SECOND;

export interface UdpBridgeDeps {
  getMainWindow: () => BrowserWindow | null;
  validateHost: (host: unknown) => asserts host is string;
}

/** Normalize rinfo / resolved peer addresses (IPv4-mapped IPv6, zone id). */
export function normalizeMeshcomUdpPeerAddress(address: string): string {
  const bare = stripConnectHostBrackets(address.trim());
  const noZone = bare.split('%')[0] ?? bare;
  if (noZone.toLowerCase().startsWith('::ffff:')) {
    return noZone.slice(7);
  }
  return noZone;
}

export async function resolveMeshcomUdpPeerHost(host: string): Promise<string> {
  const socketHost = formatHostForSocket(host);
  const bare = stripConnectHostBrackets(socketHost);
  if (isValidIpv4Literal(bare)) {
    return bare;
  }
  const result = await dns.promises.lookup(bare, { family: 4, order: 'ipv4first' });
  return normalizeMeshcomUdpPeerAddress(result.address);
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
  /** True after successful `socket.connect()` — write must omit dest (Node ERR_SOCKET_DGRAM_IS_CONNECTED). */
  let peerConnected = false;
  /** Last time we logged a rejected peer (rate-limit DoS via log/IPC fan-out). */
  let lastRejectedPeerLogAt = 0;
  let suppressedRejectedPeerLogs = 0;
  /** Sliding window for configured-peer → renderer IPC rate limiting. */
  let inboundWindowStartedAt = 0;
  let inboundWindowCount = 0;
  let suppressedInboundRateDrops = 0;
  let lastInboundRateLogAt = 0;
  /** Oversized-datagram drops (same interval summary pattern as rate-limit). */
  let suppressedOversizedDrops = 0;
  let lastOversizedLogAt = 0;

  const resetInboundRateWindow = (): void => {
    inboundWindowStartedAt = 0;
    inboundWindowCount = 0;
    suppressedInboundRateDrops = 0;
    suppressedOversizedDrops = 0;
  };

  const closeSocket = (emitDisconnected: boolean): void => {
    if (!activeSocket) return;
    const prev = activeSocket;
    activeSocket = null;
    remoteHost = null;
    peerConnected = false;
    resetInboundRateWindow();
    try {
      prev.close();
    } catch (err) {
      console.debug(
        '[IPC]',
        DISCONNECT_CHANNEL,
        'close:',
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
        console.debug(
          '[main/ipc/udp-bridge] catch:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );

        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // Tear down any prior socket without reporting a live drop (connect-replace).
      closeSocket(false);
      // Always reset the quota when installing a new socket — disconnect may have
      // already nulled activeSocket so closeSocket returned without clearing counts.
      resetInboundRateWindow();

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
            '[IPC]',
            CONNECT_CHANNEL,
            'close after error:',
            sanitizeLogMessage(closeErr instanceof Error ? closeErr.message : String(closeErr)),
          );
        }
        reject(err);
      };

      socket.once('error', (err) => {
        console.error('mcL0219 [IPC]', CONNECT_CHANNEL, 'error:', sanitizeLogMessage(err.message));
        failConnect(err);
      });

      socket.on('message', (msg, rinfo) => {
        if (activeSocket !== socket) return;
        if (msg.length > UDP_BRIDGE_INBOUND_MAX_BYTES) {
          const now = Date.now();
          suppressedOversizedDrops += 1;
          if (now - lastOversizedLogAt >= UDP_BRIDGE_INBOUND_RATE_WINDOW_MS) {
            console.warn(
              'mcL0220 [IPC] %s oversized datagram (>%d bytes; +%d dropped)',
              DATA_CHANNEL,
              UDP_BRIDGE_INBOUND_MAX_BYTES,
              suppressedOversizedDrops,
            );
            lastOversizedLogAt = now;
            suppressedOversizedDrops = 0;
          }
          return;
        }
        // Prefer UDP connect() so the kernel drops non-peer datagrams; still filter
        // with normalized addresses and rate-limit mismatch logs (flood → disk/IPC DoS).
        if (
          remoteHost &&
          normalizeMeshcomUdpPeerAddress(rinfo.address) !==
            normalizeMeshcomUdpPeerAddress(remoteHost)
        ) {
          const now = Date.now();
          if (now - lastRejectedPeerLogAt >= 60_000) {
            const suppressed =
              suppressedRejectedPeerLogs > 0 ? ` (+${suppressedRejectedPeerLogs} suppressed)` : '';
            console.debug(
              '[IPC]',
              DATA_CHANNEL,
              'ignore from',
              sanitizeLogMessage(rinfo.address),
              '(expected ' + sanitizeLogMessage(remoteHost) + ')' + suppressed,
            );
            lastRejectedPeerLogAt = now;
            suppressedRejectedPeerLogs = 0;
          } else {
            suppressedRejectedPeerLogs += 1;
          }
          return;
        }
        const now = Date.now();
        // Reset when the window elapses — or when wall clock jumps backward (NTP/sleep)
        // so a skewed start cannot leave the quota blocked until time catches up.
        if (
          now < inboundWindowStartedAt ||
          now - inboundWindowStartedAt >= UDP_BRIDGE_INBOUND_RATE_WINDOW_MS
        ) {
          inboundWindowStartedAt = now;
          inboundWindowCount = 0;
        }
        if (inboundWindowCount >= UDP_BRIDGE_INBOUND_RATE_MAX) {
          suppressedInboundRateDrops += 1;
          if (now - lastInboundRateLogAt >= UDP_BRIDGE_INBOUND_RATE_WINDOW_MS) {
            console.warn(
              'mcL0221 [IPC] %s rate-limited peer flood (%d/s; +%d dropped)',
              DATA_CHANNEL,
              UDP_BRIDGE_INBOUND_RATE_MAX,
              suppressedInboundRateDrops,
            );
            lastInboundRateLogAt = now;
            suppressedInboundRateDrops = 0;
          }
          return;
        }
        inboundWindowCount += 1;
        // Compact typed array (not number[]) — same pattern as meshcore TCP bridge.
        getMainWindow()?.webContents.send(DATA_CHANNEL, new Uint8Array(msg));
      });

      socket.on('close', () => {
        if (activeSocket === socket) {
          activeSocket = null;
          remoteHost = null;
          peerConnected = false;
          getMainWindow()?.webContents.send(DISCONNECTED_CHANNEL);
        }
      });

      void (async () => {
        try {
          remoteHost = await resolveMeshcomUdpPeerHost(host);
        } catch (err) {
          console.debug(
            '[main/ipc/udp-bridge] catch:',
            sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
          );

          failConnect(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        socket.bind(MESHCOM_EXTUDP_PORT, () => {
          socket.removeAllListeners('error');
          socket.on('error', (err) => {
            console.error('mcL0222 [IPC] meshcom:udp error:', sanitizeLogMessage(err.message));
            if (activeSocket === socket) {
              closeSocket(true);
            }
          });
          // Associate the datagram socket with the resolved peer so foreign
          // sources are dropped before the message handler (and its logging).
          if (remoteHost) {
            try {
              socket.connect(MESHCOM_EXTUDP_PORT, remoteHost);
              peerConnected = true;
            } catch (connectErr) {
              peerConnected = false;
              console.warn(
                'mcL0223 [IPC]',
                CONNECT_CHANNEL,
                'UDP connect failed; peer filter remains in handler:',
                sanitizeLogMessage(
                  connectErr instanceof Error ? connectErr.message : String(connectErr),
                ),
              );
            }
          }
          console.debug(
            '[IPC] %s bound :%d → %s',
            CONNECT_CHANNEL,
            MESHCOM_EXTUDP_PORT,
            sanitizeLogMessage(remoteHost ?? host),
          );
          resolve();
        });
      })();
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
      console.warn('mcL0224 [IPC]', msg);
      return Promise.reject(new Error(msg));
    }
    const sock = activeSocket;
    const host = remoteHost;
    const connected = peerConnected;
    return new Promise<void>((resolve, reject) => {
      const onSent = (err?: Error | null): void => {
        if (err) {
          console.error('mcL0225 [IPC]', WRITE_CHANNEL, 'error:', sanitizeLogMessage(err.message));
          reject(err);
        } else {
          resolve();
        }
      };
      const payload = Buffer.from(bytes);
      // Connected sockets must use the destination-free send overload.
      if (connected) {
        sock.send(payload, onSent);
      } else {
        sock.send(payload, MESHCOM_EXTUDP_PORT, host, onSent);
      }
    });
  };

  const disconnect = (event: IpcMainInvokeEvent): void => {
    assertIpcSender(event, DISCONNECT_CHANNEL);
    if (activeSocket) {
      console.debug('[IPC]', DISCONNECT_CHANNEL);
      // Null before close so the close handler does not double-emit disconnected.
      const prev = activeSocket;
      activeSocket = null;
      remoteHost = null;
      peerConnected = false;
      resetInboundRateWindow();
      try {
        prev.close();
      } catch (err) {
        console.debug(
          '[IPC]',
          DISCONNECT_CHANNEL,
          'close:',
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
    peerConnected = false;
    try {
      prev.close();
    } catch (err) {
      console.debug('[main]', logLabel + ':', err instanceof Error ? err.message : err); // log-injection-ok internal Node.js socket error during cleanup
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
