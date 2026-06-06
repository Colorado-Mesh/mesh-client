import { ipcMain } from 'electron';

import type { TAKServerStatus } from '../../shared/tak-types';
import { sanitizeLogMessage } from '../log-service';
import type { TakServerManager } from '../tak-server-manager';

export interface TakIpcDeps {
  idleTakStatus: TAKServerStatus;
  ensureTakServerManager: () => Promise<TakServerManager>;
  getTakServerManager: () => TakServerManager | null;
  validateTakSettings: (settings: unknown) => void;
}

/** Register TAK server IPC handlers (`tak:*`). */
export function registerTakIpcHandlers(deps: TakIpcDeps): void {
  const { idleTakStatus, ensureTakServerManager, getTakServerManager, validateTakSettings } = deps;

  ipcMain.handle('tak:start', async (_event, settings) => {
    try {
      console.debug('[IPC] tak:start');
      validateTakSettings(settings);
      const m = await ensureTakServerManager();
      await m.start(settings);
    } catch (err) {
      console.error(
        '[IPC] tak:start failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('tak:stop', () => {
    console.debug('[IPC] tak:stop');
    getTakServerManager()?.stop();
  });

  ipcMain.handle('tak:getStatus', () => {
    return getTakServerManager()?.getStatus() ?? idleTakStatus;
  });

  ipcMain.handle('tak:getConnectedClients', () => {
    return getTakServerManager()?.getConnectedClients() ?? [];
  });

  ipcMain.handle('tak:generateDataPackage', async () => {
    try {
      console.debug('[IPC] tak:generateDataPackage');
      const m = await ensureTakServerManager();
      await m.generateDataPackage();
    } catch (err) {
      console.error(
        '[IPC] tak:generateDataPackage failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('tak:regenerateCertificates', async () => {
    try {
      console.debug('[IPC] tak:regenerateCertificates');
      const m = await ensureTakServerManager();
      await m.regenerateCertificates();
    } catch (err) {
      console.error(
        '[IPC] tak:regenerateCertificates failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('tak:pushNodeUpdate', async (_event, node: unknown) => {
    if (!node || typeof node !== 'object')
      throw new Error('tak:pushNodeUpdate: node must be object');
    const n = node as Record<string, unknown>;
    const nodeId = Number(n.node_id);
    if (!Number.isFinite(nodeId) || nodeId <= 0)
      throw new Error('tak:pushNodeUpdate: invalid node_id');
    const m = await ensureTakServerManager();
    if (!m.getStatus().running) {
      console.debug('[IPC] tak:pushNodeUpdate: TAK server not running, skipping');
      return;
    }
    m.onNodeUpdate(n as Parameters<TakServerManager['onNodeUpdate']>[0]);
  });
}
