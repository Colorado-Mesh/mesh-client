import { ipcMain } from 'electron';

import {
  TAK_NODE_UPDATE_BATCH_MAX,
  type TAKServerStatus,
  type TAKSettings,
} from '../../shared/tak-types';
import { sanitizeLogMessage } from '../log-service';
import { parseTakNodeUpdate } from '../tak/node-update';
import type { TakServerManager } from '../tak-server-manager';
import { assertIpcSender } from '../validate-ipc-sender';

export interface TakIpcDeps {
  idleTakStatus: TAKServerStatus;
  ensureTakServerManager: () => Promise<TakServerManager>;
  getTakServerManager: () => TakServerManager | null;
  validateTakSettings: (settings: unknown) => asserts settings is TAKSettings;
}

/** Register TAK server IPC handlers (`tak:*`). */
export function registerTakIpcHandlers(deps: TakIpcDeps): void {
  const { idleTakStatus, ensureTakServerManager, getTakServerManager } = deps;
  const validateTakSettings: (settings: unknown) => asserts settings is TAKSettings =
    deps.validateTakSettings;

  ipcMain.handle('tak:start', async (event, settings: unknown) => {
    assertIpcSender(event, 'tak:start');
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

  ipcMain.handle('tak:stop', (event) => {
    assertIpcSender(event, 'tak:stop');
    console.debug('[IPC] tak:stop');
    getTakServerManager()?.stop();
  });

  ipcMain.handle('tak:getStatus', (event) => {
    assertIpcSender(event, 'tak:getStatus');
    return getTakServerManager()?.getStatus() ?? idleTakStatus;
  });

  ipcMain.handle('tak:getConnectedClients', (event) => {
    assertIpcSender(event, 'tak:getConnectedClients');
    return getTakServerManager()?.getConnectedClients() ?? [];
  });

  ipcMain.handle('tak:generateDataPackage', async (event) => {
    assertIpcSender(event, 'tak:generateDataPackage');
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

  ipcMain.handle('tak:regenerateCertificates', async (event) => {
    assertIpcSender(event, 'tak:regenerateCertificates');
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

  ipcMain.handle('tak:pushNodeUpdate', async (event, node: unknown) => {
    assertIpcSender(event, 'tak:pushNodeUpdate');
    try {
      const update = parseTakNodeUpdate(node);
      if (!update) throw new Error('tak:pushNodeUpdate: invalid node update');
      const m = await ensureTakServerManager();
      if (!m.hasActiveSink()) {
        console.debug('[IPC] tak:pushNodeUpdate: no TAK sink active, skipping');
        return;
      }
      m.onNodeUpdate(update);
    } catch (err) {
      console.error(
        '[IPC] tak:pushNodeUpdate failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('tak:pushNodeUpdates', (event, nodes: unknown) => {
    assertIpcSender(event, 'tak:pushNodeUpdates');
    if (!Array.isArray(nodes) || nodes.length > TAK_NODE_UPDATE_BATCH_MAX) {
      throw new Error(
        `tak:pushNodeUpdates: nodes must be an array of at most ${TAK_NODE_UPDATE_BATCH_MAX} updates`,
      );
    }
    // Nothing is listening until a sink starts, so do not load the TAK module just to drop these.
    const m = getTakServerManager();
    if (!m?.hasActiveSink()) return;
    let rejected = 0;
    for (const raw of nodes) {
      const update = parseTakNodeUpdate(raw);
      if (update) m.onNodeUpdate(update);
      else rejected++;
    }
    if (rejected > 0) {
      console.debug(`[IPC] tak:pushNodeUpdates: dropped ${rejected} invalid node update(s)`);
    }
  });
}
