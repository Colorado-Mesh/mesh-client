// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(__dirname, 'check-silent-catches.mjs');

/**
 * @param {{ nested?: boolean; source: string }} opts
 */
function runCheckOnSnippet(opts) {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-silent-catches-root-'));
  try {
    const srcMain = path.join(fakeRoot, 'src', 'main');
    const targetDir = opts.nested ? path.join(srcMain, 'ipc') : srcMain;
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'sample.ts'), opts.source, 'utf8');

    const scriptsDir = path.join(fakeRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    fs.mkdirSync(scriptsLibDir, { recursive: true });
    fs.copyFileSync(CHECK, path.join(scriptsDir, 'check-silent-catches.mjs'));
    fs.copyFileSync(
      path.join(__dirname, 'lib/path-under-root.mjs'),
      path.join(scriptsLibDir, 'path-under-root.mjs'),
    );

    return spawnSync(process.execPath, [path.join(scriptsDir, 'check-silent-catches.mjs')], {
      cwd: fakeRoot,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
}

describe('check-silent-catches', () => {
  it('fails on a silent catch block', () => {
    const result = runCheckOnSnippet({
      source: `
try { throw new Error('x'); } catch (e) {
  void e;
}
`,
    });
    expect(result.status).toBe(1);
  });

  it('passes when the catch logs via console.warn', () => {
    const result = runCheckOnSnippet({
      source: `
try { throw new Error('x'); } catch (e) {
  console.warn('mcL9999 [sample] failed', String(e));
}
`,
    });
    expect(result.status).toBe(0);
  });

  it('passes with catch-no-log-ok suppression', () => {
    const result = runCheckOnSnippet({
      source: `
try { throw new Error('x'); } catch (e) { // catch-no-log-ok hot path
  void e;
}
`,
    });
    expect(result.status).toBe(0);
  });
});
