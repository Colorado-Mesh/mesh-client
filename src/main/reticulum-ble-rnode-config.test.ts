// @vitest-environment node
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { reticulumConfigDirHasEnabledBleRnode } from './reticulum-ble-rnode-config';

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
