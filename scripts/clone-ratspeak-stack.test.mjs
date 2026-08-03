import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const cloneScriptPath = fileURLToPath(new URL('./clone-ratspeak-stack.sh', import.meta.url));
const cloneScript = readFileSync(cloneScriptPath, 'utf8');

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
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
}

/** Local bare remote with a default branch (main or master) + optional tagged pin. */
function createLocalRemote({ defaultBranch = 'main', pinTag = null } = {}) {
  const remote = makeTempDir('rsLXST-remote-');
  const seed = makeTempDir('rsLXST-seed-');
  git(seed, 'init', '-b', defaultBranch);
  git(seed, 'config', 'user.email', 'test@example.com');
  git(seed, 'config', 'user.name', 'test');
  writeFileSync(join(seed, 'README'), 'seed\n');
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

function runEnsureRepo({ remoteUrl, destDir, pinRef = '' }) {
  // Plain strings so bash ${...}/$(...) is not JS template interpolation.
  const script = [
    'set -euo pipefail',
    'source ' + JSON.stringify(cloneScriptPath),
    'ensure_repo ' +
      JSON.stringify(destDir) +
      ' ' +
      JSON.stringify(remoteUrl) +
      ' ' +
      JSON.stringify(pinRef) +
      " 'rsLXST'",
    'echo "SELECTED=${ENSURE_REPO_SELECTED_REF}"',
    'echo "MODE=$(format_repo_mode "${ENSURE_REPO_SELECTED_REF}" ' + JSON.stringify(pinRef) + ')"',
    'echo "SHA=$(git -C ' + JSON.stringify(destDir) + ' rev-parse HEAD)"',
  ].join('\n');
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
}

describe('clone-ratspeak-stack.sh float policy', () => {
  it('floats rsReticulum and rsLXMF to origin/main by default', () => {
    expect(cloneScript).toContain("target_ref='origin/main'");
    expect(cloneScript).toContain('checkout --quiet --detach');
    expect(cloneScript).toMatch(/RS_RETICULUM_REF="\$\{RS_RETICULUM_REF:-\}"/);
    expect(cloneScript).toMatch(/RS_LXMF_REF="\$\{RS_LXMF_REF:-\}"/);
    expect(cloneScript).toContain('export RS_RETICULUM_DIR=');
    expect(cloneScript).toContain('export RS_LXMF_DIR=');
    expect(cloneScript).toContain('refuse to float/pin');
    expect(cloneScript).toContain('already at');
    expect(cloneScript).toContain('skipping checkout');
    expect(cloneScript).toContain('origin/${ref_or_empty}');
    expect(cloneScript).toContain('Ratspeak stack SHAs (full)');
    expect(cloneScript).toContain('ratspeak-overlay-apply-list.sh');
    expect(cloneScript).toContain('format_repo_mode');
    expect(cloneScript).toContain('ENSURE_REPO_SELECTED_REF');
    expect(cloneScript).not.toMatch(/9928abed269a83ec5a7ef165ff1142d938cad706/);
    expect(cloneScript).not.toMatch(/68ad7c835187c052c763bb28c41b04a655f35c64/);
  });

  it('floats rsNomad to origin/main with optional RS_NOMAD_REF pin', () => {
    expect(cloneScript).toMatch(/RS_NOMAD_REF="\$\{RS_NOMAD_REF:-\}"/);
    expect(cloneScript).toContain('Colorado-Mesh/rsNomad.git');
    expect(cloneScript).toContain(
      'format_repo_mode "${ENSURE_REPO_SELECTED_REF}" "${RS_NOMAD_REF}"',
    );
    expect(cloneScript).not.toContain('6e3b288fbc6931b1e2633d986cf0d49608d578b7');
    expect(cloneScript).not.toContain('RS_NOMAD_SKIP_PIN');
  });

  it('ensure_repo floats rsLXST and reports selected ref + SHA', () => {
    const { remote, tipSha } = createLocalRemote({ defaultBranch: 'main' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    const out = runEnsureRepo({ remoteUrl: remote, destDir: dest });
    expect(out).toContain('SELECTED=origin/main');
    expect(out).toContain('MODE=floated origin/main');
    expect(out).toContain(`SHA=${tipSha}`);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(tipSha);
  });

  it('ensure_repo falls back to origin/master when main is absent', () => {
    const { remote, tipSha } = createLocalRemote({ defaultBranch: 'master' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    const out = runEnsureRepo({ remoteUrl: remote, destDir: dest });
    expect(out).toContain('SELECTED=origin/master');
    expect(out).toContain('MODE=floated origin/master');
    expect(out).toContain(`SHA=${tipSha}`);
  });

  it('ensure_repo pins RS_LXST_REF and reports pinned mode + checkout SHA', () => {
    const { remote, pinSha } = createLocalRemote({ defaultBranch: 'main', pinTag: 'v-test-pin' });
    const dest = join(makeTempDir('workspace-'), 'rsLXST');
    const out = runEnsureRepo({ remoteUrl: remote, destDir: dest, pinRef: 'v-test-pin' });
    expect(out).toMatch(/SELECTED=v-test-pin|SELECTED=origin\/v-test-pin/);
    expect(out).toContain('MODE=pinned v-test-pin');
    expect(out).toContain(`SHA=${pinSha}`);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(pinSha);
  });

  it('applies rsReticulum and rsLXMF overlays after checkout via shared list', () => {
    expect(cloneScript).toContain('apply_ratspeak_rns_overlays');
    expect(cloneScript).toContain('apply_ratspeak_lxmf_overlays');
    const rnsEnsure = cloneScript.indexOf('ensure_repo "${RNS_DIR}"');
    const rnsApply = cloneScript.indexOf('apply_ratspeak_rns_overlays');
    const lxmfEnsure = cloneScript.indexOf('ensure_repo "${LXMF_DIR}"');
    const lxmfApply = cloneScript.indexOf('apply_ratspeak_lxmf_overlays');
    expect(rnsEnsure).toBeGreaterThanOrEqual(0);
    expect(rnsApply).toBeGreaterThan(rnsEnsure);
    expect(lxmfEnsure).toBeGreaterThan(rnsApply);
    expect(lxmfApply).toBeGreaterThan(lxmfEnsure);

    const listPath = fileURLToPath(
      new URL('./lib/ratspeak-overlay-apply-list.sh', import.meta.url),
    );
    const listScript = readFileSync(listPath, 'utf8');
    expect(listScript).toContain('apply-rsReticulum-packet-tap.sh');
    expect(listScript).toContain('apply-rsLXMF-propagation-node-policy-setters.sh');
  });
});
