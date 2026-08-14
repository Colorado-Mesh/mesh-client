import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    vi.restoreAllMocks();
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

  it('restores both notice files when NSIS commit fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-notice-'));
    temps.push(dir);
    const nshPath = path.join(dir, 'schema-upgrade-notice.nsh');
    const txtPath = path.join(dir, 'SCHEMA-UPGRADE.txt');
    fs.writeFileSync(nshPath, 'PRIOR_NSH', 'utf8');
    fs.writeFileSync(txtPath, 'PRIOR_TXT', 'utf8');

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const origRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.resolve(String(to)) === path.resolve(nshPath)) {
        throw new Error('simulated rename failure');
      }
      return origRename(from, to);
    });

    expect(() => writeSchemaUpgradeNoticeFiles({ MESH_CLIENT_SCHEMA_BUMPED: '0' }, dir)).toThrow(
      'simulated rename failure',
    );
    expect(fs.readFileSync(nshPath, 'utf8')).toBe('PRIOR_NSH');
    expect(fs.readFileSync(txtPath, 'utf8')).toBe('PRIOR_TXT');
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([]);
    const logText = logged.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logText).toContain('commit NSIS stub failed');
    expect(logText).toContain(nshPath);
    expect(logText).toContain(txtPath);
  });

  it('restores both notice files when SCHEMA-UPGRADE.txt removal fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-notice-'));
    temps.push(dir);
    const nshPath = path.join(dir, 'schema-upgrade-notice.nsh');
    const txtPath = path.join(dir, 'SCHEMA-UPGRADE.txt');
    fs.writeFileSync(nshPath, 'PRIOR_NSH', 'utf8');
    fs.writeFileSync(txtPath, 'PRIOR_TXT', 'utf8');

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const origUnlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, 'unlinkSync').mockImplementation((p) => {
      if (path.resolve(String(p)) === path.resolve(txtPath)) {
        throw new Error('simulated unlink failure');
      }
      return origUnlink(p);
    });

    expect(() => writeSchemaUpgradeNoticeFiles({ MESH_CLIENT_SCHEMA_BUMPED: '0' }, dir)).toThrow(
      'simulated unlink failure',
    );
    expect(fs.readFileSync(nshPath, 'utf8')).toBe('PRIOR_NSH');
    expect(fs.readFileSync(txtPath, 'utf8')).toBe('PRIOR_TXT');
    const logText = logged.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logText).toContain('remove SCHEMA-UPGRADE.txt failed');
    expect(logText).toContain(nshPath);
    expect(logText).toContain(txtPath);
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
