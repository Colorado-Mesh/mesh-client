import { dialog } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Platform-default rnsd config file paths (first existing wins). */
export function defaultReticulumConfigPaths(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return [path.join(appData, 'Reticulum', 'config'), path.join(appData, 'rsReticulum', 'config')];
  }
  return [
    path.join(home, '.reticulum', 'config'),
    path.join(home, '.config', 'rsReticulum', 'config'),
    path.join(home, '.rsReticulum', 'config'),
  ];
}

export function readFirstExistingConfig(): { path: string | null; content: string | null } {
  for (const candidate of defaultReticulumConfigPaths()) {
    try {
      if (fs.existsSync(candidate)) {
        return { path: candidate, content: fs.readFileSync(candidate, 'utf8') };
      }
    } catch {
      // catch-no-log-ok: try next default path
    }
  }
  return { path: null, content: null };
}

export async function showReticulumConfigImportDialog(): Promise<{
  path: string | null;
  content: string | null;
}> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Reticulum config', extensions: ['config', 'ini', 'toml', 'txt', '*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null, content: null };
  }
  const filePath = result.filePaths[0];
  try {
    return { path: filePath, content: fs.readFileSync(filePath, 'utf8') };
  } catch {
    // catch-no-log-ok: dialog file read failed; caller shows empty content
    return { path: filePath, content: null };
  }
}
