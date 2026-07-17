import { dialog } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readUtf8FileBounded } from './reticulum-config-read';

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
        return { path: candidate, content: readUtf8FileBounded(candidate) };
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
    return { path: filePath, content: readUtf8FileBounded(filePath) };
  } catch {
    // catch-no-log-ok: dialog file read failed; caller shows empty content
    return { path: filePath, content: null };
  }
}

/** Pick a Nomad site root or pages directory for live watched hosting. */
export async function showNomadContentSourceDialog(): Promise<{
  canceled: boolean;
  path: string | null;
}> {
  const result = await dialog.showOpenDialog({
    title: 'Choose Nomad pages folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }
  const picked = path.resolve(result.filePaths[0]);
  rememberNomadContentSourcePick(picked);
  return { canceled: false, path: picked };
}

/** Last directory returned by {@link showNomadContentSourceDialog} (capability allowlist). */
let lastPickedNomadContentSource: string | null = null;

/** Record a picker result so {@link isAllowedNomadContentSourcePath} can authorize apply. */
export function rememberNomadContentSourcePick(pickedPath: string): void {
  lastPickedNomadContentSource = path.resolve(pickedPath);
}

/** Clear the picker allowlist (tests / logout). */
export function clearNomadContentSourcePick(): void {
  lastPickedNomadContentSource = null;
}

/**
 * True when `candidate` matches the last native folder-picker result.
 * Blocks arbitrary filesystem paths and rejects null/empty (watch folder required).
 */
export function isAllowedNomadContentSourcePath(candidate: string | null): boolean {
  if (candidate == null || candidate.trim() === '') {
    return false;
  }
  if (lastPickedNomadContentSource == null) {
    return false;
  }
  return path.resolve(candidate) === lastPickedNomadContentSource;
}

/** Sidecar HTTP path for Nomad content-source mutations (must not go through generic proxyPut). */
export const NOMAD_CONTENT_SOURCE_API_PATH = '/api/v1/nomadnetwork/serving/content-source';

/** Strip query string and trailing slashes without regex backtracking. */
export function normalizeNomadContentSourceApiPath(apiPath: string): string {
  const q = apiPath.indexOf('?');
  const withoutQuery = q === -1 ? apiPath : apiPath.slice(0, q);
  let end = withoutQuery.length;
  while (end > 0 && withoutQuery.charAt(end - 1) === '/') {
    end -= 1;
  }
  return withoutQuery.slice(0, end);
}

export function isNomadContentSourceApiPath(apiPath: string): boolean {
  const normalized = normalizeNomadContentSourceApiPath(apiPath);
  return (
    normalized === NOMAD_CONTENT_SOURCE_API_PATH ||
    normalized.endsWith('/nomadnetwork/serving/content-source')
  );
}
