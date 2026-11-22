import { describe, expect, it } from 'vitest';

import { MESHCOM_RM_ONLY_COMMAND_TOKENS } from './meshcomCommands';
import {
  classifyMeshcomFirmware,
  isMeshcomRmFirmware,
  isMeshcomRmOnlyCommandLine,
  meshcomCommandLeadingToken,
} from './meshcomRmFirmware';

describe('meshcomRmFirmware', () => {
  it('classifies RM, stock, and unknown revisions', () => {
    expect(classifyMeshcomFirmware('4.40a-rm5')).toBe('rm');
    expect(classifyMeshcomFirmware('4.40a-rm')).toBe('rm');
    expect(isMeshcomRmFirmware('4.40a-rm5')).toBe(true);

    expect(classifyMeshcomFirmware('4.40a')).toBe('stock');
    expect(classifyMeshcomFirmware('v4.40a.11.14')).toBe('stock');
    expect(isMeshcomRmFirmware('4.40a')).toBe(false);

    expect(classifyMeshcomFirmware('')).toBe('unknown');
    expect(classifyMeshcomFirmware(null)).toBe('unknown');
    expect(classifyMeshcomFirmware(undefined)).toBe('unknown');
  });

  it('detects RM-only command lines from catalog tokens', () => {
    expect(meshcomCommandLeadingToken('--battcal 4.1')).toBe('--battcal');
    expect(meshcomCommandLeadingToken('--e22pa 22')).toBe('--e22pa');
    expect(MESHCOM_RM_ONLY_COMMAND_TOKENS.has('--battcal')).toBe(true);
    expect(MESHCOM_RM_ONLY_COMMAND_TOKENS.has('--e22pa')).toBe(true);
    expect(MESHCOM_RM_ONLY_COMMAND_TOKENS.has('--txpower')).toBe(false);

    expect(isMeshcomRmOnlyCommandLine('--battcal 4.2', MESHCOM_RM_ONLY_COMMAND_TOKENS)).toBe(true);
    expect(isMeshcomRmOnlyCommandLine('--txpower 17', MESHCOM_RM_ONLY_COMMAND_TOKENS)).toBe(false);
    expect(isMeshcomRmOnlyCommandLine('GATEWAY on', MESHCOM_RM_ONLY_COMMAND_TOKENS)).toBe(false);
  });
});
