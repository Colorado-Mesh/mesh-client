import type { IpcMain } from 'electron';

import {
  ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  ENVIRONMENT_TELEMETRY_RETENTION_MS,
  isEnvironmentTelemetrySource,
  sanitizeEnvironmentReading,
} from '../../shared/environmentTelemetry';
import { isMeshProtocol } from '../../shared/meshProtocol';
import { finishDbIpcHandler, finishDbIpcReadHandler, getDbForIpc } from '../db-ipc-lifecycle';
import {
  insertEnvironmentTelemetryOn,
  pruneEnvironmentTelemetryOn,
  selectEnvironmentTelemetrySinceOn,
} from '../environment-telemetry-db';
import { assertIpcSender } from '../validate-ipc-sender';

export interface EnvironmentTelemetryIpcDeps {
  ipcMain: IpcMain;
}

function safeNodeId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff
    ? value
    : null;
}

/** Register `db:*EnvironmentTelemetry` handlers (per-node sensor history). */
export function registerEnvironmentTelemetryIpcHandlers({
  ipcMain,
}: EnvironmentTelemetryIpcDeps): void {
  ipcMain.handle(
    'db:saveEnvironmentTelemetry',
    (
      event,
      protocol: unknown,
      nodeId: unknown,
      recordedAt: unknown,
      reading: unknown,
      source: unknown,
    ) => {
      try {
        assertIpcSender(event, 'db:saveEnvironmentTelemetry');
        if (typeof protocol !== 'string' || !isMeshProtocol(protocol)) return { changes: 0 };
        const id = safeNodeId(nodeId);
        const sanitized = sanitizeEnvironmentReading(reading);
        if (
          id === null ||
          sanitized === null ||
          typeof recordedAt !== 'number' ||
          !Number.isFinite(recordedAt) ||
          !isEnvironmentTelemetrySource(source)
        ) {
          return { changes: 0 };
        }
        const db = getDbForIpc('db:saveEnvironmentTelemetry');
        if (!db) return { changes: 0 };
        insertEnvironmentTelemetryOn(db, protocol, id, Math.floor(recordedAt), sanitized, source);
        return { changes: 1 };
      } catch (err) {
        finishDbIpcHandler('db:saveEnvironmentTelemetry', err);
      }
    },
  );

  ipcMain.handle('db:getEnvironmentTelemetry', (event, sinceMs: unknown) => {
    try {
      assertIpcSender(event, 'db:getEnvironmentTelemetry');
      const db = getDbForIpc('db:getEnvironmentTelemetry');
      if (!db) return [];
      const since = typeof sinceMs === 'number' && Number.isFinite(sinceMs) ? sinceMs : 0;
      return selectEnvironmentTelemetrySinceOn(db, since);
    } catch (err) {
      return finishDbIpcReadHandler('db:getEnvironmentTelemetry', err, []);
    }
  });

  ipcMain.handle('db:clearEnvironmentTelemetry', (event) => {
    try {
      assertIpcSender(event, 'db:clearEnvironmentTelemetry');
      const db = getDbForIpc('db:clearEnvironmentTelemetry');
      if (!db) return { changes: 0 };
      const result = db.prepareOnce('DELETE FROM node_environment_telemetry').run();
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:clearEnvironmentTelemetry', err);
    }
  });

  ipcMain.handle('db:pruneEnvironmentTelemetry', (event) => {
    try {
      assertIpcSender(event, 'db:pruneEnvironmentTelemetry');
      const db = getDbForIpc('db:pruneEnvironmentTelemetry');
      if (!db) return 0;
      const changes = pruneEnvironmentTelemetryOn(
        db,
        ENVIRONMENT_TELEMETRY_RETENTION_MS,
        ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
      );
      if (changes > 0) {
        console.debug(`[IPC] db:pruneEnvironmentTelemetry: pruned ${changes} rows`);
      }
      return changes;
    } catch (err) {
      finishDbIpcHandler('db:pruneEnvironmentTelemetry', err);
    }
  });
}
