import { app, dialog } from 'electron';

import { isHeadlessServerMode, parseBooleanEnv } from '../shared/headless';
import type { DatabaseSchemaTooNewError } from './db-schema-sync';
import { getLogPath } from './log-service';
import { sanitizeLogMessage } from './sanitize-log-message';

/** Env: set to `1`/`true`/`yes`/`on` to auto-accept schema upgrade (E2E / headless containers). */
export const MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV = 'MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE';

export function formatDatabaseSchemaTooNewMessage(err: DatabaseSchemaTooNewError): string {
  const logPath = getLogPath();
  return (
    `This database was upgraded by a newer version of Mesh-Client (schema ${err.dbVersion}).\n\n` +
    `This build (${app.getVersion()}) only supports schema version ${err.appVersion} or older.\n\n` +
    `Please install the latest Mesh-Client release and try again.\n\n` +
    `Details are also in:\n${logPath}`
  );
}

export function formatSchemaUpgradeConfirmMessage(fromVersion: number, toVersion: number): string {
  return (
    `This Mesh-Client build will upgrade your local database from schema ${fromVersion} to ${toVersion}.\n\n` +
    `After the upgrade you cannot go back to an older Mesh-Client that only supports schema ${fromVersion} ` +
    `(or any version below ${toVersion}) using this database.\n\n` +
    `Choose Quit to exit without changing the database, or Upgrade to continue.`
  );
}

/**
 * Blocking confirm before irreversible SQLite schema upgrade.
 * Default button is Quit (index 0). Returns true only when the user chooses Upgrade.
 * Unattended accept requires explicit `MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE` (container
 * entrypoint sets this). Headless without that env refuses the upgrade (no dialog).
 */
export function confirmDatabaseSchemaUpgrade(fromVersion: number, toVersion: number): boolean {
  if (parseBooleanEnv(process.env[MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV])) {
    console.warn(
      `[db] MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE: auto-accepting schema upgrade ${fromVersion} → ${toVersion}`,
    );
    return true;
  }
  if (isHeadlessServerMode()) {
    console.error(
      `[db] headless server mode: refusing schema upgrade ${fromVersion} → ${toVersion} ` +
        `(set ${MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV}=1 to allow)`,
    );
    return false;
  }

  try {
    const result = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Quit', 'Upgrade'],
      defaultId: 0,
      cancelId: 0,
      title: 'Mesh-Client — Database Upgrade',
      message: 'Irreversible database schema upgrade',
      detail: formatSchemaUpgradeConfirmMessage(fromVersion, toVersion),
      noLink: true,
    });
    return result === 1;
  } catch {
    // catch-no-log-ok dialog unavailable; refuse upgrade so the DB is not silently mutated
    return false;
  }
}

/** Synchronous native dialog for fatal errors before a BrowserWindow exists (packaged-safe). */
export function showFatalStartupError(title: string, message: string): void {
  if (isHeadlessServerMode()) {
    // No desktop to show a dialog on (container/Xvfb); the error must not deadlock startup.
    console.error(
      `[main] (headless) ${sanitizeLogMessage(title)} — ${sanitizeLogMessage(message)}`,
    );
    return;
  }
  try {
    dialog.showErrorBox(title, message);
  } catch {
    // catch-no-log-ok dialog unavailable during fatal startup handling; error already logged above
  }
}
