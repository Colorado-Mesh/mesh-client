import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import { MESHCOM_DB_DEGRADED_CHANNEL, type MeshcomDbDegradedPayload } from './meshcom-db-status';

export interface MeshcomDbIpcFallbackDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  assertIpcSender: (event: IpcMainInvokeEvent, channel: string) => void;
}

/** Channels registered by {@link registerMeshcomDbIpcHandlers} (preload must stay in sync). */
const MESHCOM_DB_IPC_CHANNELS = [
  'db:getMeshcomMessages',
  'db:saveMeshcomMessage',
  'db:updateMeshcomMessageStatus',
  'db:pruneMeshcomMessagesByCount',
  'db:getMeshcomContacts',
  'db:saveMeshcomContact',
  'db:pruneMeshcomContactsByCount',
  'db:deleteMeshcomContact',
  'db:rebindMeshcomIdentity',
] as const;

/**
 * Lightweight IPC stubs when `meshcom-db-handlers.js` fails to load.
 * MeshCom history is non-critical — return empty / zero-change results instead of throwing.
 */
export function registerMeshcomDbIpcFallbackHandlers(deps: MeshcomDbIpcFallbackDeps): void {
  const { ipcMain, assertIpcSender } = deps;
  ipcMain.handle('meshcom:db-degraded', (event) => {
    assertIpcSender(event, MESHCOM_DB_DEGRADED_CHANNEL);
    const payload: MeshcomDbDegradedPayload = { degraded: true };
    return payload;
  });
  for (const channel of MESHCOM_DB_IPC_CHANNELS) {
    ipcMain.handle(channel, (event) => {
      assertIpcSender(event, channel);
      if (channel === 'db:getMeshcomMessages' || channel === 'db:getMeshcomContacts') return [];
      return { changes: 0 };
    });
  }
}
