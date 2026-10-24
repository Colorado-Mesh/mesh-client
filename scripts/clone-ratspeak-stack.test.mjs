import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const cloneScriptPath = fileURLToPath(new URL('./clone-ratspeak-stack.sh', import.meta.url));
const cloneScript = readFileSync(cloneScriptPath, 'utf8');
const ensureScriptPath = fileURLToPath(new URL('./ensure-rsReticulum-patches.sh', import.meta.url));
const ensureScript = readFileSync(ensureScriptPath, 'utf8');
const localGitEnvVars = execFileSync('git', ['rev-parse', '--local-env-vars'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n');

function fixtureEnv() {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    }).filter(([key]) => !localGitEnvVars.includes(key)),
  );
}

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: fixtureEnv(),
  }).trim();
}

/** Local bare remote with a default branch (main or master) + optional tagged pin. */
function createLocalRemote({ defaultBranch = 'main', pinTag = null, contents = 'seed\n' } = {}) {
  const remote = makeTempDir('rsLXST-remote-');
  const seed = makeTempDir('rsLXST-seed-');
  git(seed, 'init', '-b', defaultBranch);
  git(seed, 'config', 'user.email', 'test@example.com');
  git(seed, 'config', 'user.name', 'test');
  writeFileSync(join(seed, 'README'), contents);
  git(seed, 'add', 'README');
  git(seed, 'commit', '-m', 'seed');
  const tipSha = git(seed, 'rev-parse', 'HEAD');
  let pinSha = tipSha;
  if (pinTag) {
    writeFileSync(join(seed, 'PIN'), 'pin\n');
    git(seed, 'add', 'PIN');
    git(seed, 'commit', '-m', 'pin');
    pinSha = git(seed, 'rev-parse', 'HEAD');
    git(seed, 'tag', pinTag);
    // Float tip stays on default branch first commit for clearer float vs pin.
    git(seed, 'reset', '--hard', tipSha);
  }
  git(seed, 'clone', '--bare', seed, remote);
  return { remote, tipSha, pinSha };
}

/** Source the clone script and invoke ensure_repo against an isolated fixture checkout. */
function runEnsureRepo({
  remoteUrl,
  destDir,
  pinRef,
  reviewedPin = pinRef,
  env = {},
  mergeStderr = false,
}) {
  const ensureCall = 'ensure_repo "$2" "$3" "$4" rsLXST "$5"' + (mergeStderr ? ' 2>&1' : '');
  const script = [
    'set -euo pipefail',
    'source "$1"',
    ensureCall,
    'echo "SELECTED=${ENSURE_REPO_SELECTED_REF}"',
    'echo "MODE=$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "$4" "$5")"',
    'echo "SHA=$(git -C "$2" rev-parse HEAD)"',
  ].join('\n');
  return execFileSync(
    'bash',
    ['-c', script, 'ensure-repo', cloneScriptPath, destDir, remoteUrl, pinRef, reviewedPin],
    {
      encoding: 'utf8',
      env: {
        ...fixtureEnv(),
        // Host shells often export RS_STACK_DISCARD_DIRTY=1 while debugging clones.
        RS_STACK_DISCARD_DIRTY: '',
        ...env,
      },
    },
  );
}

/** Source the clone script with sanitized release-policy environment variables. */
function sourceCloneScript(env = {}) {
  return execFileSync(
    'bash',
    ['-c', 'source "$1"; printf "%s" "${RS_LXST_REF}"', 'source-clone', cloneScriptPath],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...fixtureEnv(),
        CI: '',
        GITHUB_ACTIONS: '',
        MESH_CLIENT_BUILD_CHANNEL: '',
        MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE: '',
        RS_LXST_REF: '',
        ...env,
      },
    },
  );
}

