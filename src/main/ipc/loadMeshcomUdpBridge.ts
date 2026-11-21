import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ipcMain } from 'electron';

import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';
import type { UdpBridgeDeps } from './udp-bridge';

export interface LoadMeshcomUdpBridgeDeps extends UdpBridgeDeps {
  dirname: string;
  validateHost: UdpBridgeDeps['validateHost'];
}

export async function loadMeshcomUdpBridge(
  deps: LoadMeshcomUdpBridgeDeps,
): Promise<((reason: string) => void) | null> {
  const registerFallback = async (): Promise<null> => {
    const fb = (
      process.env.VITEST
        ? await import('./udp-bridge-fallback')
        : await import(pathToFileURL(path.join(deps.dirname, 'udp-bridge-fallback.js')).href)
    ) as {
      registerUdpBridgeIpcFallbackHandlers: (args: {
        ipcMain: typeof ipcMain;
        assertIpcSender: typeof assertIpcSender;
      }) => void;
    };
    fb.registerUdpBridgeIpcFallbackHandlers({ ipcMain, assertIpcSender });
    return null;
  };

  try {
    const udpBridgeMod = (
      process.env.VITEST
        ? await import('./udp-bridge')
        : await import(pathToFileURL(path.join(deps.dirname, 'udp-bridge.js')).href)
    ) as {
      registerUdpBridgeIpcHandlers: (bridgeDeps: UdpBridgeDeps) => void;
      destroyRegisteredUdpBridgeSockets: (reason: string) => void;
    };
    udpBridgeMod.registerUdpBridgeIpcHandlers({
      getMainWindow: deps.getMainWindow,
      validateHost: deps.validateHost,
    });
    return udpBridgeMod.destroyRegisteredUdpBridgeSockets;
  } catch (err: unknown) {
    console.error(
      '[main] MeshCom UDP bridge IPC registration failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return registerFallback();
  }
}
