// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  reticulumConfigDirHasEnabledBleRnode,
  reticulumConfigDirHasEnabledLocalRadio,
} from './reticulum-ble-rnode-config';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures/reticulum-ble-rnode-config');

describe('reticulumConfigDirHasEnabledBleRnode', () => {
  it('returns false for missing config file', () => {
    expect(reticulumConfigDirHasEnabledBleRnode('/nonexistent/path')).toBe(false);
  });

  it('detects enabled BLE RNode blocks', () => {
    expect(reticulumConfigDirHasEnabledBleRnode(path.join(FIXTURE_ROOT, 'enabled'))).toBe(true);
  });

  it('ignores disabled or serial RNode blocks', () => {
    expect(reticulumConfigDirHasEnabledBleRnode(path.join(FIXTURE_ROOT, 'disabled'))).toBe(false);
    expect(reticulumConfigDirHasEnabledBleRnode(path.join(FIXTURE_ROOT, 'serial'))).toBe(false);
  });
});

describe('reticulumConfigDirHasEnabledLocalRadio', () => {
  it('returns false for missing config file', () => {
    expect(reticulumConfigDirHasEnabledLocalRadio('/nonexistent/path')).toBe(false);
  });

  it('detects BLE RNode and serial RNode / KISS', () => {
    expect(reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'enabled'))).toBe(true);
    expect(reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'serial'))).toBe(true);
    expect(reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'kiss'))).toBe(true);
  });

  it('ignores disabled local radio, TCPClient stacks, and tcp:// Wi-Fi RNodes', () => {
    expect(reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'disabled'))).toBe(false);
    expect(reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'tcp-only'))).toBe(false);
    expect(reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'tcp-rnode'))).toBe(
      false,
    );
  });

  it('detects RNodeMultiInterface with enabled=On, inline comments, and a trailing section', () => {
    expect(reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'rnode-multi'))).toBe(
      true,
    );
    expect(
      reticulumConfigDirHasEnabledLocalRadio(path.join(FIXTURE_ROOT, 'trailing-section')),
    ).toBe(true);
  });

  it('reads interface_enabled with the same precedence as the sidecar', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rnode-iface-enabled-'));
    writeFileSync(
      path.join(dir, 'config'),
      [
        '[[rnode]]',
        'type = RNodeMultiInterface',
        'interface_enabled = On',
        'port = /dev/ttyUSB0',
        '',
      ].join('\n'),
    );
    expect(reticulumConfigDirHasEnabledLocalRadio(dir)).toBe(true);

    const disabled = mkdtempSync(path.join(tmpdir(), 'rnode-iface-enabled-'));
    writeFileSync(
      path.join(disabled, 'config'),
      [
        '[[rnode]]',
        'type = RNodeInterface',
        'interface_enabled = Yes',
        'enabled = No',
        'port = /dev/ttyUSB1',
        '',
      ].join('\n'),
    );
    expect(reticulumConfigDirHasEnabledLocalRadio(disabled)).toBe(false);
  });
});
