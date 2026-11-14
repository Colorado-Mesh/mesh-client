import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-rncp-picker-pinned-jail.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-rncp-picker-pinned-jail.patch',
);

const GIT_TEST_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};
const temps = [];

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_TEST_ENV });
}

function makeFakeRsReticulum(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-rncp-picker-rns-'));
  temps.push(root);
  for (const [relative, source] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, source);
  }
  expect(git(root, ['init']).status).toBe(0);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['add', '.']);
  expect(git(root, ['commit', '-m', 'init']).status).toBe(0);
  return root;
}

function runApply(rnsDir) {
  return spawnSync('bash', [APPLY_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...GIT_TEST_ENV, RS_RETICULUM_DIR: rnsDir },
  });
}

const PRE_CLIPPY_IS_PICKER = `fn is_picker_pinned_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.starts_with("/proc/self/fd/") || s.starts_with("/.vol/")
}

fn resolve_under_picker_pin(jail: &Path, requested: &str) -> Result<PathBuf, String> {
    let _ = (jail, requested);
    Ok(PathBuf::from("/tmp"))
}
`;

afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop(), { recursive: true, force: true });
});

describe('apply-rsReticulum-rncp-picker-pinned-jail.sh', () => {
  it('contains fetch_sink_keeps_handle_alias regression marker', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('fetch_sink_keeps_handle_alias_after_selected_root_is_replaced');
    expect(patch).toContain('resolve_under_picker_pin');
  });

  it('migrates pre-clippy is_picker_pinned_path instead of blind re-apply', () => {
    const rns = makeFakeRsReticulum({
      'crates/rns-runtime/src/rncp.rs': `${PRE_CLIPPY_IS_PICKER}
// test: fetch_sink_keeps_handle_alias_after_selected_root_is_replaced
`,
    });
    const rncpPath = path.join(rns, 'crates/rns-runtime/src/rncp.rs');
    const result = runApply(rns);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/migrated|already applied/);
    const updated = readFileSync(rncpPath, 'utf8');
    expect(updated).toContain('clippy does not see needless_bool');
    expect(updated).toContain('resolve_under_picker_pin');
    expect(git(rns, ['apply', '--check', PATCH_FILE]).status).not.toBe(0);
  });
});
