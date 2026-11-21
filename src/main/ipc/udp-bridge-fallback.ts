/**
 * MeshCom EXTUDP IPC stubs when `udp-bridge.js` fails to load.
 * Keeps preload invoke paths alive with a clear error (sibling chunk — out of index.js budget).
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import type { assertIpcSender } from '../validate-ipc-sender';

const LOAD_ERROR =
  'MeshCom EXTUDP bridge is unavailable (udp-bridge failed to load). Reinstall or rebuild the app.';

const UDP_CHANNELS = [
  'meshcom:udp-connect',
  'meshcom:udp-write',
  'meshcom:udp-disconnect',
] as const;

export interface UdpBridgeFallbackDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  assertIpcSender: typeof assertIpcSender;
}

export function registerUdpBridgeIpcFallbackHandlers(deps: UdpBridgeFallbackDeps): void {
  const { ipcMain, assertIpcSender: assertSender } = deps;
  for (const channel of UDP_CHANNELS) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
      assertSender(event, channel);
      if (channel === 'meshcom:udp-disconnect') return;
      return Promise.reject(new Error(LOAD_ERROR));
    });
  }
}
