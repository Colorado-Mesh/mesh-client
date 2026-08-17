import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-announce-rebroadcast-exclude-rf.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-announce-rebroadcast-exclude-rf.patch',
);

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

function makeFakeRsReticulum(modSource) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-announce-rf-rns-'));
  temps.push(root);
  const modPath = path.join(root, 'crates/rns-transport/src/actor/mod.rs');
  mkdirSync(path.dirname(modPath), { recursive: true });
  writeFileSync(modPath, modSource);
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

/** Minimal fixture matching both overlay hunks in actor/mod.rs. */
const CLEAN_ANNOUNCE_CONTEXT = `mod rpc;
const LOCAL_LINK_INITIATOR_INTERFACE: InterfaceId = InterfaceId::MAX;
const LOCAL_LINK_RESPONDER_INTERFACE: InterfaceId = InterfaceId::MAX - 1;

#[derive(Clone)]
struct LocalLinkRoute {
    initiator_tx: mpsc::Sender<crate::link_messages::DestinationEvent>,
}

impl TransportActor {
    /// Enqueue an announce on every eligible outbound interface (except
    /// optionally one). Eligibility mirrors Python's AP/roaming/boundary mode
    /// gates. Enqueueing lets \`process_announce_queues\` apply ANNOUNCE_CAP
    /// spacing and hop priority.
    fn broadcast_announce_on_interfaces(&mut self, raw: &[u8], except: Option<InterfaceId>) {
        let destination_hash = rns_wire::header::PacketHeader::unpack(raw)
            .ok()
            .map(|(h, _)| h.destination_hash)
            .unwrap_or([0u8; 16]);
        let hops = raw.get(1).copied().unwrap_or(0);
        let now = now_f64();
        // One copy at the boundary; per-interface queue entries clone the
        // shared Arc for free.
        let shared = Bytes::copy_from_slice(raw);

        let ids: Vec<InterfaceId> = self
            .interfaces
            .keys()
            .copied()
            .filter(|id| self.interface_allows_announce(*id, &destination_hash, except))
            .collect();

    }
}
`;

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('apply-rsReticulum-announce-rebroadcast-exclude-rf.sh', () => {
  it('inlines iface_is_rf_sink and skips RF sinks in announce rebroadcast only', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('fn iface_is_rf_sink');
    expect(patch).toContain('broadcast_announce_on_interfaces');
    expect(patch).toContain('iface_is_rf_sink(entry)');
    expect(patch).toContain('broadcast_local_announce_on_interfaces');
    expect(patch).not.toContain('iface_is_pathless_link_rf_sink');
    expect(patch).toMatch(/crates\/rns-transport\/src\/actor\/mod\.rs/);
  });

  it('applies on a fixture with broadcast_announce_on_interfaces context', () => {
    const rns = makeFakeRsReticulum(CLEAN_ANNOUNCE_CONTEXT);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const applied = readFileSync(path.join(rns, 'crates/rns-transport/src/actor/mod.rs'), 'utf8');
    expect(applied).toContain('fn iface_is_rf_sink');
    expect(applied).toContain('iface_is_rf_sink(entry)');
    expect(applied).toContain('Flow-controlled RF sinks');
  });

  it('is a no-op when iface_is_rf_sink is already present', () => {
    const rns = makeFakeRsReticulum(
      'fn iface_is_rf_sink(entry: &InterfaceEntry) -> bool { false }\n',
    );
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already applied/);
  });

  it('fails with git diagnostic on incompatible checkouts', () => {
    const rns = makeFakeRsReticulum('fn broadcast_on_interfaces() {}\n');
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });
});
