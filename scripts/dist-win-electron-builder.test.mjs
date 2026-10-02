import { describe, expect, it } from 'vitest';

import { resolveElectronBuilderArgs } from './dist-win-electron-builder.mjs';
import { OVERLAY_FILENAME } from './ci-write-win-azure-signing.mjs';

describe('resolveElectronBuilderArgs', () => {
  it('omits --config when unsigned (overlay null)', () => {
    expect(resolveElectronBuilderArgs(null, ['--publish', 'never'])).toEqual([
      '--win',
      '--publish',
      'never',
    ]);
  });

  it('injects --config with the overlay filename when signed', () => {
    expect(resolveElectronBuilderArgs('/abs/' + OVERLAY_FILENAME, ['--publish', 'never'])).toEqual([
      '--win',
      '--config',
      OVERLAY_FILENAME,
      '--publish',
      'never',
    ]);
  });

  it('passes through with no extra args', () => {
    expect(resolveElectronBuilderArgs(null, [])).toEqual(['--win']);
  });
});
