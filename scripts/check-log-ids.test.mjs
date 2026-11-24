import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(ROOT, 'scripts', 'check-log-ids.mjs');

/**
 * @param {string} source
 */
function runCheckOnSnippet(source) {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-log-ids-root-'));
  try {
    const sharedDir = path.join(fakeRoot, 'src', 'shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'src', 'shared', 'logMessageIds.ts'),
      path.join(sharedDir, 'logMessageIds.ts'),
    );
    fs.writeFileSync(path.join(sharedDir, 'sample.ts'), source, 'utf8');

    const scriptsDir = path.join(fakeRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    fs.mkdirSync(scriptsLibDir, { recursive: true });
    fs.copyFileSync(CHECK, path.join(scriptsDir, 'check-log-ids.mjs'));
    fs.copyFileSync(
      path.join(ROOT, 'scripts', 'lib', 'path-under-root.mjs'),
      path.join(scriptsLibDir, 'path-under-root.mjs'),
    );

    return spawnSync(
      process.execPath,
      [path.join(scriptsDir, 'check-log-ids.mjs'), '--require-all'],
      {
        cwd: fakeRoot,
        encoding: 'utf8',
        env: { ...process.env, MESH_CLIENT_LOG_IDS_REQUIRE_ALL: '1' },
      },
    );
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
}

describe('check:log-ids gate', () => {
  it('package.json exposes check:log-ids', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:log-ids']).toBe('node scripts/check-log-ids.mjs --require-all');
  });

  it('pre-commit runs check:log-ids', () => {
    const hook = fs.readFileSync(path.join(ROOT, '.githooks/pre-commit'), 'utf8');
    expect(hook).toContain('pnpm run check:log-ids');
  });

  it('release.sh runs check:log-ids', () => {
    const release = fs.readFileSync(path.join(ROOT, 'scripts/release.sh'), 'utf8');
    expect(release).toContain('pnpm run check:log-ids');
  });

  it('fails when console.warn omits mcL id with --require-all', () => {
    const result = runCheckOnSnippet(`console.warn('[sample] no id here');\n`);
    expect(result.status).toBe(1);
  });

  it('passes when console.warn includes a registered mcL id', () => {
    const result = runCheckOnSnippet(`console.warn('mcL0065 [sample] ok');\n`);
    expect(result.status).toBe(0);
  });
});
