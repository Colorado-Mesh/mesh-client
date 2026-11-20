import { describe, expect, it } from 'vitest';

import {
  buildMeshcomCommandLine,
  getMeshcomCommandById,
  MESHCOM_COMMANDS,
} from './meshcomCommands';

describe('meshcomCommands catalog', () => {
  it('covers APP settime and serial info', () => {
    expect(getMeshcomCommandById('settime')?.channel).toBe('app');
    expect(getMeshcomCommandById('info')?.channel).toBe('serial');
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--neighbours')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--setctry')).toBe(true);
  });

  it('builds command lines including empty setgrc', () => {
    const volt = getMeshcomCommandById('volt')!;
    expect(buildMeshcomCommandLine(volt, 'on')).toBe('--volt on');
    const setgrc = getMeshcomCommandById('setgrc')!;
    expect(buildMeshcomCommandLine(setgrc, '')).toBe('--setgrc');
  });
});
