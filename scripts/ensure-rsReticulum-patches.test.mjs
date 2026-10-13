import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const localGitEnvVars = execFileSync('git', ['rev-parse', '--local-env-vars'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n');

function fixtureEnv(extra = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !localGitEnvVars.includes(key) &&
        !key.startsWith('RS_') &&
        key !== 'WORKSPACE_ROOT' &&
        key !== 'MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE',
    ),
  );
  return { ...inherited, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
}

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: fixtureEnv() }).trim();
}

/** Git repo with two commits; returns [olderSha, newerSha] with HEAD on newer. */
function makeRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  const shas = [];
  for (const n of ['one', 'two']) {
    writeFileSync(join(dir, 'README'), `${n}\n`);
    git(dir, 'add', 'README');
    git(dir, 'commit', '-m', n);
    shas.push(git(dir, 'rev-parse', 'HEAD'));
  }
  return shas;
}

const APPLY_SCRIPTS = [
  'apply-rsReticulum-reply-file-query-metadata.sh',
  'apply-rsReticulum-packet-tap.sh',
  'apply-rsReticulum-auto-beacon-utun.sh',
  'apply-rsReticulum-link-client-proof-budget.sh',
  'apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh',
  'apply-rsReticulum-ble-rnode-bond-desync.sh',
  'apply-rsReticulum-discovery-announce-egress.sh',
  'apply-rsReticulum-path-medium-slots.sh',
  'apply-rsReticulum-inbound-raw-saturation-log.sh',
  'apply-rsReticulum-interface-tx-queue-stats.sh',
  'apply-rsReticulum-ble-rnode-flow-control-ready-timeout.sh',
  'apply-rsReticulum-ble-rnode-host-rssi-cache.sh',
  'apply-rsReticulum-response-resource-window-fast.sh',
  'apply-rsReticulum-rncp-picker-pinned-jail.sh',
  'apply-rsReticulum-rncp-inbound-admission.sh',
  'apply-rsLXMF-file-attachments-list.sh',
  'apply-rsLXMF-propagation-sync-peering.sh',
  'apply-rsLXMF-propagation-node-policy-setters.sh',
  'apply-rsLXMF-propagation-node-deferred-messagestore-load.sh',
  'apply-rsLXMF-link-delivery-has-pending-to.sh',
  'apply-rsLXMF-propagation-client-abort-transfer.sh',
  'apply-rsLXMF-propagation-client-lrproof-diagnostics.sh',
  'apply-rsNomad-picker-pinned-roots.sh',
];

/**
 * Fake mesh-client tree: real ensure script + apply list, stub clone/apply scripts
 * that drop markers, and .rsstack repos. `rnsPinIndex` picks which rsReticulum
 * commit is the reviewed pin (1 = HEAD, 0 = older so HEAD is stale).
 */
function makeFixture({ rnsPinIndex }) {
  const root = makeTempDir('mesh-ensure-patches-');
  const scripts = join(root, 'scripts');
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  copyFileSync(
    join(scriptsDir, 'ensure-rsReticulum-patches.sh'),
    join(scripts, 'ensure-rsReticulum-patches.sh'),
  );
  copyFileSync(
    join(scriptsDir, 'lib', 'ratspeak-overlay-apply-list.sh'),
    join(scripts, 'lib', 'ratspeak-overlay-apply-list.sh'),
  );
  writeFileSync(
    join(scripts, 'clone-ratspeak-stack.sh'),
    `#!/usr/bin/env bash\ntouch "${join(root, 'clone-ran')}"\n`,
    { mode: 0o755 },
  );
  for (const name of APPLY_SCRIPTS) {
    writeFileSync(join(scripts, name), `#!/usr/bin/env bash\ntouch "${join(root, 'applied')}"\n`, {
      mode: 0o755,
    });
  }
  const rns = makeRepo(join(root, '.rsstack', 'rsReticulum'));
  const lxmf = makeRepo(join(root, '.rsstack', 'rsLXMF'));
  const nomad = makeRepo(join(root, '.rsstack', 'rsNomad'));
  mkdirSync(join(root, 'reticulum-sidecar'));
  writeFileSync(
    join(root, 'reticulum-sidecar', 'ratspeak-stack-pins.env'),
    [
      `RS_RETICULUM_PIN=${rns[rnsPinIndex]}`,
      `RS_LXMF_PIN=${lxmf[1]}`,
      `RS_NOMAD_PIN=${nomad[1]}`,
      '',
    ].join('\n'),
  );
  return { root, rns };
}

function runEnsure(root, env = {}) {
  return spawnSync('bash', [join(root, 'scripts', 'ensure-rsReticulum-patches.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: fixtureEnv(env),
  });
}

describe('ensure-rsReticulum-patches.sh stale pin re-pin', () => {
  it('runs clone-ratspeak-stack.sh when the .rsstack HEAD is not the reviewed pin', () => {
    const { root } = makeFixture({ rnsPinIndex: 0 });
    const result = runEnsure(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('rsReticulum stale pin');
    expect(existsSync(join(root, 'clone-ran'))).toBe(true);
    expect(existsSync(join(root, 'applied'))).toBe(false);
  });

  it('applies overlays without cloning when HEAD matches the pin', () => {
    const { root } = makeFixture({ rnsPinIndex: 1 });
    const result = runEnsure(root);
    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'clone-ran'))).toBe(false);
    expect(existsSync(join(root, 'applied'))).toBe(true);
  });

  it('does not re-pin when a local bisect override is active', () => {
    const { root, rns } = makeFixture({ rnsPinIndex: 0 });
    const result = runEnsure(root, {
      RS_RETICULUM_REF: rns[1],
      MESH_CLIENT_ALLOW_RATSPEAK_REF_OVERRIDE: '1',
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'clone-ran'))).toBe(false);
    expect(existsSync(join(root, 'applied'))).toBe(true);
  });

  it('does not re-pin an external RS_RETICULUM_DIR outside .rsstack', () => {
    const { root } = makeFixture({ rnsPinIndex: 0 });
    const external = makeTempDir('mesh-external-rns-');
    makeRepo(external);
    const result = runEnsure(root, { RS_RETICULUM_DIR: external });
    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'clone-ran'))).toBe(false);
    expect(existsSync(join(root, 'applied'))).toBe(true);
  });
});
