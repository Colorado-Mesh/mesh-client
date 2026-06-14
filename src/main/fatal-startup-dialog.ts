import { app, dialog } from 'electron';

import type { DatabaseSchemaTooNewError } from './db-schema-sync';
import { getLogPath } from './log-service';

export function formatDatabaseSchemaTooNewMessage(err: DatabaseSchemaTooNewError): string {
  const logPath = getLogPath();
  return (
    `This database was upgraded by a newer version of Mesh-Client (schema ${err.dbVersion}).\n\n` +
    `This build (${app.getVersion()}) only supports schema version ${err.appVersion} or older.\n\n` +
    `Please install the latest Mesh-Client release and try again.\n\n` +
    `Details are also in:\n${logPath}`
  );
}

/** Synchronous native dialog for fatal errors before a BrowserWindow exists (packaged-safe). */
export function showFatalStartupError(title: string, message: string): void {
  try {
    dialog.showErrorBox(title, message);
  } catch {
    // catch-no-log-ok dialog unavailable during fatal startup handling; error already logged above
  }
}