describe('clone-ratspeak-stack.sh immutable source policy', () => {
  it('loads reviewed full-SHA pins for every native dependency', () => {
    expect(cloneScript).toContain('WORKSPACE_ROOT="${WORKSPACE_ROOT:-${REPO_ROOT}/.rsstack}"');
    expect(cloneScript).toContain('reticulum-sidecar/ratspeak-stack-pins.env');
    expect(cloneScript).toContain('validate_pin "${RS_RETICULUM_PIN:-}"');
    expect(cloneScript).toContain('validate_pin "${RS_LXMF_PIN:-}"');
    expect(cloneScript).toContain('validate_pin "${RS_NOMAD_PIN:-}"');
    expect(cloneScript).toContain('validate_pin "${RS_LXST_PIN:-}"');
    expect(cloneScript).toContain('validate_pin "${RS_LRGP_PIN:-}"');
    expect(cloneScript).toContain('cannot override the reviewed pin in CI/release');
    expect(cloneScript).toContain('MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE=1');
    expect(cloneScript).not.toContain("target_ref='origin/main'");
    expect(cloneScript).not.toContain("target_ref='origin/master'");
    expect(cloneScript).toContain('export RS_RETICULUM_DIR=');
    expect(cloneScript).toContain('export RS_LXMF_DIR=');
    expect(cloneScript).toContain('refuse to float/pin');
    expect(cloneScript).toContain('RS_STACK_DISCARD_DIRTY');
    expect(cloneScript).toContain('discarding to float/pin');
    expect(cloneScript).toContain('basename "${WORKSPACE_ROOT}"');
    expect(cloneScript).toContain("== '.rsstack'");
    expect(cloneScript).toContain("rev-parse --verify 'FETCH_HEAD^{commit}'");
    expect(cloneScript).toContain('verify_origin_serves_pin');
    expect(cloneScript).toContain('mesh-ratspeak-origin-proof.XXXXXX');
    expect(cloneScript).not.toContain('fetch --refetch');
    expect(cloneScript).toContain('does not match reviewed pin');
    expect(cloneScript).toContain('checkout HEAD');
    expect(cloneScript).toContain('Ratspeak stack SHAs (full)');
    expect(cloneScript).toContain('ratspeak-overlay-apply-list.sh');
    expect(cloneScript).toContain('format_repo_mode');
    expect(cloneScript).toContain('ENSURE_REPO_SELECTED_REF');
    const pins = readFileSync(
      fileURLToPath(new URL('../reticulum-sidecar/ratspeak-stack-pins.env', import.meta.url)),
      'utf8',
    );
    expect(pins.match(/^[A-Z_]+=[0-9a-f]{40}$/gm)).toHaveLength(5);
  });

  it('pins rsNomad and verifies the manifest SHA', () => {
    expect(cloneScript).toContain('RS_NOMAD_REF="$(select_ref RS_NOMAD_REF "${RS_NOMAD_PIN}"');
    expect(cloneScript).toContain('Colorado-Mesh/rsNomad.git');
    expect(cloneScript).toContain('"${RS_NOMAD_REF}" \'rsNomad\' "${RS_NOMAD_PIN}"');
  });

  it('requires explicit local opt-in and rejects ref overrides in CI', () => {
    expect(() => sourceCloneScript({ RS_LXST_REF: 'main' })).toThrow(
      /MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE=1/,
    );
    expect(
      sourceCloneScript({
        RS_LXST_REF: 'main',
        MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE: '1',
      }),
    ).toBe('main');
    expect(() =>
      sourceCloneScript({
        CI: 'true',
        RS_LXST_REF: 'main',
        MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE: '1',
      }),
    ).toThrow(/cannot override the reviewed pin in CI\/release/);
  });

  it('ensure_repo checks out an exact reviewed SHA', () => {
    const { remote, tipSha } = createLocalRemote({ defaultBranch: 'main' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    const out = runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: tipSha });
    expect(out).toContain(`SELECTED=${tipSha}`);
    expect(out).toContain(`MODE=latest-release SHA ${tipSha.slice(0, 12)}`);
    expect(out).toContain(`SHA=${tipSha}`);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(tipSha);
  });

  it.each([false, true])('preserves the hook worktree when dependency exists: %s', (existing) => {
    const { remote, tipSha } = createLocalRemote();
    const parent = makeTempDir('mesh-hook-parent-');
    git(parent, 'init', '-b', 'main');
    git(parent, 'config', 'user.email', 'test@example.com');
    git(parent, 'config', 'user.name', 'test');
    writeFileSync(join(parent, 'README'), 'parent repository\n');
    git(parent, 'add', 'README');
    git(parent, 'commit', '-m', 'parent');
    const parentOrigin = join(parent, 'parent-origin');
    git(parent, 'remote', 'add', 'origin', parentOrigin);
    const worktree = join(makeTempDir('mesh-hook-worktree-'), 'checkout');
    git(parent, 'worktree', 'add', '-b', 'review-fixture', worktree);
    writeFileSync(join(worktree, 'README'), 'staged review fix\n');
    git(worktree, 'add', 'README');
    writeFileSync(join(worktree, 'UNTRACKED'), 'keep this work\n');
    const parentHead = git(worktree, 'rev-parse', 'HEAD');
    const staged = git(worktree, 'diff', '--cached', '--binary');
    const dest = join(makeTempDir('mesh-hook-dependency-'), 'rsLXST');
    if (existing) runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: tipSha });

    const out = runEnsureRepo({
      remoteUrl: remote,
      destDir: dest,
      pinRef: tipSha,
      env: {
        GIT_DIR: git(worktree, 'rev-parse', '--absolute-git-dir'),
        GIT_COMMON_DIR: git(worktree, 'rev-parse', '--git-common-dir'),
        GIT_INDEX_FILE: git(worktree, 'rev-parse', '--git-path', 'index'),
        GIT_WORK_TREE: worktree,
      },
    });

    expect(out).toContain(`SHA=${tipSha}`);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(tipSha);
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(parentHead);
    expect(git(worktree, 'symbolic-ref', '--short', 'HEAD')).toBe('review-fixture');
    expect(git(parent, 'remote', 'get-url', 'origin')).toBe(parentOrigin);
    expect(git(worktree, 'diff', '--cached', '--binary')).toBe(staged);
    expect(readFileSync(join(worktree, 'README'), 'utf8')).toBe('staged review fix\n');
    expect(readFileSync(join(worktree, 'UNTRACKED'), 'utf8')).toBe('keep this work\n');
  });

  it('ensure_repo discards dirty overlay state under .rsstack when a reviewed pin changes', () => {
    const { remote, tipSha } = createLocalRemote({ defaultBranch: 'main' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: tipSha });
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(tipSha);

    // Advance remote tip after initial clone so float must move HEAD.
    const seed = makeTempDir('rsLXST-advance-');
    git(seed, 'clone', remote, '.');
    git(seed, 'config', 'user.email', 'test@example.com');
    git(seed, 'config', 'user.name', 'test');
    writeFileSync(join(seed, 'NEXT'), 'next\n');
    git(seed, 'add', 'NEXT');
    git(seed, 'commit', '-m', 'next');
    const newTip = git(seed, 'rev-parse', 'HEAD');
    git(seed, 'push', 'origin', 'HEAD:main');
    expect(newTip).not.toBe(tipSha);

    writeFileSync(join(dest, 'OVERLAY'), 'dirty\n');
    expect(git(dest, 'status', '--porcelain')).toContain('OVERLAY');

    // Default WORKSPACE_ROOT from sourced script is repo .rsstack → discard dirty.
    const out = runEnsureRepo({
      remoteUrl: remote,
      destDir: dest,
      pinRef: newTip,
      mergeStderr: true,
    });
    expect(out).toContain('discarding to float/pin');
    expect(out).toContain(`SHA=${newTip}`);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(newTip);
    expect(git(dest, 'status', '--porcelain')).toBe('');
  });

  it('cleans dirty same-SHA state before using a reviewed pin', () => {
    const { remote, tipSha } = createLocalRemote({ defaultBranch: 'main' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: tipSha });
    writeFileSync(join(dest, 'UNREVIEWED'), 'must not reach Cargo\n');

    const out = runEnsureRepo({
      remoteUrl: remote,
      destDir: dest,
      pinRef: tipSha,
      mergeStderr: true,
    });

    expect(out).toContain('discarding to float/pin');
    expect(git(dest, 'status', '--porcelain')).toBe('');
  });

  it('fails closed when an immutable commit cannot be fetched', () => {
    const { remote } = createLocalRemote({ defaultBranch: 'main' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    const missing = 'f'.repeat(40);

    expect(() => runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: missing })).toThrow(
      /expected origin cannot serve reviewed pin/,
    );
  });

  it('requires the configured origin to serve a cached reviewed commit', () => {
    const first = createLocalRemote({ defaultBranch: 'main' });
    const unrelated = createLocalRemote({ defaultBranch: 'main', contents: 'unrelated\n' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');

    runEnsureRepo({ remoteUrl: first.remote, destDir: dest, pinRef: first.tipSha });
    expect(unrelated.tipSha).not.toBe(first.tipSha);

    expect(() =>
      runEnsureRepo({
        remoteUrl: unrelated.remote,
        destDir: dest,
        pinRef: first.tipSha,
      }),
    ).toThrow(/expected origin cannot serve reviewed pin/);
  });

  it('ensure_repo refuses dirty external workspaces unless RS_STACK_DISCARD_DIRTY=1', () => {
    const { remote, tipSha } = createLocalRemote({ defaultBranch: 'main' });
    const dest = join(makeTempDir('siblings-'), 'rsLXST');
    runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: tipSha });
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(tipSha);

    const seed = makeTempDir('rsLXST-advance-');
    git(seed, 'clone', remote, '.');
    git(seed, 'config', 'user.email', 'test@example.com');
    git(seed, 'config', 'user.name', 'test');
    writeFileSync(join(seed, 'NEXT'), 'next\n');
    git(seed, 'add', 'NEXT');
    git(seed, 'commit', '-m', 'next');
    const newTip = git(seed, 'rev-parse', 'HEAD');
    git(seed, 'push', 'origin', 'HEAD:main');
    expect(newTip).not.toBe(tipSha);

    writeFileSync(join(dest, 'WIP'), 'keep\n');

    const externalWorkspace = makeTempDir('not-rsstack-');
    expect(() =>
      runEnsureRepo({
        remoteUrl: remote,
        destDir: dest,
        pinRef: newTip,
        env: { WORKSPACE_ROOT: externalWorkspace },
      }),
    ).toThrow(/refuse to float\/pin/);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(tipSha);
    expect(git(dest, 'status', '--porcelain')).toContain('WIP');

    const out = runEnsureRepo({
      remoteUrl: remote,
      destDir: dest,
      pinRef: newTip,
      mergeStderr: true,
      env: { WORKSPACE_ROOT: externalWorkspace, RS_STACK_DISCARD_DIRTY: '1' },
    });
    expect(out).toContain('discarding to float/pin');
    expect(out).toContain(`SHA=${newTip}`);
    expect(git(dest, 'status', '--porcelain')).toBe('');
  });

  it('ensure_repo rejects an empty source ref', () => {
    const { remote } = createLocalRemote({ defaultBranch: 'master' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    expect(() =>
      runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: '', reviewedPin: '' }),
    ).toThrow(/immutable source ref is required/);
  });

  it('ensure_repo pins RS_LXST_REF and reports pinned mode + checkout SHA', () => {
    const { remote, pinSha } = createLocalRemote({ defaultBranch: 'main', pinTag: 'v-test-pin' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    const out = runEnsureRepo({
      remoteUrl: remote,
      destDir: dest,
      pinRef: 'v-test-pin',
      reviewedPin: '',
    });
    expect(out).toMatch(/SELECTED=v-test-pin|SELECTED=origin\/v-test-pin/);
    expect(out).toContain('MODE=local override v-test-pin');
    expect(out).toContain(`SHA=${pinSha}`);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(pinSha);
  });

  it('clones lrgp-rs from the reviewed pin', () => {
    expect(cloneScript).toContain('LRGP_DIR=');
    expect(cloneScript).toContain('RS_LRGP_REF="$(select_ref RS_LRGP_REF "${RS_LRGP_PIN}"');
    expect(cloneScript).toContain('https://github.com/ratspeak/lrgp-rs.git');
    expect(cloneScript).toContain('ensure_repo "${LRGP_DIR}"');
    expect(cloneScript).toContain('"${RS_LRGP_REF}" \'lrgp-rs\' "${RS_LRGP_PIN}"');
    expect(cloneScript).toContain('lrgp-rs @');
    const { remote, tipSha } = createLocalRemote({ defaultBranch: 'main' });
    const dest = join(makeTempDir('workspace-'), 'lrgp-rs');
    const out = runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: tipSha });
    expect(out).toContain(`SELECTED=${tipSha}`);
    expect(out).toContain(`SHA=${tipSha}`);
  });

  it('applies rsReticulum, rsLXMF, and rsNomad overlays after checkout via shared list', () => {
    expect(cloneScript).toContain('apply_ratspeak_rns_overlays');
    expect(cloneScript).toContain('apply_ratspeak_lxmf_overlays');
    expect(cloneScript).toContain('apply_ratspeak_nomad_overlays');
    const rnsEnsure = cloneScript.indexOf('ensure_repo "${RNS_DIR}"');
    const rnsApply = cloneScript.indexOf('apply_ratspeak_rns_overlays');
    const lxmfEnsure = cloneScript.indexOf('ensure_repo "${LXMF_DIR}"');
    const lxmfApply = cloneScript.indexOf('apply_ratspeak_lxmf_overlays');
    const nomadEnsure = cloneScript.indexOf('ensure_repo "${NOMAD_DIR}"');
    const nomadApply = cloneScript.indexOf('apply_ratspeak_nomad_overlays');
    expect(rnsEnsure).toBeGreaterThanOrEqual(0);
    expect(rnsApply).toBeGreaterThan(rnsEnsure);
    expect(lxmfEnsure).toBeGreaterThan(rnsApply);
    expect(lxmfApply).toBeGreaterThan(lxmfEnsure);
    expect(nomadEnsure).toBeGreaterThan(lxmfApply);
    expect(nomadApply).toBeGreaterThan(nomadEnsure);

    const listPath = fileURLToPath(
      new URL('./lib/ratspeak-overlay-apply-list.sh', import.meta.url),
    );
    const listScript = readFileSync(listPath, 'utf8');
    expect(listScript).toContain('apply-rsReticulum-packet-tap.sh');
    expect(listScript).toContain('apply-rsLXMF-propagation-node-policy-setters.sh');
    expect(listScript).toContain('apply-rsLXMF-propagation-node-deferred-messagestore-load.sh');
    expect(listScript).toContain('apply-rsNomad-picker-pinned-roots.sh');

    expect(ensureScript).toContain('NOMAD_DIR="${RS_NOMAD_DIR:-${REPO_ROOT}/.rsstack/rsNomad}"');
    expect(ensureScript).toContain('apply_ratspeak_nomad_overlays');
    expect(ensureScript.indexOf('apply_ratspeak_nomad_overlays')).toBeGreaterThan(
      ensureScript.indexOf('apply_ratspeak_lxmf_overlays'),
    );
  });
});
