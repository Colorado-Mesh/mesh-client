import { describe, expect, it, vi } from 'vitest';

import { areElectronBundlesReady, waitForDevReady } from './wait-for-dev.mjs';

describe('wait-for-dev', () => {
  it('areElectronBundlesReady requires non-empty files for main and preload', () => {
    const statSync = vi.fn((filePath) => {
      if (filePath.endsWith('preload/index.js')) {
        return { isFile: () => true, size: 100 };
      }
      if (filePath.endsWith('main/index.js')) {
        return { isFile: () => false, size: 100 };
      }
      throw new Error('missing');
    });

    expect(
      areElectronBundlesReady(
        { main: '/tmp/main/index.js', preload: '/tmp/preload/index.js' },
        statSync,
      ),
    ).toBe(false);
  });

  it('waitForDevReady resolves only when vite and bundles are both ready', async () => {
    let viteUp = false;
    let bundlesReady = false;
    const sleep = vi.fn(async () => {
      if (!viteUp) viteUp = true;
      else bundlesReady = true;
    });

    const isPortOpen = vi.fn(async () => viteUp);
    const paths = { main: '/tmp/main/index.js', preload: '/tmp/preload/index.js' };
    const statSync = vi.fn(() => ({
      isFile: () => true,
      size: bundlesReady ? 100 : 0,
    }));

    await waitForDevReady({
      paths,
      isPortOpen,
      statSync,
      sleep,
      intervalMs: 1,
    });

    expect(isPortOpen).toHaveBeenCalled();
    expect(sleep).toHaveBeenCalled();
    expect(statSync).toHaveBeenCalled();
  });
});
