import { describe, expect, it } from 'vitest';

import { remapAppImageLauncherEnv } from './appImageLauncherEnv';

describe('remapAppImageLauncherEnv', () => {
  it('is a no-op when AppImageLauncher is not active', () => {
    const env: NodeJS.ProcessEnv = {
      APPIMAGE: '/tmp/Mesh-client-6.6.0.AppImage',
      ARGV0: '/home/user/Applications/Mesh-client-6.6.0.AppImage',
    };
    expect(remapAppImageLauncherEnv(env)).toEqual({ remapped: false });
    expect(env.APPIMAGE).toBe('/tmp/Mesh-client-6.6.0.AppImage');
  });

  it('rewrites APPIMAGE to ARGV0 under AppImageLauncher', () => {
    const env: NodeJS.ProcessEnv = {
      DESKTOPINTEGRATION: 'AppImageLauncher',
      APPIMAGE: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      ARGV0: '/home/user/Applications/Mesh-client-6.6.0.AppImage',
    };
    expect(remapAppImageLauncherEnv(env)).toEqual({
      remapped: true,
      from: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      to: '/home/user/Applications/Mesh-client-6.6.0.AppImage',
    });
    expect(env.APPIMAGE).toBe('/home/user/Applications/Mesh-client-6.6.0.AppImage');
  });

  it('ignores AppImageLauncher when ARGV0 is missing or not an AppImage path', () => {
    expect(
      remapAppImageLauncherEnv({
        DESKTOPINTEGRATION: 'AppImageLauncher',
        APPIMAGE: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      }),
    ).toEqual({ remapped: false });
    expect(
      remapAppImageLauncherEnv({
        DESKTOPINTEGRATION: 'AppImageLauncher',
        APPIMAGE: '/run/user/1000/appimagelauncherfs/0001.AppImage',
        ARGV0: '/usr/bin/mesh-client',
      }),
    ).toEqual({ remapped: false });
  });

  it('does not report a remap when APPIMAGE already matches ARGV0', () => {
    const path = '/home/user/Applications/Mesh-client-6.6.0.AppImage';
    const env: NodeJS.ProcessEnv = {
      DESKTOPINTEGRATION: 'AppImageLauncher',
      APPIMAGE: path,
      ARGV0: path,
    };
    expect(remapAppImageLauncherEnv(env)).toEqual({ remapped: false });
  });
});
