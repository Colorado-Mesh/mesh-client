import { describe, expect, it } from 'vitest';

import {
  buildMeshcomCommandLine,
  getMeshcomCommandById,
  MESHCOM_COMMANDS,
} from './meshcomCommands';

describe('meshcomCommands catalog', () => {
  it('covers APP settime and serial info', () => {
    expect(getMeshcomCommandById('settime')?.channel).toBe('app');
    expect(getMeshcomCommandById('info')?.channel).toBe('app');
    expect(getMeshcomCommandById('mbox')?.channel).toBe('app');
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--neighbours')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--setctry')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--mesh')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--deepsleep')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--sendtrack')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--setnoinfo')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--rxboost')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--symid')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--io')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--aht20')).toBe(true);
    expect(MESHCOM_COMMANDS.some((c) => c.token === '--aprsmc')).toBe(true);
    for (const token of ['--parm', '--unit', '--eqns', '--values', '--ptime', '--tel'] as const) {
      expect(MESHCOM_COMMANDS.some((c) => c.token === token && c.group === 'sensors')).toBe(true);
    }
  });

  it('builds command lines including empty setgrc', () => {
    const volt = getMeshcomCommandById('volt')!;
    expect(buildMeshcomCommandLine(volt, 'on')).toBe('--volt on');
    const setgrc = getMeshcomCommandById('setgrc')!;
    expect(buildMeshcomCommandLine(setgrc, '')).toBe('--setgrc');
    expect(buildMeshcomCommandLine(setgrc, '232;20')).toBe('--setgrc 232;20');
  });

  it('builds dynamic APRS telemetry command lines', () => {
    expect(buildMeshcomCommandLine(getMeshcomCommandById('tel')!, '')).toBe('--tel');
    expect(buildMeshcomCommandLine(getMeshcomCommandById('ptime')!, '15')).toBe('--ptime 15');
    expect(buildMeshcomCommandLine(getMeshcomCommandById('values')!, 'temp,onewire')).toBe(
      '--values temp,onewire',
    );
  });
});
