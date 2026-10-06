import path from 'node:path';

import { app, ipcMain } from 'electron';

import { parseGeoResolvePlaceRequest } from '../../shared/geoPlace';
import { PlaceCache } from '../geo/placeCache';
import { PlaceResolver } from '../geo/resolvePlace';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

function gazetteerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'geo', 'cities15000.tsv')
    : path.join(app.getAppPath(), 'resources', 'geo', 'cities15000.tsv');
}

let resolver: PlaceResolver | null = null;

function getResolver(): PlaceResolver {
  resolver ??= new PlaceResolver({
    gazetteerPath: gazetteerPath(),
    cache: PlaceCache.inDirectory(app.getPath('userData')),
  });
  return resolver;
}

/** Register place-lookup IPC handlers (`geo:*`). */
export function registerGeoIpcHandlers(): void {
  ipcMain.handle('geo:resolvePlace', async (event, raw: unknown) => {
    assertIpcSender(event, 'geo:resolvePlace');
    const request = parseGeoResolvePlaceRequest(raw);
    if (!request) return null;
    try {
      return await getResolver().resolve(request);
    } catch (err) {
      console.warn(
        '[geo] resolvePlace failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      return null;
    }
  });
}
