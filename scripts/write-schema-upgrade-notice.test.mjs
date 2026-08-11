import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatNsisSchemaUpgradeInclude,
  formatSchemaUpgradeNoticeText,
  NSIS_SCHEMA_UPGRADE_STUB,
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

  it('writes notice files when bumped and a no-op NSIS stub when not', () => {
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
    expect(fs.readFileSync(path.join(dir, 'schema-upgrade-notice.nsh'), 'utf8')).toBe(
      NSIS_SCHEMA_UPGRADE_STUB,
    );
    expect(fs.readFileSync(path.join(dir, 'schema-upgrade-notice.nsh'), 'utf8')).not.toContain(
      'MESH_CLIENT_SCHEMA_UPGRADE_NOTICE',
    );
  });

  it('keeps a committed NSIS stub that matches the generator', () => {
    const committed = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        'resources',
        'schema-upgrade-notice.nsh',
      ),
      'utf8',
    );
    expect(committed).toBe(NSIS_SCHEMA_UPGRADE_STUB);
  });
});
