// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-bump.mjs');
const METAINFO = 'flatpak/org.coloradomesh.MeshClient.metainfo.xml';
const dirs = [];

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A repository at a tagged v1.0.0 release with the two files the bump edits. */
function releasedRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'mesh-release-bump-'));
  dirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'tag.gpgsign', 'false']);
  writeFileSync(
    path.join(repo, 'package.json'),
    '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n',
  );
  mkdirSync(path.join(repo, 'flatpak'));
  writeFileSync(
    path.join(repo, METAINFO),
    '<component>\n  <releases>\n    <release version="1.0.0" date="2026-01-01"/>\n  </releases>\n</component>\n',
  );
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'chore: release v1.0.0']);
  git(repo, ['tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0']);
  return repo;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('release-bump CLI', () => {
  it('bumps package.json and MetaInfo from the latest release tag', () => {
    const repo = releasedRepo();
    const run = spawnSync(process.execPath, [SCRIPT, 'minor'], { cwd: repo, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version).toBe('1.1.0');
    const today = new Date().toISOString().slice(0, 10);
    const xml = readFileSync(path.join(repo, METAINFO), 'utf8');
    expect(xml).toContain(
      `<releases>\n    <release version="1.1.0" date="${today}"/>\n    <release version="1.0.0" date="2026-01-01"/>`,
    );
    expect(run.stdout).toContain('chore: release v1.1.0');
  });

  it('accepts an exact version after the pnpm argument separator', () => {
    const repo = releasedRepo();
    const run = spawnSync(process.execPath, [SCRIPT, '--', '1.0.5'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version).toBe('1.0.5');
  });

  it('refuses an unknown bump without touching the files', () => {
    const repo = releasedRepo();
    const before = readFileSync(path.join(repo, 'package.json'), 'utf8');
    const run = spawnSync(process.execPath, [SCRIPT, 'huge'], { cwd: repo, encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Usage');
    expect(readFileSync(path.join(repo, 'package.json'), 'utf8')).toBe(before);
  });

  it('refuses a version that is not newer than the latest release', () => {
    const repo = releasedRepo();
    const run = spawnSync(process.execPath, [SCRIPT, '1.0.0'], { cwd: repo, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('greater than 1.0.0');
  });
});
