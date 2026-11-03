import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { remapAppImageLauncherEnv, resolveAppImageLauncherSourcePath } from './appImageLauncherEnv';
import { canonicalizePath } from './pathCanonical';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-launcher-'));
  tempDirs.push(dir);
  return dir;
}

/** Realpath for assertions (macOS `/var` → `/private/var`). */
function real(p: string): string {
  const canonical = canonicalizePath(p);
  if (canonical == null) {
    throw new Error(`expected canonicalizePath(${p})`);
  }
  return canonical;
}

describe('remapAppImageLauncherEnv', () => {
  it('is a no-op when AppImageLauncher is not active', () => {
    const env: NodeJS.ProcessEnv = {
      APPIMAGE: '/tmp/Mesh-client-6.6.0.AppImage',
      ARGV0: '/home/user/Applications/Mesh-client-6.6.0.AppImage',
    };
    expect(remapAppImageLauncherEnv(env)).toEqual({ remapped: false });
    expect(env.APPIMAGE).toBe('/tmp/Mesh-client-6.6.0.AppImage');
  });

  it('rewrites APPIMAGE to the absolute resolved ARGV0 under AppImageLauncher', () => {
    const dir = makeTempDir();
    const source = path.join(dir, 'Mesh-client-6.6.0.AppImage');
    writeFileSync(source, 'appimage');
    const canonicalSource = real(source);
    const env: NodeJS.ProcessEnv = {
      DESKTOPINTEGRATION: 'AppImageLauncher',
      APPIMAGE: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      ARGV0: source,
    };
    expect(remapAppImageLauncherEnv(env)).toEqual({
      remapped: true,
      from: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      to: canonicalSource,
    });
    expect(env.APPIMAGE).toBe(canonicalSource);
    expect(path.isAbsolute(env.APPIMAGE!)).toBe(true);
  });

  it('resolves relative ARGV0 against AppImage OWD', () => {
    const dir = makeTempDir();
    const source = path.join(dir, 'Mesh-client-6.6.0.AppImage');
    writeFileSync(source, 'appimage');
    const canonicalSource = real(source);
    const env: NodeJS.ProcessEnv = {
      DESKTOPINTEGRATION: 'AppImageLauncher',
      APPIMAGE: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      ARGV0: 'Mesh-client-6.6.0.AppImage',
      OWD: dir,
    };
    const result = remapAppImageLauncherEnv(env, '/unrelated/cwd');
    expect(result).toEqual({
      remapped: true,
      from: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      to: canonicalSource,
    });
    expect(env.APPIMAGE).toBe(canonicalSource);
  });

  it('resolves ARGV0 through a symlink to the real AppImage path', () => {
    const dir = makeTempDir();
    const realDir = path.join(dir, 'real');
    const linkDir = path.join(dir, 'link');
    mkdirSync(realDir);
    mkdirSync(linkDir);
    const realFile = path.join(realDir, 'Mesh-client-6.6.0.AppImage');
    writeFileSync(realFile, 'appimage');
    const linkFile = path.join(linkDir, 'Mesh-client-6.6.0.AppImage');
    symlinkSync(realFile, linkFile);
    const canonicalReal = real(realFile);

    const env: NodeJS.ProcessEnv = {
      DESKTOPINTEGRATION: 'AppImageLauncher',
      APPIMAGE: '/run/user/1000/appimagelauncherfs/0001.AppImage',
      ARGV0: linkFile,
    };
    const result = remapAppImageLauncherEnv(env);
    expect(result.remapped).toBe(true);
    expect(result.to).toBe(canonicalReal);
    expect(env.APPIMAGE).toBe(canonicalReal);
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

  it('does not report a remap when APPIMAGE already matches the resolved source', () => {
    const dir = makeTempDir();
    const source = path.join(dir, 'Mesh-client-6.6.0.AppImage');
    writeFileSync(source, 'appimage');
    const canonicalSource = real(source);
    const env: NodeJS.ProcessEnv = {
      DESKTOPINTEGRATION: 'AppImageLauncher',
      APPIMAGE: canonicalSource,
      ARGV0: source,
    };
    expect(remapAppImageLauncherEnv(env)).toEqual({ remapped: false });
  });
});

describe('resolveAppImageLauncherSourcePath', () => {
  it('returns null for empty or null-byte paths', () => {
    expect(resolveAppImageLauncherSourcePath('')).toBeNull();
    expect(resolveAppImageLauncherSourcePath('evil\0.AppImage')).toBeNull();
  });
});
