import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsLXMF-propagation-client-link-attached-tx.sh');

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

function makeFakeRsLxmf(clientSource) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-lxmf-link-tx-'));
  temps.push(root);
  const clientPath = path.join(root, 'crates/lxmf-core/src/propagation_client.rs');
  mkdirSync(path.dirname(clientPath), { recursive: true });
  writeFileSync(clientPath, clientSource);
  const gitInit = git(root, ['init']);
  expect(gitInit.status).toBe(0);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['add', '.']);
  const commit = git(root, ['commit', '-m', 'init']);
  expect(commit.status).toBe(0);
  return root;
}

function runApply(lxmfDir) {
  return spawnSync('bash', [APPLY_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...GIT_TEST_ENV, RS_LXMF_DIR: lxmfDir },
  });
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('apply-rsLXMF-propagation-client-link-attached-tx.sh', () => {
  it('is a no-op when upstream SendLinkEndpoint pins attached_interface', () => {
    const lxmf = makeFakeRsLxmf(`
pub struct PropagationClient {
    attached_interface: Option<InterfaceId>,
}
impl PropagationClient {
    fn queue_link_endpoint(&mut self, request: OutboundRequest) -> bool {
        self.queue_transport(TransportMessage::SendLinkEndpoint {
            link_id,
            request,
        })
    }
}
`);
    const result = runApply(lxmf);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already present/);
  });

  it('fails with git diagnostic on incompatible checkouts', () => {
    const lxmf = makeFakeRsLxmf('pub struct PropagationClient {}\n');
    const result = runApply(lxmf);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });
});
