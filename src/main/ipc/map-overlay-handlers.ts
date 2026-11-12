import { type BrowserWindow, dialog, ipcMain } from 'electron';

import type { MapOverlayImportResult } from '@/shared/mapOverlays/types';

import { importMapOverlayFromPath } from '../map-overlays/importOverlay';
import { assertIpcSender } from '../validate-ipc-sender';

/**
 * Local vector overlay import (KML / KMZ / GeoJSON). The renderer never supplies a filesystem path —
 * main opens the OS dialog and returns a parsed FeatureCollection.
 */
export function registerMapOverlayIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('mapOverlays:import', async (event): Promise<MapOverlayImportResult> => {
    assertIpcSender(event, 'mapOverlays:import');
    const parent = getMainWindow();
    const opts = {
      title: 'Import map overlay',
      properties: ['openFile'] as ('openFile' | 'multiSelections')[],
      filters: [
        { name: 'Map overlays', extensions: ['geojson', 'json', 'kml', 'kmz'] },
        { name: 'GeoJSON', extensions: ['geojson', 'json'] },
        { name: 'KML / KMZ', extensions: ['kml', 'kmz'] },
      ],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, code: 'cancelled' };
    }
    const filePath = result.filePaths[0];
    if (!filePath) return { ok: false, code: 'cancelled' };
    return importMapOverlayFromPath(filePath);
  });
}
