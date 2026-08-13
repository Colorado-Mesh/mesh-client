import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-link-client-nomad.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-link-client-nomad.patch',
);
const PATH_MEDIUM_PATCH = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-path-medium-slots.patch',
);
const LXMF_DEFERRED_PATCH = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsLXMF-propagation-node-deferred-messagestore-load.patch',
);
const LXMF_ABORT_PATCH = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsLXMF-propagation-client-abort-transfer.patch',
);

const ALREADY_PRESENT = `impl LinkClient {
    async fn discover_remote_public_key() {}
    fn gc_closed_announce_handlers() {}
}
const PATH_LOOKUP_TIMEOUT: Duration = Duration::from_secs(15);
`;

const INCOMPATIBLE = `impl LinkClient {
    pub async fn query() {}
}
`;

const temps = [];

function makeFakeRsReticulum(linkClientSource) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-link-client-nomad-rns-'));
  temps.push(root);
  const linkClientPath = path.join(root, 'crates/rns-runtime/src/link_client.rs');
  mkdirSync(path.dirname(linkClientPath), { recursive: true });
  writeFileSync(linkClientPath, linkClientSource);
  const gitInit = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  expect(gitInit.status).toBe(0);
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root });
  spawnSync('git', ['add', '.'], { cwd: root });
  const commit = spawnSync('git', ['commit', '-m', 'init'], { cwd: root, encoding: 'utf8' });
  expect(commit.status).toBe(0);
  return root;
}

function runApply(rnsDir) {
  return spawnSync('bash', [APPLY_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, RS_RETICULUM_DIR: rnsDir },
  });
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('apply-rsReticulum-link-client-nomad.sh', () => {
  it('keeps RRC LinkClient recall on upstream RecallDestination', () => {
    const rrcLink = readFileSync(
      path.join(REPO_ROOT, 'reticulum-sidecar/src/stack/rrc_link.rs'),
      'utf8',
    );
    expect(rrcLink).toContain('TransportQuery::RecallDestination');
    expect(rrcLink).toContain('TransportQueryResponse::RecalledDestination');
    expect(rrcLink).not.toContain('RecallDestinationPublicKey');
    expect(rrcLink).not.toContain('PublicKeyResult');
  });

  it('uses LinkClient markers, not the retired RecallDestinationPublicKey RPC', () => {
    const applyScript = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(applyScript).toContain('discover_remote_public_key');
    expect(applyScript).toContain('gc_closed_announce_handlers');
    expect(applyScript).toContain('PATH_LOOKUP_TIMEOUT');
    expect(applyScript).not.toContain('RecallDestinationPublicKey');
    expect(applyScript).not.toContain('MESSAGES_RS');
  });

  it('rebases Nomad recall onto upstream RecallDestination + await_path', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('discover_remote_public_key');
    expect(patch).toContain('gc_closed_announce_handlers');
    expect(patch).toContain('RecallDestination');
    expect(patch).toContain('await_path');
    expect(patch).toContain('PATH_LOOKUP_TIMEOUT');
    expect(patch).not.toContain('RecallDestinationPublicKey');
    expect(patch).not.toContain('PublicKeyResult');
    expect(patch).toMatch(/crates\/rns-runtime\/src\/link_client\.rs/);
    expect(patch).not.toMatch(/crates\/rns-transport\/src\/messages\.rs/);
  });

  it('does not keep retired Nomad RPC tests in the path-medium-slots overlay', () => {
    const patch = readFileSync(PATH_MEDIUM_PATCH, 'utf8');
    expect(patch).not.toContain('RecallDestinationPublicKey');
    expect(patch).toContain('MAX_PATH_SLOTS');
  });

  it('rebases LXMF deferred messagestore load onto pending_write fields', () => {
    const patch = readFileSync(LXMF_DEFERRED_PATCH, 'utf8');
    expect(patch).toContain('with_storage_unloaded');
    expect(patch).toContain('load_messagestore_from_disk');
    expect(patch).toContain('pending_write_ids');
    expect(patch).toContain('pending_write_bytes');
  });

  it('inserts abort_transfer after acknowledge_transfer on current rsLXMF', () => {
    const patch = readFileSync(LXMF_ABORT_PATCH, 'utf8');
    expect(patch).toContain('fn abort_transfer');
    expect(patch).toContain('start_download_with_limit');
  });

  it('is a no-op when discover_remote_public_key + GC markers are already present', () => {
    const rns = makeFakeRsReticulum(ALREADY_PRESENT);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already present/);
  });

  it('fails with git diagnostic on incompatible checkouts', () => {
    const rns = makeFakeRsReticulum(INCOMPATIBLE);
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });
});
