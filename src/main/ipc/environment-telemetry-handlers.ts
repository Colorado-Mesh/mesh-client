import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import {
  ENVIRONMENT_TELEMETRY_MAX_NODES,
  ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  ENVIRONMENT_TELEMETRY_RETENTION_MS,
  isEnvironmentTelemetrySource,
  sanitizeEnvironmentReading,
} from '../../shared/environmentTelemetry';
import { isMeshProtocol } from '../../shared/meshProtocol';
import { finishDbIpcHandler, finishDbIpcReadHandler, getDbForIpc } from '../db-ipc-lifecycle';
import {
  claimLegacyEnvironmentTelemetryIdentityOn,
  ensureEnvironmentTelemetryNodeTimeIndexOn,
  insertEnvironmentTelemetryOn,
  pruneEnvironmentTelemetryOn,
  selectEnvironmentTelemetrySinceOn,
} from '../environment-telemetry-db';

export interface EnvironmentTelemetryIpcDeps {
  ipcMain: IpcMain;
  /** Main-owned sender check (includes suspension fence) — do not import validate-ipc-sender here. */
  assertIpcSender: (event: IpcMainInvokeEvent, channel: string) => void;
}

function safeNodeId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff
    ? value
    : null;
}

function safeIdentityId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;
}

/** Register `db:*EnvironmentTelemetry` handlers (per-node sensor history). */
export function registerEnvironmentTelemetryIpcHandlers({
  ipcMain,
  assertIpcSender,
}: EnvironmentTelemetryIpcDeps): void {
  const dbForIndex = getDbForIpc('db:ensureEnvironmentTelemetryNodeTimeIndex');
  if (dbForIndex) ensureEnvironmentTelemetryNodeTimeIndexOn(dbForIndex);

  ipcMain.handle(
    'db:saveEnvironmentTelemetry',
    (
      event,
      protocol: unknown,
      identityId: unknown,
      nodeId: unknown,
      recordedAt: unknown,
      reading: unknown,
      source: unknown,
    ) => {
      try {
        assertIpcSender(event, 'db:saveEnvironmentTelemetry');
        if (typeof protocol !== 'string' || !isMeshProtocol(protocol)) return { changes: 0 };
        const identity = safeIdentityId(identityId);
        const id = safeNodeId(nodeId);
        const sanitized = sanitizeEnvironmentReading(reading);
        if (
          identity === null ||
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
        insertEnvironmentTelemetryOn(
          db,
          protocol,
          identity,
          id,
          Math.floor(recordedAt),
          sanitized,
          source,
        );
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
      return selectEnvironmentTelemetrySinceOn(
        db,
        since,
        ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
        ENVIRONMENT_TELEMETRY_MAX_NODES,
      );
    } catch (err) {
      return finishDbIpcReadHandler('db:getEnvironmentTelemetry', err, []);
    }
  });

  ipcMain.handle(
    'db:claimLegacyEnvironmentTelemetryIdentity',
    (event, protocol: unknown, identityId: unknown) => {
      try {
        assertIpcSender(event, 'db:claimLegacyEnvironmentTelemetryIdentity');
        if (typeof protocol !== 'string' || !isMeshProtocol(protocol)) return { changes: 0 };
        const identity = safeIdentityId(identityId);
        if (identity === null) return { changes: 0 };
        const db = getDbForIpc('db:claimLegacyEnvironmentTelemetryIdentity');
        if (!db) return { changes: 0 };
        const changes = claimLegacyEnvironmentTelemetryIdentityOn(db, protocol, identity);
        return { changes };
      } catch (err) {
        finishDbIpcHandler('db:claimLegacyEnvironmentTelemetryIdentity', err);
      }
    },
  );

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
