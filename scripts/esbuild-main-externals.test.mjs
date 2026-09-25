import { describe, expect, it } from 'vitest';

import { MAIN_ESBUILD_EXTERNALS, mainEsbuildExternalArgs } from './esbuild-main-externals.mjs';

describe('esbuild-main-externals', () => {
  it('externalizes large Node deps that previously inflated the main bundle past 1mb', () => {
    expect(MAIN_ESBUILD_EXTERNALS).toEqual(
      expect.arrayContaining([
        'electron',
        'electron-updater',
        'systeminformation',
        'node-forge',
        'jszip',
        'mqtt',
        '@bufbuild/protobuf',
        '@meshtastic/protobufs',
        'undici',
        'ws',
      ]),
    );
  });

  it('emits --external CLI flags for every listed package', () => {
    expect(mainEsbuildExternalArgs()).toEqual(
      MAIN_ESBUILD_EXTERNALS.flatMap((pkg) => [`--external:${pkg}`]),
    );
  });
});
