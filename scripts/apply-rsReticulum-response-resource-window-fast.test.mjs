import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-response-resource-window-fast.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-response-resource-window-fast.patch',
);

const GIT_TEST_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

const temps = [];

function git(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: GIT_TEST_ENV,
  });
}

function makeFakeRsReticulum(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-window-fast-rns-'));
  temps.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, source);
  }
  const gitInit = git(root, ['init']);
  expect(gitInit.status).toBe(0);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['add', '.']);
  const commit = git(root, ['commit', '-m', 'init']);
  expect(commit.status).toBe(0);
  return root;
}

function runApply(rnsDir) {
  return spawnSync('bash', [APPLY_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...GIT_TEST_ENV, RS_RETICULUM_DIR: rnsDir },
  });
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('apply-rsReticulum-response-resource-window-fast.sh', () => {
  it('promotes inbound response Resources on sub-second RTT', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('fn promote_fast');
    expect(patch).toContain('WINDOW_MAX_FAST');
    expect(patch).toContain('test_window_promote_fast_skips_slow_start');
    expect(patch).toContain('flags.is_response && rtt <= Duration::from_millis(1000)');
    expect(patch).toMatch(/crates\/rns-protocol\/src\/resource\.rs/);
    expect(patch).toMatch(/crates\/rns-runtime\/src\/link_session\.rs/);
  });

  it('is a no-op when the complete TCP fast-start overlay is present', () => {
    const rns = makeFakeRsReticulum({
      'crates/rns-protocol/src/resource.rs':
        'impl WindowState {\n    pub fn promote_fast(&mut self) {\n        self.window = WINDOW_MAX_FAST;\n        self.window_max = WINDOW_MAX_FAST;\n    }\n}\n',
      'crates/rns-runtime/src/link_session.rs':
        'if flags.is_response && rtt <= Duration::from_millis(1000) {\n        transfer.resource.window.promote_fast();\n    }\n',
    });
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already applied/);
  });

  it('does not treat a partial promote_fast marker as already applied', () => {
    const rns = makeFakeRsReticulum({
      'crates/rns-protocol/src/resource.rs':
        'impl WindowState {\n    pub fn promote_fast(&mut self) {}\n}\n',
      'crates/rns-runtime/src/link_session.rs':
        'if flags.is_response {\n        transfer.resource.window.promote_fast();\n    }\n',
    });
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toMatch(/already applied/);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });

  it('fails with git diagnostic on incompatible checkouts', () => {
    const rns = makeFakeRsReticulum({
      'crates/rns-protocol/src/resource.rs': 'impl WindowState {}\n',
      'crates/rns-runtime/src/link_session.rs': 'fn inbound_transfer_from_advertisement() {}\n',
    });
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });
});
