import { describe, expect, it } from 'vitest';

import {
  isMeshcoreRepeaterCliDangerCommand,
  isMeshcoreRepeaterRebootCommand,
  MESHCORE_REPEATER_CLI_DANGER_PATTERN,
} from './meshcoreRepeaterCliDanger';

describe('meshcoreRepeaterCliDanger', () => {
  it('matches destructive CLI verbs case-insensitively', () => {
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('reboot')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('Reboot')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('erase')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('clkreboot')).toBe(true);
    expect(MESHCORE_REPEATER_CLI_DANGER_PATTERN.test('set factory mode')).toBe(true);
    expect(isMeshcoreRepeaterCliDangerCommand('shutdown')).toBe(true);
    expect(isMeshcoreRepeaterCliDangerCommand('poweroff')).toBe(true);
  });

  it('does not match benign repeater CLI commands', () => {
    expect(isMeshcoreRepeaterCliDangerCommand('name')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('get path.hash.mode')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('ver')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('clock')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('advert')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('get cad')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('set cad off')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('set radio.fem.rxgain off')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('get radio.fem.txgain')).toBe(false);
  });

  it('confirms CAD lock and FEM TX gain sets', () => {
    expect(isMeshcoreRepeaterCliDangerCommand('set cad on')).toBe(true);
    expect(isMeshcoreRepeaterCliDangerCommand('Set CAD On')).toBe(true);
    expect(isMeshcoreRepeaterCliDangerCommand('set radio.fem.txgain on')).toBe(true);
    expect(isMeshcoreRepeaterCliDangerCommand('set radio.fem.txgain off')).toBe(true);
  });

  it('allows literal destructive words in structured string settings', () => {
    expect(isMeshcoreRepeaterCliDangerCommand('set name Factory Repeater')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('region default reboot')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('region default preboot')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('region default reboot\nerase')).toBe(true);
    expect(isMeshcoreRepeaterCliDangerCommand('region default')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('set owner.info Reboot contact')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('set guest.password reboot')).toBe(false);
    expect(isMeshcoreRepeaterCliDangerCommand('set name test\nreboot')).toBe(true);
    expect(isMeshcoreRepeaterCliDangerCommand('factory')).toBe(true);
  });

  it('detects self-restarting reboot commands only', () => {
    expect(isMeshcoreRepeaterRebootCommand('reboot')).toBe(true);
    expect(isMeshcoreRepeaterRebootCommand(' Reboot ')).toBe(true);
    expect(isMeshcoreRepeaterRebootCommand('clkreboot')).toBe(true);
    expect(isMeshcoreRepeaterRebootCommand('rebootx')).toBe(false);
    expect(isMeshcoreRepeaterRebootCommand('start ota')).toBe(false);
    expect(isMeshcoreRepeaterRebootCommand('region default reboot')).toBe(false);
  });
});
