/**
 * AppImageLauncher intercepts AppImage launches and remaps `$APPIMAGE` to a FUSE
 * mount under `/run/user/…/appimagelauncherfs/`. electron-updater then updates the
 * wrong path (or fails with ENOSYS), and desktop integration can keep launching the
 * previously integrated binary — so About still shows the old version after the user
 * downloads a newer `Mesh-client-X.Y.Z.AppImage` (GitHub #1382).
 *
 * When AppImageLauncher is active, `$ARGV0` points at the real source AppImage
 * (typically under `~/Applications`). Point `$APPIMAGE` there before electron-updater runs.
 * `electron-updater` requires an absolute `APPIMAGE` path (it unlinks that path on install),
 * so relative/`symlink` `ARGV0` values are resolved against AppImage `$OWD` (else cwd)
 * and canonicalized before assignment.
 *
 * @see https://github.com/electron-userland/electron-builder/issues/4046
 */

import path from 'node:path';

import { canonicalizePath } from './pathCanonical';

export interface AppImageLauncherEnvRemap {
  remapped: boolean;
  from?: string;
  to?: string;
}

function looksLikeAppImagePath(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.endsWith('.appimage');
}

/**
 * Resolve AppImageLauncher `$ARGV0` to an absolute realpath suitable for `$APPIMAGE`.
 * Uses `$OWD` (AppImage original working directory) when present, otherwise `process.cwd()`.
 */
export function resolveAppImageLauncherSourcePath(
  argv0: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null {
  if (argv0.length === 0 || argv0.includes('\0') || !looksLikeAppImagePath(argv0)) {
    return null;
  }
  const owd = env.OWD;
  const base = typeof owd === 'string' && owd.length > 0 && !owd.includes('\0') ? owd : cwd;
  const absolute = path.resolve(base, argv0);
  if (!path.isAbsolute(absolute) || absolute.includes('\0')) {
    return null;
  }
  const canonical = canonicalizePath(absolute) ?? absolute;
  if (
    !looksLikeAppImagePath(canonical) ||
    !path.isAbsolute(canonical) ||
    canonical.includes('\0')
  ) {
    return null;
  }
  return canonical;
}

/**
 * Mutates `env` when AppImageLauncher is detected. Safe no-op on other platforms
 * and when the expected env vars are missing or not AppImage paths.
 */
export function remapAppImageLauncherEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): AppImageLauncherEnvRemap {
  if (env.DESKTOPINTEGRATION !== 'AppImageLauncher') {
    return { remapped: false };
  }
  const argv0 = env.ARGV0;
  if (typeof argv0 !== 'string') {
    return { remapped: false };
  }
  const resolved = resolveAppImageLauncherSourcePath(argv0, env, cwd);
  if (resolved == null) {
    return { remapped: false };
  }
  const from = typeof env.APPIMAGE === 'string' ? env.APPIMAGE : undefined;
  if (from === resolved) {
    return { remapped: false };
  }
  env.APPIMAGE = resolved;
  return { remapped: true, from, to: resolved };
}
