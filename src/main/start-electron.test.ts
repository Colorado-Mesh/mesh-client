import { describe, expect, it } from 'vitest';

describe('start-electron wrapper helpers', () => {
  it('classifies libffmpeg shared-library startup failures', async () => {
    // @ts-expect-error test import from scripts directory
    const mod = (await import('../../scripts/start-electron.mjs')) as {
      classifyElectronStartupError: (stderrText: string) => string | null;
    };
    const err =
      'electron: error while loading shared libraries: libffmpeg.so: cannot open shared object file: No such file or directory';
    expect(mod.classifyElectronStartupError(err)).toBe('linux-libffmpeg-missing');
  });

  it('does not classify unrelated startup failures', async () => {
    // @ts-expect-error test import from scripts directory
    const mod = (await import('../../scripts/start-electron.mjs')) as {
      classifyElectronStartupError: (stderrText: string) => string | null;
    };
    expect(mod.classifyElectronStartupError('Error: EACCES')).toBeNull();
  });

  it('classifies Linux display backend startup failures', async () => {
    // @ts-expect-error test import from scripts directory
    const mod = (await import('../../scripts/start-electron.mjs')) as {
      classifyElectronStartupError: (stderrText: string) => string | null;
    };
    const err =
      '[40321:0323/203719.272214:ERROR:ui/ozone/platform/x11/ozone_platform_x11.cc:256] Missing X server or $DISPLAY\n' +
      '[40321:0323/203719.272233:ERROR:ui/aura/env.cc:257] The platform failed to initialize.  Exiting.';
    expect(mod.classifyElectronStartupError(err)).toBe('linux-display-missing');
  });

  it('prints remediation text with rollback and ambient-cap commands', async () => {
    // @ts-expect-error test import from scripts directory
    const mod = (await import('../../scripts/start-electron.mjs')) as {
      fedoraLibffmpegRemediation: () => string;
    };
    const text = mod.fedoraLibffmpegRemediation();
    expect(text).toContain('sudo setcap -r ./node_modules/electron/dist/electron');
    expect(text).toContain('--ambient-caps +net_raw');
    expect(text).toContain("bash -lc 'npm start'");
  });

  it('prints remediation text for missing Linux display backend', async () => {
    // @ts-expect-error test import from scripts directory
    const mod = (await import('../../scripts/start-electron.mjs')) as {
      linuxDisplayMissingRemediation: () => string;
    };
    const text = mod.linuxDisplayMissingRemediation();
    expect(text).toContain('Missing X server or $DISPLAY');
    expect(text).toContain('ELECTRON_OZONE_PLATFORM_HINT=x11 npm start');
    expect(text).toContain('DISPLAY=$DISPLAY WAYLAND_DISPLAY=$WAYLAND_DISPLAY');
  });

  it('resolves macOS electron app binary path', async () => {
    // @ts-expect-error test import from scripts directory
    const mod = (await import('../../scripts/start-electron.mjs')) as {
      resolveLocalElectronBin: (
        platform: string,
        fileExists: (candidate: string) => boolean,
      ) => string;
    };
    const resolved = mod.resolveLocalElectronBin('darwin', () => false);
    expect(resolved).toContain('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  });

  it('resolves Linux electron binary path', async () => {
    // @ts-expect-error test import from scripts directory
    const mod = (await import('../../scripts/start-electron.mjs')) as {
      resolveLocalElectronBin: (
        platform: string,
        fileExists: (candidate: string) => boolean,
      ) => string;
    };
    const resolved = mod.resolveLocalElectronBin('linux', () => false);
    expect(resolved).toContain('node_modules/electron/dist/electron');
  });
});
