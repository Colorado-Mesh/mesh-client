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

function parseUnifiedHunkHeader(line) {
  if (!line.startsWith('@@ -')) {
    return null;
  }
  const close = line.indexOf(' @@', 4);
  if (close < 0) {
    return null;
  }
  const [oldSpec, newSpec] = line.slice(4, close).split(' +');
  if (!oldSpec || !newSpec) {
    return null;
  }
  const oldStart = Number(oldSpec.split(',')[0]);
  const newStart = Number(newSpec.split(',')[0]);
  if (!Number.isInteger(oldStart) || !Number.isInteger(newStart)) {
    return null;
  }
  return { oldStart, newStart };
}

function materializePatchFiles(patchText, side) {
  /** @type {Map<string, string[]>} */
  const files = new Map();
  const patchLines = patchText.replace(/\n$/, '').split('\n');
  let i = 0;
  /** @type {string | null} */
  let currentPath = null;

  while (i < patchLines.length) {
    const line = patchLines[i];
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentPath = match ? match[2] : null;
      if (currentPath && !files.has(currentPath)) {
        files.set(currentPath, []);
      }
      i += 1;
      continue;
    }
    const hunk = parseUnifiedHunkHeader(line);
    if (hunk && currentPath) {
      const lines = files.get(currentPath) ?? [];
      const start = side === 'old' ? hunk.oldStart : hunk.newStart;
      while (lines.length < start - 1) {
        lines.push(`// overlay-fixture-pad ${lines.length + 1}`);
      }
      i += 1;
      while (
        i < patchLines.length &&
        !patchLines[i].startsWith('@@ ') &&
        !patchLines[i].startsWith('diff --git ')
      ) {
        const hunkLine = patchLines[i];
        if (hunkLine.startsWith('\\')) {
          i += 1;
          continue;
        }
        const tag = hunkLine[0];
        const body = hunkLine.slice(1);
        if (tag === ' ') {
          lines.push(body);
        } else if (tag === '-' && side === 'old') {
          lines.push(body);
        } else if (tag === '+' && side === 'new') {
          lines.push(body);
        }
        i += 1;
      }
      files.set(currentPath, lines);
      continue;
    }
    i += 1;
  }

  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [rel, lines] of files) {
    out.set(rel, `${lines.join('\n')}\n`);
  }
  return out;
}

function makeFakeRsReticulum(reticulumSource, actorModSource = 'pub struct TransportActor {}\n') {
  return makeFakeRsReticulumFromFiles(
    new Map([
      ['crates/rns-runtime/src/reticulum.rs', reticulumSource],
      ['crates/rns-transport/src/actor/mod.rs', actorModSource],
    ]),
  );
}

function makeFakeRsReticulumFromFiles(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-packet-tap-rns-'));
  temps.push(root);
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
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

function readPacketTapTargets(rnsDir) {
  return {
    reticulum: readFileSync(path.join(rnsDir, 'crates/rns-runtime/src/reticulum.rs'), 'utf8'),
    actorMod: readFileSync(path.join(rnsDir, 'crates/rns-transport/src/actor/mod.rs'), 'utf8'),
  };
}

function expectPacketTapApplied(rnsDir) {
  const { reticulum, actorMod } = readPacketTapTargets(rnsDir);
  expect(reticulum).toContain('register_packet_tap');
  expect(reticulum).toContain('SetPacketTap');
  expect(actorMod).toContain('emit_packet_tap');
  expect(actorMod).toContain('packet_tap');
  expect(actorMod).toContain('InterfaceSendOutcome::Sent');
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

  it('applies on a clean checkout and writes both patch targets', () => {
    const files = materializePatchFiles(readFileSync(PATCH_FILE, 'utf8'), 'old');
    expect(files.has('crates/rns-runtime/src/reticulum.rs')).toBe(true);
    expect(files.has('crates/rns-transport/src/actor/mod.rs')).toBe(true);
    const rns = makeFakeRsReticulumFromFiles(files);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/applied .*rsReticulum-packet-tap\.patch/);
    expectPacketTapApplied(rns);
  });

  it('is idempotent after a clean apply', () => {
    const files = materializePatchFiles(readFileSync(PATCH_FILE, 'utf8'), 'old');
    const rns = makeFakeRsReticulumFromFiles(files);
    const first = runApply(rns);
    expect(first.status, first.stderr || first.stdout).toBe(0);
    const second = runApply(rns);
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(second.stdout).toMatch(/already applied/);
    expectPacketTapApplied(rns);
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
