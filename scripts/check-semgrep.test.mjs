// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_SEMGREP = path.join(ROOT, 'scripts/check-semgrep.mjs');
const SEMGREP_YML = path.join(ROOT, '.semgrep.yml');
const PRE_COMMIT = path.join(ROOT, '.githooks/pre-commit');
const GITIGNORE = path.join(ROOT, '.gitignore');

describe('check:semgrep gate', () => {
  it('keeps .semgrep.yml tracked and not gitignored', () => {
    expect(fs.existsSync(SEMGREP_YML)).toBe(true);
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.semgrep.yml'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(tracked.status).toBe(0);

    const ignore = spawnSync('git', ['check-ignore', '-v', '.semgrep.yml'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    // exit 1 = not ignored
    expect(ignore.status).toBe(1);

    const gitignore = fs.readFileSync(GITIGNORE, 'utf8');
    expect(gitignore).not.toMatch(/semgrep/i);
  });

  it('documents false-positive remediation in the wrapper and policy file', () => {
    const wrapper = fs.readFileSync(CHECK_SEMGREP, 'utf8');
    const policy = fs.readFileSync(SEMGREP_YML, 'utf8');
    expect(wrapper).toMatch(/false-positive/i);
    expect(wrapper).toMatch(/\.semgrep\.yml/);
    expect(wrapper).toMatch(/Research the rule/i);
    expect(policy).toMatch(/false positives/i);
    expect(policy).toMatch(/Tracked in git/);
  });

  it('is wired into always-on pre-commit (skipped only for manifest-only)', () => {
    const hook = fs.readFileSync(PRE_COMMIT, 'utf8');
    expect(hook).toContain('pnpm run check:semgrep');
    expect(hook).toMatch(/Findings may be wrong/);
    expect(hook).toContain('skip_manifest_only');
    expect(hook).toMatch(/check:semgrep/);
  });

  it('package.json exposes check:semgrep', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:semgrep']).toBe('node scripts/check-semgrep.mjs');
  });
});
