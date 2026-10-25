import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'i18n-auto-translate-write-subprocess.mjs',
);

describe('i18n-auto-translate-write-subprocess', () => {
  /** @type {string | undefined} */
  let dir;

  afterEach(() => {
    if (dir) {
      try {
        chmodSync(join(dir, 'es'), 0o755);
      } catch {
        // catch-no-log-ok: dir may already be gone or never chmod'd
      }
      rmSync(dir, { recursive: true, force: true });
    }
    dir = undefined;
  });

  it('writes locale JSON under the locales root', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-i18n-write-'));
    const localesRoot = dir;
    mkdirSync(join(localesRoot, 'es'), { recursive: true });
    const outPath = join(localesRoot, 'es', 'translation.json');
    const body = '{\n  "ok": true\n}\n';

    const res = spawnSync(process.execPath, [SCRIPT, localesRoot, outPath], {
      input: body,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(readFileSync(outPath, 'utf8')).toBe(body);
  });

  it('leaves the existing locale file unchanged when the staged write fails', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-i18n-write-'));
    const localesRoot = dir;
    const localeDir = join(localesRoot, 'es');
    mkdirSync(localeDir, { recursive: true });
    const outPath = join(localeDir, 'translation.json');
    const existing = '{\n  "ok": true\n}\n';
    writeFileSync(outPath, existing, 'utf8');

    // Deny create in the locale dir so mkdtemp beside outPath fails before replace.
    chmodSync(localeDir, 0o555);

    const res = spawnSync(process.execPath, [SCRIPT, localesRoot, outPath], {
      input: '{\n  "ok": false\n}\n',
      encoding: 'utf8',
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr.length).toBeGreaterThan(0);

    chmodSync(localeDir, 0o755);
    expect(readFileSync(outPath, 'utf8')).toBe(existing);
  });

  it('refuses an outPath that escapes the locales root', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-i18n-write-'));
    const localesRoot = join(dir, 'locales');
    mkdirSync(localesRoot, { recursive: true });
    const outside = join(dir, 'escape.json');

    const res = spawnSync(process.execPath, [SCRIPT, localesRoot, outside], {
      input: '{}\n',
      encoding: 'utf8',
    });
    expect(res.status).toBe(3);
    expect(res.stderr).toMatch(/escapes locales root/);
  });
});
