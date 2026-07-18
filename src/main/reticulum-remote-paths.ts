/**
 * File dialogs + picker allowlist for Reticulum Remote (rncp file transfer).
 *
 * Mirrors the Nomad content-source pattern (`reticulum-config-paths.ts`):
 * a renderer cannot pass an arbitrary local path to `reticulum:rncpSend` /
 * `reticulum:rncpFetch` / `reticulum:setRncpListener` — the path must match
 * the last result returned by the corresponding native picker. Without this,
 * a compromised renderer could exfiltrate arbitrary local files over rncp
 * (send) or expose an arbitrary directory to remote fetch (listener
 * `fetch_jail`), so these are gated the same way Nomad's watched content
 * source directory is.
 */
import { dialog } from 'electron';
import path from 'path';

/** Last file returned by {@link showRncpOpenFileDialog} (rncp send allowlist). */
let lastPickedRncpSendFile: string | null = null;
/** Last directory returned by {@link showRncpSaveDirectoryDialog} (save_dir / fetch_jail allowlist). */
let lastPickedRncpSaveDirectory: string | null = null;

/** Pick a local file to send via rncp. */
export async function showRncpOpenFileDialog(): Promise<{
  canceled: boolean;
  path: string | null;
}> {
  const result = await dialog.showOpenDialog({
    title: 'Choose file to send',
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }
  const picked = path.resolve(result.filePaths[0]);
  lastPickedRncpSendFile = picked;
  return { canceled: false, path: picked };
}

/** Pick a local directory for rncp inbound listener `save_dir` / `fetch_jail`, or fetch `save_path`. */
export async function showRncpSaveDirectoryDialog(): Promise<{
  canceled: boolean;
  path: string | null;
}> {
  const result = await dialog.showOpenDialog({
    title: 'Choose folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }
  const picked = path.resolve(result.filePaths[0]);
  lastPickedRncpSaveDirectory = picked;
  return { canceled: false, path: picked };
}

/** Clear the picker allowlist (tests / logout). */
export function clearRncpPickerAllowlist(): void {
  lastPickedRncpSendFile = null;
  lastPickedRncpSaveDirectory = null;
}

/** True when `candidate` is exactly the last file returned by {@link showRncpOpenFileDialog}. */
export function isAllowedRncpSendFilePath(candidate: string | null | undefined): boolean {
  if (candidate == null || candidate.trim() === '') return false;
  if (lastPickedRncpSendFile == null) return false;
  return path.resolve(candidate) === lastPickedRncpSendFile;
}

/**
 * True when `candidate` is the last directory returned by
 * {@link showRncpSaveDirectoryDialog}, or a path nested under it (e.g. a
 * fetch `save_path` naming a file inside that directory).
 */
export function isAllowedRncpSaveDirectoryPath(candidate: string | null | undefined): boolean {
  if (candidate == null || candidate.trim() === '') return false;
  if (lastPickedRncpSaveDirectory == null) return false;
  const resolved = path.resolve(candidate);
  const dir = lastPickedRncpSaveDirectory;
  return resolved === dir || resolved.startsWith(`${dir}${path.sep}`);
}

/** True when `candidate` matches either picker allowlist (used to gate `reticulum:revealInFolder`). */
export function isAllowedRncpRevealPath(candidate: string | null | undefined): boolean {
  return isAllowedRncpSendFilePath(candidate) || isAllowedRncpSaveDirectoryPath(candidate);
}

/** Strip query string and trailing slashes without regex backtracking. */
function normalizeApiPath(apiPath: string): string {
  const q = apiPath.indexOf('?');
  const withoutQuery = q === -1 ? apiPath : apiPath.slice(0, q);
  let end = withoutQuery.length;
  while (end > 0 && withoutQuery.charAt(end - 1) === '/') {
    end -= 1;
  }
  return withoutQuery.slice(0, end);
}

/**
 * Sidecar HTTP paths for rncp mutations that must go through the picker-gated
 * dedicated handlers (`reticulum:rncpSend` / `rncpFetch` / `setRncpListener`)
 * instead of the generic `reticulum:proxyPost`.
 */
const RNCP_PICKER_GATED_API_PATHS = new Set([
  '/api/v1/rncp/send',
  '/api/v1/rncp/fetch',
  '/api/v1/rncp/listener',
]);

export function isRncpPickerGatedApiPath(apiPath: string): boolean {
  const normalized = normalizeApiPath(apiPath);
  return (
    RNCP_PICKER_GATED_API_PATHS.has(normalized) ||
    [...RNCP_PICKER_GATED_API_PATHS].some((p) => normalized.endsWith(p))
  );
}
