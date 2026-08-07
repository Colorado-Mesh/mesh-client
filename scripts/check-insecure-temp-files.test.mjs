// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(__dirname, 'check-insecure-temp-files.mjs');

function runCheckOnSnippet(source) {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-insecure-temp-root-'));
  try {
    const srcMain = path.join(fakeRoot, 'src', 'main');
    fs.mkdirSync(srcMain, { recursive: true });
    fs.writeFileSync(path.join(srcMain, 'sample.test.ts'), source, 'utf8');

    const scriptsDir = path.join(fakeRoot, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.copyFileSync(CHECK, path.join(scriptsDir, 'check-insecure-temp-files.mjs'));

    return spawnSync(process.execPath, [path.join(scriptsDir, 'check-insecure-temp-files.mjs')], {
      cwd: fakeRoot,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
}

describe('check-insecure-temp-files', () => {
  it('passes on mkdtemp + write inside unique dir', () => {
    const result = runCheckOnSnippet(`
import fs from 'fs';
import os from 'os';
import path from 'path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ok-'));
fs.writeFileSync(path.join(dir, 'f'), '');
`);
    expect(result.status).toBe(0);
  });

  it('fails on writeFileSync to predictable tmpdir path', () => {
    const result = runCheckOnSnippet(`
import fs from 'fs';
import os from 'os';
import path from 'path';
const binary = path.join(os.tmpdir(), 'fake-sidecar');
fs.writeFileSync(binary, '');
`);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/insecure-temporary-file|predictable/);
  });

  it('allows string-only tmpdir join without write', () => {
    const result = runCheckOnSnippet(`
import os from 'os';
import path from 'path';
export const mock = () => path.join(os.tmpdir(), 'mesh-client-support-test-userdata');
`);
    expect(result.status).toBe(0);
  });

  it('fails on mkdirSync to predictable tmpdir path', () => {
    const result = runCheckOnSnippet(`
import fs from 'fs';
import os from 'os';
import path from 'path';
const dir = path.join(os.tmpdir(), 'mesh-client-appimage-x64-1');
fs.mkdirSync(dir, { recursive: true });
`);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/insecure-temporary-file|predictable/);
  });
});
