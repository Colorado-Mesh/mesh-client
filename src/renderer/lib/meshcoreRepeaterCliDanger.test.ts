import { describe, expect, it } from 'vitest';

import {
  isMeshcoreRepeaterCliDangerCommand,
  MESHCORE_REPEATER_CLI_DANGER_PATTERN,
} from './meshcoreRepeaterCliDanger';

describe('meshcoreRepeaterCliDanger', () => {
  it('matches destructive CLI verbs case-insensitively', () => {
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('reboot')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('Reboot')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('erase')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('clkreboot')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('set factory mode')).toBe(true);
  });

  it('does not match benign repeater CLI commands', () => {
    expect(isMeshcoreRepeaterCliDangerCommand('name')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('get path.hash.mode')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('ver')).toBe(false);
  });
});
