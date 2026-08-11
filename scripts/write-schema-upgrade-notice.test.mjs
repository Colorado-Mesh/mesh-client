import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatNsisSchemaUpgradeInclude,
  formatSchemaUpgradeNoticeText,
  writeSchemaUpgradeNoticeFiles,
} from './write-schema-upgrade-notice.mjs';

describe('write-schema-upgrade-notice', () => {
  /** @type {string[]} */
  const temps = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formats notice text and NSIS include', () => {
    const text = formatSchemaUpgradeNoticeText({
      bumped: true,
      currSchema: 49,
      prevSchema: 48,
      prevTag: 'v5.26.0',
    });
    expect(text).toContain('schema 49');
    expect(text).toContain('v5.26.0');
    expect(text).toContain('cannot downgrade');
    const nsh = formatNsisSchemaUpgradeInclude(text);
    expect(nsh).toContain('!define MESH_CLIENT_SCHEMA_UPGRADE_NOTICE');
    expect(nsh).toContain('$\\r$\\n');
  });

  it('writes notice files when bumped; on no-bump keeps an empty NSIS stub', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-notice-'));
    temps.push(dir);

    writeSchemaUpgradeNoticeFiles(
      {
        MESH_CLIENT_SCHEMA_BUMPED: '1',
        MESH_CLIENT_SCHEMA_CURR: '49',
        MESH_CLIENT_SCHEMA_PREV: '48',
        MESH_CLIENT_SCHEMA_PREV_TAG: 'v5.26.0',
      },
      dir,
    );
    expect(fs.existsSync(path.join(dir, 'SCHEMA-UPGRADE.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'schema-upgrade-notice.nsh'))).toBe(true);

    writeSchemaUpgradeNoticeFiles({ MESH_CLIENT_SCHEMA_BUMPED: '0' }, dir);
    expect(fs.existsSync(path.join(dir, 'SCHEMA-UPGRADE.txt'))).toBe(false);
    // installer.nsh always includes the .nsh, so it stays as an empty stub
    // (no define) instead of being deleted — otherwise NSIS warns 7000 under -WX.
    expect(fs.existsSync(path.join(dir, 'schema-upgrade-notice.nsh'))).toBe(true);
    const stub = fs.readFileSync(path.join(dir, 'schema-upgrade-notice.nsh'), 'utf8');
    expect(stub).not.toContain('MESH_CLIENT_SCHEMA_UPGRADE_NOTICE');
  });
});
