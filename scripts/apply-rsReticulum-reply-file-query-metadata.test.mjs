import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-reply-file-query-metadata.sh');
const HELPER_SCRIPT = path.join(SCRIPT_DIR, 'lib/apply-ratspeak-overlay.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-reply-file-query-metadata.patch',
);

const GIT_TEST_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

/** @type {string[]} */
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

function makeFakeRsReticulumFromFiles(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-reply-file-rns-'));
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

function runApply(rnsDir, applyScript = APPLY_SCRIPT, extraEnv = {}) {
  return spawnSync('bash', [applyScript], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...GIT_TEST_ENV, RS_RETICULUM_DIR: rnsDir, ...extraEnv },
  });
}

/** Copy apply script + helper into a fake repo root with no patch file. */
function prepareMissingPatchScriptTree() {
  const work = mkdtempSync(path.join(os.tmpdir(), 'mesh-reply-file-missing-patch-'));
  temps.push(work);
  const scriptsDir = path.join(work, 'scripts');
  mkdirSync(path.join(scriptsDir, 'lib'), { recursive: true });
  mkdirSync(path.join(work, 'reticulum-sidecar/patches'), { recursive: true });
  const applyCopy = path.join(scriptsDir, 'apply-rsReticulum-reply-file-query-metadata.sh');
  copyFileSync(APPLY_SCRIPT, applyCopy);
  copyFileSync(HELPER_SCRIPT, path.join(scriptsDir, 'lib/apply-ratspeak-overlay.sh'));
  return applyCopy;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('apply-rsReticulum-reply-file-query-metadata.sh', () => {
  it('fails when rsReticulum checkout is missing', () => {
    const missing = path.join(
      mkdtempSync(path.join(os.tmpdir(), 'mesh-reply-file-missing-checkout-')),
      'rsReticulum',
    );
    temps.push(path.dirname(missing));
    const result = runApply(missing);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/rsReticulum not found/);
  });

  it('fails when the overlay patch file is missing', () => {
    const files = materializePatchFiles(readFileSync(PATCH_FILE, 'utf8'), 'old');
    const rns = makeFakeRsReticulumFromFiles(files);
    const applyCopy = prepareMissingPatchScriptTree();
    const result = runApply(rns, applyCopy);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/patch not found/);
  });

  it('is a no-op when ReplyFile overlay markers are already present', () => {
    const rns = makeFakeRsReticulumFromFiles(
      new Map([
        [
          'crates/rns-runtime/src/link_manager.rs',
          `pub enum RequestOutcome {
    Reply(Vec<u8>),
    ReplyFile { path: PathBuf, metadata: Option<Vec<u8>> },
}
fn pack_file_name_metadata(name: &str) -> Vec<u8> { vec![] }
`,
        ],
      ]),
    );
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already present/);
  });

  it('applies on a clean checkout matching the overlay context', () => {
    const files = materializePatchFiles(readFileSync(PATCH_FILE, 'utf8'), 'old');
    expect(files.has('crates/rns-runtime/src/link_manager.rs')).toBe(true);
    const rns = makeFakeRsReticulumFromFiles(files);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/applied .*rsReticulum-reply-file-query-metadata\.patch/);
    const linkManager = readFileSync(
      path.join(rns, 'crates/rns-runtime/src/link_manager.rs'),
      'utf8',
    );
    expect(linkManager).toMatch(/ReplyFile\s*\{/);
    expect(linkManager).toContain('fn pack_file_name_metadata(');
  });
});
