// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(__dirname, 'check-log-injection.mjs');

/**
 * @param {{ nested?: boolean; source: string }} opts
 */
function runCheckOnSnippet(opts) {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-log-injection-root-'));
  try {
    const srcMain = path.join(fakeRoot, 'src', 'main');
    const targetDir = opts.nested ? path.join(srcMain, 'ipc') : srcMain;
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'sample.ts'), opts.source, 'utf8');

    const scriptsDir = path.join(fakeRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    fs.mkdirSync(scriptsLibDir, { recursive: true });
    fs.copyFileSync(CHECK, path.join(scriptsDir, 'check-log-injection.mjs'));
    fs.copyFileSync(
      path.join(__dirname, 'lib/path-under-root.mjs'),
      path.join(scriptsLibDir, 'path-under-root.mjs'),
    );

    return spawnSync(process.execPath, [path.join(scriptsDir, 'check-log-injection.mjs')], {
      cwd: fakeRoot,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
}

describe('check-log-injection', () => {
  it('passes when errors are sanitized', () => {
    const result = runCheckOnSnippet({
      source: `
try { throw new Error('x'); } catch (e) {
  console.debug('[tag]', sanitizeLogMessage(String(e)));
}
`,
    });
    expect(result.status).toBe(0);
  });

  it('fails on raw console.debug(..., e) at top-level src/main', () => {
    const result = runCheckOnSnippet({
      source: `
try { throw new Error('x'); } catch (e) {
  console.debug('[tag] catch:', e);
}
`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/log injection|sanitizeLogMessage/);
  });

  it('fails on nested src/main/ipc/*.ts with raw console.debug(..., e)', () => {
    const result = runCheckOnSnippet({
      nested: true,
      source: `
try { throw new Error('x'); } catch (e) {
  console.debug('[ipc] catch:', e);
}
`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/src[/\\]main[/\\]ipc[/\\]sample\.ts/);
    expect(result.stderr).toMatch(/log injection|sanitizeLogMessage/);
  });

  it('allows sanitizing helpers that take (e) / (err)', () => {
    const result = runCheckOnSnippet({
      nested: true,
      source: `
function errText(e) { return sanitizeLogMessage(String(e)); }
console.debug('[tag] skip:', errText(e));
console.warn('mcL0001 failed:', errorMessage(err));
console.debug('[linux-bluez] late bus error:', formatted.message);
`,
    });
    expect(result.status).toBe(0);
  });

  it('skips *.test.ts under src/main', () => {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-log-injection-test-skip-'));
    try {
      const srcMain = path.join(fakeRoot, 'src', 'main', 'ipc');
      fs.mkdirSync(srcMain, { recursive: true });
      fs.writeFileSync(
        path.join(srcMain, 'sample.test.ts'),
        `console.debug('catch:', e);\n`,
        'utf8',
      );

      const scriptsDir = path.join(fakeRoot, 'scripts');
      const scriptsLibDir = path.join(scriptsDir, 'lib');
      fs.mkdirSync(scriptsLibDir, { recursive: true });
      fs.copyFileSync(CHECK, path.join(scriptsDir, 'check-log-injection.mjs'));
      fs.copyFileSync(
        path.join(__dirname, 'lib/path-under-root.mjs'),
        path.join(scriptsLibDir, 'path-under-root.mjs'),
      );

      const result = spawnSync(
        process.execPath,
        [path.join(scriptsDir, 'check-log-injection.mjs')],
        { cwd: fakeRoot, encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});
