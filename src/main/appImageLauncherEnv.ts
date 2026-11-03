/**
 * AppImageLauncher intercepts AppImage launches and remaps `$APPIMAGE` to a FUSE
 * mount under `/run/user/…/appimagelauncherfs/`. electron-updater then updates the
 * wrong path (or fails with ENOSYS), and desktop integration can keep launching the
 * previously integrated binary — so About still shows the old version after the user
 * downloads a newer `Mesh-client-X.Y.Z.AppImage` (GitHub #1382).
 *
 * When AppImageLauncher is active, `$ARGV0` points at the real source AppImage
 * (typically under `~/Applications`). Point `$APPIMAGE` there before electron-updater runs.
 *
 * @see https://github.com/electron-userland/electron-builder/issues/4046
 */

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
 * Mutates `env` when AppImageLauncher is detected. Safe no-op on other platforms
 * and when the expected env vars are missing or not AppImage paths.
 */
export function remapAppImageLauncherEnv(
  env: NodeJS.ProcessEnv = process.env,
): AppImageLauncherEnvRemap {
  if (env.DESKTOPINTEGRATION !== 'AppImageLauncher') {
    return { remapped: false };
  }
  const argv0 = env.ARGV0;
  if (typeof argv0 !== 'string' || argv0.length === 0 || !looksLikeAppImagePath(argv0)) {
    return { remapped: false };
  }
  const from = typeof env.APPIMAGE === 'string' ? env.APPIMAGE : undefined;
  if (from === argv0) {
    return { remapped: false };
  }
  env.APPIMAGE = argv0;
  return { remapped: true, from, to: argv0 };
}
