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

const GIT_TEST_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

/** Marker fallback: recall + GC semantics without matching the exact patch hunks. */
const MARKER_FALLBACK = `impl LinkClient {
    async fn discover_remote_public_key() {
        match self.transport_query(TransportQuery::RecallDestination { dest: dest_hash }).await? {
            TransportQueryResponse::RecalledDestination(Some(destination)) => destination.public_key,
            _ => return Err(LinkClientError::PubkeyNotDiscovered),
        };
        await_path(&self.transport_tx, dest_hash, PATH_LOOKUP_TIMEOUT).await?;
    }
    fn gc_closed_announce_handlers() {
        let _ = self.transport_tx.try_send(TransportMessage::DeregisterAnnounceHandler {
            aspect_filter: None,
        });
    }
}
const PATH_LOOKUP_TIMEOUT: Duration = Duration::from_secs(15);
`;

const INCOMPATIBLE = `impl LinkClient {
    pub async fn query() {}
}
`;

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

function materializeLinkClientFromPatch(patchText, side) {
  const lines = [];
  const patchLines = patchText.replace(/\n$/, '').split('\n');
  let i = 0;
  while (i < patchLines.length && !patchLines[i].startsWith('@@ ')) {
    i += 1;
  }
  while (i < patchLines.length) {
    const hunk = parseUnifiedHunkHeader(patchLines[i]);
    if (!hunk) {
      i += 1;
      continue;
    }
    const start = side === 'old' ? hunk.oldStart : hunk.newStart;
    while (lines.length < start - 1) {
      lines.push(`// overlay-fixture-pad ${lines.length + 1}`);
    }
    i += 1;
    while (i < patchLines.length && !patchLines[i].startsWith('@@ ')) {
      const line = patchLines[i];
      if (line.startsWith('\\')) {
        i += 1;
        continue;
      }
      if (
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ')
      ) {
        break;
      }
      const tag = line[0];
      const body = line.slice(1);
      if (tag === ' ') {
        lines.push(body);
      } else if (tag === '-' && side === 'old') {
        lines.push(body);
      } else if (tag === '+' && side === 'new') {
        lines.push(body);
      }
      i += 1;
    }
  }
  return `${lines.join('\n')}\n`;
}

function makeFakeRsReticulum(linkClientSource) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-link-client-nomad-rns-'));
  temps.push(root);
  const linkClientPath = path.join(root, 'crates/rns-runtime/src/link_client.rs');
  mkdirSync(path.dirname(linkClientPath), { recursive: true });
  writeFileSync(linkClientPath, linkClientSource);
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

  it('uses LinkClient recall/GC semantics, not the retired RecallDestinationPublicKey RPC', () => {
    const applyScript = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(applyScript).toContain('discover_remote_public_key');
    expect(applyScript).toContain('gc_closed_announce_handlers');
    expect(applyScript).toContain('PATH_LOOKUP_TIMEOUT');
    expect(applyScript).toContain('TransportQuery::RecallDestination');
    expect(applyScript).toContain('await_path\\(');
    expect(applyScript).toContain('aspect_filter: None');
    expect(applyScript).toContain('TransportQuery::HasPath');
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

  it('is a no-op when the exact applied overlay reverse-checks', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    const applied = materializeLinkClientFromPatch(patch, 'new');
    const rns = makeFakeRsReticulum(applied);
    const reverse = git(rns, ['apply', '--reverse', '--check', PATCH_FILE]);
    expect(reverse.status, reverse.stderr || reverse.stdout).toBe(0);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already present/);
  });

  it('is a no-op when recall/GC markers are present but reverse-check misses', () => {
    const rns = makeFakeRsReticulum(MARKER_FALLBACK);
    const reverse = git(rns, ['apply', '--reverse', '--check', PATCH_FILE]);
    expect(reverse.status).not.toBe(0);
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
