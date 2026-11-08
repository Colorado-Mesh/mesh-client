import { randomUUID } from 'crypto';
import { type BrowserWindow, ipcMain } from 'electron';

import type { ElevationHgtDownloadRequest, ElevationHgtProgress } from '@/shared/elevation/types';
import {
  parseElevationProfileRequest,
  parseHgtEstimateRequest,
} from '@/shared/elevation/validation';

import {
  createElevationService,
  type ElevationService,
  type ElevationServiceDeps,
} from '../elevation/elevation-service';
import { assertIpcSender } from '../validate-ipc-sender';

export type ElevationHandlerDeps = ElevationServiceDeps & {
  getMainWindow: () => BrowserWindow | null;
};

let service: ElevationService | null = null;

function getService(deps: ElevationHandlerDeps): ElevationService {
  service ??= createElevationService(deps);
  return service;
}

/** Test seam. */
export function resetElevationServiceForTests(): void {
  service = null;
}

export function registerElevationIpcHandlers(deps: ElevationHandlerDeps): void {
  ipcMain.handle('elevation:sampleProfile', (event, raw: unknown) => {
    assertIpcSender(event, 'elevation:sampleProfile');
    const req = parseElevationProfileRequest(raw);
    if (!req) {
      return { ok: false, error: { code: 'invalid_request', message: 'invalid_request' } };
    }
    return getService(deps).sampleProfile(req);
  });

  ipcMain.handle('elevation:estimateHgt', (event, raw: unknown) => {
    assertIpcSender(event, 'elevation:estimateHgt');
    const req = parseHgtEstimateRequest(raw);
    if (!req) {
      return { ok: false, error: { code: 'invalid_request', message: 'invalid_request' } };
    }
    return getService(deps).estimateHgt(req);
  });

  ipcMain.handle('elevation:downloadHgt', async (event, raw: unknown) => {
    assertIpcSender(event, 'elevation:downloadHgt');
    if (raw == null || typeof raw !== 'object') {
      return { ok: false, error: { code: 'invalid_request', message: 'invalid_request' } };
    }
    const bounds = parseHgtEstimateRequest(raw);
    if (!bounds) {
      return { ok: false, error: { code: 'invalid_request', message: 'invalid_request' } };
    }
    const jobId =
      typeof (raw as ElevationHgtDownloadRequest).jobId === 'string' &&
      (raw as ElevationHgtDownloadRequest).jobId!.length > 0
        ? (raw as ElevationHgtDownloadRequest).jobId!
        : randomUUID();
    const win = deps.getMainWindow();
    return getService(deps).downloadHgt({ ...bounds, jobId }, (progress: ElevationHgtProgress) => {
      win?.webContents.send('elevation:hgtProgress', progress);
    });
  });

  ipcMain.handle('elevation:cancelHgtDownload', (event, raw: unknown) => {
    assertIpcSender(event, 'elevation:cancelHgtDownload');
    const jobId = typeof raw === 'string' ? raw : (raw as { jobId?: string } | null)?.jobId;
    if (typeof jobId !== 'string' || !jobId) {
      return { ok: false as const };
    }
    getService(deps).cancelDownload(jobId);
    return { ok: true as const };
  });

  ipcMain.handle('elevation:cacheStats', (event) => {
    assertIpcSender(event, 'elevation:cacheStats');
    return getService(deps).cacheStats();
  });

  ipcMain.handle('elevation:clearCache', async (event) => {
    assertIpcSender(event, 'elevation:clearCache');
    await getService(deps).clearCache();
    return { ok: true as const };
  });
}
