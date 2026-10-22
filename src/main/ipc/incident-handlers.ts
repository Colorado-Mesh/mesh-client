import { ipcMain } from 'electron';

import { getDatabase } from '../database';
import { getIncidentsOn, saveIncidentsOn, seedIncidentsOn } from '../incident-database';
import { assertIpcSender } from '../validate-ipc-sender';

/** Incident mutations reject on validation or database failure so the renderer retains its retry. */
export function registerIncidentIpcHandlers(): void {
  ipcMain.handle('db:getIncidents', (event) => {
    assertIpcSender(event, 'db:getIncidents');
    return getIncidentsOn(getDatabase());
  });
  ipcMain.handle('db:saveIncidents', (event, snapshot: unknown) => {
    assertIpcSender(event, 'db:saveIncidents');
    saveIncidentsOn(getDatabase(), snapshot);
  });
  ipcMain.handle('db:seedIncidents', (event, legacyJson: unknown) => {
    assertIpcSender(event, 'db:seedIncidents');
    return seedIncidentsOn(getDatabase(), legacyJson);
  });
}
