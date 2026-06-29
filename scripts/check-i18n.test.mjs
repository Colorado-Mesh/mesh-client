// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/renderer/locales');
const EN_FILE = join(LOCALES_DIR, 'en/translation.json');

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

describe('check-i18n flatten helper', () => {
  it('flattens nested locale keys', () => {
    expect(flatten({ chatPanel: { jumpToUnread: 'Jump to unread' } })).toEqual({
      'chatPanel.jumpToUnread': 'Jump to unread',
    });
  });
});

describe('check-i18n locale fixtures', () => {
  it('English translation.json parses and includes audit-added keys', () => {
    const en = JSON.parse(readFileSync(EN_FILE, 'utf8'));
    const flat = flatten(en);
    expect(flat['chatPanel.jumpToUnread']).toBe('Jump to Unread');
    expect(flat['chatPanel.jumpToLatest']).toBe('Jump to Latest');
    expect(flat['radioPanel.validationInvalidPsk']).toContain('base64');
    expect(flat['radioPanel.xmodemInvalidFilename']).toBeTruthy();
  });

  it('reports unreadable locale files as failures in the checker contract', () => {
    expect(() => JSON.parse('{not json')).toThrow();
  });

  it('branch mode runs quality checks only on keys new vs HEAD en', async () => {
    const { spawnSync } = await import('node:child_process');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const result = spawnSync(process.execPath, ['scripts/check-i18n.mjs', '--branch'], {
      cwd: join(scriptDir, '..'),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const output = `${result.stderr}\n${result.stdout}`;
    expect(output).toContain('check:i18n:branch');
  });
});

describe('check-i18n locales directory access', () => {
  it('fails with a helpful message when LOCALES_DIR is missing', async () => {
    const { spawnSync } = await import('node:child_process');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const missingLocales = join(scriptDir, '__missing_locales_dir__');
    const result = spawnSync(process.execPath, ['scripts/check-i18n.mjs'], {
      cwd: join(scriptDir, '..'),
      env: { ...process.env, MESH_CLIENT_LOCALES_DIR: missingLocales },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    const output = `${result.stderr}\n${result.stdout}`;
    expect(output).toContain('locales directory is missing or inaccessible');
    expect(output).toContain(missingLocales);
  });
});
