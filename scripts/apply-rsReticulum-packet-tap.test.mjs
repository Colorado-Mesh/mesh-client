import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-packet-tap.sh');
const PATCH_FILE = path.join(REPO_ROOT, 'reticulum-sidecar/patches/rsReticulum-packet-tap.patch');

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

function makeFakeRsReticulum(reticulumSource) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-packet-tap-rns-'));
  temps.push(root);
  const reticulumPath = path.join(root, 'crates/rns-runtime/src/reticulum.rs');
  mkdirSync(path.dirname(reticulumPath), { recursive: true });
  writeFileSync(reticulumPath, reticulumSource);
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

describe('apply-rsReticulum-packet-tap.sh', () => {
  it('hooks current rsReticulum TX send outcome (InterfaceSendOutcome::Sent)', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('register_packet_tap');
    expect(patch).toContain('SetPacketTap');
    expect(patch).toContain('emit_packet_tap');
    expect(patch).toContain('try_send(data.clone())');
    expect(patch).toContain('InterfaceSendOutcome::Sent');
    expect(patch).toContain('PacketTapEvent');
    expect(patch).toMatch(/crates\/rns-transport\/src\/actor\/mod\.rs/);
    expect(patch).toMatch(/crates\/rns-runtime\/src\/reticulum\.rs/);
  });

  it('is a no-op when register_packet_tap is already present', () => {
    const rns = makeFakeRsReticulum(
      'impl ReticulumHandle {\n    pub async fn register_packet_tap() {}\n}\n',
    );
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already applied/);
  });

  it('fails with git diagnostic on incompatible checkouts', () => {
    const rns = makeFakeRsReticulum('impl ReticulumHandle {\n    pub async fn recall() {}\n}\n');
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });
});
