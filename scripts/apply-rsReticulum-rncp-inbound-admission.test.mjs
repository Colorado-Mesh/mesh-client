import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-rncp-inbound-admission.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-rncp-inbound-admission.patch',
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
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-rncp-admission-rns-'));
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

afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop(), { recursive: true, force: true });
});

describe('apply-rsReticulum-rncp-inbound-admission.sh', () => {
  it('contains the complete pre-advertisement admission contract', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('set_resource_accept_handler');
    expect(patch).toContain('RncpReceiveMode::EmitPayload');
    expect(patch).toContain('max_active_per_identity');
    expect(patch).toContain('max_reserved_bytes');
    expect(patch).toContain('validate_completed_payload');
    expect(patch).toContain('set_accounting_event_channel');
    expect(patch).toContain('logical_resource_id');
    expect(patch).toContain('next_segment_index');
    expect(patch).toContain('release_incomplete_for_link');
    expect(patch).toContain('inbound_admission_rejects_before_receiving_untrusted_bytes');
    expect(patch).toContain('RncpReceiveMode::SaveToDirectory');
    expect(patch).toContain('api/stability.json');
    expect(patch).toContain('pub struct rns_runtime::rncp::RncpPayloadAck(_)');
    expect(patch).toContain('pub struct RncpFetchLimits');
    expect(patch).toContain('FetchReceiveBudget');
    expect(patch).toContain('bounded_fetch_accepts_stock_file_and_exact_limits');
    expect(patch).toContain('bounded_fetch_keeps_split_metadata_and_compression_compatibility');
    expect(patch).toContain('bounded_fetch_rejects_invalid_declarations_and_actual_sizes');
    expect(patch).toContain('bounded_fetch_rejects_wire_bytes_before_part_retention');
    expect(patch).toContain('fetch packet exceeded negotiated MTU');
  });

  it('does not treat marker-only partial content as the complete overlay', () => {
    const rns = makeFakeRsReticulum({
      'crates/rns-runtime/src/rncp.rs':
        'set_resource_accept_handler\nRncpReceiveMode::EmitPayload\nRNCP_PAYLOAD_ACK_TIMEOUT\nvalidate_completed_payload\nset_accounting_event_channel\nlogical_resource_id\nnext_segment_index\nrelease_incomplete_for_link\n',
      'crates/rns-tools/src/commands/rncp.rs': 'RncpReceiveMode::SaveToDirectory\n',
    });
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toMatch(/already applied/);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });

  it('requires full reverse patch applicability before reporting a no-op', () => {
    const script = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(script).toContain('git -C "${RNS_DIR}" apply --reverse --check "${PATCH_FILE}"');
    expect(script).not.toContain("grep -q 'set_resource_accept_handler'");
  });

  it('does not accept the superseded lossy accounting markers as complete', () => {
    const rns = makeFakeRsReticulum({
      'crates/rns-runtime/src/rncp.rs':
        'set_resource_accept_handler\nRncpReceiveMode::EmitPayload\nRNCP_PAYLOAD_ACK_TIMEOUT\nvalidate_completed_payload\n',
      'crates/rns-tools/src/commands/rncp.rs': 'RncpReceiveMode::SaveToDirectory\n',
    });
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toMatch(/already applied/);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });

  it('does not mistake a partial payload marker for the overlay', () => {
    const rns = makeFakeRsReticulum({
      'crates/rns-runtime/src/rncp.rs': 'RncpReceiveMode::EmitPayload\n',
      'crates/rns-tools/src/commands/rncp.rs': 'RncpReceiveMode::SaveToDirectory\n',
    });
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toMatch(/already applied/);
    expect(result.stderr).toMatch(/did not apply|regenerate overlay/);
  });
});
